/**
 * Regex PII Detection (Layer 1)
 *
 * Fast regex-based PII detection.
 * Completes in <5ms for 1000-character input.
 * Zero false negatives on critical patterns (API keys, passwords, tokens).
 */

import { ALL_REGEX_PATTERNS, RegexPattern } from "./constants";
import { hashContent } from "./hashContent";
import { DetectedPii } from "./types";

/**
 * Detect PII using regex patterns
 * @param text - The text to analyze
 * @returns Array of detected PII items
 */
export function detectRegexPii(text: string): DetectedPii[] {
  const detected: DetectedPii[] = [];
  const seenRanges = new Set<string>();

  for (const pattern of ALL_REGEX_PATTERNS) {
    const matches = findAllMatches(text, pattern);

    for (const match of matches) {
      // Skip if this range overlaps with already detected PII
      const rangeKey = `${match.start}-${match.end}`;
      if (seenRanges.has(rangeKey)) continue;

      // Check for any overlapping ranges
      let overlaps = false;
      for (let i = match.start; i < match.end; i++) {
        if (seenRanges.has(`${i}-${i + 1}`)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      // Mark range as used
      for (let i = match.start; i < match.end; i++) {
        seenRanges.add(`${i}-${i + 1}`);
      }

      detected.push({
        type: pattern.type,
        start: match.start,
        end: match.end,
        value: match.value,
        hash: hashContent(match.value),
        confidence: pattern.confidence,
        detectedBy: "regex",
      });
    }
  }

  // Sort by position in text
  return detected.sort((a, b) => a.start - b.start);
}

/**
 * Find all matches for a pattern, handling capture groups
 */
function findAllMatches(
  text: string,
  pattern: RegexPattern,
): Array<{ start: number; end: number; value: string }> {
  const matches: Array<{ start: number; end: number; value: string }> = [];
  const regex = new RegExp(
    pattern.pattern.source,
    pattern.pattern.flags.includes("g") ? pattern.pattern.flags : pattern.pattern.flags + "g",
  );

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    // Use first capture group if present, otherwise full match
    const value = match[1] ?? match[0];
    const start = match.index + match[0].indexOf(value);
    const end = start + value.length;

    matches.push({ start, end, value });

    // Prevent infinite loop on zero-length matches
    if (match[0].length === 0) {
      regex.lastIndex++;
    }
  }

  return matches;
}

/**
 * Quick check if text might contain PII (for fast path)
 * @param text - The text to check
 * @returns True if potential PII detected
 */
export function mightContainPii(text: string): boolean {
  // Quick heuristics before running full regex
  const quickChecks = [
    /sk-[a-zA-Z0-9]{10,}/, // Potential OpenAI key prefix
    /password/i,
    /token/i,
    /api[_-]?key/i,
    /AKIA/, // AWS key prefix
    /-----BEGIN/, // PEM header
    /\d{3}-\d{2}-\d{4}/, // SSN pattern
    /@.+\./, // Email pattern (contains @ and . after)
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card pattern
  ];

  return quickChecks.some((pattern) => pattern.test(text));
}
