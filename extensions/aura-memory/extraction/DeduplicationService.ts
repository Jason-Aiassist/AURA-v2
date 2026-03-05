/**
 * Deduplication Service
 *
 * Prevents duplicate memories using semantic similarity.
 * Checks new memories against existing ones before storage.
 */

import { createEmbeddingService, EmbeddingService } from "../embeddings/EmbeddingService.js";

export interface Memory {
  uuid?: string;
  content: string;
  contentHash?: string;
  timestamp?: number;
  entities?: string[];
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  duplicateOf?: string; // UUID of existing memory
  similarityScore: number;
  reasoning: string;
  mergeRecommended: boolean;
  mergeStrategy?: "replace" | "merge_content" | "skip" | "update_metadata";
  existingMemory?: Memory;
}

export interface DeduplicationConfig {
  similarityThreshold: number; // 0.0-1.0, above this = duplicate
  exactMatchThreshold: number; // 0.0-1.0, above this = exact duplicate
  contentHashMatch: boolean; // Check content hash first
  semanticCheck: boolean; // Use embeddings for similarity
  maxCandidates: number; // How many candidates to check
}

export class DeduplicationService {
  private config: DeduplicationConfig;
  private embeddingService?: EmbeddingService;
  private contentHashCache: Set<string> = new Set();

  constructor(config?: Partial<DeduplicationConfig>, embeddingService?: EmbeddingService) {
    this.config = {
      similarityThreshold: 0.85,
      exactMatchThreshold: 0.95,
      contentHashMatch: true,
      semanticCheck: true,
      maxCandidates: 10,
      ...config,
    };
    this.embeddingService = embeddingService;
  }

  /**
   * Check if a new memory is a duplicate of existing memories
   */
  async check(newMemory: Memory, existingMemories: Memory[]): Promise<DuplicateCheckResult> {
    // Fast path: content hash check
    if (this.config.contentHashMatch && newMemory.contentHash) {
      if (this.contentHashCache.has(newMemory.contentHash)) {
        const existing = existingMemories.find((m) => m.contentHash === newMemory.contentHash);
        return {
          isDuplicate: true,
          duplicateOf: existing?.uuid,
          similarityScore: 1.0,
          reasoning: "Exact content hash match",
          mergeRecommended: false,
          mergeStrategy: "skip",
          existingMemory: existing,
        };
      }
    }

    // Get top candidates by simple text similarity
    const candidates = this.findCandidates(newMemory, existingMemories);

    if (candidates.length === 0) {
      return {
        isDuplicate: false,
        similarityScore: 0,
        reasoning: "No similar candidates found",
        mergeRecommended: false,
      };
    }

    // Check each candidate for semantic similarity
    for (const candidate of candidates.slice(0, this.config.maxCandidates)) {
      const similarity = await this.calculateSimilarity(newMemory, candidate);

      // Exact duplicate
      if (similarity >= this.config.exactMatchThreshold) {
        return {
          isDuplicate: true,
          duplicateOf: candidate.uuid,
          similarityScore: similarity,
          reasoning: `Exact semantic match (${Math.round(similarity * 100)}% similar)`,
          mergeRecommended: false,
          mergeStrategy: "skip",
          existingMemory: candidate,
        };
      }

      // Near-duplicate - consider merging
      if (similarity >= this.config.similarityThreshold) {
        return {
          isDuplicate: true,
          duplicateOf: candidate.uuid,
          similarityScore: similarity,
          reasoning: `High semantic similarity (${Math.round(similarity * 100)}% similar)`,
          mergeRecommended: true,
          mergeStrategy: this.determineMergeStrategy(newMemory, candidate),
          existingMemory: candidate,
        };
      }
    }

    // Not a duplicate
    return {
      isDuplicate: false,
      similarityScore: candidates[0]?.score || 0,
      reasoning: "No significant similarity found with existing memories",
      mergeRecommended: false,
    };
  }

  /**
   * Check multiple memories in batch
   */
  async checkBatch(
    newMemories: Memory[],
    existingMemories: Memory[],
  ): Promise<Map<string, DuplicateCheckResult>> {
    const results = new Map<string, DuplicateCheckResult>();

    for (const memory of newMemories) {
      const result = await this.check(memory, existingMemories);
      results.set(memory.uuid || memory.content, result);

      // Add to existing if not duplicate
      if (!result.isDuplicate) {
        existingMemories.push(memory);
      }
    }

    return results;
  }

  /**
   * Merge two memories based on strategy
   */
  mergeMemories(
    newMemory: Memory,
    existingMemory: Memory,
    strategy: "replace" | "merge_content" | "update_metadata",
  ): Memory {
    switch (strategy) {
      case "replace":
        return {
          ...newMemory,
          uuid: existingMemory.uuid, // Keep original UUID
        };

      case "merge_content":
        return {
          ...existingMemory,
          content: this.mergeContent(existingMemory.content, newMemory.content),
          entities: this.mergeArrays(existingMemory.entities || [], newMemory.entities || []),
        };

      case "update_metadata":
        return {
          ...existingMemory,
          // Keep content, update metadata
          entities: this.mergeArrays(existingMemory.entities || [], newMemory.entities || []),
        };

      default:
        return existingMemory;
    }
  }

  /**
   * Register a content hash as seen
   */
  registerContentHash(hash: string): void {
    this.contentHashCache.add(hash);
  }

  /**
   * Register multiple content hashes
   */
  registerContentHashes(hashes: string[]): void {
    hashes.forEach((h) => this.contentHashCache.add(h));
  }

  /**
   * Find candidate memories for comparison
   */
  private findCandidates(
    newMemory: Memory,
    existingMemories: Memory[],
  ): Array<Memory & { score: number }> {
    const candidates: Array<Memory & { score: number }> = [];

    for (const existing of existingMemories) {
      // Quick text-based similarity
      const textScore = this.textSimilarity(newMemory.content, existing.content);

      // Entity overlap
      const entityScore = this.entityOverlap(newMemory.entities || [], existing.entities || []);

      // Combined score
      const score = textScore * 0.7 + entityScore * 0.3;

      if (score > 0.5) {
        // Minimum threshold for candidate
        candidates.push({ ...existing, score });
      }
    }

    // Sort by score descending
    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate semantic similarity between two memories
   */
  private async calculateSimilarity(a: Memory, b: Memory): Promise<number> {
    // If embedding service available, use it
    if (this.embeddingService && this.config.semanticCheck) {
      try {
        const embeddingA = await this.embeddingService.generateEmbedding(a.content);
        const embeddingB = await this.embeddingService.generateEmbedding(b.content);

        if (embeddingA && embeddingB) {
          return this.cosineSimilarity(embeddingA.embedding, embeddingB.embedding);
        }
      } catch (error) {
        // Fall back to text similarity
      }
    }

    // Fall back to text similarity
    return this.textSimilarity(a.content, b.content);
  }

  /**
   * Simple text similarity (Jaccard on words)
   */
  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Calculate entity overlap
   */
  private entityOverlap(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;

    const setA = new Set(a.map((e) => e.toLowerCase()));
    const setB = new Set(b.map((e) => e.toLowerCase()));

    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return intersection.size / union.size;
  }

  /**
   * Cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Determine merge strategy based on content comparison
   */
  private determineMergeStrategy(
    newMemory: Memory,
    existingMemory: Memory,
  ): "replace" | "merge_content" | "update_metadata" {
    const textSim = this.textSimilarity(newMemory.content, existingMemory.content);

    if (textSim > 0.9) {
      return "update_metadata"; // Very similar, just update metadata
    } else if (textSim > 0.7) {
      return "merge_content"; // Moderately similar, merge content
    } else {
      return "replace"; // Different enough to replace
    }
  }

  /**
   * Merge two content strings intelligently
   */
  private mergeContent(existing: string, new_: string): string {
    // If one contains the other, use the longer one
    if (existing.includes(new_)) return existing;
    if (new_.includes(existing)) return new_;

    // Otherwise, concatenate with deduplication
    const existingSentences = new Set(existing.split(/[.!?]+/).map((s) => s.trim().toLowerCase()));

    const newSentences = new_
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => !existingSentences.has(s.toLowerCase()));

    return existing + " " + newSentences.join(". ");
  }

  /**
   * Merge two arrays without duplicates
   */
  private mergeArrays<T>(a: T[], b: T[]): T[] {
    return [...new Set([...a, ...b])];
  }
}

// Factory function
export function createDeduplicationService(
  config?: Partial<DeduplicationConfig>,
  embeddingService?: EmbeddingService,
): DeduplicationService {
  return new DeduplicationService(config, embeddingService);
}
