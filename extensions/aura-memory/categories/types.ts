// Category-Based Storage Types
// Story 2.1: Category-Based Storage

/**
 * Memory categories for user classification
 */
export type MemoryCategory =
  | "User" // Personal preferences, facts about user
  | "FutureTask" // Things to do later
  | "CurrentProject" // Active work context
  | "SelfImprovement" // Learning, habits, growth
  | "KnowledgeBase"; // General knowledge to retain

/**
 * All valid memory categories
 */
export const MEMORY_CATEGORIES: MemoryCategory[] = [
  "User",
  "FutureTask",
  "CurrentProject",
  "SelfImprovement",
  "KnowledgeBase",
];

/**
 * Storage tier options
 */
export type StorageTier = "Hot" | "Warm" | "Cold";

/**
 * Configuration for a memory category
 */
export interface CategoryConfig {
  /** Whether memories in this category are auto-stored without review */
  autoStore: boolean;
  /** Whether memories should be encrypted at rest */
  encrypt: boolean;
  /** Default storage tier for this category */
  defaultTier: StorageTier;
  /** Description of the category purpose */
  description: string;
  /** Retention priority (1-10, higher = keep longer) */
  retentionPriority: number;
}

/**
 * Category configuration map
 */
export type CategoryConfigMap = Record<MemoryCategory, CategoryConfig>;

/**
 * Memory with category metadata
 */
export interface CategorizedMemory {
  /** Unique memory ID */
  memoryId: string;
  /** Memory content */
  content: string;
  /** Assigned category */
  category: MemoryCategory;
  /** Storage tier assigned */
  tier: StorageTier;
  /** Whether memory is encrypted */
  encrypted: boolean;
  /** Importance score (0-1) */
  importance: number;
  /** Confidence score (0-1) */
  confidence: number;
  /** Source of the memory */
  source: "manual" | "automated";
  /** Source message IDs that support this memory */
  sourceMessageIds: string[];
  /** Unix timestamp (ms) for database storage */
  timestamp?: number;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last access */
  lastAccessedAt: string;
  /** Access count for tier management */
  accessCount: number;
  /** Correlation ID for audit trail */
  correlationId: string;
}

/**
 * Tier assignment parameters
 */
export interface TierAssignmentParams {
  /** Memory category */
  category: MemoryCategory;
  /** Importance score (0-1) */
  importance: number;
  /** Age of memory in milliseconds */
  ageMs: number;
  /** Number of times accessed */
  accessCount: number;
}

/**
 * Tier assignment result
 */
export interface TierAssignmentResult {
  /** Assigned tier */
  tier: StorageTier;
  /** Reason for assignment */
  reason:
    | "category_default"
    | "high_importance"
    | "frequently_accessed"
    | "age_demotion"
    | "manual_override";
}

/**
 * Storage operation result
 */
export interface StorageResult {
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Stored memory if successful */
  memory?: CategorizedMemory;
}

/**
 * Dependencies for category storage
 */
export interface CategoryStorageDependencies {
  /** Hot tier storage */
  hotTier: {
    store: (memory: CategorizedMemory) => Promise<void>;
    get: (memoryId: string) => Promise<CategorizedMemory | null>;
    delete: (memoryId: string) => Promise<void>;
  };
  /** Warm tier storage */
  warmTier: {
    store: (memory: CategorizedMemory) => Promise<void>;
    get: (memoryId: string) => Promise<CategorizedMemory | null>;
    delete: (memoryId: string) => Promise<void>;
  };
  /** Cold tier storage */
  coldTier: {
    store: (memory: CategorizedMemory) => Promise<void>;
    get: (memoryId: string) => Promise<CategorizedMemory | null>;
    delete: (memoryId: string) => Promise<void>;
  };
  /** Encryption service */
  encryption: {
    encrypt: (content: string, category: MemoryCategory) => Promise<string>;
    decrypt: (encrypted: string, category: MemoryCategory) => Promise<string>;
  };
  /** Audit logger */
  auditLog: (event: {
    operation: string;
    memoryId: string;
    correlationId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  /** ID generator */
  generateId: () => string;
  /** Timestamp provider */
  now: () => number;
}
