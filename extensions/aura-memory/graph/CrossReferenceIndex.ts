/**
 * Cross-Reference Index
 * Sprint 2 - AC2.3: Bidirectional memory_id ↔ episode_uuid lookup
 */

import type { Database } from "better-sqlite3";
import { Logger, MetricsCollector, generateCorrelationId } from "../../utils/logger";
import { ConsistencyVerifier, type ConsistencyReport } from "./ConsistencyVerifier";

export interface CrossReferenceEntry {
  memoryId: string;
  episodeUuid: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CrossReferenceStats {
  totalLinks: number;
  memoryToEpisodeLookups: number;
  episodeToMemoryLookups: number;
  consistencyChecks: number;
  errors: number;
  lastCheckAt?: string;
}

export class CrossReferenceIndex {
  private db: Database;
  private stats: CrossReferenceStats;
  private logger: Logger;
  private metrics: MetricsCollector;
  private verifier: ConsistencyVerifier;

  constructor(db: Database, correlationId?: string) {
    this.db = db;
    this.logger = new Logger("CrossReferenceIndex", correlationId || generateCorrelationId());
    this.metrics = new MetricsCollector();
    this.verifier = new ConsistencyVerifier(this.logger);
    this.stats = {
      totalLinks: 0,
      memoryToEpisodeLookups: 0,
      episodeToMemoryLookups: 0,
      consistencyChecks: 0,
      errors: 0,
    };
    this.initializeTable();
  }

  private initializeTable(): void {
    this.logger.debug("Initializing cross-reference table");
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS cross_reference (
          memory_id TEXT PRIMARY KEY,
          episode_uuid TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          version INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_episode_uuid ON cross_reference(episode_uuid);
        CREATE INDEX IF NOT EXISTS idx_created_at ON cross_reference(created_at);
      `);
      this.logger.info("Cross-reference table initialized");
      this.refreshStats();
    } catch (error) {
      this.logger.error("Failed to initialize cross-reference table", error as Error);
      throw error;
    }
  }

  async link(memoryId: string, episodeUuid: string): Promise<void> {
    const startTime = performance.now();
    this.logger.debug("Creating cross-reference link", { memoryId, episodeUuid });
    try {
      const stmt = this.db.prepare(`
        INSERT INTO cross_reference (memory_id, episode_uuid, created_at, updated_at, version)
        VALUES (?, ?, datetime('now'), datetime('now'), 1)
        ON CONFLICT(memory_id) DO UPDATE SET
          episode_uuid = excluded.episode_uuid,
          updated_at = datetime('now'),
          version = version + 1
      `);
      stmt.run(memoryId, episodeUuid);
      this.refreshStats();
      const duration = performance.now() - startTime;
      this.metrics.recordDuration("link", duration);
      this.logger.info("Cross-reference link created", { memoryId, episodeUuid, duration });
    } catch (error) {
      this.stats.errors++;
      this.logger.error("Failed to create cross-reference link", error as Error, {
        memoryId,
        episodeUuid,
      });
      throw error;
    }
  }

  async unlink(memoryId: string): Promise<boolean> {
    this.logger.debug("Unlinking by memory ID", { memoryId });
    try {
      const stmt = this.db.prepare(`DELETE FROM cross_reference WHERE memory_id = ?`);
      const result = stmt.run(memoryId);
      const removed = result.changes > 0;
      this.refreshStats();
      if (removed) this.logger.info("Unlinked memory ID", { memoryId });
      else this.logger.warn("No link found to unlink for memory ID", { memoryId });
      return removed;
    } catch (error) {
      this.stats.errors++;
      this.logger.error("Failed to unlink memory ID", error as Error, { memoryId });
      throw error;
    }
  }

  async unlinkByEpisode(episodeUuid: string): Promise<boolean> {
    this.logger.debug("Unlinking by episode UUID", { episodeUuid });
    try {
      const stmt = this.db.prepare(`DELETE FROM cross_reference WHERE episode_uuid = ?`);
      const result = stmt.run(episodeUuid);
      const removed = result.changes > 0;
      this.refreshStats();
      if (removed) this.logger.info("Unlinked episode UUID", { episodeUuid });
      else this.logger.warn("No link found to unlink for episode UUID", { episodeUuid });
      return removed;
    } catch (error) {
      this.stats.errors++;
      this.logger.error("Failed to unlink episode UUID", error as Error, { episodeUuid });
      throw error;
    }
  }

  async getMemoryId(episodeUuid: string): Promise<string | null> {
    try {
      const stmt = this.db.prepare(`SELECT memory_id FROM cross_reference WHERE episode_uuid = ?`);
      const result = stmt.get(episodeUuid) as { memory_id: string } | undefined;
      this.stats.episodeToMemoryLookups++;
      this.metrics.incrementCounter("episodeToMemoryLookup");
      return result?.memory_id || null;
    } catch (error) {
      this.stats.errors++;
      this.logger.error("Failed to get memory ID", error as Error, { episodeUuid });
      throw error;
    }
  }

  async getEpisodeUuid(memoryId: string): Promise<string | null> {
    try {
      const stmt = this.db.prepare(`SELECT episode_uuid FROM cross_reference WHERE memory_id = ?`);
      const result = stmt.get(memoryId) as { episode_uuid: string } | undefined;
      this.stats.memoryToEpisodeLookups++;
      this.metrics.incrementCounter("memoryToEpisodeLookup");
      return result?.episode_uuid || null;
    } catch (error) {
      this.stats.errors++;
      this.logger.error("Failed to get episode UUID", error as Error, { memoryId });
      throw error;
    }
  }

  async getEntry(memoryId: string): Promise<CrossReferenceEntry | null> {
    try {
      const stmt = this.db.prepare(`
        SELECT memory_id as memoryId, episode_uuid as episodeUuid, created_at as createdAt, updated_at as updatedAt, version
        FROM cross_reference WHERE memory_id = ?
      `);
      return (stmt.get(memoryId) as CrossReferenceEntry) || null;
    } catch (error) {
      this.logger.error("Failed to get entry", error as Error, { memoryId });
      throw error;
    }
  }

  async exists(memoryId: string, episodeUuid?: string): Promise<boolean> {
    try {
      if (episodeUuid) {
        const stmt = this.db.prepare(
          `SELECT 1 FROM cross_reference WHERE memory_id = ? AND episode_uuid = ?`,
        );
        return !!stmt.get(memoryId, episodeUuid);
      }
      const stmt = this.db.prepare(`SELECT 1 FROM cross_reference WHERE memory_id = ?`);
      return !!stmt.get(memoryId);
    } catch (error) {
      this.logger.error("Failed to check existence", error as Error, { memoryId, episodeUuid });
      throw error;
    }
  }

  async verifyConsistency(
    memoryStore?: { exists: (id: string) => Promise<boolean> },
    episodeStore?: { exists: (uuid: string) => Promise<boolean> },
  ): Promise<ConsistencyReport> {
    const startTime = performance.now();
    try {
      const stmt = this.db.prepare(`SELECT memory_id, episode_uuid FROM cross_reference`);
      const links = stmt.all() as Array<{ memory_id: string; episode_uuid: string }>;

      const report = await this.verifier.verify(
        links,
        (uuid) => this.getMemoryId(uuid),
        memoryStore,
        episodeStore,
      );

      this.stats.consistencyChecks++;
      this.stats.lastCheckAt = new Date().toISOString();
      const duration = performance.now() - startTime;
      this.metrics.recordDuration("verifyConsistency", duration);

      return report;
    } catch (error) {
      this.stats.errors++;
      this.logger.error("Consistency verification failed", error as Error);
      throw error;
    }
  }

  async getAll(): Promise<CrossReferenceEntry[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT memory_id as memoryId, episode_uuid as episodeUuid, created_at as createdAt, updated_at as updatedAt, version
        FROM cross_reference ORDER BY created_at DESC
      `);
      return stmt.all() as CrossReferenceEntry[];
    } catch (error) {
      this.logger.error("Failed to get all entries", error as Error);
      throw error;
    }
  }

  async getPage(page: number, pageSize: number): Promise<CrossReferenceEntry[]> {
    try {
      const offset = (page - 1) * pageSize;
      const stmt = this.db.prepare(`
        SELECT memory_id as memoryId, episode_uuid as episodeUuid, created_at as createdAt, updated_at as updatedAt, version
        FROM cross_reference ORDER BY created_at DESC LIMIT ? OFFSET ?
      `);
      return stmt.all(pageSize, offset) as CrossReferenceEntry[];
    } catch (error) {
      this.logger.error("Failed to get page", error as Error, { page, pageSize });
      throw error;
    }
  }

  async count(): Promise<number> {
    try {
      const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM cross_reference`);
      const result = stmt.get() as { count: number };
      return result.count;
    } catch (error) {
      this.logger.error("Failed to count entries", error as Error);
      throw error;
    }
  }

  async linkBatch(links: Array<{ memoryId: string; episodeUuid: string }>): Promise<number> {
    const startTime = performance.now();
    this.logger.debug("Starting batch link operation", { count: links.length });
    try {
      const insert = this.db.prepare(`
        INSERT INTO cross_reference (memory_id, episode_uuid, created_at, updated_at, version)
        VALUES (?, ?, datetime('now'), datetime('now'), 1)
        ON CONFLICT(memory_id) DO UPDATE SET
          episode_uuid = excluded.episode_uuid,
          updated_at = datetime('now'),
          version = version + 1
      `);
      const transaction = this.db.transaction((items: typeof links) => {
        let count = 0;
        for (const item of items) {
          insert.run(item.memoryId, item.episodeUuid);
          count++;
        }
        return count;
      });
      const count = transaction(links);
      this.refreshStats();
      const duration = performance.now() - startTime;
      this.metrics.recordDuration("linkBatch", duration);
      this.logger.info("Batch link operation complete", { count, duration });
      return count;
    } catch (error) {
      this.stats.errors++;
      this.logger.error("Batch link operation failed", error as Error, { count: links.length });
      throw error;
    }
  }

  getStats(): CrossReferenceStats {
    return { ...this.stats };
  }

  getMetrics(): Record<string, unknown> {
    return { ...this.metrics.getSummary(), stats: this.getStats() };
  }

  private refreshStats(): void {
    try {
      const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM cross_reference`);
      const result = stmt.get() as { count: number };
      this.stats.totalLinks = result.count;
    } catch (error) {
      this.logger.error("Failed to refresh stats", error as Error);
    }
  }

  async clearAll(): Promise<number> {
    this.logger.warn("Clearing all cross-references");
    try {
      const stmt = this.db.prepare(`DELETE FROM cross_reference`);
      const result = stmt.run();
      this.refreshStats();
      this.logger.info("All cross-references cleared", { count: result.changes });
      return result.changes;
    } catch (error) {
      this.stats.errors++;
      this.logger.error("Failed to clear all cross-references", error as Error);
      throw error;
    }
  }
}
