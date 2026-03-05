/**
 * Consistency Verifier
 * Sprint 2 - AC2.3: Cross-Reference Index
 *
 * Verifies consistency between memory store and episode store
 */

import { Logger } from "../../utils/logger";

export interface ConsistencyReport {
  totalLinks: number;
  inconsistencies: Inconsistency[];
  orphanedMemoryIds: string[];
  orphanedEpisodeUuids: string[];
  isConsistent: boolean;
  checkedAt: string;
}

export interface Inconsistency {
  type: "orphaned_memory" | "orphaned_episode" | "mismatched_reference";
  memoryId?: string;
  episodeUuid?: string;
  details: string;
}

export interface VerifierStats {
  checksPerformed: number;
  lastCheckAt?: string;
  errors: number;
}

export class ConsistencyVerifier {
  private logger: Logger;
  private stats: VerifierStats = { checksPerformed: 0, errors: 0 };

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async verify(
    links: Array<{ memory_id: string; episode_uuid: string }>,
    getMemoryId: (uuid: string) => Promise<string | null>,
    memoryStore?: { exists: (id: string) => Promise<boolean> },
    episodeStore?: { exists: (uuid: string) => Promise<boolean> },
  ): Promise<ConsistencyReport> {
    const startTime = performance.now();
    this.logger.info("Starting consistency verification", {
      hasMemoryStore: !!memoryStore,
      hasEpisodeStore: !!episodeStore,
    });

    const inconsistencies: Inconsistency[] = [];
    const orphanedMemoryIds: string[] = [];
    const orphanedEpisodeUuids: string[] = [];

    for (const link of links) {
      // Check memory existence
      if (memoryStore) {
        await this.checkMemoryExists(link, memoryStore, inconsistencies, orphanedMemoryIds);
      }

      // Check episode existence
      if (episodeStore) {
        await this.checkEpisodeExists(link, episodeStore, inconsistencies, orphanedEpisodeUuids);
      }

      // Verify bidirectional integrity
      await this.checkBidirectionalIntegrity(link, getMemoryId, inconsistencies);
    }

    this.stats.checksPerformed++;
    this.stats.lastCheckAt = new Date().toISOString();

    const duration = performance.now() - startTime;
    const isConsistent = inconsistencies.length === 0;

    if (isConsistent) {
      this.logger.info("Consistency verification complete - all consistent", {
        totalLinks: links.length,
        duration,
      });
    } else {
      this.logger.warn("Consistency verification complete - inconsistencies found", {
        totalLinks: links.length,
        inconsistencyCount: inconsistencies.length,
        duration,
      });
    }

    return {
      totalLinks: links.length,
      inconsistencies,
      orphanedMemoryIds,
      orphanedEpisodeUuids,
      isConsistent,
      checkedAt: new Date().toISOString(),
    };
  }

  private async checkMemoryExists(
    link: { memory_id: string; episode_uuid: string },
    memoryStore: { exists: (id: string) => Promise<boolean> },
    inconsistencies: Inconsistency[],
    orphanedMemoryIds: string[],
  ): Promise<void> {
    try {
      const exists = await memoryStore.exists(link.memory_id);
      if (!exists) {
        inconsistencies.push({
          type: "orphaned_memory",
          memoryId: link.memory_id,
          episodeUuid: link.episode_uuid,
          details: `Memory ${link.memory_id} referenced but does not exist`,
        });
        orphanedMemoryIds.push(link.memory_id);
        this.logger.warn("Orphaned memory reference detected", {
          memoryId: link.memory_id,
          episodeUuid: link.episode_uuid,
        });
      }
    } catch (error) {
      this.logger.error("Error checking memory existence", error as Error, {
        memoryId: link.memory_id,
      });
    }
  }

  private async checkEpisodeExists(
    link: { memory_id: string; episode_uuid: string },
    episodeStore: { exists: (uuid: string) => Promise<boolean> },
    inconsistencies: Inconsistency[],
    orphanedEpisodeUuids: string[],
  ): Promise<void> {
    try {
      const exists = await episodeStore.exists(link.episode_uuid);
      if (!exists) {
        inconsistencies.push({
          type: "orphaned_episode",
          memoryId: link.memory_id,
          episodeUuid: link.episode_uuid,
          details: `Episode ${link.episode_uuid} referenced but does not exist`,
        });
        orphanedEpisodeUuids.push(link.episode_uuid);
        this.logger.warn("Orphaned episode reference detected", {
          memoryId: link.memory_id,
          episodeUuid: link.episode_uuid,
        });
      }
    } catch (error) {
      this.logger.error("Error checking episode existence", error as Error, {
        episodeUuid: link.episode_uuid,
      });
    }
  }

  private async checkBidirectionalIntegrity(
    link: { memory_id: string; episode_uuid: string },
    getMemoryId: (uuid: string) => Promise<string | null>,
    inconsistencies: Inconsistency[],
  ): Promise<void> {
    try {
      const reverseLookup = await getMemoryId(link.episode_uuid);
      if (reverseLookup !== link.memory_id) {
        inconsistencies.push({
          type: "mismatched_reference",
          memoryId: link.memory_id,
          episodeUuid: link.episode_uuid,
          details: `Bidirectional mismatch: ${link.episode_uuid} → ${reverseLookup}, expected ${link.memory_id}`,
        });
        this.logger.error("Bidirectional mismatch detected", undefined, {
          memoryId: link.memory_id,
          episodeUuid: link.episode_uuid,
          reverseLookup,
        });
      }
    } catch (error) {
      this.logger.error("Error during bidirectional verification", error as Error, {
        episodeUuid: link.episode_uuid,
      });
    }
  }

  getStats(): VerifierStats {
    return { ...this.stats };
  }
}
