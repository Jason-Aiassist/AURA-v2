/**
 * Semantic search engine for AURA Context Injection
 * Ported from Python search_engine.py to TypeScript
 * Uses TF-IDF-like scoring for text similarity
 */

import {
  debugSearchStart,
  debugSearchResults,
  debugSearchError,
  debugIndexBuildStart,
  debugIndexBuildComplete,
  trackPerformance,
} from "./debug-utils.js";
import type { SearchResult } from "./models.js";

export interface SearchEngineConfig {
  /** Path to memory storage */
  memoryPath: string;
  /** Stop words to filter out */
  stopWords?: Set<string>;
}

export class SemanticSearchEngine {
  private memoryPath: string;
  private stopWords: Set<string>;
  private index: Map<string, { content: string; metadata: Record<string, unknown> }> = new Map();
  private indexBuilt = false;

  constructor(config: SearchEngineConfig) {
    this.memoryPath = config.memoryPath;
    this.stopWords =
      config.stopWords ??
      new Set([
        "the",
        "a",
        "an",
        "and",
        "or",
        "but",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "with",
        "by",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "have",
        "has",
        "had",
        "do",
        "does",
        "did",
      ]);
  }

  /**
   * Search for relevant memories with adjustable threshold
   * Equivalent to Python: async def search(self, query, limit, relevance_threshold)
   */
  @trackPerformance("search")
  async search(
    query: string,
    limit: number = 50,
    relevanceThreshold: number = 0.1,
  ): Promise<SearchResult[]> {
    const startTime = Date.now();
    debugSearchStart(query, limit, this.memoryPath);

    try {
      // Build index if not cached
      if (!this.indexBuilt) {
        await this.buildIndex();
      }

      // Simple keyword-based search with TF-IDF-like scoring
      const queryWords = this.tokenize(query);
      const results: SearchResult[] = [];

      for (const [memoryId, memory] of this.index.entries()) {
        const score = this.calculateSimilarity(queryWords, memory.content);
        if (score > relevanceThreshold) {
          results.push({
            memoryId,
            content: memory.content,
            score,
            metadata: memory.metadata,
          });
        }
      }

      // Sort by relevance
      results.sort((a, b) => b.score - a.score);

      // Log results
      const durationMs = Date.now() - startTime;
      debugSearchResults(results, query, durationMs);

      // Limit results
      return results.slice(0, limit);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      debugSearchError(query, error as Error, durationMs);
      throw error;
    }
  }

  /**
   * Simple tokenization - equivalent to Python _tokenize()
   */
  private tokenize(text: string): string[] {
    const words = text.toLowerCase().split(/\s+/);
    return words.filter((w) => !this.stopWords.has(w) && w.length > 2);
  }

  /**
   * Calculate similarity score - equivalent to Python _calculate_similarity()
   */
  private calculateSimilarity(queryWords: string[], content: string): number {
    const contentLower = content.toLowerCase();

    // Check for exact phrase match first (high score)
    const queryPhrase = queryWords.join(" ");
    if (contentLower.includes(queryPhrase)) {
      return 0.95; // Very high score for exact phrase
    }

    // Check for individual word matches
    const contentWords = this.tokenize(content);

    // Count matches
    let matches = 0;
    for (const queryWord of queryWords) {
      if (contentWords.includes(queryWord) || contentLower.includes(queryWord)) {
        matches++;
      }
    }

    if (queryWords.length === 0) {
      return 0.0;
    }

    // Score based on percentage of query words found
    const matchRatio = matches / queryWords.length;

    // Boost for high match percentage
    if (matchRatio >= 0.5) {
      return Math.min(matchRatio + 0.3, 0.9);
    } else if (matchRatio > 0) {
      return matchRatio * 0.7;
    }

    return 0.0;
  }

  /**
   * Build search index from memory storage
   * Equivalent to Python _build_index()
   */
  @trackPerformance("index-build")
  private async buildIndex(): Promise<void> {
    debugIndexBuildStart(this.memoryPath);
    const startTime = Date.now();

    this.index.clear();
    let fileCount = 0;

    try {
      // For AURA, we query the TieredMemoryStore instead of file system
      // This will be populated by the ContextInjector calling search on storage
      this.indexBuilt = true;

      const durationMs = Date.now() - startTime;
      debugIndexBuildComplete(fileCount, durationMs);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Add memory to index (used by ContextInjector)
   */
  addToIndex(memoryId: string, content: string, metadata: Record<string, unknown>): void {
    this.index.set(memoryId, { content, metadata });
    this.indexBuilt = true;
  }

  /**
   * Clear the index
   */
  clearIndex(): void {
    this.index.clear();
    this.indexBuilt = false;
  }

  /**
   * Get index statistics
   */
  getStats(): { size: number; built: boolean } {
    return {
      size: this.index.size,
      built: this.indexBuilt,
    };
  }
}
