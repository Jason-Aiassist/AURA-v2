/**
 * HotTier Implementation
 * Full content storage in SQLite
 * Sprint 2 - Story 1: Tiered Storage Foundation
 */

import Database from "better-sqlite3";
import { FtsSearchSchema } from "../embeddings/FtsSearchSchema.js";
import { VectorSearchSchema } from "../embeddings/VectorSearchSchema.js";
import type { HotTier as IHotTier, MemoryContent, StorageMetrics } from "./types.js";

export class HotTier implements IHotTier {
  private db: Database.Database;
  private vectorSchema: VectorSearchSchema;
  private ftsSchema: FtsSearchSchema;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);

    // Load sqlite-vec extension if available
    const sqliteVecPath = process.env.SQLITE_VEC_PATH;
    if (sqliteVecPath) {
      try {
        this.db.loadExtension(sqliteVecPath);
        console.log("[HotTier] sqlite-vec extension loaded successfully");
      } catch (vecError) {
        console.warn("[HotTier] Failed to load sqlite-vec extension:", vecError);
      }
    }

    this.initializeSchema();

    // Initialize search schemas - read dimensions from env to match embedding model
    const embeddingDimensions = parseInt(process.env.OLLAMA_EMBED_DIMENSIONS || "768", 10);
    this.vectorSchema = new VectorSearchSchema({ db: this.db, dimensions: embeddingDimensions });
    this.vectorSchema.initialize();

    this.ftsSchema = new FtsSearchSchema({ db: this.db, tokenizer: "porter" });
    this.ftsSchema.initialize();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hot_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        access_count INTEGER DEFAULT 1,
        last_accessed INTEGER NOT NULL,
        importance REAL NOT NULL,
        confidence REAL NOT NULL,
        category TEXT NOT NULL,
        encrypted INTEGER DEFAULT 0,
        entities TEXT NOT NULL
      );
      -- Existing indexes
      CREATE INDEX IF NOT EXISTS idx_last_accessed ON hot_memories(last_accessed);
      CREATE INDEX IF NOT EXISTS idx_importance ON hot_memories(importance);
      CREATE INDEX IF NOT EXISTS idx_category ON hot_memories(category);
      
      -- PERF-OPT-1.3: Additional indexes for 10-100x query performance
      CREATE INDEX IF NOT EXISTS idx_timestamp ON hot_memories(timestamp);
      CREATE INDEX IF NOT EXISTS idx_access_count ON hot_memories(access_count);
    `);
  }

  async store(memory: MemoryContent): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO hot_memories (id, content, timestamp, access_count, last_accessed, importance, confidence, category, encrypted, entities)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      memory.id,
      memory.content,
      memory.timestamp.getTime(),
      memory.accessCount,
      memory.lastAccessed.getTime(),
      memory.importance,
      memory.confidence,
      memory.category,
      memory.encrypted ? 1 : 0,
      JSON.stringify(memory.entities),
    );
  }

  async retrieve(id: string): Promise<MemoryContent | null> {
    const stmt = this.db.prepare("SELECT * FROM hot_memories WHERE id = ?");
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      content: row.content,
      timestamp: new Date(row.timestamp),
      accessCount: row.access_count,
      lastAccessed: new Date(row.last_accessed),
      importance: row.importance,
      confidence: row.confidence,
      category: row.category,
      encrypted: row.encrypted === 1,
      entities: JSON.parse(row.entities),
    };
  }

  async delete(id: string): Promise<boolean> {
    const stmt = this.db.prepare("DELETE FROM hot_memories WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async updateAccess(id: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE hot_memories 
      SET access_count = access_count + 1, last_accessed = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), id);
  }

  async getLeastRecentlyUsed(limit: number): Promise<MemoryContent[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM hot_memories 
      ORDER BY last_accessed ASC 
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      timestamp: new Date(row.timestamp),
      accessCount: row.access_count,
      lastAccessed: new Date(row.last_accessed),
      importance: row.importance,
      confidence: row.confidence,
      category: row.category,
      encrypted: row.encrypted === 1,
      entities: JSON.parse(row.entities),
    }));
  }

  /**
   * Get the underlying database connection
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Get the vector search schema for embedding operations
   */
  getVectorSchema(): VectorSearchSchema {
    return this.vectorSchema;
  }

  /**
   * Get the FTS search schema for text search operations
   */
  getFtsSchema(): FtsSearchSchema {
    return this.ftsSchema;
  }

  /**
   * Get all memories for batch operations (e.g., reindexing)
   */
  async getAllMemories(): Promise<MemoryContent[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM hot_memories 
      ORDER BY timestamp DESC
    `);
    const rows = stmt.all() as any[];

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      timestamp: new Date(row.timestamp),
      accessCount: row.access_count,
      lastAccessed: new Date(row.last_accessed),
      importance: row.importance,
      confidence: row.confidence,
      category: row.category,
      encrypted: row.encrypted === 1,
      entities: JSON.parse(row.entities),
    }));
  }

  /**
   * Get total count of memories
   */
  async getCount(): Promise<number> {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM hot_memories");
    const row = stmt.get() as { count: number };
    return row.count;
  }

  async getRecentMessages(options: { limit: number; maxAgeMs: number }): Promise<
    Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
      correlationId: string;
    }>
  > {
    const cutoff = Date.now() - options.maxAgeMs;
    const stmt = this.db.prepare(`
      SELECT id, content, timestamp, category 
      FROM hot_memories 
      WHERE timestamp > ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(cutoff, options.limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      role: "assistant", // Default role for stored memories
      content: row.content,
      timestamp: row.timestamp,
      correlationId: "",
    }));
  }

  async getMetrics(): Promise<StorageMetrics> {
    const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM hot_memories");
    const sizeStmt = this.db.prepare(`
      SELECT SUM(LENGTH(content) + LENGTH(entities)) as total_size 
      FROM hot_memories
    `);

    const countRow = countStmt.get() as any;
    const sizeRow = sizeStmt.get() as any;

    return {
      tier: "hot",
      count: countRow.count,
      totalSize: sizeRow.total_size || 0,
      avgAccessTime: 0,
    };
  }
}
