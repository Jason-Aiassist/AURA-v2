// Sprint 2 Integration Adapter Types
// Story 2.4: Sprint 2 Integration Adapter

import type { CategorizedMemory, StorageTier, MemoryCategory } from "../categories/types.js";

/**
 * Sprint 2 Memory Store interface (abstracted)
 * This is what Sprint 3 code expects from storage
 */
export interface MemoryStoreInterface {
  /** Store memory in appropriate tier */
  store(memory: CategorizedMemory): Promise<void>;
  /** Retrieve memory by ID (searches all tiers) */
  get(memoryId: string): Promise<CategorizedMemory | null>;
  /** Delete memory from all tiers */
  delete(memoryId: string): Promise<void>;
  /** Update memory (used for tier migrations) */
  update(memory: CategorizedMemory): Promise<void>;
  /** Get recent messages for context building */
  getRecentMessages(options: { limit: number; maxAgeMs: number }): Promise<
    Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
      correlationId: string;
    }>
  >;
}

/**
 * Sprint 2 Knowledge Graph interface (abstracted)
 */
export interface KnowledgeGraphInterface {
  /** Create episode node for memory */
  createEpisode(params: {
    memoryId: string;
    content: string;
    timestamp: number;
    category: MemoryCategory;
  }): Promise<{ uuid: string }>;
  /** Link entities to episode */
  linkEntities(params: {
    episodeUuid: string;
    entities: Array<{ type: string; name: string }>;
  }): Promise<void>;
  /** Search for related memories */
  searchRelated(params: {
    entityNames: string[];
    limit: number;
  }): Promise<Array<{ memoryId: string; relevance: number }>>;
}

/**
 * Adapter configuration
 */
export interface AdapterConfig {
  /** Enable debug logging */
  debug: boolean;
  /** Operation timeout in ms */
  timeoutMs: number;
  /** Retry attempts for transient failures */
  retryAttempts: number;
  /** Enable input validation */
  validateInputs: boolean;
}

/**
 * Operation result wrapper
 */
export interface AdapterResult<T> {
  success: boolean;
  data?: T;
  error?: AdapterError;
  durationMs: number;
  retries: number;
}

/**
 * Domain errors for Sprint 3 code
 */
export interface AdapterError {
  code: ErrorCode;
  message: string;
  originalError?: unknown;
  isRetryable: boolean;
}

/**
 * Error codes for adapter operations
 */
export type ErrorCode =
  | "MEMORY_NOT_FOUND"
  | "TIER_UNAVAILABLE"
  | "GRAPH_CONNECTION_ERROR"
  | "VALIDATION_ERROR"
  | "TIMEOUT_ERROR"
  | "RETRY_EXHAUSTED"
  | "UNKNOWN_ERROR";

/**
 * Memory store adapter dependencies
 */
export interface MemoryStoreAdapterDependencies {
  /** Sprint 2 Hot Tier */
  hotTier: {
    store: (key: string, value: unknown, metadata?: Record<string, unknown>) => Promise<void>;
    get: (key: string) => Promise<{ value: unknown; metadata?: Record<string, unknown> } | null>;
    delete: (key: string) => Promise<void>;
  };
  /** Sprint 2 Warm Tier */
  warmTier: {
    store: (key: string, value: unknown, metadata?: Record<string, unknown>) => Promise<void>;
    get: (key: string) => Promise<{ value: unknown; metadata?: Record<string, unknown> } | null>;
    delete: (key: string) => Promise<void>;
  };
  /** Sprint 2 Cold Tier */
  coldTier: {
    store: (key: string, value: unknown, metadata?: Record<string, unknown>) => Promise<void>;
    get: (key: string) => Promise<{ value: unknown; metadata?: Record<string, unknown> } | null>;
    delete: (key: string) => Promise<void>;
  };
  /** Audit logger */
  auditLog: (event: {
    operation: string;
    memoryId: string;
    tier?: StorageTier;
    durationMs: number;
    success: boolean;
    error?: string;
  }) => Promise<void>;
  /** Timestamp provider */
  now: () => number;
}

/**
 * Knowledge graph adapter dependencies
 */
export interface KnowledgeGraphAdapterDependencies {
  /** Neo4j client from Sprint 2 */
  neo4jClient: {
    createEpisode: (params: {
      uuid: string;
      memoryId: string;
      timestamp: number;
      entities: Array<{ type: string; name: string; confidence: number }>;
      sourceDescription: string;
      referenceTime: number;
    }) => Promise<void>;
    getRelatedMemories: (entityNames: string[]) => Promise<
      Array<{
        memoryId: string;
        similarity: number;
      }>
    >;
  };
  /** Entity extractor */
  extractEntities: (
    content: string,
  ) => Promise<Array<{ type: string; name: string; confidence: number }>>;
  /** Audit logger */
  auditLog: (event: {
    operation: string;
    memoryId: string;
    episodeUuid?: string;
    durationMs: number;
    success: boolean;
    error?: string;
  }) => Promise<void>;
  /** ID generator */
  generateUuid: () => string;
  /** Timestamp provider */
  now: () => number;
}

// Alias for backward compatibility
export type IMemoryStoreAdapter = MemoryStoreInterface;
