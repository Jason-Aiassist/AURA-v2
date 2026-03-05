/**
 * Semantic Extraction Types
 * Types for relationship-aware extraction
 */

import type { MemoryCategory } from "../../categories/types.js";
import type { EntityType, SemanticRelationship } from "../../graph/ontology/types.js";

/**
 * Extracted entity with semantic information
 */
export interface SemanticExtractedEntity {
  /** Entity name (unique identifier) */
  name: string;
  /** Entity type classification */
  type: EntityType;
  /** Confidence score (0.0-1.0) */
  confidence: number;
  /** Optional aliases for entity matching */
  aliases?: string[];
  /** Optional description/summary */
  summary?: string;
}

/**
 * Extracted semantic relationship between entities
 */
export interface SemanticExtractedRelationship {
  /** Source entity name */
  from: string;
  /** Target entity name */
  to: string;
  /** Relationship type */
  type: SemanticRelationship;
  /** Confidence score (0.0-1.0) */
  confidence: number;
  /** Supporting evidence text */
  fact?: string;
}

/**
 * Complete semantic extraction result
 */
export interface SemanticExtractionResult {
  /** Extracted entities */
  entities: SemanticExtractedEntity[];
  /** Extracted relationships between entities */
  relationships: SemanticExtractedRelationship[];
  /** Processing metadata */
  metadata: {
    /** Duration in milliseconds */
    durationMs: number;
    /** Token usage */
    tokensUsed: {
      input: number;
      output: number;
      total: number;
    };
    /** Whether output was validated */
    wasValidated: boolean;
    /** Validation errors if any */
    validationErrors?: string[];
  };
}

/**
 * Memory extraction with semantic metadata
 */
export interface SemanticMemoryExtraction {
  /** Extracted memory content */
  content: string;
  /** Suggested category */
  category: MemoryCategory;
  /** Confidence score (0.0-1.0) */
  confidence: number;
  /** Importance score (0.0-1.0) */
  importance: number;
  /** Reasoning for extraction */
  reasoning: string;
  /** Source message IDs */
  sourceMessageIds: string[];
  /** Entities mentioned in this memory */
  entities?: SemanticExtractedEntity[];
  /** Relationships relevant to this memory */
  relationships?: SemanticExtractedRelationship[];
}

/**
 * Extended extraction output with semantic data
 */
export interface SemanticExtractionOutput {
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Extracted memories with semantic metadata */
  memories: SemanticMemoryExtraction[];
  /** All entities extracted from conversation */
  entities: SemanticExtractedEntity[];
  /** All relationships extracted from conversation */
  relationships: SemanticExtractedRelationship[];
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
 * Semantic extraction input
 */
export interface SemanticExtractionInput {
  /** Messages to analyze */
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
  }>;
  /** Maximum entities to extract (default: 20) */
  maxEntities?: number;
  /** Maximum relationships to extract (default: 30) */
  maxRelationships?: number;
  /** Minimum confidence threshold (default: 0.7) */
  minConfidence?: number;
}

/**
 * Raw LLM output for semantic extraction
 */
export interface RawSemanticExtractionOutput {
  /** Extracted entities */
  entities?: Array<{
    name?: string;
    type?: string;
    confidence?: number;
    aliases?: string[];
    summary?: string;
  }>;
  /** Extracted relationships */
  relationships?: Array<{
    from?: string;
    to?: string;
    type?: string;
    confidence?: number;
    fact?: string;
  }>;
}

/**
 * Validation result for semantic extraction
 */
export interface SemanticValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Valid entities */
  validEntities: SemanticExtractedEntity[];
  /** Valid relationships */
  validRelationships: SemanticExtractedRelationship[];
  /** Validation errors */
  errors: ValidationError[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  /** Field that failed validation */
  field: string;
  /** Error message */
  message: string;
  /** Original value */
  value: unknown;
  /** Error type */
  type: "entity" | "relationship" | "schema";
}

/**
 * Prompt variables for semantic extraction
 */
export interface SemanticPromptVariables {
  /** Formatted conversation */
  messages: string;
  /** Maximum entities */
  maxEntities: number;
  /** Maximum relationships */
  maxRelationships: number;
  /** Relationship ontology description */
  relationshipOntology: string;
  /** Entity type definitions */
  entityTypes: string;
  /** Current timestamp */
  currentTime: string;
}
