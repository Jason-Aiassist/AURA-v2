/**
 * PII Detection and Sanitization Types
 *
 * Types for the multi-layer PII detection system.
 */

/** Types of PII that can be detected */
export type PiiType =
  | "api_key"
  | "aws_key"
  | "password"
  | "token"
  | "email"
  | "phone"
  | "address"
  | "ssn"
  | "credit_card"
  | "ip_address"
  | "url_with_creds"
  | "private_key";

/** A detected PII item */
export interface DetectedPii {
  type: PiiType;
  start: number;
  end: number;
  value: string;
  hash: string;
  confidence: "high" | "medium" | "low";
  detectedBy: "regex" | "llm";
}

/** Result of sanitization */
export interface SanitizationResult {
  sanitizedText: string;
  piiDetected: DetectedPii[];
  auditId: string;
  timestamp: number;
}

/** Audit log entry for PII detection */
export interface PiiAuditEntry {
  id: string;
  timestamp: number;
  hash: string;
  type: PiiType;
  detectedBy: "regex" | "llm";
  redacted: boolean;
  metadata?: Record<string, unknown>;
}

/** Sanitization configuration */
export interface SanitizationConfig {
  /** Enable regex layer (default: true) */
  enableRegexLayer: boolean;
  /** Enable LLM layer (default: true) */
  enableLlmLayer: boolean;
  /** Timeout for LLM layer in ms (default: 5000) */
  llmTimeoutMs: number;
  /** Types to always redact regardless of context */
  alwaysRedact: PiiType[];
  /** Placeholder format: bracket, asterisk, or hash (default: bracket) */
  placeholderFormat: "bracket" | "asterisk" | "hash";
}

/** Default sanitization configuration */
export const DEFAULT_SANITIZATION_CONFIG: SanitizationConfig = {
  enableRegexLayer: true,
  enableLlmLayer: true,
  llmTimeoutMs: 5000,
  alwaysRedact: ["api_key", "aws_key", "password", "token", "private_key", "ssn", "credit_card"],
  placeholderFormat: "bracket",
};
