/**
 * Stage 2: Hybrid Search (Vector + BM25)
 * Single Responsibility: Perform hybrid semantic search with query embeddings
 */

import type { DatabaseSync } from "better-sqlite3";
import type { EncryptionService } from "../../encryption/EncryptionService.js";
import { debugStage2Start, debugStage2Complete } from "../debug-utils.js";
import { HybridSearchEngine } from "../hybrid-search-engine.js";
import type { SearchResult } from "../models.js";
import type { QueryEmbeddingService } from "../services/QueryEmbeddingService.js";

export interface Stage2Config {
  db: DatabaseSync;
  providerModel: string;
  maxResults: number;
  minRelevance: number;
  vectorWeight?: number;
  textWeight?: number;
  /** Query embedding service for generating query vectors */
  queryEmbeddingService?: QueryEmbeddingService;
  /** Encryption service for decrypting User category memories */
  encryptionService?: EncryptionService;
}

export class Stage2HybridSearch {
  private searchEngine: HybridSearchEngine;
  private queryEmbeddingService?: QueryEmbeddingService;
  private maxResults: number;
  private minRelevance: number;

  constructor(config: Stage2Config) {
    this.searchEngine = new HybridSearchEngine({
      db: config.db,
      providerModel: config.providerModel,
      vectorWeight: config.vectorWeight ?? 0.7,
      textWeight: config.textWeight ?? 0.3,
      enableMMR: true,
      enableTemporalDecay: true,
      encryptionService: config.encryptionService,
    });
    this.queryEmbeddingService = config.queryEmbeddingService;
    this.maxResults = config.maxResults;
    this.minRelevance = config.minRelevance;
  }

  /**
   * Execute Stage 2: Hybrid vector + BM25 search
   *
   * In pipeline mode, restricts search to memory IDs from Stage 1
   *
   * @param query - The search query
   * @param stage1Results - Optional results from Stage 1 to restrict search scope
   */
  async execute(
    query: string,
    stage1Results?: SearchResult[],
  ): Promise<{
    results: SearchResult[];
    success: boolean;
    error?: Error;
    embeddingGenerated: boolean;
  }> {
    debugStage2Start(query);
    const startTime = Date.now();

    try {
      // Generate query embedding if service available
      let queryEmbedding: number[] | undefined;
      let embeddingGenerated = false;

      if (this.queryEmbeddingService) {
        const embeddingResult = await this.queryEmbeddingService.embedQuery(query);

        if (embeddingResult?.embedding) {
          queryEmbedding = embeddingResult.embedding;
          embeddingGenerated = true;
        }
      }

      // Extract memory IDs from Stage 1 results for pipeline filtering
      const stage1MemoryIds = stage1Results?.map((r) => r.memoryId);

      // Perform hybrid search (vector + BM25), scoped to Stage 1 results if provided
      const results = await this.searchEngine.search(
        query,
        queryEmbedding,
        this.maxResults,
        this.minRelevance,
        stage1MemoryIds, // Pipeline: restricts search to Stage 1's identified memories
      );

      // In pipeline mode, include Stage 1 results that weren't found by hybrid search
      // This ensures we don't lose highly relevant KG matches
      const finalResults = this.mergeWithStage1(results, stage1Results);

      const durationMs = Date.now() - startTime;
      debugStage2Complete(results.length, durationMs);

      return {
        results: finalResults,
        success: true,
        embeddingGenerated,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      console.error(`[Stage2] Hybrid search failed after ${durationMs}ms:`, error);

      return {
        results: [],
        success: false,
        error: error as Error,
        embeddingGenerated: false,
      };
    }
  }

  /**
   * Check if this stage is available
   */
  isAvailable(): boolean {
    return true; // Always available if initialized
  }

  /**
   * Get search engine statistics
   */
  getStats(): ReturnType<HybridSearchEngine["getStats"]> {
    return this.searchEngine.getStats();
  }

  /**
   * Get embedding service status
   */
  getEmbeddingStatus(): {
    available: boolean;
    cached: number;
  } {
    return {
      available: !!this.queryEmbeddingService,
      cached: this.queryEmbeddingService?.getCacheStats().size ?? 0,
    };
  }

  /**
   * Merge hybrid search results with Stage 1 results
   * Ensures Stage 1's highly relevant KG matches aren't lost
   */
  private mergeWithStage1(
    hybridResults: SearchResult[],
    stage1Results?: SearchResult[],
  ): SearchResult[] {
    if (!stage1Results || stage1Results.length === 0) {
      return hybridResults;
    }

    // Create map of hybrid results by memory ID
    const byId = new Map<string, SearchResult>();
    for (const r of hybridResults) {
      byId.set(r.memoryId, r);
    }

    // Add Stage 1 results that weren't found by hybrid search
    // Keep the higher score if duplicate exists
    for (const r of stage1Results) {
      const existing = byId.get(r.memoryId);
      if (!existing) {
        // Stage 1 found it but hybrid didn't - add it with Stage 1's score
        byId.set(r.memoryId, r);
      } else if (r.score > existing.score) {
        // Stage 1 had higher score - use that
        byId.set(r.memoryId, r);
      }
    }

    return Array.from(byId.values());
  }
}
