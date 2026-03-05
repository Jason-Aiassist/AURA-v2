/**
 * Stage2HybridSearch Unit Tests
 *
 * Tests Stage 2 hybrid search with and without query embeddings.
 */

import type { DatabaseSync } from "better-sqlite3";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Stage2HybridSearch } from "../../../context/stages/stage2-hybrid-search.js";
import type { QueryEmbeddingService } from "../../context/services/QueryEmbeddingService.js";

// Mock QueryEmbeddingService
const createMockQueryEmbeddingService = (embedding?: number[] | null): QueryEmbeddingService => {
  return {
    embedQuery: vi.fn().mockResolvedValue(
      embedding
        ? {
            embedding,
            durationMs: 100,
            fromCache: false,
          }
        : null,
    ),
    getCacheStats: vi.fn().mockReturnValue({ size: 0, maxSize: 100, hitRate: 0 }),
    clearCache: vi.fn(),
  } as unknown as QueryEmbeddingService;
};

// Mock Database
const createMockDatabase = (): DatabaseSync => {
  const mockStmt = {
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    run: vi.fn(),
  };

  return {
    prepare: vi.fn().mockReturnValue(mockStmt),
    exec: vi.fn(),
    close: vi.fn(),
  } as unknown as DatabaseSync;
};

describe("Stage2HybridSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("should execute search with query embedding when service available", async () => {
      const mockEmbedding = Array(768).fill(0.1);
      const mockEmbeddingService = createMockQueryEmbeddingService(mockEmbedding);
      const mockDb = createMockDatabase();

      const stage = new Stage2HybridSearch({
        db: mockDb,
        providerModel: "test-model",
        maxResults: 10,
        minRelevance: 0.1,
        queryEmbeddingService: mockEmbeddingService,
      });

      const result = await stage.execute("test query");

      expect(mockEmbeddingService.embedQuery).toHaveBeenCalledWith("test query");
      expect(result.success).toBe(true);
      expect(result.embeddingGenerated).toBe(true);
    });

    it("should execute search without embedding when service not available", async () => {
      const mockDb = createMockDatabase();

      const stage = new Stage2HybridSearch({
        db: mockDb,
        providerModel: "test-model",
        maxResults: 10,
        minRelevance: 0.1,
        // No queryEmbeddingService
      });

      const result = await stage.execute("test query");

      expect(result.success).toBe(true);
      expect(result.embeddingGenerated).toBe(false);
    });

    it("should execute search without embedding when embedding generation fails", async () => {
      const mockEmbeddingService = createMockQueryEmbeddingService(null); // Returns null
      const mockDb = createMockDatabase();

      const stage = new Stage2HybridSearch({
        db: mockDb,
        providerModel: "test-model",
        maxResults: 10,
        minRelevance: 0.1,
        queryEmbeddingService: mockEmbeddingService,
      });

      const result = await stage.execute("test query");

      expect(result.success).toBe(true);
      expect(result.embeddingGenerated).toBe(false);
    });

    it("should handle errors gracefully", async () => {
      const mockEmbeddingService = {
        embedQuery: vi.fn().mockRejectedValue(new Error("Embedding failed")),
      } as unknown as QueryEmbeddingService;
      const mockDb = createMockDatabase();

      const stage = new Stage2HybridSearch({
        db: mockDb,
        providerModel: "test-model",
        maxResults: 10,
        minRelevance: 0.1,
        queryEmbeddingService: mockEmbeddingService,
      });

      const result = await stage.execute("test query");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.embeddingGenerated).toBe(false);
    });

    it("should return empty results array on error", async () => {
      const mockEmbeddingService = {
        embedQuery: vi.fn().mockRejectedValue(new Error("Embedding failed")),
      } as unknown as QueryEmbeddingService;
      const mockDb = createMockDatabase();

      const stage = new Stage2HybridSearch({
        db: mockDb,
        providerModel: "test-model",
        maxResults: 10,
        minRelevance: 0.1,
        queryEmbeddingService: mockEmbeddingService,
      });

      const result = await stage.execute("test query");

      expect(result.results).toEqual([]);
    });
  });

  describe("isAvailable", () => {
    it("should always return true", () => {
      const mockDb = createMockDatabase();
      const stage = new Stage2HybridSearch({
        db: mockDb,
        providerModel: "test-model",
        maxResults: 10,
        minRelevance: 0.1,
      });

      expect(stage.isAvailable()).toBe(true);
    });
  });

  describe("getEmbeddingStatus", () => {
    it("should report embedding service available when configured", () => {
      const mockEmbeddingService = createMockQueryEmbeddingService(Array(768).fill(0.1));
      const mockDb = createMockDatabase();
      const stage = new Stage2HybridSearch({
        db: mockDb,
        providerModel: "test-model",
        maxResults: 10,
        minRelevance: 0.1,
        queryEmbeddingService: mockEmbeddingService,
      });

      const status = stage.getEmbeddingStatus();

      expect(status.available).toBe(true);
      expect(status.cached).toBe(0);
    });

    it("should report embedding service unavailable when not configured", () => {
      const mockDb = createMockDatabase();
      const stage = new Stage2HybridSearch({
        db: mockDb,
        providerModel: "test-model",
        maxResults: 10,
        minRelevance: 0.1,
      });

      const status = stage.getEmbeddingStatus();

      expect(status.available).toBe(false);
      expect(status.cached).toBe(0);
    });

    it("should report cache size from embedding service", () => {
      const mockEmbeddingService = {
        embedQuery: vi.fn(),
        getCacheStats: vi.fn().mockReturnValue({ size: 5, maxSize: 100, hitRate: 0.5 }),
        clearCache: vi.fn(),
      } as unknown as QueryEmbeddingService;

      const mockDb = createMockDatabase();
      const stage = new Stage2HybridSearch({
        db: mockDb,
        providerModel: "test-model",
        maxResults: 10,
        minRelevance: 0.1,
        queryEmbeddingService: mockEmbeddingService,
      });

      const status = stage.getEmbeddingStatus();

      expect(status.cached).toBe(5);
    });
  });

  describe("configuration", () => {
    it("should use default vector and text weights", async () => {
      const mockDb = createMockDatabase();
      const stage = new Stage2HybridSearch({
        db: mockDb,
        providerModel: "test-model",
        maxResults: 10,
        minRelevance: 0.1,
      });

      // Just verify it creates without error
      expect(stage).toBeDefined();
      expect(stage.isAvailable()).toBe(true);
    });

    it("should accept custom vector and text weights", async () => {
      const mockDb = createMockDatabase();
      const stage = new Stage2HybridSearch({
        db: mockDb,
        providerModel: "test-model",
        maxResults: 10,
        minRelevance: 0.1,
        vectorWeight: 0.8,
        textWeight: 0.2,
      });

      expect(stage).toBeDefined();
    });
  });

  describe("getStats", () => {
    it("should return search engine stats", () => {
      const mockDb = createMockDatabase();
      const stage = new Stage2HybridSearch({
        db: mockDb,
        providerModel: "test-model",
        maxResults: 10,
        minRelevance: 0.1,
      });

      const stats = stage.getStats();

      expect(stats).toBeDefined();
      expect(stats.vectorAvailable).toBeDefined();
      expect(stats.ftsAvailable).toBeDefined();
    });
  });
});
