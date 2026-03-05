/**
 * WarmTier Implementation
 * Compressed storage with entity preservation
 * Sprint 2 - Story 1: Tiered Storage Foundation
 */

import os from "os";
import path from "path";
import { promisify } from "util";
import { deflate, inflate } from "zlib";
import Database from "better-sqlite3";
import type {
  WarmTier as IWarmTier,
  MemoryContent,
  CompressionResult,
  StorageMetrics,
} from "./types.js";

const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

export class WarmTier implements IWarmTier {
  private db: Database.Database;

  constructor(dbPath?: string) {
    // Use persistent SQLite instead of in-memory to prevent data loss
    const finalDbPath =
      dbPath || path.join(os.homedir(), ".openclaw", "state", "aura", "warm-tier.sqlite");
    this.db = new Database(finalDbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS warm_memories (
        id TEXT PRIMARY KEY,
        compressed BLOB NOT NULL,
        timestamp INTEGER NOT NULL,
        access_count INTEGER DEFAULT 1,
        last_accessed INTEGER NOT NULL,
        importance REAL NOT NULL,
        confidence REAL NOT NULL,
        category TEXT NOT NULL,
        encrypted INTEGER DEFAULT 0,
        entities TEXT NOT NULL,
        compression_ratio REAL NOT NULL
      );
    `);
  }

  async compress(memory: MemoryContent): Promise<CompressionResult> {
    const buffer = Buffer.from(memory.content, "utf-8");
    const compressed = await deflateAsync(buffer, { level: 9 });

    const originalSize = buffer.length;
    const compressedSize = compressed.length;
    const ratio = compressedSize / originalSize;

    return {
      originalSize,
      compressedSize,
      ratio,
      bleuScore: 1.0, // Lossless compression
      preservedEntities: memory.entities,
    };
  }

  async decompress(compressed: Buffer): Promise<string> {
    const decompressed = await inflateAsync(compressed);
    return decompressed.toString("utf-8");
  }

  async validateCompression(original: string, compressed: string): Promise<number> {
    // Simple BLEU-like score: exact match = 1.0
    return original === compressed ? 1.0 : 0.0;
  }

  async store(memory: MemoryContent): Promise<void> {
    const compressed = await deflateAsync(Buffer.from(memory.content), { level: 9 });
    const ratio = compressed.length / memory.content.length;

    const stmt = this.db.prepare(`
      INSERT INTO warm_memories (id, compressed, timestamp, access_count, last_accessed, importance, confidence, category, encrypted, entities, compression_ratio)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      memory.id,
      compressed,
      memory.timestamp.getTime(),
      memory.accessCount,
      memory.lastAccessed.getTime(),
      memory.importance,
      memory.confidence,
      memory.category,
      memory.encrypted ? 1 : 0,
      JSON.stringify(memory.entities),
      ratio,
    );
  }

  async retrieve(id: string): Promise<MemoryContent | null> {
    const stmt = this.db.prepare("SELECT * FROM warm_memories WHERE id = ?");
    const row = stmt.get(id) as any;

    if (!row) return null;

    // Update access metadata
    const updateStmt = this.db.prepare(`
      UPDATE warm_memories 
      SET access_count = access_count + 1, last_accessed = ?
      WHERE id = ?
    `);
    updateStmt.run(Date.now(), id);

    const content = await inflateAsync(row.compressed);

    return {
      id: row.id,
      content: content.toString("utf-8"),
      timestamp: new Date(row.timestamp),
      accessCount: row.access_count + 1,
      lastAccessed: new Date(),
      importance: row.importance,
      confidence: row.confidence,
      category: row.category,
      encrypted: row.encrypted === 1,
      entities: JSON.parse(row.entities),
    };
  }

  async delete(id: string): Promise<boolean> {
    const stmt = this.db.prepare("DELETE FROM warm_memories WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async getLeastRecentlyUsed(limit: number): Promise<MemoryContent[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM warm_memories 
      ORDER BY last_accessed ASC 
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];

    const results: MemoryContent[] = [];
    for (const row of rows) {
      const content = await inflateAsync(row.compressed);
      results.push({
        id: row.id,
        content: content.toString("utf-8"),
        timestamp: new Date(row.timestamp),
        accessCount: row.access_count,
        lastAccessed: new Date(row.last_accessed),
        importance: row.importance,
        confidence: row.confidence,
        category: row.category,
        encrypted: row.encrypted === 1,
        entities: JSON.parse(row.entities),
      });
    }
    return results;
  }

  async getMetrics(): Promise<StorageMetrics & { avgCompressionRatio?: number }> {
    const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM warm_memories");
    const sizeStmt = this.db.prepare(
      "SELECT SUM(LENGTH(compressed)) as total_size FROM warm_memories",
    );
    const ratioStmt = this.db.prepare(
      "SELECT AVG(compression_ratio) as avg_ratio FROM warm_memories",
    );

    const countRow = countStmt.get() as any;
    const sizeRow = sizeStmt.get() as any;
    const ratioRow = ratioStmt.get() as any;

    return {
      tier: "warm",
      count: countRow.count,
      totalSize: sizeRow.total_size || 0,
      avgAccessTime: 0,
      avgCompressionRatio: ratioRow.avg_ratio || 0,
    };
  }
}
