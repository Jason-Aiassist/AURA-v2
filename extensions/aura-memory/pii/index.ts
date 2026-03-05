/**
 * PII Sanitization Module
 *
 * Multi-layer PII detection and sanitization system.
 *
 * Usage:
 * ```typescript
 * import { sanitize, sanitizeSync } from './pii';
 *
 * // Async with LLM layer
 * const result = await sanitize("My key is sk-abc123...");
 * // result.sanitizedText: "My key is [API_KEY]"
 *
 * // Sync with regex only
 * const result = sanitizeSync("My password is secret123");
 * // result.sanitizedText: "My password is [PASSWORD]"
 * ```
 */

// Types
export * from "./types";

// Core functions
export { sanitize, sanitizeSync } from "./sanitize";
export { detectRegexPii, mightContainPii } from "./detectRegex";
export {
  detectLlmPii,
  createDetectionPrompt,
  parseLlmResponse,
  createMockLlmDetector,
} from "./detectLlm";
export { hashContent, hashContentWithPepper } from "./hashContent";
export {
  getAuditLogger,
  setAuditLogger,
  logPiiDetection,
  logMultiplePiiDetections,
  type AuditLogger,
} from "./auditLogger";

// Constants
export {
  ALL_REGEX_PATTERNS,
  OPENAI_KEY_PATTERN,
  AWS_KEY_PATTERN,
  PASSWORD_PATTERNS,
  TOKEN_PATTERNS,
  type RegexPattern,
} from "./constants";
