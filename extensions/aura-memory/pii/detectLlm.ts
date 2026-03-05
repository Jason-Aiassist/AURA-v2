/**
 * LLM-Based PII Detection (Layer 2)
 *
 * Context-aware PII detection using LLM.
 * Used when regex is inconclusive or for context-dependent PII (addresses, etc.)
 * Timeout: 5 seconds (configurable)
 */

import { hashContent } from "./hashContent";
import { DetectedPii, PiiType } from "./types";

/** LLM detection result */
interface LlmDetectionResult {
  detected: boolean;
  items?: Array<{
    type: PiiType;
    value: string;
    start: number;
    end: number;
    confidence: "high" | "medium" | "low";
  }>;
}

/** PII detection prompt template */
const PII_DETECTION_PROMPT = `You are a PII (Personally Identifiable Information) detection system.

Analyze the following text for any PII. Look for:
- Email addresses
- Phone numbers
- Physical addresses (street, city, state, zip)
- Names combined with other identifying info
- Dates of birth
- Any context-dependent PII not caught by regex patterns

Return a JSON object with this exact structure:
{
  "detected": true/false,
  "items": [
    {
      "type": "email|phone|address|ssn|credit_card|...",
      "value": "the exact PII text",
      "start": character index where PII starts,
      "end": character index where PII ends,
      "confidence": "high|medium|low"
    }
  ]
}

If no PII is detected, return {"detected": false}.

Be precise with start/end positions - they must match the exact location in the input text.

TEXT TO ANALYZE:
---
{text}
---`;

/**
 * Detect PII using LLM (context-aware)
 *
 * NOTE: This is a placeholder implementation.
 * In production, this would call an actual LLM API.
 * For testing, we use mock responses.
 *
 * @param text - The text to analyze
 * @param timeoutMs - Timeout in milliseconds
 * @returns Array of detected PII items (may be empty)
 */
export async function detectLlmPii(text: string, timeoutMs: number = 5000): Promise<DetectedPii[]> {
  // In production, this would:
  // 1. Call LLM with timeout
  // 2. Parse JSON response
  // 3. Validate and return detected items

  // For now, return empty (regex layer handles most critical PII)
  // This is a stub for the interface
  return [];
}

/**
 * Create the detection prompt for the LLM
 */
export function createDetectionPrompt(text: string): string {
  return PII_DETECTION_PROMPT.replace("{text}", text);
}

/**
 * Parse LLM response into structured format
 */
export function parseLlmResponse(response: string, originalText: string): DetectedPii[] {
  try {
    const parsed: LlmDetectionResult = JSON.parse(response);

    if (!parsed.detected || !parsed.items) {
      return [];
    }

    return parsed.items.map((item) => ({
      type: item.type,
      start: item.start,
      end: item.end,
      value: originalText.slice(item.start, item.end),
      hash: hashContent(item.value),
      confidence: item.confidence,
      detectedBy: "llm" as const,
    }));
  } catch (error) {
    // Invalid JSON response - log and return empty
    return [];
  }
}

/**
 * Mock LLM detector for testing
 * Returns predefined PII for specific test inputs
 */
export function createMockLlmDetector(
  mockResults: Map<string, DetectedPii[]>,
): (text: string, timeoutMs?: number) => Promise<DetectedPii[]> {
  return async (text: string, _timeoutMs?: number): Promise<DetectedPii[]> => {
    for (const [key, results] of mockResults) {
      if (text.includes(key)) {
        return results;
      }
    }
    return [];
  };
}
