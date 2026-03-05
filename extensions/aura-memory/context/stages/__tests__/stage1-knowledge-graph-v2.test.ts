/**
 * Stage 1 v2 Tests
 * Tests for Entity Resolution + Graph Traversal integration
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EntityResolver } from "../../../graph/entity-resolution/EntityResolver.js";
import type { KnowledgeGraphIntegration } from "../../../graph/KnowledgeGraphIntegration.js";
import type { GraphTraversalSearch } from "../../../graph/traversal/traversal-search.js";
import { Stage1KnowledgeGraphSearch } from "../stage1-knowledge-graph-v2.js";

// Mock dependencies
const createMockKG = (): KnowledgeGraphIntegration =>
  ({
    searchRelated: vi
      .fn()
      .mockResolvedValue([{ memoryId: "mem1", content: "Test memory", relevance: 0.8 }]),
  }) as unknown as KnowledgeGraphIntegration;

const createMockResolver = (): EntityResolver =>
  ({
    resolve: vi.fn().mockImplementation((name: string) => {
      if (name === "me" || name === "I") {
        return Promise.resolve({
          name: "User",
          type: "Person",
          aliases: ["me", "I"],
          confidence: 0.95,
          method: "pronoun",
          originalQuery: name,
        });
      }
      return Promise.resolve(null);
    }),
  }) as unknown as EntityResolver;

const createMockTraversal = (): GraphTraversalSearch =>
  ({
    findConnectedSubgraph: vi.fn().mockResolvedValue({
      success: true,
      subgraph: {
        entities: [
          { name: "Daggerheart", type: "Game", depth: 1, paths: [] },
          { name: "TTRPG", type: "Category", depth: 2, paths: [] },
        ],
        relationships: [],
        paths: [],
        query: {
          entityNames: ["Steve"],
          maxDepth: 2,
          minConfidence: 0.7,
        },
      },
      metrics: {
        durationMs: 50,
        pathsExplored: 2,
        entitiesFound: 2,
      },
    }),
  }) as unknown as GraphTraversalSearch;

describe("Stage1KnowledgeGraphSearch v2", () => {
  let mockKG: KnowledgeGraphIntegration;
  let mockResolver: EntityResolver;
  let mockTraversal: GraphTraversalSearch;

  beforeEach(() => {
    mockKG = createMockKG();
    mockResolver = createMockResolver();
    mockTraversal = createMockTraversal();
  });

  it("should resolve pronouns using EntityResolver", async () => {
    const stage1 = new Stage1KnowledgeGraphSearch({
      knowledgeGraph: mockKG,
      maxResults: 50,
      minRelevance: 0.3,
      entityResolver: mockResolver,
    });

    const result = await stage1.execute("What do I like?", ["I"]);

    expect(result.success).toBe(true);
    expect(mockResolver.resolve).toHaveBeenCalledWith("I");
    expect(result.resolvedEntities?.resolved).toContainEqual(
      expect.objectContaining({
        original: "I",
        name: "User",
        method: "pronoun",
      }),
    );
  });

  it("should use graph traversal when enabled", async () => {
    const stage1 = new Stage1KnowledgeGraphSearch({
      knowledgeGraph: mockKG,
      maxResults: 50,
      minRelevance: 0.3,
      entityResolver: mockResolver,
      graphTraversal: mockTraversal,
      enableTraversal: true,
    });

    const result = await stage1.execute("Tell me about Steve");

    expect(result.success).toBe(true);
    expect(mockTraversal.findConnectedSubgraph).toHaveBeenCalled();
    expect(result.resolvedEntities?.connected).toContain("Daggerheart");
    expect(result.resolvedEntities?.connected).toContain("TTRPG");
  });

  it("should skip traversal when disabled", async () => {
    const stage1 = new Stage1KnowledgeGraphSearch({
      knowledgeGraph: mockKG,
      maxResults: 50,
      minRelevance: 0.3,
      entityResolver: mockResolver,
      graphTraversal: mockTraversal,
      enableTraversal: false,
    });

    await stage1.execute("Tell me about Steve");

    expect(mockTraversal.findConnectedSubgraph).not.toHaveBeenCalled();
  });

  it("should work without resolver (passthrough mode)", async () => {
    const stage1 = new Stage1KnowledgeGraphSearch({
      knowledgeGraph: mockKG,
      maxResults: 50,
      minRelevance: 0.3,
    });

    const result = await stage1.execute("Tell me about Steve");

    expect(result.success).toBe(true);
    expect(result.resolvedEntities?.resolved[0].method).toBe("passthrough");
  });

  it("should report availability correctly", () => {
    const stage1 = new Stage1KnowledgeGraphSearch({
      knowledgeGraph: mockKG,
      maxResults: 50,
      minRelevance: 0.3,
      entityResolver: mockResolver,
      graphTraversal: mockTraversal,
      enableTraversal: true,
    });

    expect(stage1.isAvailable()).toBe(true);
    expect(stage1.isTraversalAvailable()).toBe(true);
  });

  it("should report traversal unavailable when disabled", () => {
    const stage1 = new Stage1KnowledgeGraphSearch({
      knowledgeGraph: mockKG,
      maxResults: 50,
      minRelevance: 0.3,
      entityResolver: mockResolver,
      graphTraversal: mockTraversal,
      enableTraversal: false,
    });

    expect(stage1.isTraversalAvailable()).toBe(false);
  });
});
