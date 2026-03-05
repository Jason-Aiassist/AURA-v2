/**
 * QueryEmbeddingService Unit Tests
 *
 * Tests query embedding generation, caching, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryEmbeddingService } from "../../context/services/QueryEmbeddingService.js";
import type { EmbeddingService } from "../../embeddings/EmbeddingService.js";

// Mock EmbeddingService
const createMockEmbeddingService = (embedding?: number[] | null): EmbeddingService => {
  return {
    generateEmbedding: vi.fn().mockResolvedValue(embedding ? { embedding, durationMs: 100 } : null),
    generateEmbeddings: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
    getConfig: vi.fn().mockReturnValue({
      baseUrl: "http://test",
      model: "test-model",
      dimensions: 768,
      timeoutMs: 10000,
      batchSize: 100,
    }),
    getStatus: vi.fn().mockResolvedValue({
      healthy: true,
      baseUrl: "http://test",
      model: "test-model",
      dimensions: 768,
    }),
  } as unknown as EmbeddingService;
};

describe("QueryEmbeddingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("embedQuery", () => {
    it("should generate embedding for valid query", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      const mockService = createMockEmbeddingService(mockEmbedding);
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: false,
      });

      const result = await service.embedQuery("test query");

      expect(result).not.toBeNull();
      expect(result?.embedding).toEqual(mockEmbedding);
      expect(result?.fromCache).toBe(false);
      expect(result?.durationMs).toBeGreaterThanOrEqual(0);
      expect(mockService.generateEmbedding).toHaveBeenCalledWith("test query");
    });

    it("should normalize query before embedding (lowercase + trim)", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      const mockService = createMockEmbeddingService(mockEmbedding);
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: false,
      });

      await service.embedQuery("  TEST Query  ");

      expect(mockService.generateEmbedding).toHaveBeenCalledWith("test query");
    });

    it("should return null for empty query", async () => {
      const mockService = createMockEmbeddingService([]);
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: false,
      });

      const result = await service.embedQuery("");

      expect(result).toBeNull();
      expect(mockService.generateEmbedding).not.toHaveBeenCalled();
    });

    it("should return null when embedding service fails", async () => {
      const mockService = createMockEmbeddingService(null);
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: false,
      });

      const result = await service.embedQuery("test query");

      expect(result).toBeNull();
    });

    it("should return null when embedding service throws", async () => {
      const mockService = {
        generateEmbedding: vi.fn().mockRejectedValue(new Error("Network error")),
      } as unknown as EmbeddingService;
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: false,
      });

      const result = await service.embedQuery("test query");

      expect(result).toBeNull();
    });
  });

  describe("caching", () => {
    it("should cache embeddings when enabled", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      const mockService = createMockEmbeddingService(mockEmbedding);
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: true,
        maxCacheSize: 10,
      });

      // First call - should hit service
      const result1 = await service.embedQuery("test query");
      expect(result1?.fromCache).toBe(false);
      expect(mockService.generateEmbedding).toHaveBeenCalledTimes(1);

      // Second call - should hit cache
      const result2 = await service.embedQuery("test query");
      expect(result2?.fromCache).toBe(true);
      expect(mockService.generateEmbedding).toHaveBeenCalledTimes(1); // No additional call

      // Results should be identical
      expect(result1?.embedding).toEqual(result2?.embedding);
    });

    it("should not cache when disabled", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      const mockService = createMockEmbeddingService(mockEmbedding);
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: false,
      });

      await service.embedQuery("test query");
      await service.embedQuery("test query");

      expect(mockService.generateEmbedding).toHaveBeenCalledTimes(2);
    });

    it("should evict oldest entries when cache is full (LRU)", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      const mockService = createMockEmbeddingService(mockEmbedding);
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: true,
        maxCacheSize: 2,
      });

      // Fill cache
      await service.embedQuery("query1");
      await service.embedQuery("query2");
      expect(mockService.generateEmbedding).toHaveBeenCalledTimes(2);

      // Add third query - should evict query1
      await service.embedQuery("query3");
      expect(mockService.generateEmbedding).toHaveBeenCalledTimes(3);

      // query1 should be evicted (called again)
      await service.embedQuery("query1");
      expect(mockService.generateEmbedding).toHaveBeenCalledTimes(4);

      // query2 should still be cached
      await service.embedQuery("query2");
      expect(mockService.generateEmbedding).toHaveBeenCalledTimes(4); // No new call
    });

    it("should update LRU order on cache hit", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      const mockService = createMockEmbeddingService(mockEmbedding);
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: true,
        maxCacheSize: 2,
      });

      await service.embedQuery("query1");
      await service.embedQuery("query2");

      // Access query1 (makes it recently used)
      await service.embedQuery("query1");

      // Add query3 - should evict query2 (not query1)
      await service.embedQuery("query3");

      // query1 should still be cached
      await service.embedQuery("query1");
      expect(mockService.generateEmbedding).toHaveBeenCalledTimes(3); // No new call for query1
    });
  });

  describe("cache management", () => {
    it("should clear cache", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      const mockService = createMockEmbeddingService(mockEmbedding);
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: true,
      });

      await service.embedQuery("query1");
      service.clearCache();

      // Should generate again after clear
      await service.embedQuery("query1");
      expect(mockService.generateEmbedding).toHaveBeenCalledTimes(2);
    });

    it("should return cache stats", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      const mockService = createMockEmbeddingService(mockEmbedding);
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: true,
        maxCacheSize: 100,
      });

      const stats = service.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(100);

      await service.embedQuery("query1");
      const stats2 = service.getCacheStats();
      expect(stats2.size).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("should handle whitespace-only queries", async () => {
      const mockService = createMockEmbeddingService([]);
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: false,
      });

      const result = await service.embedQuery("   ");
      expect(result).toBeNull();
    });

    it("should handle very long queries", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      const mockService = createMockEmbeddingService(mockEmbedding);
      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: false,
      });

      const longQuery = "a".repeat(10000);
      const result = await service.embedQuery(longQuery);

      expect(result).not.toBeNull();
      expect(mockService.generateEmbedding).toHaveBeenCalledWith(longQuery.toLowerCase());
    });

    it("should handle embedding with token count", async () => {
      const mockService = {
        generateEmbedding: vi.fn().mockResolvedValue({
          embedding: Array(768).fill(0.1),
          tokensUsed: 42,
          durationMs: 150,
        }),
      } as unknown as EmbeddingService;

      const service = new QueryEmbeddingService({
        embeddingService: mockService,
        enableCache: false,
      });

      const result = await service.embedQuery("test");

      expect(result?.tokenCount).toBe(42);
    });
  });
});
