/**
 * ColdTier Implementation
 * File-based archival storage
 * Sprint 2 - Story 1: Tiered Storage Foundation
 */

import { createHash } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path, { join, dirname } from "path";
import Database from "better-sqlite3";
import type { ColdTier as IColdTier, MemoryContent, StorageMetrics } from "./types.js";

export class ColdTier implements IColdTier {
  private db: Database.Database;
  private archivePath: string;

  constructor(archivePath: string, dbPath?: string) {
    this.archivePath = archivePath;
    // Use persistent SQLite for index instead of in-memory
    const finalDbPath =
      dbPath || path.join(os.homedir(), ".openclaw", "state", "aura", "cold-tier-index.sqlite");
    this.db = new Database(finalDbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cold_memories (
        id TEXT PRIMARY KEY,
        archive_path TEXT NOT NULL,
        checksum TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        importance REAL NOT NULL,
        confidence REAL NOT NULL,
        category TEXT NOT NULL,
        encrypted INTEGER DEFAULT 0,
        entities TEXT NOT NULL
      );
    `);
  }

  async archive(memory: MemoryContent): Promise<string> {
    const date = memory.timestamp;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");

    const archiveDir = join(this.archivePath, String(year), month);
    const archiveFile = join(archiveDir, `${memory.id}.json`);

    // Ensure directory exists
    await fs.mkdir(archiveDir, { recursive: true });

    // Serialize and write
    const data = JSON.stringify({
      id: memory.id,
      content: memory.content,
      timestamp: memory.timestamp.toISOString(),
      accessCount: memory.accessCount,
      lastAccessed: memory.lastAccessed.toISOString(),
      importance: memory.importance,
      confidence: memory.confidence,
      category: memory.category,
      encrypted: memory.encrypted,
      entities: memory.entities,
    });

    await fs.writeFile(archiveFile, data, "utf-8");

    return archiveFile;
  }

  async rehydrate(archivePath: string): Promise<MemoryContent> {
    const data = await fs.readFile(archivePath, "utf-8");
    const parsed = JSON.parse(data);

    return {
      id: parsed.id,
      content: parsed.content,
      timestamp: new Date(parsed.timestamp),
      accessCount: parsed.accessCount,
      lastAccessed: new Date(parsed.lastAccessed),
      importance: parsed.importance,
      confidence: parsed.confidence || 0.5,
      category: parsed.category || "Uncategorized",
      encrypted: parsed.encrypted || false,
      entities: parsed.entities,
    };
  }

  async verifyChecksum(archivePath: string): Promise<boolean> {
    try {
      await fs.access(archivePath);
      const data = await fs.readFile(archivePath);
      const hash = createHash("sha256").update(data).digest("hex");

      // In real implementation, compare with stored checksum
      return true;
    } catch {
      return false;
    }
  }

  async store(memory: MemoryContent): Promise<void> {
    const archivePath = await this.archive(memory);

    // Calculate checksum
    const data = await fs.readFile(archivePath);
    const checksum = createHash("sha256").update(data).digest("hex");

    const stmt = this.db.prepare(`
      INSERT INTO cold_memories (id, archive_path, checksum, timestamp, access_count, last_accessed, importance, confidence, category, encrypted, entities)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      memory.id,
      archivePath,
      checksum,
      memory.timestamp.getTime(),
      memory.accessCount,
      memory.lastAccessed?.getTime() || null,
      memory.importance,
      memory.confidence,
      memory.category,
      memory.encrypted ? 1 : 0,
      JSON.stringify(memory.entities),
    );
  }

  async retrieve(id: string): Promise<MemoryContent | null> {
    const stmt = this.db.prepare("SELECT * FROM cold_memories WHERE id = ?");
    const row = stmt.get(id) as any;

    if (!row) return null;

    // Check if file exists
    try {
      await fs.access(row.archive_path);
    } catch {
      return null;
    }

    // Update access metadata
    const updateStmt = this.db.prepare(`
      UPDATE cold_memories 
      SET access_count = access_count + 1, last_accessed = ?
      WHERE id = ?
    `);
    updateStmt.run(Date.now(), id);

    return this.rehydrate(row.archive_path);
  }

  async delete(id: string): Promise<boolean> {
    const stmt = this.db.prepare("SELECT archive_path FROM cold_memories WHERE id = ?");
    const row = stmt.get(id) as any;

    if (!row) return false;

    // Delete file
    try {
      await fs.unlink(row.archive_path);
    } catch {
      // File may not exist, continue
    }

    // Delete metadata
    const deleteStmt = this.db.prepare("DELETE FROM cold_memories WHERE id = ?");
    const result = deleteStmt.run(id);

    return result.changes > 0;
  }

  async getLeastRecentlyUsed(limit: number): Promise<MemoryContent[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM cold_memories 
      ORDER BY last_accessed ASC NULLS FIRST 
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];

    const results: MemoryContent[] = [];
    for (const row of rows) {
      try {
        const memory = await this.rehydrate(row.archive_path);
        results.push(memory);
      } catch {
        // Skip files that can't be read
      }
    }
    return results;
  }

  async getMetrics(): Promise<StorageMetrics> {
    const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM cold_memories");
    const sizeStmt = this.db.prepare(`
      SELECT SUM(LENGTH(archive_path) + LENGTH(checksum)) as total_size 
      FROM cold_memories
    `);

    const countRow = countStmt.get() as any;
    const sizeRow = sizeStmt.get() as any;

    return {
      tier: "cold",
      count: countRow.count,
      totalSize: sizeRow.total_size || 0,
      avgAccessTime: 0,
    };
  }
}
