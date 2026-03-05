/**
 * PII Regex Patterns
 *
 * Layer 1: Regex-based detection for common PII patterns.
 * These patterns are designed for zero false negatives on critical data.
 */

import { PiiType } from "./types";

/** Regex pattern entry with metadata */
export interface RegexPattern {
  type: PiiType;
  pattern: RegExp;
  confidence: "high" | "medium";
  description: string;
}

/**
 * OpenAI API key pattern
 * Format: sk-[a-zA-Z0-9]{32,64}
 * Also catches sk-proj-, sk-live-, sk-test- variants
 * Relaxed length requirement for flexibility
 */
export const OPENAI_KEY_PATTERN: RegexPattern = {
  type: "api_key",
  pattern: /sk-(?:proj-|live-|test-)?[a-zA-Z0-9]{32,64}/g,
  confidence: "high",
  description: "OpenAI API key",
};

/**
 * GitHub token patterns
 * Formats: ghp_*, gho_*, ghu_*, ghs_*,ghr_*
 */
export const GITHUB_TOKEN_PATTERN: RegexPattern = {
  type: "api_key",
  pattern: /gh[pousr]_[A-Za-z0-9_]{36}/g,
  confidence: "high",
  description: "GitHub personal access token",
};

/**
 * Slack token patterns
 * Formats: xoxb-*, xoxp-*, xoxa-*, xoxr-*
 */
export const SLACK_TOKEN_PATTERN: RegexPattern = {
  type: "api_key",
  pattern: /xox[bpar]-[0-9]{10,13}-[0-9]{10,13}(-[a-zA-Z0-9]{24})?/g,
  confidence: "high",
  description: "Slack token",
};

/**
 * Stripe API key patterns
 * Formats: sk_live_*, pk_live_*, sk_test_*, pk_test_*
 */
export const STRIPE_KEY_PATTERN: RegexPattern = {
  type: "api_key",
  pattern: /(?:sk|pk)_(?:live|test)_[0-9a-zA-Z]{24}/g,
  confidence: "high",
  description: "Stripe API key",
};

/**
 * Generic API key patterns
 * Common prefixes: api_key, apikey, api-key followed by base64 or hex
 */
export const GENERIC_API_KEY_PATTERNS: RegexPattern[] = [
  {
    type: "api_key",
    pattern: /(?:api[_-]?key|apikey)[:\s=]+['"]?([a-zA-Z0-9_-]{32,64})['"]?/gi,
    confidence: "high",
    description: "Generic API key with prefix",
  },
  {
    type: "api_key",
    pattern: /\b[a-f0-9]{32,64}\b/gi,
    confidence: "medium",
    description: "Potential API key (hex)",
  },
  {
    type: "api_key",
    pattern: /\b[A-Za-z0-9+/]{32,64}={0,2}\b/g,
    confidence: "low",
    description: "Potential API key (base64)",
  },
];

/**
 * AWS access key ID pattern
 * Format: AKIA[0-9A-Z]{16}
 */
export const AWS_KEY_PATTERN: RegexPattern = {
  type: "aws_key",
  pattern: /AKIA[0-9A-Z]{16}/g,
  confidence: "high",
  description: "AWS access key ID",
};

/**
 * AWS secret access key pattern
 * Format: 40-character base64 string
 */
export const AWS_SECRET_PATTERN: RegexPattern = {
  type: "aws_key",
  pattern:
    /(?:aws[_-]?secret[_-]?access[_-]?key|aws_secret)[:\s=]+['"]?([a-zA-Z0-9/+=]{40})['"]?/gi,
  confidence: "high",
  description: "AWS secret access key",
};

/**
 * Password patterns
 * Various common patterns for password declarations
 */
export const PASSWORD_PATTERNS: RegexPattern[] = [
  {
    type: "password",
    pattern: /(?:password|passwd|pwd)[:\s=]+['"]?([^'"]{3,}?)(?=['"]?(?:\s|$|[.!,?]))/giu,
    confidence: "high",
    description: "Password with label",
  },
  {
    type: "password",
    pattern: /pass[:\s=]+['"]?([^'"]{3,}?)(?=['"]?(?:\s|$|[.!,?]))/giu,
    confidence: "medium",
    description: "Potential password abbreviation",
  },
];

/**
 * Bearer token pattern
 * Format: Bearer <token>
 * Catches JWTs and other bearer tokens
 */
export const BEARER_TOKEN_PATTERN: RegexPattern = {
  type: "token",
  pattern: /bearer\s+[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]*)*/gi,
  confidence: "high",
  description: "Bearer token",
};

/**
 * Generic token patterns
 */
export const TOKEN_PATTERNS: RegexPattern[] = [
  {
    type: "token",
    pattern: /(?:token|auth_token|access_token)[:\s=]+['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,
    confidence: "high",
    description: "Generic token with label",
  },
  {
    type: "token",
    pattern: /\beyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\b/g,
    confidence: "high",
    description: "JWT token (base64url)",
  },
];

/**
 * Email address pattern
 */
export const EMAIL_PATTERN: RegexPattern = {
  type: "email",
  pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
  confidence: "high",
  description: "Email address",
};

/**
 * Phone number patterns (US and international)
 */
export const PHONE_PATTERNS: RegexPattern[] = [
  {
    type: "phone",
    pattern: /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    confidence: "high",
    description: "US phone number",
  },
  {
    type: "phone",
    pattern: /\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
    confidence: "medium",
    description: "International phone number",
  },
];

/**
 * Social Security Number pattern
 */
export const SSN_PATTERN: RegexPattern = {
  type: "ssn",
  pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
  confidence: "high",
  description: "Social Security Number",
};

/**
 * Credit card patterns (major providers)
 */
export const CREDIT_CARD_PATTERNS: RegexPattern[] = [
  {
    type: "credit_card",
    pattern: /\b4\d{3}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g,
    confidence: "high",
    description: "Visa card",
  },
  {
    type: "credit_card",
    pattern: /\b5[1-5]\d{2}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g,
    confidence: "high",
    description: "Mastercard",
  },
  {
    type: "credit_card",
    pattern: /\b3[47]\d{13}\b/g,
    confidence: "high",
    description: "American Express",
  },
];

/**
 * IP address patterns
 */
export const IP_ADDRESS_PATTERNS: RegexPattern[] = [
  {
    type: "ip_address",
    pattern:
      /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    confidence: "high",
    description: "IPv4 address",
  },
  {
    type: "ip_address",
    pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    confidence: "high",
    description: "IPv6 address",
  },
];

/**
 * URL with credentials pattern
 */
export const URL_WITH_CREDS_PATTERN: RegexPattern = {
  type: "url_with_creds",
  pattern: /https?:\/\/[^\s:@]+:[^\s@]+@[^\s/]+/gi,
  confidence: "high",
  description: "URL with embedded credentials",
};

/**
 * Private key patterns (PEM format)
 */
export const PRIVATE_KEY_PATTERNS: RegexPattern[] = [
  {
    type: "private_key",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    confidence: "high",
    description: "PEM private key",
  },
  {
    type: "private_key",
    pattern:
      /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:ENCRYPTED )?PRIVATE KEY-----/g,
    confidence: "high",
    description: "Encrypted private key",
  },
];

/** All regex patterns in priority order (high confidence first) */
export const ALL_REGEX_PATTERNS: RegexPattern[] = [
  // Highest priority: Private keys and specific API keys
  ...PRIVATE_KEY_PATTERNS, // Must come before generic hex pattern
  OPENAI_KEY_PATTERN, // OpenAI before generic patterns
  GITHUB_TOKEN_PATTERN,
  SLACK_TOKEN_PATTERN,
  STRIPE_KEY_PATTERN,
  AWS_KEY_PATTERN,
  AWS_SECRET_PATTERN,
  // Tokens and credentials
  BEARER_TOKEN_PATTERN,
  ...PASSWORD_PATTERNS,
  ...TOKEN_PATTERNS,
  // Sensitive numbers
  SSN_PATTERN,
  ...CREDIT_CARD_PATTERNS,
  URL_WITH_CREDS_PATTERN,
  // Contact info (lower priority to avoid false positives)
  EMAIL_PATTERN,
  ...PHONE_PATTERNS,
  ...IP_ADDRESS_PATTERNS,
  // Generic patterns last (lowest priority)
  ...GENERIC_API_KEY_PATTERNS,
];
