/**
 * Embedding Service for AURA Memory System
 *
 * Generates vector embeddings via Ollama embedding endpoint.
 * Used for both storing memories (indexing) and searching (query embedding).
 */

export interface EmbeddingServiceConfig {
  /** Ollama base URL (e.g., http://ollama-embed-gpu0:11434) */
  baseUrl: string;
  /** Embedding model name (e.g., "nomic-embed-text") */
  model: string;
  /** Embedding dimensions (768 for nomic-embed-text) */
  dimensions: number;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Max texts per batch */
  batchSize: number;
}

export interface EmbeddingResult {
  /** The embedding vector (normalized to unit length) */
  embedding: number[];
  /** Token count if available from Ollama */
  tokensUsed?: number;
  /** Generation time in milliseconds */
  durationMs: number;
}

export interface EmbeddingError {
  /** Error message */
  error: string;
  /** Whether this is a retryable error */
  retryable: boolean;
}

/**
 * Embedding Service - Generates embeddings via Ollama
 *
 * Features:
 * - Single and batch embedding generation
 * - L2 normalization of embeddings
 * - Health checking with caching
 * - Graceful fallback on errors
 * - Timeout handling
 */
export class EmbeddingService {
  private config: EmbeddingServiceConfig;
  private healthy: boolean | null = null;
  private lastHealthCheck: number = 0;
  private healthCheckIntervalMs: number = 30000; // 30 seconds

  constructor(config: EmbeddingServiceConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ""), // Remove trailing slash
      model: config.model,
      dimensions: config.dimensions,
      timeoutMs: config.timeoutMs,
      batchSize: config.batchSize,
    };
  }

  /**
   * Check if Ollama embedding service is healthy
   * Caches result for 30 seconds to avoid excessive checks
   */
  async healthCheck(): Promise<boolean> {
    const now = Date.now();
    if (this.healthy !== null && now - this.lastHealthCheck < this.healthCheckIntervalMs) {
      return this.healthy;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      this.healthy = response.ok;
      this.lastHealthCheck = now;

      if (!response.ok) {
        console.warn(`[EmbeddingService] Health check failed: ${response.status}`);
      }

      return this.healthy;
    } catch (error) {
      console.warn("[EmbeddingService] Health check error:", error);
      this.healthy = false;
      this.lastHealthCheck = now;
      return false;
    }
  }

  /**
   * Generate embedding for a single text
   *
   * @param text - Text to embed
   * @returns Embedding result or null if service unavailable
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult | null> {
    const startTime = Date.now();

    if (!text || text.trim().length === 0) {
      console.warn("[EmbeddingService] Empty text provided, skipping embedding");
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(`${this.config.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          prompt: text.trim(),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[EmbeddingService] Ollama error ${response.status}: ${errorText}`);
        return null;
      }

      const result = (await response.json()) as {
        embedding?: number[];
      };

      if (!result.embedding || result.embedding.length === 0) {
        console.error("[EmbeddingService] Empty embedding received from Ollama");
        return null;
      }

      // Normalize to unit vector (L2 norm = 1)
      const normalizedEmbedding = this.normalizeVector(result.embedding);

      // Verify dimensions
      if (normalizedEmbedding.length !== this.config.dimensions) {
        console.warn(
          `[EmbeddingService] Dimension mismatch: expected ${this.config.dimensions}, got ${normalizedEmbedding.length}`,
        );
      }

      return {
        embedding: normalizedEmbedding,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.error(`[EmbeddingService] Request timed out after ${this.config.timeoutMs}ms`);
      } else {
        console.error("[EmbeddingService] Failed to generate embedding:", error);
      }
      this.healthy = false; // Mark as unhealthy on error
      return null;
    }
  }

  /**
   * Generate embeddings for multiple texts in batches
   *
   * Ollama doesn't support true batching, so we process sequentially
   * but limit concurrency to avoid overwhelming the service.
   *
   * @param texts - Array of texts to embed
   * @returns Array of embedding results (null for failed items)
   */
  async generateEmbeddings(texts: string[]): Promise<(EmbeddingResult | null)[]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const results: (EmbeddingResult | null)[] = [];
    const batchSize = this.config.batchSize;

    // Process in batches to avoid overwhelming Ollama
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      // Process batch sequentially (Ollama doesn't support parallel embeddings well)
      for (const text of batch) {
        const result = await this.generateEmbedding(text);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Get service configuration (useful for debugging)
   */
  getConfig(): EmbeddingServiceConfig {
    return { ...this.config };
  }

  /**
   * Get service status
   */
  async getStatus(): Promise<{
    healthy: boolean;
    baseUrl: string;
    model: string;
    dimensions: number;
  }> {
    const healthy = await this.healthCheck();
    return {
      healthy,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      dimensions: this.config.dimensions,
    };
  }

  /**
   * Normalize vector to unit length (L2 norm = 1)
   * This is required for cosine similarity to work correctly
   */
  private normalizeVector(vector: number[]): number[] {
    const sumOfSquares = vector.reduce((sum, val) => sum + val * val, 0);
    const magnitude = Math.sqrt(sumOfSquares);

    if (magnitude === 0) {
      console.warn("[EmbeddingService] Zero magnitude vector, returning original");
      return vector;
    }

    return vector.map((val) => val / magnitude);
  }
}

/**
 * Factory function to create embedding service with default config
 */
export function createEmbeddingService(
  overrides?: Partial<EmbeddingServiceConfig>,
): EmbeddingService {
  const config: EmbeddingServiceConfig = {
    baseUrl: process.env.OLLAMA_EMBED_URL || "http://ollama-embed-gpu0:11434",
    model: process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text",
    dimensions: parseInt(process.env.OLLAMA_EMBED_DIMENSIONS || "768", 10),
    timeoutMs: parseInt(process.env.OLLAMA_EMBED_TIMEOUT_MS || "10000", 10),
    batchSize: parseInt(process.env.OLLAMA_EMBED_BATCH_SIZE || "100", 10),
    ...overrides,
  };

  return new EmbeddingService(config);
}

/**
 * Singleton instance for global access
 */
let globalEmbeddingService: EmbeddingService | null = null;

/**
 * Initialize global embedding service
 */
export function initializeEmbeddingService(
  config?: Partial<EmbeddingServiceConfig>,
): EmbeddingService {
  globalEmbeddingService = createEmbeddingService(config);
  return globalEmbeddingService;
}

/**
 * Get global embedding service (throws if not initialized)
 */
export function getEmbeddingService(): EmbeddingService {
  if (!globalEmbeddingService) {
    throw new Error("EmbeddingService not initialized. Call initializeEmbeddingService first.");
  }
  return globalEmbeddingService;
}

/**
 * Check if embedding service is initialized
 */
export function isEmbeddingServiceInitialized(): boolean {
  return globalEmbeddingService !== null;
}

/**
 * Get global embedding service or null (safe access)
 */
export function getEmbeddingServiceSafe(): EmbeddingService | null {
  return globalEmbeddingService;
}
