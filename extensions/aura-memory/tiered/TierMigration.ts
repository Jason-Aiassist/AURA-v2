/**
 * TierMigration Implementation
 * Tier promotion/demotion operations
 * Sprint 2 - Story 1: Tiered Storage Foundation
 */

import type { ColdTier } from "./ColdTier.js";
import type { HotTier } from "./HotTier.js";
import type { MemoryContent, MigrationResult, Tier } from "./types.js";
import type { WarmTier } from "./WarmTier.js";

export interface TierMigrationConfig {
  hotTier: HotTier;
  warmTier: WarmTier;
  coldTier: ColdTier;
}

export class TierMigration {
  private hotTier: HotTier;
  private warmTier: WarmTier;
  private coldTier: ColdTier;

  constructor(config: TierMigrationConfig) {
    this.hotTier = config.hotTier;
    this.warmTier = config.warmTier;
    this.coldTier = config.coldTier;
  }

  async promote(memoryId: string, fromTier: Tier, toTier: Tier): Promise<MigrationResult> {
    const startTime = Date.now();

    if (fromTier === toTier) {
      return {
        success: false,
        fromTier,
        toTier,
        memoryId,
        durationMs: 0,
      };
    }

    // Retrieve from source
    const memory = await this.retrieveFromTier(memoryId, fromTier);
    if (!memory) {
      return {
        success: false,
        fromTier,
        toTier,
        memoryId,
        durationMs: Date.now() - startTime,
      };
    }

    // Store to destination
    await this.storeToTier(memory, toTier);

    // Delete from source
    await this.deleteFromTier(memoryId, fromTier);

    return {
      success: true,
      fromTier,
      toTier,
      memoryId,
      durationMs: Date.now() - startTime,
    };
  }

  async demote(memoryId: string, fromTier: Tier, toTier: Tier): Promise<MigrationResult> {
    // Demotion is just promotion in reverse
    return this.promote(memoryId, fromTier, toTier);
  }

  async migrateBasedOnAccess(memoryId: string, currentTier: Tier): Promise<MigrationResult> {
    const memory = await this.retrieveFromTier(memoryId, currentTier);

    if (!memory) {
      return {
        success: false,
        fromTier: currentTier,
        toTier: currentTier,
        memoryId,
        durationMs: 0,
      };
    }

    // Determine optimal tier based on access patterns
    const targetTier = this.determineOptimalTier(memory);

    if (targetTier === currentTier) {
      return {
        success: true,
        fromTier: currentTier,
        toTier: currentTier,
        memoryId,
        durationMs: 0,
      };
    }

    return this.promote(memoryId, currentTier, targetTier);
  }

  private async retrieveFromTier(memoryId: string, tier: Tier): Promise<MemoryContent | null> {
    switch (tier) {
      case "hot":
        return this.hotTier.retrieve(memoryId);
      case "warm":
        return this.warmTier.retrieve(memoryId);
      case "cold":
        return this.coldTier.retrieve(memoryId);
      default:
        return null;
    }
  }

  private async storeToTier(memory: MemoryContent, tier: Tier): Promise<void> {
    switch (tier) {
      case "hot":
        return this.hotTier.store(memory);
      case "warm":
        return this.warmTier.store(memory);
      case "cold":
        return this.coldTier.store(memory);
    }
  }

  private async deleteFromTier(memoryId: string, tier: Tier): Promise<boolean> {
    switch (tier) {
      case "hot":
        return this.hotTier.delete(memoryId);
      case "warm":
        return this.warmTier.delete(memoryId);
      case "cold":
        return this.coldTier.delete(memoryId);
      default:
        return false;
    }
  }

  private determineOptimalTier(memory: MemoryContent): Tier {
    // High importance and frequent access -> Hot
    if (memory.importance >= 0.7 && memory.accessCount >= 10) {
      return "hot";
    }

    // Low importance and rare access -> Cold
    if (memory.importance <= 0.3 && memory.accessCount <= 2) {
      return "cold";
    }

    // Everything else -> Warm
    return "warm";
  }
}
