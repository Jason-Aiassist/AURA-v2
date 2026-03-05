/**
 * Tiered Storage Types
 * Sprint 2 - Tiered Storage Architecture
 */

/** Memory content with metadata */
export interface MemoryContent {
  id: string;
  content: string;
  timestamp: Date;
  accessCount: number;
  lastAccessed: Date;
  importance: number;
  confidence: number;
  category: string;
  encrypted: boolean;
  entities: string[];
}

/** Tier types */
export type Tier = "hot" | "warm" | "cold";

/** Tier configuration */
export interface TierConfig {
  hot: {
    maxSize: number;
    maxAgeMs: number;
  };
  warm: {
    compressionRatio: number;
    minBleuScore: number;
  };
  cold: {
    archivePath: string;
    maxRehydrationTimeMs: number;
  };
}

/** Compression result */
export interface CompressionResult {
  originalSize: number;
  compressedSize: number;
  ratio: number;
  bleuScore: number;
  preservedEntities: string[];
}

/** Migration result */
export interface MigrationResult {
  success: boolean;
  fromTier: Tier;
  toTier: Tier;
  memoryId: string;
  durationMs: number;
}

/** Storage metrics */
export interface StorageMetrics {
  tier: Tier;
  count: number;
  totalSize: number;
  avgAccessTime: number;
}

/** Tiered storage interface */
export interface TieredStorage {
  store(memory: MemoryContent): Promise<void>;
  retrieve(id: string): Promise<MemoryContent | null>;
  delete(id: string): Promise<boolean>;
  getMetrics(): Promise<StorageMetrics>;
}

/** Hot tier - full content in SQLite */
export interface HotTier extends TieredStorage {
  updateAccess(id: string): Promise<void>;
  getLeastRecentlyUsed(limit: number): Promise<MemoryContent[]>;
}

/** Warm tier - compressed content */
export interface WarmTier extends TieredStorage {
  compress(content: MemoryContent): Promise<CompressionResult>;
  decompress(compressed: Buffer): Promise<string>;
  validateCompression(original: string, compressed: string): Promise<number>;
}

/** Cold tier - file archival */
export interface ColdTier extends TieredStorage {
  archive(memory: MemoryContent): Promise<string>;
  rehydrate(archivePath: string): Promise<MemoryContent>;
  verifyChecksum(archivePath: string): Promise<boolean>;
}
