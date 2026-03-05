/**
 * Semantic Extraction Bridge Types
 * Types for integrating Phase 1 semantic extraction into production
 */

import type { MemoryCategory } from "../../categories/types.js";
import type {
  SemanticExtractionOutput,
  SemanticExtractedEntity,
  SemanticExtractedRelationship,
} from "../../extraction/semantic/types.js";

/**
 * Bridge configuration
 */
export interface BridgeConfig {
  /** Enable semantic extraction (default: false) */
  enabled: boolean;
  /** Enable debug logging */
  debug: boolean;
  /** Minimum confidence for relationships (default: 0.7) */
  minConfidence: number;
  /** Maximum entities per extraction (default: 20) */
  maxEntities: number;
  /** Maximum relationships per extraction (default: 30) */
  maxRelationships: number;
  /** Optional feature flag provider for testing */
  featureFlags?: {
    isEnabled(flag: string): boolean;
    isAnyEnabled(): boolean;
  };
}

/**
 * Bridge dependencies
 */
export interface BridgeDependencies {
  /** LLM client for extraction */
  llm: {
    complete(params: { prompt: string; maxTokens: number; temperature: number }): Promise<{
      content: string;
      tokensUsed: { input: number; output: number };
    }>;
  };
  /** Knowledge graph storage for relationships */
  relationshipStore: {
    createRelationship(params: {
      fromEntity: string;
      toEntity: string;
      type: string;
      confidence: number;
      fact?: string;
      episodeUuid?: string;
      correlationId?: string;
    }): Promise<{ success: boolean; action?: string; error?: string }>;
  };
  /** Alias store for entity resolution */
  aliasStore: {
    updateAliases(params: {
      entityName: string;
      entityType: string;
      aliases: string[];
      correlationId?: string;
    }): Promise<{ success: boolean; error?: string }>;
  };
  /** Audit logger */
  auditLog?: (event: {
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
 * Input to bridge extraction
 */
export interface BridgeExtractionInput {
  /** Messages to analyze */
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
  }>;
  /** Extracted memories from DeepCoder */
  memories: Array<{
    id: string;
    content: string;
    category: MemoryCategory;
    confidence: number;
    importance: number;
    sourceMessageIds: string[];
  }>;
  /** Episode UUID for linking */
  episodeUuid?: string;
  /** Correlation ID */
  correlationId: string;
}

/**
 * Output from bridge extraction
 */
export interface BridgeExtractionOutput {
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Extracted entities with aliases */
  entities: SemanticExtractedEntity[];
  /** Extracted relationships */
  relationships: SemanticExtractedRelationship[];
  /** Storage results */
  storage: {
    /** Number of relationships stored */
    relationshipsStored: number;
    /** Number of entities with aliases updated */
    entitiesUpdated: number;
    /** Number of failures */
    failures: number;
  };
  /** Performance metrics */
  metrics: {
    /** Extraction duration in ms */
    extractionMs: number;
    /** Storage duration in ms */
    storageMs: number;
    /** Total tokens used */
    tokensUsed: number;
  };
}

/**
 * Feature flag configuration
 */
export interface FeatureFlagConfig {
  /** Master switch for semantic extraction */
  semanticExtraction: boolean;
  /** Enable relationship storage */
  relationshipStorage: boolean;
  /** Enable alias updates */
  aliasUpdates: boolean;
  /** Log-only mode (don't actually store) */
  dryRun: boolean;
}

/**
 * Bridge health status
 */
export interface BridgeHealth {
  /** Whether bridge is healthy */
  healthy: boolean;
  /** Component status */
  components: {
    llm: boolean;
    relationshipStore: boolean;
    aliasStore: boolean;
  };
  /** Last error if unhealthy */
  lastError?: string;
  /** Timestamp of last check */
  checkedAt: number;
}
