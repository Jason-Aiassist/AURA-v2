/**
 * Tiered Memory Store - Full tiered storage implementation
 * Integrates HotTier, WarmTier, ColdTier with automatic migration
 */

import os from "os";
import path from "path";
import type { CategorizedMemory, StorageTier } from "../categories/types.js";
import type { SearchIndexBuilder } from "../embeddings/SearchIndexBuilder.js";
import { ColdTier } from "../tiered/ColdTier.js";
import { HotTier } from "../tiered/HotTier.js";
import { TierMigration } from "../tiered/TierMigration.js";
import type { MemoryContent } from "../tiered/types.js";
import { WarmTier } from "../tiered/WarmTier.js";
import type { Logger } from "../types.js";
import type { MemoryStoreInterface } from "./types.js";

export interface TieredMemoryStoreConfig {
  dbPath: string;
  archivePath: string;
  hotMaxSize: number;
  warmMaxSize: number;
  encryptionPassword?: string;
}

/**
 * Tiered Memory Store - manages memories across hot/warm/cold tiers
 * with automatic migration based on access patterns
 */
export class TieredMemoryStore implements MemoryStoreInterface {
  private hotTier: HotTier;
  private warmTier: WarmTier;
  private coldTier: ColdTier;
  private migration: TierMigration;
  private config: TieredMemoryStoreConfig;
  private log: Logger;
  private searchIndexBuilder?: SearchIndexBuilder;

  constructor(config: TieredMemoryStoreConfig, log: Logger) {
    this.config = config;
    this.log = log;

    // Initialize tiers
    this.hotTier = new HotTier(config.dbPath);
    this.warmTier = new WarmTier(config.dbPath.replace("tiered-memory.sqlite", "warm-tier.sqlite"));
    this.coldTier = new ColdTier(
      config.archivePath,
      config.dbPath.replace("tiered-memory.sqlite", "cold-tier-index.sqlite"),
    );
    this.migration = new TierMigration({
      hotTier: this.hotTier,
      warmTier: this.warmTier,
      coldTier: this.coldTier,
    });

    this.log.info("TieredMemoryStore initialized", {
      dbPath: config.dbPath,
      archivePath: config.archivePath,
    });
  }

  /**
   * Store memory in appropriate tier based on importance
   */
  async store(memory: CategorizedMemory): Promise<void> {
    const memoryContent = this.convertToMemoryContent(memory);
    const targetTier = this.determineInitialTier(memory);

    try {
      switch (targetTier) {
        case "Hot":
          await this.hotTier.store(memoryContent);
          break;
        case "Warm":
          await this.warmTier.store(memoryContent);
          break;
        case "Cold":
          await this.coldTier.store(memoryContent);
          break;
        default:
          throw new Error(`Invalid tier: ${targetTier}`);
      }

      // Index in search indexes (only for Hot tier initially)
      if (targetTier === "Hot" && this.searchIndexBuilder) {
        try {
          await this.searchIndexBuilder.indexMemory(memory);
        } catch {
          // Silently continue - don't fail the store operation
        }
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Retrieve memory from any tier with automatic promotion
   */
  async get(memoryId: string): Promise<CategorizedMemory | null> {
    // Try hot tier first
    let memory = await this.hotTier.retrieve(memoryId);
    if (memory) {
      await this.hotTier.updateAccess(memoryId);
      return this.convertFromMemoryContent(memory, "hot");
    }

    // Try warm tier
    memory = await this.warmTier.retrieve(memoryId);
    if (memory) {
      // Promote to hot on access
      await this.migration.promote(memoryId, "warm", "hot");
      return this.convertFromMemoryContent(memory, "hot");
    }

    // Try cold tier
    memory = await this.coldTier.retrieve(memoryId);
    if (memory) {
      // Promote to hot on access
      await this.migration.promote(memoryId, "cold", "hot");
      return this.convertFromMemoryContent(memory, "hot");
    }

    return null;
  }

  /**
   * Delete memory from all tiers
   */
  async delete(memoryId: string): Promise<void> {
    await this.hotTier.delete(memoryId);
    await this.warmTier.delete(memoryId);
    await this.coldTier.delete(memoryId);

    // Remove from search indexes
    if (this.searchIndexBuilder) {
      try {
        await this.searchIndexBuilder.deleteFromIndex(memoryId);
        this.log.debug("Memory removed from search indexes", { memoryId });
      } catch (indexError) {
        this.log.warn("Failed to remove memory from search indexes", {
          memoryId,
          error: indexError instanceof Error ? indexError.message : String(indexError),
        });
      }
    }

    this.log.info("Memory deleted from all tiers", { memoryId });
  }

  /**
   * Update memory (re-store with same ID)
   */
  async update(memory: CategorizedMemory): Promise<void> {
    await this.store(memory);
  }

  /**
   * Get all memories from hot tier (for context injection)
   */
  async getRecentMessages(options: { limit: number; maxAgeMs: number }): Promise<
    Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
      correlationId: string;
    }>
  > {
    return this.hotTier.getRecentMessages(options);
  }

  /**
   * Get the underlying database connection for hybrid search
   */
  getDatabase(): import("better-sqlite3").DatabaseSync {
    return this.hotTier.getDatabase();
  }

  /**
   * Get the HotTier for direct access (e.g., for reindexing)
   */
  getHotTier(): HotTier {
    return this.hotTier;
  }

  /**
   * Set the search index builder for automatic indexing
   */
  setSearchIndexBuilder(builder: SearchIndexBuilder): void {
    this.searchIndexBuilder = builder;
    this.log.info("Search index builder attached to memory store");
  }

  /**
   * Get the search index builder
   */
  getSearchIndexBuilder(): SearchIndexBuilder | undefined {
    return this.searchIndexBuilder;
  }

  /**
   * Run tier migration based on access patterns
   */
  async runMigration(): Promise<void> {
    this.log.info("Starting tier migration");

    // Get LRU from hot for demotion
    const hotLRU = await this.hotTier.getLeastRecentlyUsed(10);
    for (const memory of hotLRU) {
      if (memory.accessCount < 3) {
        await this.migration.demote(memory.id, "Hot", "Warm");
      }
    }

    // Get LRU from warm for demotion
    const warmLRU = await this.warmTier.getLeastRecentlyUsed(10);
    for (const memory of warmLRU) {
      if (memory.accessCount < 2) {
        await this.migration.demote(memory.id, "Warm", "Cold");
      }
    }

    this.log.info("Tier migration complete");
  }

  /**
   * Convert CategorizedMemory to MemoryContent
   */
  private convertToMemoryContent(memory: CategorizedMemory): MemoryContent {
    return {
      id: memory.memoryId,
      content: memory.content,
      timestamp: new Date(memory.timestamp || Date.now()),
      accessCount: memory.accessCount || 1,
      lastAccessed: new Date(memory.lastAccessedAt || Date.now()),
      importance: memory.importance,
      confidence: memory.confidence,
      category: memory.category,
      encrypted: memory.encrypted,
      entities: [],
    };
  }

  /**
   * Convert MemoryContent to CategorizedMemory
   */
  private convertFromMemoryContent(memory: MemoryContent, tier: StorageTier): CategorizedMemory {
    return {
      memoryId: memory.id,
      content: memory.content,
      category: memory.category as any,
      tier,
      encrypted: memory.encrypted,
      importance: memory.importance,
      confidence: memory.confidence,
      source: "automated",
      sourceMessageIds: [],
      timestamp: memory.timestamp.getTime(),
      createdAt: memory.timestamp.toISOString(),
      lastAccessedAt: memory.lastAccessed.toISOString(),
      accessCount: memory.accessCount,
      correlationId: "",
    };
  }

  /**
   * Determine initial tier based on importance
   */
  private determineInitialTier(memory: CategorizedMemory): StorageTier {
    if (memory.importance >= 0.7) {
      return "Hot";
    } else if (memory.importance >= 0.4) {
      return "Warm";
    }
    return "Cold";
  }
}

/**
 * Factory function to create TieredMemoryStore
 */
export function createTieredMemoryStore(
  config: Partial<TieredMemoryStoreConfig>,
  log: Logger,
): TieredMemoryStore {
  const defaultConfig: TieredMemoryStoreConfig = {
    dbPath: path.join(os.homedir(), ".openclaw", "state", "aura", "tiered-memory.sqlite"),
    archivePath: path.join(os.homedir(), ".openclaw", "state", "aura", "cold-archive"),
    hotMaxSize: 100,
    warmMaxSize: 1000,
    ...config,
  };

  return new TieredMemoryStore(defaultConfig, log);
}
