/**
 * Context Deduplication Utility
 *
 * Deduplicates memories at runtime during context injection.
 * Prevents duplicates from being returned to the user even if they exist in storage.
 */

export interface Memory {
  memoryId: string;
  content: string;
  entities?: string[];
  relevanceScore?: number;
  timestamp?: number;
  source?: string;
}

export interface DeduplicationOptions {
  similarityThreshold: number;
  preferHigherRelevance: boolean;
  preferMoreRecent: boolean;
}

export class ContextDeduplicator {
  private options: DeduplicationOptions;

  constructor(options?: Partial<DeduplicationOptions>) {
    this.options = {
      similarityThreshold: 0.85,
      preferHigherRelevance: true,
      preferMoreRecent: true,
      ...options,
    };
  }

  /**
   * Deduplicate an array of memories
   */
  deduplicate(memories: Memory[]): Memory[] {
    if (memories.length <= 1) {
      return memories;
    }

    const uniqueMemories: Memory[] = [];
    const seen = new Map<string, Memory>();

    for (const memory of memories) {
      // Check for exact duplicate by ID
      if (seen.has(memory.memoryId)) {
        const existing = seen.get(memory.memoryId)!;
        const merged = this.mergeMemories(existing, memory);
        seen.set(memory.memoryId, merged);
        continue;
      }

      // Check for semantic duplicate by content
      let isDuplicate = false;
      for (const [id, existing] of seen) {
        if (this.isDuplicate(memory, existing)) {
          isDuplicate = true;
          const merged = this.mergeMemories(existing, memory);
          seen.set(id, merged);
          break;
        }
      }

      if (!isDuplicate) {
        seen.set(memory.memoryId, memory);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Check if two memories are duplicates
   */
  private isDuplicate(a: Memory, b: Memory): boolean {
    // Exact content match
    if (a.content === b.content) {
      return true;
    }

    // Similar content (Jaccard similarity)
    const similarity = this.calculateSimilarity(a.content, b.content);
    return similarity >= this.options.similarityThreshold;
  }

  /**
   * Calculate text similarity (Jaccard on words)
   */
  private calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(
      a
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
    const wordsB = new Set(
      b
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );

    if (wordsA.size === 0 || wordsB.size === 0) {
      return 0;
    }

    const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  /**
   * Merge two duplicate memories, keeping the better one
   */
  private mergeMemories(a: Memory, b: Memory): Memory {
    // Prefer higher relevance
    if (this.options.preferHigherRelevance) {
      const scoreA = a.relevanceScore || 0;
      const scoreB = b.relevanceScore || 0;
      if (scoreB > scoreA) {
        return b;
      }
    }

    // Prefer more recent
    if (this.options.preferMoreRecent) {
      const timeA = a.timestamp || 0;
      const timeB = b.timestamp || 0;
      if (timeB > timeA) {
        return b;
      }
    }

    return a;
  }

  /**
   * Deduplicate between two sources (e.g., Stage 1-3 and Step 3b)
   */
  mergeAndDeduplicate(sourceA: Memory[], sourceB: Memory[]): Memory[] {
    const combined = [...sourceA, ...sourceB];
    return this.deduplicate(combined);
  }

  /**
   * Get statistics about deduplication
   */
  getStats(
    original: Memory[],
    deduplicated: Memory[],
  ): {
    originalCount: number;
    deduplicatedCount: number;
    duplicatesRemoved: number;
    reductionPercent: number;
  } {
    const originalCount = original.length;
    const deduplicatedCount = deduplicated.length;
    const duplicatesRemoved = originalCount - deduplicatedCount;
    const reductionPercent =
      originalCount > 0 ? Math.round((duplicatesRemoved / originalCount) * 100) : 0;

    return {
      originalCount,
      deduplicatedCount,
      duplicatesRemoved,
      reductionPercent,
    };
  }
}

// Factory function
export function createContextDeduplicator(
  options?: Partial<DeduplicationOptions>,
): ContextDeduplicator {
  return new ContextDeduplicator(options);
}
