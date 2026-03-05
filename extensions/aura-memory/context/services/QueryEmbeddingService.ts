/**
 * Query Embedding Service
 *
 * Generates embeddings for search queries using the configured embedding service.
 * Used by the context injection pipeline to enable semantic search.
 */

import type { EmbeddingService } from "../embeddings/EmbeddingService.js";

export interface QueryEmbeddingServiceConfig {
  /** Embedding service for generating vectors */
  embeddingService: EmbeddingService;
  /** Enable caching of query embeddings */
  enableCache?: boolean;
  /** Maximum cache size (LRU eviction) */
  maxCacheSize?: number;
}

export interface QueryEmbeddingResult {
  /** The embedding vector */
  embedding: number[];
  /** Number of tokens in query */
  tokenCount?: number;
  /** Generation duration in ms */
  durationMs: number;
  /** Whether result was from cache */
  fromCache: boolean;
}

/**
 * Service for generating query embeddings
 *
 * Features:
 * - Generates embeddings for search queries
 * - Optional LRU caching to avoid re-embedding same queries
 * - Error handling with graceful fallback
 * - Debug logging for troubleshooting
 */
export class QueryEmbeddingService {
  private embeddingService: EmbeddingService;
  private enableCache: boolean;
  private maxCacheSize: number;
  private cache: Map<string, number[]>;
  private cacheOrder: string[];

  constructor(config: QueryEmbeddingServiceConfig) {
    this.embeddingService = config.embeddingService;
    this.enableCache = config.enableCache ?? true;
    this.maxCacheSize = config.maxCacheSize ?? 100;
    this.cache = new Map();
    this.cacheOrder = [];
  }

  /**
   * Generate embedding for a query
   *
   * @param query - The search query text
   * @returns Embedding result or null if generation fails
   */
  async embedQuery(query: string): Promise<QueryEmbeddingResult | null> {
    const startTime = Date.now();

    // Normalize query for cache key
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return null;
    }

    // Check cache
    if (this.enableCache) {
      const cached = this.getFromCache(normalizedQuery);
      if (cached) {
        return {
          embedding: cached,
          durationMs: Date.now() - startTime,
          fromCache: true,
        };
      }
    }

    // Generate embedding
    try {
      const result = await this.embeddingService.generateEmbedding(normalizedQuery);

      if (!result?.embedding) {
        return null;
      }

      // Cache the result
      if (this.enableCache) {
        this.addToCache(normalizedQuery, result.embedding);
      }

      const durationMs = Date.now() - startTime;

      return {
        embedding: result.embedding,
        tokenCount: result.tokensUsed,
        durationMs,
        fromCache: false,
      };
    } catch (error) {
      console.error("[QueryEmbeddingService] Failed to generate embedding:", error);
      return null;
    }
  }

  /**
   * Get embedding from cache with LRU update
   */
  private getFromCache(query: string): number[] | null {
    const cached = this.cache.get(query);
    if (cached) {
      // Update LRU order
      this.updateLRU(query);
      return cached;
    }
    return null;
  }

  /**
   * Add embedding to cache with LRU eviction
   */
  private addToCache(query: string, embedding: number[]): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxCacheSize && this.cacheOrder.length > 0) {
      const oldest = this.cacheOrder.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }

    // Add new entry
    this.cache.set(query, embedding);
    this.cacheOrder.push(query);
  }

  /**
   * Update LRU order for accessed item
   */
  private updateLRU(query: string): void {
    const index = this.cacheOrder.indexOf(query);
    if (index > -1) {
      this.cacheOrder.splice(index, 1);
      this.cacheOrder.push(query);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hitRate: 0, // Would need to track hits/misses to calculate
    };
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheOrder = [];
  }
}

/**
 * Factory function to create query embedding service
 */
export function createQueryEmbeddingService(
  embeddingService: EmbeddingService,
): QueryEmbeddingService {
  return new QueryEmbeddingService({
    embeddingService,
    enableCache: true,
    maxCacheSize: 100,
  });
}
