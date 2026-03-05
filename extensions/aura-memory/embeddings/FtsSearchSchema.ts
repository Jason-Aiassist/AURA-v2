/**
 * FTS5 Search Schema for AURA Memory
 *
 * Manages the memory_fts virtual table for BM25 keyword search.
 * Compatible with existing hot_memories table (linked by memory_id).
 */

import type { DatabaseSync } from "better-sqlite3";

export interface FtsSearchSchemaConfig {
  /** Database connection */
  db: DatabaseSync;
  /** FTS table name */
  tableName?: string;
  /** Tokenizer to use (default: porter for stemming) */
  tokenizer?: string;
}

/**
 * FTS5 Search Schema - Manages full-text search index
 *
 * Features:
 * - Creates FTS5 virtual table for text search
 * - BM25 ranking for relevance scoring
 * - Porter stemming (running/run/runs match)
 * - Prefix search support
 * - Compatible with hot_memories table
 */
export class FtsSearchSchema {
  private db: DatabaseSync;
  private tableName: string;
  private tokenizer: string;
  private available: boolean = false;

  constructor(config: FtsSearchSchemaConfig) {
    this.db = config.db;
    this.tableName = config.tableName ?? "memory_fts";
    this.tokenizer = config.tokenizer ?? "porter"; // Porter stemming for better matches
  }

  /**
   * Initialize the FTS search schema
   * Creates the virtual table and triggers
   */
  initialize(): boolean {
    try {
      // Check if FTS5 is available
      const hasFts5 = this.checkFts5Extension();
      if (!hasFts5) {
        this.available = false;
        return false;
      }

      // Create FTS5 virtual table
      // memory_id is UNINDEXED (we don't search by ID)
      // content is the searchable text
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName} USING fts5(
          memory_id UNINDEXED,
          content,
          tokenize='${this.tokenizer}'
        );
      `);

      this.available = true;
      return true;
    } catch (error) {
      this.available = false;
      return false;
    }
  }

  /**
   * Check if FTS5 extension is available
   */
  private checkFts5Extension(): boolean {
    try {
      // Try to check for FTS5
      const result = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_fts5'")
        .get();
      // FTS5 might not show in sqlite_master, try creating a test table
      this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_test USING fts5(x)");
      this.db.exec("DROP TABLE IF EXISTS _fts5_test");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if FTS search is available
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Insert or update a document in the FTS index
   *
   * Note: For encrypted memories, do NOT index the encrypted content.
   * Only index decrypted plaintext or skip entirely.
   *
   * @param memoryId - The memory ID (from hot_memories.id)
   * @param content - The plaintext content to index
   */
  insertDocument(memoryId: string, content: string): void {
    if (!this.available) {
      throw new Error("FTS search not available");
    }

    if (!content || content.trim().length === 0) {
      return; // Skip empty content
    }

    // Delete existing document first (UPSERT behavior)
    this.deleteDocument(memoryId);

    const stmt = this.db.prepare(`
      INSERT INTO ${this.tableName} (memory_id, content)
      VALUES (?, ?)
    `);

    stmt.run(memoryId, content.trim());
  }

  /**
   * Delete a document from the FTS index
   *
   * @param memoryId - The memory ID to delete
   */
  deleteDocument(memoryId: string): void {
    if (!this.available) {
      return; // Silently skip if not available
    }

    const stmt = this.db.prepare(`
      DELETE FROM ${this.tableName} WHERE memory_id = ?
    `);

    stmt.run(memoryId);
  }

  /**
   * Update a document (convenience method)
   *
   * @param memoryId - The memory ID
   * @param content - The new content
   */
  updateDocument(memoryId: string, content: string): void {
    this.insertDocument(memoryId, content); // FTS5 doesn't have UPDATE, use INSERT after DELETE
  }

  /**
   * Search using BM25 ranking
   *
   * @param query - The search query
   * @param limit - Maximum results to return
   * @returns Array of {memoryId, rank} sorted by relevance (best first)
   */
  searchBM25(
    query: string,
    limit: number = 50,
  ): Array<{ memoryId: string; rank: number; score: number }> {
    if (!this.available) {
      return [];
    }

    const ftsQuery = this.buildFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    // Use BM25 ranking - lower rank = better match
    const stmt = this.db.prepare(`
      SELECT memory_id, bm25(${this.tableName}) as rank
      FROM ${this.tableName}
      WHERE ${this.tableName} MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    `);

    const rows = stmt.all(ftsQuery, limit) as Array<{
      memory_id: string;
      rank: number;
    }>;

    return rows.map((row) => ({
      memoryId: row.memory_id,
      rank: row.rank,
      score: this.rankToScore(row.rank), // Convert to 0-1 score
    }));
  }

  /**
   * Search with content preview
   *
   * @param query - The search query
   * @param limit - Maximum results to return
   * @returns Array with memoryId, rank, and snippet
   */
  searchWithPreview(
    query: string,
    limit: number = 50,
  ): Array<{
    memoryId: string;
    rank: number;
    score: number;
    snippet: string;
  }> {
    if (!this.available) {
      return [];
    }

    const ftsQuery = this.buildFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    const stmt = this.db.prepare(`
      SELECT 
        memory_id, 
        bm25(${this.tableName}) as rank,
        snippet(${this.tableName}, 0, '<mark>', '</mark>', '...', 32) as snippet
      FROM ${this.tableName}
      WHERE ${this.tableName} MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    `);

    const rows = stmt.all(ftsQuery, limit) as Array<{
      memory_id: string;
      rank: number;
      snippet: string;
    }>;

    return rows.map((row) => ({
      memoryId: row.memory_id,
      rank: row.rank,
      score: this.rankToScore(row.rank),
      snippet: row.snippet,
    }));
  }

  /**
   * Check if a document exists in the index
   *
   * @param memoryId - The memory ID
   */
  hasDocument(memoryId: string): boolean {
    if (!this.available) {
      return false;
    }

    const stmt = this.db.prepare(`
      SELECT 1 FROM ${this.tableName} WHERE memory_id = ?
    `);

    const row = stmt.get(memoryId);
    return row !== undefined;
  }

  /**
   * Get count of indexed documents
   */
  getCount(): number {
    if (!this.available) {
      return 0;
    }

    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName}`);
    const row = stmt.get() as { count: number };
    return row.count;
  }

  /**
   * Delete all documents (use with caution - for reindexing)
   */
  clearAll(): void {
    if (!this.available) {
      return;
    }

    this.db.exec(`DELETE FROM ${this.tableName}`);
  }

  /**
   * Optimize the FTS index (run periodically for performance)
   */
  optimize(): void {
    if (!this.available) {
      return;
    }

    this.db.exec(`INSERT INTO ${this.tableName}(${this.tableName}) VALUES('optimize')`);
  }

  /**
   * Get statistics about the FTS index
   */
  getStats(): {
    available: boolean;
    tableName: string;
    tokenizer: string;
    count: number;
  } {
    return {
      available: this.available,
      tableName: this.tableName,
      tokenizer: this.tokenizer,
      count: this.getCount(),
    };
  }

  /**
   * Build FTS query from raw text
   * Tokenizes and creates AND-separated quoted terms
   *
   * Supports:
   * - Basic word search: "hello world" → "hello" AND "world"
   * - Phrase search: "hello world" (with quotes)
   * - Prefix search: "run*" → matches "running", "run", etc.
   */
  private buildFtsQuery(raw: string): string | null {
    if (!raw || raw.trim().length === 0) {
      return null;
    }

    // Check if already a valid FTS query (contains operators)
    if (/[\*\^\":\(\)]/.test(raw)) {
      return raw.trim();
    }

    // Tokenize and quote
    const tokens =
      raw
        .toLowerCase()
        .match(/[\p{L}\p{N}_]+/gu)
        ?.map((t) => t.trim())
        .filter((t) => t.length > 1) ?? []; // Filter single-char tokens

    if (tokens.length === 0) {
      return null;
    }

    // Quote tokens and join with AND
    const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
    return quoted.join(" AND ");
  }

  /**
   * Convert BM25 rank to normalized score (0-1)
   * BM25 rank is unbounded, lower is better
   */
  private rankToScore(rank: number): number {
    // BM25 ranks are typically small negative numbers for good matches
    // Convert to 0-1 scale where 1 is best match
    const normalized = Number.isFinite(rank) ? Math.max(-100, Math.min(0, rank)) : -100;
    return 1 + normalized / 100; // -100 → 0, 0 → 1
  }
}

/**
 * Factory function to create FTS search schema
 */
export function createFtsSearchSchema(
  db: DatabaseSync,
  tokenizer: string = "porter",
): FtsSearchSchema {
  return new FtsSearchSchema({ db, tokenizer });
}
