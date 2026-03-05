/**
 * Search Index Builder for AURA Memory
 *
 * Coordinates embedding generation and search index updates when memories are stored.
 * Connects the EmbeddingService (Sprint 1) with the search schemas (Sprint 2).
 */

import type { CategorizedMemory } from "../categories/types.js";
import type { MemoryContent } from "../tiered/types.js";
import type { Logger } from "../types.js";
import type { EmbeddingService } from "./EmbeddingService.js";
import type { FtsSearchSchema } from "./FtsSearchSchema.js";
import type { VectorSearchSchema } from "./VectorSearchSchema.js";

export interface SearchIndexBuilderConfig {
  /** Embedding service for generating vectors */
  embeddingService: EmbeddingService;
  /** Vector search schema for semantic search */
  vectorSchema: VectorSearchSchema;
  /** FTS search schema for keyword search */
  ftsSchema: FtsSearchSchema;
  /** Logger for operations */
  log?: Logger;
  /** Enable encryption-aware indexing (skip encrypted content in FTS) */
  enableEncryption: boolean;
  /** Index encrypted memories in FTS (false = more secure, true = searchable) */
  indexEncryptedInFts?: boolean;
}

export interface IndexResult {
  /** Whether vector indexing succeeded */
  vectorIndexed: boolean;
  /** Whether FTS indexing succeeded */
  ftsIndexed: boolean;
  /** The generated embedding (if successful) */
  embedding?: number[];
  /** Error message if indexing failed */
  error?: string;
}

export interface BatchIndexResult {
  /** Number of memories processed */
  processed: number;
  /** Number of vector indexes created */
  vectorsIndexed: number;
  /** Number of FTS documents created */
  ftsIndexed: number;
  /** Number of failures */
  failures: number;
  /** Total duration in ms */
  durationMs: number;
}

/**
 * Search Index Builder
 *
 * Responsibilities:
 * 1. Generate embeddings for memory content
 * 2. Store embeddings in memory_vectors (semantic search)
 * 3. Index content in memory_fts (keyword search)
 * 4. Handle encrypted memories appropriately
 * 5. Support batch operations for efficiency
 *
 * Security Note:
 * - Vector embeddings are generated from content (ok for encrypted memories)
 * - FTS content should NOT be indexed if encrypted (searchable = decryptable)
 */
export class SearchIndexBuilder {
  private embeddingService: EmbeddingService;
  private vectorSchema: VectorSearchSchema;
  private ftsSchema: FtsSearchSchema;
  private log: Logger;
  private enableEncryption: boolean;
  private indexEncryptedInFts: boolean;

  constructor(config: SearchIndexBuilderConfig) {
    this.embeddingService = config.embeddingService;
    this.vectorSchema = config.vectorSchema;
    this.ftsSchema = config.ftsSchema;
    this.enableEncryption = config.enableEncryption;
    this.indexEncryptedInFts = config.indexEncryptedInFts ?? false;

    // Default logger if not provided (no-op)
    this.log = config.log ?? {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
    };
  }

  /**
   * Index a single memory
   *
   * @param memory - The categorized memory to index
   * @returns IndexResult with status of vector and FTS indexing
   */
  async indexMemory(memory: CategorizedMemory): Promise<IndexResult> {
    const memoryId = memory.memoryId;
    const isEncrypted = memory.encrypted;

    this.log.debug("Indexing memory", {
      memoryId,
      category: memory.category,
      encrypted: isEncrypted,
      contentLength: memory.content?.length ?? 0,
    });

    try {
      // Step 1: Generate embedding for vector search
      // Embeddings can be generated from encrypted content (they're just semantic vectors)
      const embeddingResult = await this.embeddingService.generateEmbedding(memory.content);

      let vectorIndexed = false;
      if (embeddingResult?.embedding) {
        try {
          this.vectorSchema.insertVector(memoryId, embeddingResult.embedding);
          vectorIndexed = true;
          this.log.debug("Vector indexed successfully", { memoryId });
        } catch (vecError) {
          this.log.warn("Failed to insert vector", {
            memoryId,
            error: vecError instanceof Error ? vecError.message : String(vecError),
          });
        }
      } else {
        this.log.debug("No embedding generated (service may be unavailable)", { memoryId });
      }

      // Step 2: Index content in FTS (only if NOT encrypted, or if explicitly enabled)
      let ftsIndexed = false;
      if (this.ftsSchema.isAvailable()) {
        if (!isEncrypted || this.indexEncryptedInFts) {
          try {
            // For encrypted memories, we'd need to decrypt first (if indexEncryptedInFts)
            // This is a security trade-off - searchable vs. secure
            const contentToIndex =
              isEncrypted && this.indexEncryptedInFts
                ? await this.decryptIfNeeded(memory.content)
                : memory.content;

            if (contentToIndex) {
              this.ftsSchema.insertDocument(memoryId, contentToIndex);
              ftsIndexed = true;
              this.log.debug("FTS indexed successfully", { memoryId, encrypted: isEncrypted });
            }
          } catch (ftsError) {
            this.log.warn("Failed to insert FTS document", {
              memoryId,
              error: ftsError instanceof Error ? ftsError.message : String(ftsError),
            });
          }
        } else {
          this.log.debug("Skipping FTS indexing for encrypted memory", { memoryId });
        }
      }

      return {
        vectorIndexed,
        ftsIndexed,
        embedding: embeddingResult?.embedding,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error("Failed to index memory", error as Error, { memoryId });
      return {
        vectorIndexed: false,
        ftsIndexed: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Index multiple memories in a batch
   *
   * More efficient than indexing individually because:
   * 1. Single health check
   * 2. Batch embedding generation
   * 3. Fewer database transactions
   *
   * @param memories - Array of memories to index
   * @returns BatchIndexResult with statistics
   */
  async indexMemoriesBatch(memories: CategorizedMemory[]): Promise<BatchIndexResult> {
    const startTime = Date.now();
    const result: BatchIndexResult = {
      processed: 0,
      vectorsIndexed: 0,
      ftsIndexed: 0,
      failures: 0,
      durationMs: 0,
    };

    if (memories.length === 0) {
      return result;
    }

    this.log.info(`Starting batch index of ${memories.length} memories`);

    // Check if embedding service is healthy
    const embeddingHealthy = await this.embeddingService.healthCheck();
    if (!embeddingHealthy) {
      this.log.warn("Embedding service not available, skipping vector indexing");
    }

    // Generate embeddings in batch (if service available)
    const contents = memories.map((m) => m.content);
    let embeddings: (import("./EmbeddingService.js").EmbeddingResult | null)[] = [];

    if (embeddingHealthy) {
      try {
        embeddings = await this.embeddingService.generateEmbeddings(contents);
      } catch (error) {
        this.log.error("Batch embedding generation failed", error as Error);
        // Continue - we'll just skip vector indexing
      }
    }

    // Index each memory
    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i];
      const embedding = embeddings[i]?.embedding;

      try {
        // Vector indexing
        if (embedding && this.vectorSchema.isAvailable()) {
          try {
            this.vectorSchema.insertVector(memory.memoryId, embedding);
            result.vectorsIndexed++;
          } catch (vecError) {
            this.log.warn("Failed to insert vector", {
              memoryId: memory.memoryId,
              error: vecError instanceof Error ? vecError.message : String(vecError),
            });
          }
        }

        // FTS indexing
        if (this.ftsSchema.isAvailable() && (!memory.encrypted || this.indexEncryptedInFts)) {
          try {
            const contentToIndex =
              memory.encrypted && this.indexEncryptedInFts
                ? await this.decryptIfNeeded(memory.content)
                : memory.content;

            if (contentToIndex) {
              this.ftsSchema.insertDocument(memory.memoryId, contentToIndex);
              result.ftsIndexed++;
            }
          } catch (ftsError) {
            this.log.warn("Failed to insert FTS document", {
              memoryId: memory.memoryId,
              error: ftsError instanceof Error ? ftsError.message : String(ftsError),
            });
          }
        }

        result.processed++;
      } catch (error) {
        this.log.error("Failed to index memory", error as Error, { memoryId: memory.memoryId });
        result.failures++;
      }
    }

    result.durationMs = Date.now() - startTime;
    this.log.info(`Batch index complete`, {
      processed: result.processed,
      vectorsIndexed: result.vectorsIndexed,
      ftsIndexed: result.ftsIndexed,
      failures: result.failures,
      durationMs: result.durationMs,
    });

    return result;
  }

  /**
   * Remove a memory from the search indexes
   *
   * @param memoryId - The memory ID to remove
   */
  async deleteFromIndex(memoryId: string): Promise<void> {
    this.log.debug("Deleting memory from search indexes", { memoryId });

    // Remove from vector index
    try {
      this.vectorSchema.deleteVector(memoryId);
    } catch (error) {
      this.log.warn("Failed to delete vector", {
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Remove from FTS index
    try {
      this.ftsSchema.deleteDocument(memoryId);
    } catch (error) {
      this.log.warn("Failed to delete FTS document", {
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Reindex all memories from a HotTier
   * Useful for migration or recovery
   *
   * @param memories - All memories to reindex
   * @returns Async generator yielding progress updates
   */
  async *reindexAll(memories: CategorizedMemory[]): AsyncGenerator<{
    processed: number;
    total: number;
    currentMemoryId: string;
    vectorsIndexed: number;
    ftsIndexed: number;
  }> {
    const total = memories.length;
    let processed = 0;
    let vectorsIndexed = 0;
    let ftsIndexed = 0;

    this.log.info(`Starting reindex of ${total} memories`);

    // Clear existing indexes
    this.log.info("Clearing existing search indexes");
    this.vectorSchema.clearAll();
    this.ftsSchema.clearAll();

    // Process in batches
    const batchSize = 50;
    for (let i = 0; i < memories.length; i += batchSize) {
      const batch = memories.slice(i, i + batchSize);

      for (const memory of batch) {
        const result = await this.indexMemory(memory);

        if (result.vectorIndexed) vectorsIndexed++;
        if (result.ftsIndexed) ftsIndexed++;
        processed++;

        yield {
          processed,
          total,
          currentMemoryId: memory.memoryId,
          vectorsIndexed,
          ftsIndexed,
        };
      }
    }

    this.log.info(`Reindex complete`, { processed, vectorsIndexed, ftsIndexed });
  }

  /**
   * Get statistics about the search indexes
   */
  getStats(): {
    vectorAvailable: boolean;
    ftsAvailable: boolean;
    vectorCount: number;
    ftsCount: number;
    embeddingServiceHealthy: boolean;
  } {
    return {
      vectorAvailable: this.vectorSchema.isAvailable(),
      ftsAvailable: this.ftsSchema.isAvailable(),
      vectorCount: this.vectorSchema.getCount(),
      ftsCount: this.ftsSchema.getCount(),
      embeddingServiceHealthy: false, // Will be checked on next operation
    };
  }

  /**
   * Check if index builder is ready
   */
  async isReady(): Promise<boolean> {
    const embeddingHealthy = await this.embeddingService.healthCheck();
    return embeddingHealthy && (this.vectorSchema.isAvailable() || this.ftsSchema.isAvailable());
  }

  /**
   * Decrypt content if needed (placeholder for encryption integration)
   *
   * In a full implementation, this would use the EncryptionService to decrypt.
   * For now, we assume encrypted content should not be indexed in FTS.
   */
  private async decryptIfNeeded(content: string): Promise<string | null> {
    // If content looks like encrypted JSON (contains ciphertext, iv, salt), skip
    if (content.startsWith('{"ciphertext"')) {
      this.log.warn("Cannot index encrypted content in FTS without decryption key");
      return null;
    }
    return content;
  }
}

/**
 * Factory function to create search index builder
 */
export function createSearchIndexBuilder(
  embeddingService: EmbeddingService,
  vectorSchema: VectorSearchSchema,
  ftsSchema: FtsSearchSchema,
  log?: Logger,
): SearchIndexBuilder {
  return new SearchIndexBuilder({
    embeddingService,
    vectorSchema,
    ftsSchema,
    log,
    enableEncryption: true,
    indexEncryptedInFts: false,
  });
}
