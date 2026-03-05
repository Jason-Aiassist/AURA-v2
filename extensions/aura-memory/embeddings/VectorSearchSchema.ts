/**
 * Vector Search Schema for AURA Memory
 *
 * Manages the memory_vectors table using sqlite-vec for semantic search.
 * Compatible with existing hot_memories table (linked by memory_id).
 */

import type { DatabaseSync } from "better-sqlite3";

export interface VectorSearchSchemaConfig {
  /** Database connection */
  db: DatabaseSync;
  /** Vector table name */
  tableName?: string;
  /** Embedding dimensions (768 for nomic-embed-text) */
  dimensions?: number;
}

/**
 * Vector Search Schema - Manages sqlite-vec virtual table
 *
 * Features:
 * - Creates vec0 virtual table for vector storage
 * - Stores normalized embeddings linked to memory_id
 * - Cosine similarity search for semantic retrieval
 * - Graceful fallback if sqlite-vec not available
 */
export class VectorSearchSchema {
  private db: DatabaseSync;
  private tableName: string;
  private dimensions: number;
  private available: boolean = false;

  constructor(config: VectorSearchSchemaConfig) {
    this.db = config.db;
    this.tableName = config.tableName ?? "memory_vectors";
    this.dimensions = config.dimensions ?? 768;
  }

  /**
   * Initialize the vector search schema
   * Creates the virtual table if sqlite-vec is available
   */
  initialize(): boolean {
    try {
      // Check if vec0 extension is available
      const hasVec = this.checkVecExtension();
      if (!hasVec) {
        this.available = false;
        return false;
      }

      // Create vec0 virtual table
      // vec0 format: id (rowid) + embedding vector
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName} USING vec0(
          memory_id TEXT PRIMARY KEY,
          embedding FLOAT[${this.dimensions}] distance_metric=cosine
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
   * Check if sqlite-vec extension is available
   */
  private checkVecExtension(): boolean {
    try {
      // Try to execute a vec0-specific query
      this.db.exec("SELECT vec_version()");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if vector search is available
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Insert or update a vector for a memory
   *
   * @param memoryId - The memory ID (from hot_memories.id)
   * @param embedding - The embedding vector (must be normalized)
   */
  insertVector(memoryId: string, embedding: number[]): void {
    if (!this.available) {
      throw new Error("Vector search not available");
    }

    if (embedding.length !== this.dimensions) {
      // Dimension mismatch - still attempt to store
    }

    // Convert to Float32Array and then to Buffer for storage
    const floatArray = new Float32Array(embedding);
    const buffer = Buffer.from(floatArray.buffer);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.tableName} (memory_id, embedding)
      VALUES (?, ?)
    `);

    stmt.run(memoryId, buffer);
  }

  /**
   * Delete a vector for a memory
   *
   * @param memoryId - The memory ID to delete
   */
  deleteVector(memoryId: string): void {
    if (!this.available) {
      return; // Silently skip if not available
    }

    const stmt = this.db.prepare(`
      DELETE FROM ${this.tableName} WHERE memory_id = ?
    `);

    stmt.run(memoryId);
  }

  /**
   * Search for similar vectors using cosine similarity
   *
   * @param queryEmbedding - The query embedding vector
   * @param limit - Maximum results to return
   * @returns Array of {memoryId, distance} sorted by similarity (closest first)
   */
  searchSimilar(
    queryEmbedding: number[],
    limit: number = 50,
  ): Array<{ memoryId: string; distance: number; similarity: number }> {
    if (!this.available) {
      return [];
    }

    // Convert query embedding to buffer
    const floatArray = new Float32Array(queryEmbedding);
    const buffer = Buffer.from(floatArray.buffer);

    // Use vec_distance_cosine for cosine similarity search
    // Returns distance (0 = identical, 2 = opposite), convert to similarity (1 = identical)
    const stmt = this.db.prepare(`
      SELECT memory_id, vec_distance_cosine(embedding, ?) as distance
      FROM ${this.tableName}
      ORDER BY distance ASC
      LIMIT ?
    `);

    const rows = stmt.all(buffer, limit) as Array<{
      memory_id: string;
      distance: number;
    }>;

    return rows.map((row) => ({
      memoryId: row.memory_id,
      distance: row.distance,
      similarity: 1 - row.distance / 2, // Convert cosine distance to similarity
    }));
  }

  /**
   * Get a vector by memory ID
   *
   * @param memoryId - The memory ID
   * @returns The embedding vector or null if not found
   */
  getVector(memoryId: string): number[] | null {
    if (!this.available) {
      return null;
    }

    const stmt = this.db.prepare(`
      SELECT embedding FROM ${this.tableName} WHERE memory_id = ?
    `);

    const row = stmt.get(memoryId) as { embedding: Buffer } | undefined;

    if (!row) {
      return null;
    }

    // Convert buffer back to Float32Array
    const floatArray = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4,
    );

    return Array.from(floatArray);
  }

  /**
   * Check if a vector exists for a memory
   *
   * @param memoryId - The memory ID
   */
  hasVector(memoryId: string): boolean {
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
   * Get count of indexed vectors
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
   * Delete all vectors (use with caution - for reindexing)
   */
  clearAll(): void {
    if (!this.available) {
      return;
    }

    this.db.exec(`DELETE FROM ${this.tableName}`);
  }

  /**
   * Get statistics about the vector index
   */
  getStats(): {
    available: boolean;
    tableName: string;
    dimensions: number;
    count: number;
  } {
    return {
      available: this.available,
      tableName: this.tableName,
      dimensions: this.dimensions,
      count: this.getCount(),
    };
  }
}

/**
 * Factory function to create vector search schema
 */
export function createVectorSearchSchema(
  db: DatabaseSync,
  dimensions: number = 768,
): VectorSearchSchema {
  return new VectorSearchSchema({ db, dimensions });
}
