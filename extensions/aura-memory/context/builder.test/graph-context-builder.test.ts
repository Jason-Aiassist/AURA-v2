/**
 * Graph Context Builder Tests
 */

import { describe, it, expect } from "vitest";
import type { Subgraph } from "../../../graph/traversal/types.js";
import {
  GraphContextBuilder,
  createGraphContextBuilder,
} from "../builder/graph-context-builder.js";
import type { RelatedMemory } from "../builder/types.js";

describe("GraphContextBuilder", () => {
  const createSubgraph = (): Subgraph => ({
    entities: [
      { name: "Steve", type: "Person", depth: 0, paths: [] },
      { name: "Daggerheart", type: "Game", depth: 1, paths: [] },
      { name: "TTRPG", type: "Category", depth: 2, paths: [] },
    ],
    relationships: [
      { from: "Steve", to: "Daggerheart", type: "ENJOYS", confidence: 0.95 },
      { from: "Daggerheart", to: "TTRPG", type: "IS_A", confidence: 0.98 },
      { from: "Steve", to: "AURA", type: "WORKS_ON", confidence: 0.9 },
    ],
    paths: [
      {
        start: "Steve",
        end: "Daggerheart",
        hops: 1,
        confidence: 0.95,
        relationships: ["ENJOYS"],
        entities: ["Steve", "Daggerheart"],
      },
      {
        start: "Steve",
        end: "TTRPG",
        hops: 2,
        confidence: 0.931,
        relationships: ["ENJOYS", "IS_A"],
        entities: ["Steve", "Daggerheart", "TTRPG"],
      },
    ],
    query: {
      entityNames: ["Steve"],
      maxDepth: 2,
      minConfidence: 0.7,
    },
  });

  const createMemories = (): RelatedMemory[] => [
    {
      id: "mem-1",
      content: "Steve played Daggerheart last weekend",
      timestamp: Date.now(),
      relevance: 0.95,
      sourceMessageIds: ["msg-1"],
    },
    {
      id: "mem-2",
      content: "Working on AURA project",
      timestamp: Date.now() - 86400000,
      relevance: 0.8,
      sourceMessageIds: ["msg-2"],
    },
  ];

  describe("build", () => {
    it("should build context from subgraph", async () => {
      const builder = createGraphContextBuilder("moderate");
      const result = await builder.build(
        createSubgraph(),
        createMemories(),
        "What do I like?",
        "Steve",
      );

      expect(result.success).toBe(true);
      expect(result.context.entityResolution).toHaveLength(1);
      expect(result.context.knownFacts).toHaveLength(3);
      expect(result.context.reasoningPaths.length).toBeGreaterThan(0);
      expect(result.context.metadata.entityCount).toBe(3);
    });

    it("should include entity resolution", async () => {
      const builder = createGraphContextBuilder("moderate");
      const result = await builder.build(createSubgraph(), [], "What do I like?", "Steve");

      expect(result.context.entityResolution[0]).toMatchObject({
        original: "What do I like?",
        resolved: "Steve",
        method: "entity_resolution",
      });
    });

    it("should filter facts by confidence", async () => {
      const subgraph = createSubgraph();
      subgraph.relationships.push({
        from: "Steve",
        to: "Unknown",
        type: "KNOWS",
        confidence: 0.3, // Low confidence
      });

      const builder = createGraphContextBuilder("focused"); // Higher threshold
      const result = await builder.build(subgraph, [], "What do I like?");

      // Low confidence fact should be filtered
      const hasLowConfidence = result.context.knownFacts.some((f) => f.confidence < 0.6);
      expect(hasLowConfidence).toBe(false);
    });

    it("should generate reasoning hints", async () => {
      const builder = createGraphContextBuilder("moderate");
      const result = await builder.build(createSubgraph(), [], "What do I like?");

      // Should have enjoys_category pattern hint
      const hasCategoryHint = result.context.reasoningPaths.some((p) => p.hint.includes("TTRPG"));
      expect(hasCategoryHint).toBe(true);
    });

    it("should limit facts to top 10", async () => {
      const subgraph = createSubgraph();
      // Add many relationships
      for (let i = 0; i < 20; i++) {
        subgraph.relationships.push({
          from: "Steve",
          to: `Entity-${i}`,
          type: "KNOWS",
          confidence: 0.9 - i * 0.01,
        });
      }

      const builder = createGraphContextBuilder("general");
      const result = await builder.build(subgraph, [], "Query");

      expect(result.context.knownFacts.length).toBeLessThanOrEqual(10);
    });

    it("should include memories when provided", async () => {
      const builder = createGraphContextBuilder("general");
      const result = await builder.build(createSubgraph(), createMemories(), "What do I like?");

      expect(result.context.relatedMemories.length).toBeGreaterThan(0);
      expect(result.context.relatedMemories[0].content).toContain("Daggerheart");
    });

    it("should format as XML", async () => {
      const builder = createGraphContextBuilder("moderate");
      const result = await builder.build(createSubgraph(), [], "What do I like?");

      expect(result.formatted).toContain("<knowledge_graph_context>");
      expect(result.formatted).toContain("</knowledge_graph_context>");
      expect(result.formatted).toContain("## Known Facts");
      expect(result.formatted).toContain("## Reasoning Paths");
    });

    it("should calculate token estimates", async () => {
      const builder = createGraphContextBuilder("moderate");
      const result = await builder.build(createSubgraph(), [], "What do I like?");

      expect(result.tokens.used).toBeGreaterThan(0);
      expect(result.tokens.total).toBe(2500); // Moderate config
      expect(result.context.metadata.tokenEstimate).toBeGreaterThan(0);
    });
  });

  describe("level configurations", () => {
    it("should use focused config", () => {
      const builder = createGraphContextBuilder("focused");
      const config = builder.getConfig();

      expect(config.maxTokens).toBe(1000);
      expect(config.minFactConfidence).toBe(0.8);
      expect(config.includeSummaries).toBe(false);
    });

    it("should use moderate config", () => {
      const builder = createGraphContextBuilder("moderate");
      const config = builder.getConfig();

      expect(config.maxTokens).toBe(2500);
      expect(config.minFactConfidence).toBe(0.6);
      expect(config.includeSummaries).toBe(true);
    });

    it("should use general config", () => {
      const builder = createGraphContextBuilder("general");
      const config = builder.getConfig();

      expect(config.maxTokens).toBe(4000);
      expect(config.minFactConfidence).toBe(0.4);
      expect(config.includeSummaries).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should handle empty subgraph gracefully", async () => {
      const emptySubgraph: Subgraph = {
        entities: [],
        relationships: [],
        paths: [],
        query: { entityNames: [], maxDepth: 1, minConfidence: 0.7 },
      };

      const builder = createGraphContextBuilder("moderate");
      const result = await builder.build(emptySubgraph, [], "Query");

      expect(result.success).toBe(true);
      expect(result.context.knownFacts).toHaveLength(0);
      expect(result.context.reasoningPaths).toHaveLength(0);
    });

    it("should provide metrics", async () => {
      const builder = createGraphContextBuilder("moderate");
      const result = await builder.build(createSubgraph(), createMemories(), "What do I like?");

      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.entitiesProcessed).toBe(3);
      expect(result.metrics.relationshipsProcessed).toBe(3);
    });
  });
});
