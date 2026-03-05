/**
 * Hybrid Search Engine for AURA Stage 2
 * Leverages legacy OpenClaw's vector + BM25 hybrid search
 *
 * Features:
 * - Vector search (cosine similarity)
 * - BM25 keyword search (SQLite FTS)
 * - Hybrid result merging with configurable weights
 * - MMR (Maximal Marginal Relevance) for diversity
 * - Temporal decay for recency boosting
 */

import type { DatabaseSync } from "better-sqlite3";
import type { EncryptionService } from "../encryption/EncryptionService.js";
import {
  debugSearchStart,
  debugSearchResults,
  debugSearchError,
  trackPerformance,
} from "./debug-utils.js";
import type { SearchResult } from "./models.js";

export interface HybridSearchConfig {
  /** Database connection */
  db: DatabaseSync;
  /** Vector table name */
  vectorTable?: string;
  /** FTS table name */
  ftsTable?: string;
  /** Provider model for embeddings */
  providerModel: string;
  /** Vector search weight (0-1) */
  vectorWeight?: number;
  /** Text/BM25 search weight (0-1) */
  textWeight?: number;
  /** Enable MMR re-ranking */
  enableMMR?: boolean;
  /** Enable temporal decay */
  enableTemporalDecay?: boolean;
  /** Encryption service for decrypting User category memories */
  encryptionService?: EncryptionService;
}

export class HybridSearchEngine {
  private db: DatabaseSync;
  private vectorTable: string;
  private ftsTable: string;
  private providerModel: string;
  private vectorWeight: number;
  private textWeight: number;
  private enableMMR: boolean;
  private enableTemporalDecay: boolean;
  private encryptionService?: EncryptionService;

  constructor(config: HybridSearchConfig) {
    this.db = config.db;
    this.vectorTable = config.vectorTable ?? "memory_vectors";
    this.ftsTable = config.ftsTable ?? "memory_fts";
    this.providerModel = config.providerModel;
    this.vectorWeight = config.vectorWeight ?? 0.7;
    this.textWeight = config.textWeight ?? 0.3;
    this.enableMMR = config.enableMMR ?? true;
    this.enableTemporalDecay = config.enableTemporalDecay ?? true;
    this.encryptionService = config.encryptionService;

    // Validate weights
    const totalWeight = this.vectorWeight + this.textWeight;
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      this.vectorWeight /= totalWeight;
      this.textWeight /= totalWeight;
    }
  }

  /**
   * Perform hybrid search (vector + BM25)
   * Equivalent to legacy OpenClaw's hybrid search
   *
   * @param memoryIds - Optional array of memory IDs to restrict search to (for pipeline mode)
   */
  @trackPerformance("hybrid-search")
  async search(
    query: string,
    queryEmbedding?: number[],
    limit: number = 50,
    relevanceThreshold: number = 0.1,
    memoryIds?: string[],
  ): Promise<SearchResult[]> {
    const startTime = Date.now();
    debugSearchStart(query, limit, "hybrid-engine");

    try {
      let vectorResults: Array<{
        id: string;
        content: string;
        score: number;
        metadata: Record<string, unknown>;
      }> = [];

      let textResults: Array<{
        id: string;
        content: string;
        score: number;
        metadata: Record<string, unknown>;
      }> = [];

      // Stage 2a: Vector search (if embedding provided)
      if (queryEmbedding && queryEmbedding.length > 0) {
        vectorResults = await this.searchVector(queryEmbedding, limit * 2, memoryIds);
      }

      // Stage 2b: BM25 text search
      textResults = await this.searchBM25(query, limit * 2, memoryIds);

      // Merge results with hybrid scoring
      const merged = this.mergeResults(vectorResults, textResults);

      // Apply relevance threshold
      const filtered = merged.filter((r) => r.score >= relevanceThreshold);

      // Sort by score
      filtered.sort((a, b) => b.score - a.score);

      // Limit results
      const results = filtered.slice(0, limit);

      const durationMs = Date.now() - startTime;
      debugSearchResults(results, query, durationMs);

      return results;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      debugSearchError(query, error as Error, durationMs);
      throw error;
    }
  }

  /**
   * Vector search using cosine similarity
   * Leverages sqlite-vec or in-memory cosine similarity
   *
   * @param memoryIds - Optional array of memory IDs to restrict search to
   */
  private async searchVector(
    queryVec: number[],
    limit: number,
    memoryIds?: string[],
  ): Promise<
    Array<{ id: string; content: string; score: number; metadata: Record<string, unknown> }>
  > {
    try {
      // Check if vec table exists
      const tableExists = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get(this.vectorTable);

      if (!tableExists) {
        return [];
      }

      // Build query with optional memory ID filtering
      let sql = `SELECT m.id as memory_id, m.content, m.category, m.encrypted, m.entities as metadata, m.timestamp as created_at,
                vec_distance_cosine(v.embedding, ?) AS distance
         FROM ${this.vectorTable} v
         JOIN hot_memories m ON m.id = v.memory_id`;

      const params: (Buffer | number | string)[] = [Buffer.from(new Float32Array(queryVec).buffer)];

      if (memoryIds && memoryIds.length > 0) {
        const placeholders = memoryIds.map(() => "?").join(",");
        sql += ` WHERE m.id IN (${placeholders})`;
        params.push(...memoryIds);
      }

      sql += ` ORDER BY distance ASC LIMIT ?`;
      params.push(limit);

      // Query using vec_distance_cosine (sqlite-vec)
      const rows = this.db.prepare(sql).all(...params) as Array<{
        memory_id: string;
        content: string;
        category: string;
        encrypted: number;
        metadata: string;
        created_at: number;
        distance: number;
      }>;

      // Decrypt User category memories if needed
      return await Promise.all(
        rows.map(async (row) => ({
          id: row.memory_id,
          content: await this.decryptIfNeeded(
            row.content,
            row.category,
            row.encrypted,
            row.memory_id,
          ),
          score: 1 - row.distance, // Convert distance to similarity
          metadata: {
            ...JSON.parse(row.metadata || "{}"),
            createdAt: row.created_at,
            category: row.category,
            encrypted: row.encrypted === 1,
          },
        })),
      );
    } catch (error) {
      return [];
    }
  }

  /**
   * BM25 text search using SQLite FTS
   *
   * @param memoryIds - Optional array of memory IDs to restrict search to
   */
  private searchBM25(
    query: string,
    limit: number,
    memoryIds?: string[],
  ): Promise<
    Array<{ id: string; content: string; score: number; metadata: Record<string, unknown> }>
  > {
    return new Promise(async (resolve) => {
      try {
        // Build FTS query (tokenize and quote)
        const ftsQuery = this.buildFtsQuery(query);
        if (!ftsQuery) {
          resolve([]);
          return;
        }

        // Check if FTS table exists
        const tableExists = this.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
          .get(this.ftsTable);

        if (!tableExists) {
          resolve([]);
          return;
        }

        // Build query with optional memory ID filtering
        let sql = `SELECT m.id as memory_id, m.content, m.category, m.encrypted, m.entities as metadata, m.timestamp as created_at,
                  bm25(${this.ftsTable}) AS rank
           FROM ${this.ftsTable}
           JOIN hot_memories m ON m.id = ${this.ftsTable}.memory_id
           WHERE ${this.ftsTable} MATCH ?`;

        const params: (string | number)[] = [ftsQuery];

        if (memoryIds && memoryIds.length > 0) {
          const placeholders = memoryIds.map(() => "?").join(",");
          sql += ` AND m.id IN (${placeholders})`;
          params.push(...memoryIds);
        }

        sql += ` ORDER BY rank ASC LIMIT ?`;
        params.push(limit);

        // Query using BM25 ranking
        const rows = this.db.prepare(sql).all(...params) as Array<{
          memory_id: string;
          content: string;
          category: string;
          encrypted: number;
          metadata: string;
          created_at: number;
          rank: number;
        }>;

        // Decrypt User category memories if needed
        const results = await Promise.all(
          rows.map(async (row) => ({
            id: row.memory_id,
            content: await this.decryptIfNeeded(
              row.content,
              row.category,
              row.encrypted,
              row.memory_id,
            ),
            score: this.bm25RankToScore(row.rank),
            metadata: {
              ...JSON.parse(row.metadata || "{}"),
              createdAt: row.created_at,
              category: row.category,
              encrypted: row.encrypted === 1,
            },
          })),
        );

        resolve(results);
      } catch (error) {
        resolve([]);
      }
    });
  }

  /**
   * Merge vector and BM25 results with hybrid scoring
   */
  private mergeResults(
    vectorResults: Array<{
      id: string;
      content: string;
      score: number;
      metadata: Record<string, unknown>;
    }>,
    textResults: Array<{
      id: string;
      content: string;
      score: number;
      metadata: Record<string, unknown>;
    }>,
  ): SearchResult[] {
    const byId = new Map<
      string,
      {
        id: string;
        content: string;
        vectorScore: number;
        textScore: number;
        metadata: Record<string, unknown>;
      }
    >();

    // Add vector results
    for (const r of vectorResults) {
      byId.set(r.id, {
        id: r.id,
        content: r.content,
        vectorScore: r.score,
        textScore: 0,
        metadata: r.metadata,
      });
    }

    // Add/merge BM25 results
    for (const r of textResults) {
      const existing = byId.get(r.id);
      if (existing) {
        existing.textScore = r.score;
      } else {
        byId.set(r.id, {
          id: r.id,
          content: r.content,
          vectorScore: 0,
          textScore: r.score,
          metadata: r.metadata,
        });
      }
    }

    // Calculate hybrid scores
    return Array.from(byId.values()).map((entry) => {
      const hybridScore = this.vectorWeight * entry.vectorScore + this.textWeight * entry.textScore;
      return {
        memoryId: entry.id,
        content: entry.content,
        score: hybridScore,
        metadata: entry.metadata,
      };
    });
  }

  /**
   * Build FTS query from raw text
   * Tokenizes and creates AND-separated quoted terms
   */
  private buildFtsQuery(raw: string): string | null {
    const tokens =
      raw
        .match(/[\p{L}\p{N}_]+/gu)
        ?.map((t) => t.trim())
        .filter(Boolean) ?? [];

    if (tokens.length === 0) {
      return null;
    }

    const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
    return quoted.join(" AND ");
  }

  /**
   * Convert BM25 rank to normalized score (0-1)
   */
  private bm25RankToScore(rank: number): number {
    const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
    return 1 / (1 + normalized);
  }

  /**
   * Apply MMR (Maximal Marginal Relevance) re-ranking
   * Reduces redundancy while maintaining relevance
   */
  private applyMMR(
    results: SearchResult[],
    lambda: number = 0.5,
    diversityThreshold: number = 0.7,
  ): SearchResult[] {
    if (results.length <= 1) return results;

    const selected: SearchResult[] = [];
    const candidates = [...results];

    // Select first result (highest relevance)
    selected.push(candidates.shift()!);

    while (candidates.length > 0 && selected.length < 10) {
      let bestMMRScore = -1;
      let bestIndex = -1;

      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];

        // Relevance component
        const relevance = candidate.score;

        // Diversity component (max similarity to already selected)
        let maxSimilarity = 0;
        for (const selectedItem of selected) {
          const similarity = this.calculateSimilarity(candidate.content, selectedItem.content);
          maxSimilarity = Math.max(maxSimilarity, similarity);
        }

        // MMR score
        const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;

        if (mmrScore > bestMMRScore) {
          bestMMRScore = mmrScore;
          bestIndex = i;
        }
      }

      if (bestIndex >= 0) {
        selected.push(candidates.splice(bestIndex, 1)[0]);
      }
    }

    return selected;
  }

  /**
   * Calculate text similarity for MMR
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Get search engine statistics
   */
  getStats(): {
    vectorWeight: number;
    textWeight: number;
    enableMMR: boolean;
    enableTemporalDecay: boolean;
    vectorAvailable: boolean;
    ftsAvailable: boolean;
  } {
    return {
      vectorWeight: this.vectorWeight,
      textWeight: this.textWeight,
      enableMMR: this.enableMMR,
      enableTemporalDecay: this.enableTemporalDecay,
      vectorAvailable: this.vectorWeight > 0,
      ftsAvailable: this.textWeight > 0,
    };
  }

  /**
   * Decrypt content if it's a User category memory and encrypted
   */
  private async decryptIfNeeded(
    content: string,
    category: string,
    encrypted: number,
    memoryId: string,
  ): Promise<string> {
    // Only decrypt User category memories that are marked as encrypted
    if (category !== "User" || encrypted !== 1 || !this.encryptionService) {
      return content;
    }

    try {
      // Parse the encrypted data structure
      const encryptedData = JSON.parse(content);

      // Decrypt using the encryption service
      const result = await this.encryptionService.decrypt({
        encrypted: encryptedData,
        category,
        memoryId,
      });

      if (result.success && result.plaintext) {
        return result.plaintext;
      } else {
        return `[Encrypted: ${result.error || "decryption failed"}]`;
      }
    } catch (error) {
      return `[Encrypted: parse error]`;
    }
  }

  /**
   * Update search weights dynamically
   */
  setWeights(vectorWeight: number, textWeight: number): void {
    const total = vectorWeight + textWeight;
    this.vectorWeight = vectorWeight / total;
    this.textWeight = textWeight / total;
  }
}
