/**
 * Graph Context Injector Tests
 */

import { describe, it, expect } from "vitest";
import type { Subgraph } from "../../../graph/traversal/types.js";
import {
  GraphContextInjector,
  createGraphContextInjector,
  injectGraphContext,
} from "../injector/graph-context-injector.js";
import type { GraphInjectionInput } from "../injector/graph-context-injector.js";

describe("GraphContextInjector", () => {
  const createSubgraph = (): Subgraph => ({
    entities: [
      { name: "Steve", type: "Person", depth: 0, paths: [] },
      { name: "Daggerheart", type: "Game", depth: 1, paths: [] },
    ],
    relationships: [{ from: "Steve", to: "Daggerheart", type: "ENJOYS", confidence: 0.95 }],
    paths: [
      {
        start: "Steve",
        end: "Daggerheart",
        hops: 1,
        confidence: 0.95,
        relationships: ["ENJOYS"],
        entities: ["Steve", "Daggerheart"],
      },
    ],
    query: {
      entityNames: ["Steve"],
      maxDepth: 1,
      minConfidence: 0.7,
    },
  });

  const createInput = (overrides: Partial<GraphInjectionInput> = {}): GraphInjectionInput => ({
    query: "What do I like?",
    resolvedEntity: "Steve",
    subgraph: createSubgraph(),
    memories: [
      {
        id: "mem-1",
        content: "Steve played Daggerheart",
        timestamp: Date.now(),
        relevance: 0.9,
      },
    ],
    level: "moderate",
    ...overrides,
  });

  describe("inject", () => {
    it("should inject context into query", async () => {
      const injector = createGraphContextInjector("moderate");
      const result = await injector.inject(createInput());

      expect(result.success).toBe(true);
      expect(result.formattedContext).toContain("<knowledge_graph_context>");
      expect(result.enhancedQuery).toContain("<knowledge_graph_context>");
      expect(result.enhancedQuery).toContain("What do I like?");
    });

    it("should prepend context before query", async () => {
      const injector = createGraphContextInjector("moderate");
      const result = await injector.inject(createInput());

      const contextIndex = result.enhancedQuery.indexOf("<knowledge_graph_context>");
      const queryIndex = result.enhancedQuery.indexOf("What do I like?");

      expect(contextIndex).toBeLessThan(queryIndex);
    });

    it("should track token usage", async () => {
      const injector = createGraphContextInjector("moderate");
      const result = await injector.inject(createInput());

      expect(result.tokens.contextTokens).toBeGreaterThan(0);
      expect(result.tokens.totalTokens).toBeGreaterThan(result.tokens.contextTokens);
      expect(result.tokens.remainingBudget).toBeGreaterThanOrEqual(0);
    });

    it("should provide metrics", async () => {
      const injector = createGraphContextInjector("moderate");
      const result = await injector.inject(createInput());

      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.entitiesIncluded).toBeGreaterThan(0);
      expect(result.metrics.factsIncluded).toBeGreaterThanOrEqual(0);
    });

    it("should handle different levels", async () => {
      for (const level of ["focused", "moderate", "general"] as const) {
        const injector = createGraphContextInjector(level);
        const result = await injector.inject(createInput({ level }));

        expect(result.success).toBe(true);
        expect(result.tokens.totalTokens).toBeGreaterThan(0);
      }
    });

    it("should return original query on failure", async () => {
      const injector = createGraphContextInjector("moderate");

      // Invalid input will cause failure
      const result = await injector.inject({
        ...createInput(),
        subgraph: {
          entities: [],
          relationships: [],
          paths: [],
          query: { entityNames: [], maxDepth: 1, minConfidence: 0.7 },
        },
      });

      // Should still succeed with empty context
      expect(result.success).toBe(true);
      expect(result.enhancedQuery).toContain("What do I like?");
    });

    it("should work with helper function", async () => {
      const result = await injectGraphContext(createInput());

      expect(result.success).toBe(true);
      expect(result.context.knownFacts.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("level budgets", () => {
    it("should use focused budget", async () => {
      const injector = createGraphContextInjector("focused");
      const result = await injector.inject(createInput({ level: "focused" }));

      expect(result.tokens.totalTokens).toBeLessThanOrEqual(1000 * 2); // Some margin
    });

    it("should use moderate budget", async () => {
      const injector = createGraphContextInjector("moderate");
      const result = await injector.inject(createInput({ level: "moderate" }));

      expect(result.tokens.totalTokens).toBeLessThanOrEqual(2500 * 2);
    });

    it("should use general budget", async () => {
      const injector = createGraphContextInjector("general");
      const result = await injector.inject(createInput({ level: "general" }));

      expect(result.tokens.totalTokens).toBeLessThanOrEqual(4000 * 2);
    });
  });

  describe("getConfig", () => {
    it("should return current config", () => {
      const injector = createGraphContextInjector("moderate");
      const config = injector.getConfig();

      expect(config.level).toBe("moderate");
      expect(config.budget).toBe(2500);
    });
  });

  describe("error handling", () => {
    it("should handle missing resolved entity", async () => {
      const injector = createGraphContextInjector("moderate");
      const result = await injector.inject(createInput({ resolvedEntity: undefined }));

      expect(result.success).toBe(true);
      // Should still build context without resolution
      expect(result.context.entityResolution).toHaveLength(0);
    });

    it("should handle empty memories", async () => {
      const injector = createGraphContextInjector("moderate");
      const result = await injector.inject(createInput({ memories: [] }));

      expect(result.success).toBe(true);
      expect(result.context.relatedMemories).toHaveLength(0);
    });
  });
});
