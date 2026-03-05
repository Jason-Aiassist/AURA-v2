/**
 * Entity Extraction Diagnostic Tests
 *
 * Tests for empty/undefined entity handling from QueryAnalyzer
 * through to Stage 1 Knowledge Graph search.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeGraphIntegration } from "../../graph/KnowledgeGraphIntegration.js";
import { Stage1KnowledgeGraphSearch } from "../stage1-knowledge-graph.js";

// Mock the KnowledgeGraphIntegration
const createMockKG = (): KnowledgeGraphIntegration =>
  ({
    searchRelated: vi.fn().mockResolvedValue([]),
    createEpisode: vi.fn(),
    linkEpisodeToMemory: vi.fn(),
    getRelatedMemories: vi.fn().mockResolvedValue([]),
    searchMemoriesByEntity: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
  }) as unknown as KnowledgeGraphIntegration;

describe("Stage1KnowledgeGraphSearch - Entity Handling", () => {
  let stage1: Stage1KnowledgeGraphSearch;
  let mockKG: KnowledgeGraphIntegration;

  beforeEach(() => {
    mockKG = createMockKG();
    stage1 = new Stage1KnowledgeGraphSearch({
      knowledgeGraph: mockKG,
      maxResults: 50,
      minRelevance: 0.3,
    });
  });

  describe("Entity Input Scenarios", () => {
    it("should use provided entities when array has items", async () => {
      const query = "Tell me about Project AURA";
      const entities = ["aura", "neo4j", "steve"];

      await stage1.execute(query, entities);

      expect(mockKG.searchRelated).toHaveBeenCalledWith({
        entityNames: ["aura", "neo4j", "steve"],
        limit: 50,
      });
    });

    it("should fallback to regex extraction when entities is empty array []", async () => {
      const query = "Tell me about Project AURA and Neo4j";
      const entities: string[] = []; // Empty array, not undefined!

      await stage1.execute(query, entities);

      // Should extract capitalized words via regex
      expect(mockKG.searchRelated).toHaveBeenCalledWith({
        entityNames: expect.arrayContaining(["project", "aura", "neo4j"]),
        limit: 50,
      });
    });

    it("should fallback to regex extraction when entities is undefined", async () => {
      const query = "Tell me about Project AURA";
      const entities = undefined;

      await stage1.execute(query, entities);

      expect(mockKG.searchRelated).toHaveBeenCalledWith({
        entityNames: expect.arrayContaining(["project", "aura"]),
        limit: 50,
      });
    });

    it("should fallback to regex extraction when entities is null", async () => {
      const query = "Tell me about Project AURA";
      const entities = null as unknown as string[];

      await stage1.execute(query, entities);

      expect(mockKG.searchRelated).toHaveBeenCalledWith({
        entityNames: expect.arrayContaining(["project", "aura"]),
        limit: 50,
      });
    });

    it("should handle undefined items in entity array", async () => {
      const query = "Tell me about things";
      const entities = ["aura", undefined, "neo4j"] as unknown as string[];

      await stage1.execute(query, entities);

      // Current behavior: passes through as-is (may cause downstream issues)
      expect(mockKG.searchRelated).toHaveBeenCalled();
      const call = (mockKG.searchRelated as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.entityNames).toContain("aura");
      expect(call.entityNames).toContain("neo4j");
    });

    it("should handle whitespace-only entities", async () => {
      const query = "Tell me about things";
      const entities = ["aura", "   ", "neo4j"];

      await stage1.execute(query, entities);

      // Should filter out whitespace-only strings
      const call = (mockKG.searchRelated as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.entityNames).toContain("aura");
      expect(call.entityNames).not.toContain("   ");
      expect(call.entityNames).toContain("neo4j");
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long entity list", async () => {
      const query = "Query with many entities";
      const entities = Array(1000).fill("entity");

      await stage1.execute(query, entities);

      // Should limit to maxResults
      const call = (mockKG.searchRelated as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.limit).toBe(50);
    });

    it("should deduplicate entities", async () => {
      const query = "Tell me about AURA";
      const entities = ["aura", "aura", "aura", "neo4j", "aura"];

      await stage1.execute(query, entities);

      const call = (mockKG.searchRelated as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // Should have unique values only
      const uniqueEntities = [...new Set(call.entityNames)];
      expect(call.entityNames.length).toBe(uniqueEntities.length);
      expect(call.entityNames).toContain("aura");
      expect(call.entityNames).toContain("neo4j");
    });

    it("should handle query with no extractable entities", async () => {
      const query = "What is this?"; // No capitalized words
      const entities: string[] = [];

      const result = await stage1.execute(query, entities);

      expect(result.success).toBe(true);
      expect(result.results).toEqual([]);
      expect(mockKG.searchRelated).not.toHaveBeenCalled();
    });

    it("should detect first-person pronouns and add user entity", async () => {
      const query = "What do I need to remember about my project?";
      const entities: string[] = [];

      await stage1.execute(query, entities);

      const call = (mockKG.searchRelated as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.entityNames).toContain("steve");
      expect(call.entityNames).toContain("user");
    });
  });

  describe("Debug Output Verification", () => {
    it("should log diagnostic information", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const query = "Tell me about AURA";
      const entities: string[] = []; // Empty to trigger fallback

      await stage1.execute(query, entities);

      // Check for diagnostic logs
      const diagnosticCalls = consoleSpy.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("[Stage1-DIAGNOSTIC]"),
      );

      expect(diagnosticCalls.length).toBeGreaterThan(0);

      // Verify fallback detection is logged
      const fallbackLog = diagnosticCalls.find((call) => call[0].includes("Entity source:"));
      expect(fallbackLog).toBeDefined();
      expect(fallbackLog?.[0]).toContain("Fallback regex");

      consoleSpy.mockRestore();
    });
  });
});

describe("Integration: QueryAnalyzer → Stage1", () => {
  it("should trace entity flow from analysis to search", async () => {
    // This would be an integration test across ContextInjector → ThreeStageBuilder → Stage1
    // For now, we document the expected flow:
    // 1. QueryAnalyzer returns QueryAnalysis with entities array
    // 2. ContextInjector passes analysis.entities to buildContext
    // 3. ThreeStageBuilder passes entities to executePipeline
    // 4. Stage1 receives entities and uses them OR falls back
    // Key assertions to verify in full integration test:
    // - Empty array [] triggers fallback
    // - Undefined triggers fallback
    // - Populated array uses those entities directly
    // - Diagnostic logs show the decision path
  });
});
