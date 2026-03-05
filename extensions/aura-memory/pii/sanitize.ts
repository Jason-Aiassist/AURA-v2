/**
 * PII Sanitization Orchestrator
 *
 * Main entry point for PII detection and sanitization.
 * Coordinates Layer 1 (regex) and Layer 2 (LLM) detection.
 * Returns sanitized text with PII replaced by typed placeholders.
 */

import { logMultiplePiiDetections } from "./auditLogger";
import { detectLlmPii } from "./detectLlm";
import { detectRegexPii, mightContainPii } from "./detectRegex";
import {
  SanitizationResult,
  SanitizationConfig,
  DEFAULT_SANITIZATION_CONFIG,
  DetectedPii,
  PiiType,
} from "./types";

/**
 * Sanitize text by detecting and redacting PII
 * @param text - The text to sanitize
 * @param config - Optional configuration overrides
 * @returns Sanitization result with sanitized text and detected PII metadata
 */
export async function sanitize(
  text: string,
  config: Partial<SanitizationConfig> = {},
): Promise<SanitizationResult> {
  const fullConfig = { ...DEFAULT_SANITIZATION_CONFIG, ...config };
  const correlationId = generateCorrelationId();

  // Fast path: check if text might contain PII
  if (!mightContainPii(text) && fullConfig.enableRegexLayer) {
    return {
      sanitizedText: text,
      piiDetected: [],
      auditId: `audit-${Date.now()}-clean`,
      timestamp: Date.now(),
    };
  }

  // Layer 1: Regex detection (fast, always runs if enabled)
  const regexPii: DetectedPii[] = fullConfig.enableRegexLayer ? detectRegexPii(text) : [];

  // Layer 2: LLM detection (context-aware, only if regex inconclusive or enabled)
  let llmPii: DetectedPii[] = [];
  if (fullConfig.enableLlmLayer && needsLlmDetection(text, regexPii)) {
    llmPii = await detectLlmPii(text, fullConfig.llmTimeoutMs);
  }

  // Merge detections (regex takes priority on overlaps)
  const allPii = mergeDetections(regexPii, llmPii);

  // Apply redaction
  const sanitizedText = applyRedaction(text, allPii, fullConfig.placeholderFormat);

  // Log to audit (hashes only, never original content)
  const auditId = logMultiplePiiDetections(allPii, correlationId);

  return {
    sanitizedText,
    piiDetected: allPii,
    auditId,
    timestamp: Date.now(),
  };
}

/**
 * Synchronous sanitization (regex layer only)
 * Use when async is not possible and LLM layer not needed
 * @param text - The text to sanitize
 * @returns Sanitization result
 */
export function sanitizeSync(text: string): SanitizationResult {
  const correlationId = generateCorrelationId();

  if (!mightContainPii(text)) {
    return {
      sanitizedText: text,
      piiDetected: [],
      auditId: `audit-${Date.now()}-clean`,
      timestamp: Date.now(),
    };
  }

  const detected = detectRegexPii(text);
  const sanitizedText = applyRedaction(text, detected, "bracket");
  const auditId = logMultiplePiiDetections(detected, correlationId);

  return {
    sanitizedText,
    piiDetected: detected,
    auditId,
    timestamp: Date.now(),
  };
}

/**
 * Check if LLM detection is needed
 * (when regex detects potential addresses or context-dependent PII)
 */
function needsLlmDetection(text: string, regexPii: DetectedPii[]): boolean {
  // Always run LLM if no regex detections (to catch context-dependent PII)
  if (regexPii.length === 0) {
    return (
      /\d+\s+\w+\s+(street|st|avenue|ave|road|rd|boulevard|blvd)/i.test(text) ||
      /\b\d{5}(-\d{4})?\b/.test(text)
    );
  }

  // Run LLM if we detected emails or phones (might be part of addresses)
  const needsContext = regexPii.some(
    (p) => p.type === "email" || p.type === "phone" || p.type === "ip_address",
  );

  return needsContext;
}

/**
 * Merge regex and LLM detections, with regex taking priority on overlaps
 */
function mergeDetections(regexPii: DetectedPii[], llmPii: DetectedPii[]): DetectedPii[] {
  const result = [...regexPii];
  const regexRanges = new Set<string>();

  // Mark all regex ranges
  for (const pii of regexPii) {
    for (let i = pii.start; i < pii.end; i++) {
      regexRanges.add(`${i}-${i + 1}`);
    }
  }

  // Add LLM detections that don't overlap
  for (const pii of llmPii) {
    let overlaps = false;
    for (let i = pii.start; i < pii.end && !overlaps; i++) {
      if (regexRanges.has(`${i}-${i + 1}`)) {
        overlaps = true;
      }
    }

    if (!overlaps) {
      result.push(pii);
    }
  }

  // Sort by position
  return result.sort((a, b) => a.start - b.start);
}

/**
 * Apply redaction to text, replacing PII with placeholders
 */
function applyRedaction(
  text: string,
  piiList: DetectedPii[],
  format: "bracket" | "asterisk" | "hash",
): string {
  if (piiList.length === 0) {
    return text;
  }

  let result = "";
  let lastEnd = 0;

  for (const pii of piiList) {
    // Add text before this PII
    result += text.slice(lastEnd, pii.start);

    // Add placeholder
    result += createPlaceholder(pii.type, format);

    lastEnd = pii.end;
  }

  // Add remaining text
  result += text.slice(lastEnd);

  return result;
}

/**
 * Create a placeholder for a PII type
 */
function createPlaceholder(type: PiiType, format: "bracket" | "asterisk" | "hash"): string {
  const formattedType = type.toUpperCase().replace(/_/g, "_");

  switch (format) {
    case "bracket":
      return `[${formattedType}]`;
    case "asterisk":
      return "***";
    case "hash":
      return "####";
    default:
      return `[${formattedType}]`;
  }
}

/**
 * Generate a correlation ID for tracing
 */
function generateCorrelationId(): string {
  return `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
