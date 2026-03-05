// Extraction Engine Types
// Story 3.1: LLM-Based Extraction Engine

import type { MemoryCategory } from "../categories/types.js";

/**
 * Extraction mode determines routing of extracted memories
 */
export type ExtractionMode = "manual" | "review" | "automatic";

/**
 * Single memory extraction result
 */
export interface MemoryExtraction {
  /** Extracted memory content */
  content: string;
  /** Suggested category */
  category: MemoryCategory;
  /** Confidence score (0.0-1.0) */
  confidence: number;
  /** Importance score (0.0-1.0) - how much this matters for future interactions */
  importance: number;
  /** Reasoning for extraction */
  reasoning: string;
  /** Source message IDs that support this extraction */
  sourceMessageIds: string[];
}

/**
 * Extraction engine input
 */
export interface ExtractionInput {
  /** Messages to analyze */
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
  }>;
  /** Extraction mode */
  mode: ExtractionMode;
  /** Optional user hint/prompt */
  userHint?: string;
  /** Maximum memories to extract (default: 5) */
  maxMemories?: number;
}

/**
 * Extracted entity
 */
export interface ExtractedEntity {
  /** Entity name */
  name: string;
  /** Entity type */
  type: string;
  /** Alternative names/aliases */
  aliases?: string[];
}

/**
 * Extracted relationship
 */
export interface ExtractedRelationship {
  /** Source entity name */
  from: string;
  /** Target entity name */
  to: string;
  /** Relationship type */
  type: string;
  /** Confidence score (0.0-1.0) */
  confidence: number;
}

/**
 * Extraction engine output
 */
export interface ExtractionOutput {
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Extracted memories */
  memories: MemoryExtraction[];
  /** Extracted entities */
  entities: ExtractedEntity[];
  /** Extracted relationships */
  relationships: ExtractedRelationship[];
  /** Token usage */
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  /** Processing duration in ms */
  durationMs: number;
  /** Whether output was validated */
  wasValidated: boolean;
}

/**
 * Confidence factors
 */
export interface ConfidenceFactors {
  /** Clarity: Is the statement clear and unambiguous? (0-1) */
  clarity: number;
  /** Importance: Does this matter for future interactions? (0-1) */
  importance: number;
  /** Specificity: Is it specific rather than vague? (0-1) */
  specificity: number;
  /** Context: Is there supporting context? (0-1) */
  context: number;
}

/**
 * Prompt template variables
 */
export interface PromptVariables {
  /** Messages to analyze (formatted) */
  messages: string;
  /** User hint if any */
  userHint?: string;
  /** Maximum memories to extract */
  maxMemories: number;
  /** Available categories */
  categories: string;
  /** Current date/time */
  currentTime: string;
}

/**
 * Raw LLM output (before validation)
 */
export interface RawExtractionOutput {
  memories: Array<{
    content?: string;
    category?: string;
    confidence?: number;
    reasoning?: string;
    sourceMessageIds?: string[];
  }>;
  entities?: Array<{
    name?: string;
    type?: string;
    aliases?: string[];
  }>;
  relationships?: Array<{
    from?: string;
    to?: string;
    type?: string;
    confidence?: number;
  }>;
}

/**
 * Extraction engine configuration
 */
export interface ExtractionConfig {
  /** Minimum confidence threshold (default: 0.75) */
  minConfidence: number;
  /** Maximum tokens per extraction call (default: 2000) */
  maxTokens: number;
  /** Maximum memories per extraction (default: 5) */
  maxMemories: number;
  /** Enable output validation (default: true) */
  validateOutput: boolean;
  /** Temperature for LLM (default: 0.3) */
  temperature: number;
}

/**
 * LLM client interface
 */
export interface LLMClient {
  complete(params: { prompt: string; maxTokens: number; temperature: number }): Promise<{
    content: string;
    tokensUsed: { input: number; output: number };
  }>;
}

/**
 * Extraction engine dependencies
 */
export interface ExtractionDependencies {
  /** LLM client for extraction */
  llm: LLMClient;
  /** PII sanitizer */
  sanitize: (text: string) => Promise<{ sanitizedText: string }>;
  /** Audit logger */
  auditLog: (event: {
    operation: string;
    correlationId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  /** Timestamp provider */
  now: () => number;
  /** ID generator */
  generateId: () => string;
}

/**
 * Extraction engine interface
 */
export interface IExtractionEngine {
  extract(input: ExtractionInput): Promise<ExtractionOutput>;
}
