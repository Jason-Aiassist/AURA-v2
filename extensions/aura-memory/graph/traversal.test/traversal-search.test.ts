/**
 * Graph Traversal Search Tests
 */

import { describe, it, expect, vi } from "vitest";
import type { Neo4jDriver } from "../../../adapters/kg-storage/types.js";
import { GraphTraversalSearch } from "../traversal/traversal-search.js";

// Mock Neo4j
const createMockSession = (returnValue: any = []) => ({
  run: vi.fn().mockResolvedValue(returnValue),
  close: vi.fn().mockResolvedValue(undefined),
});

const createMockDriver = (session: ReturnType<typeof createMockSession>): Neo4jDriver => ({
  session: vi.fn().mockReturnValue(session),
});

describe("GraphTraversalSearch", () => {
  describe("findConnectedSubgraph", () => {
    it("should find connected entities", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "connected") return { properties: { name: "Daggerheart", type: "Game" } };
              if (key === "rels") return [{ type: "ENJOYS", properties: { confidence: 0.95 } }];
              if (key === "nodes")
                return [
                  { properties: { name: "Steve", type: "Person" } },
                  { properties: { name: "Daggerheart", type: "Game" } },
                ];
              if (key === "pathConfidence") return 0.95;
              return null;
            },
          },
        ],
      });

      const search = new GraphTraversalSearch(createMockDriver(mockSession));

      const result = await search.findConnectedSubgraph({
        entityNames: ["Steve"],
        maxDepth: 1,
        minConfidence: 0.7,
      });

      expect(result.success).toBe(true);
      expect(result.subgraph.entities).toHaveLength(2);
      expect(result.subgraph.relationships).toHaveLength(1);
      expect(result.subgraph.paths).toHaveLength(1);
    });

    it("should handle 2-hop traversal", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "connected") return { properties: { name: "TTRPG", type: "Category" } };
              if (key === "rels")
                return [
                  { type: "ENJOYS", properties: { confidence: 0.95 } },
                  { type: "IS_A", properties: { confidence: 0.98 } },
                ];
              if (key === "nodes")
                return [
                  { properties: { name: "Steve", type: "Person" } },
                  { properties: { name: "Daggerheart", type: "Game" } },
                  { properties: { name: "TTRPG", type: "Category" } },
                ];
              if (key === "pathConfidence") return 0.931;
              return null;
            },
          },
        ],
      });

      const search = new GraphTraversalSearch(createMockDriver(mockSession));

      const result = await search.findConnectedSubgraph({
        entityNames: ["Steve"],
        maxDepth: 2,
        minConfidence: 0.7,
      });

      expect(result.success).toBe(true);
      expect(result.subgraph.paths[0].hops).toBe(2);
      expect(result.subgraph.paths[0].confidence).toBe(0.931);
    });

    it("should filter by relationship type", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "connected") return { properties: { name: "Neo4j", type: "Technology" } };
              if (key === "rels") return [{ type: "KNOWS", properties: { confidence: 0.9 } }];
              if (key === "nodes")
                return [
                  { properties: { name: "Steve", type: "Person" } },
                  { properties: { name: "Neo4j", type: "Technology" } },
                ];
              if (key === "pathConfidence") return 0.9;
              return null;
            },
          },
        ],
      });

      const search = new GraphTraversalSearch(createMockDriver(mockSession));

      const result = await search.findConnectedSubgraph({
        entityNames: ["Steve"],
        maxDepth: 1,
        minConfidence: 0.7,
        relationshipTypes: ["KNOWS"],
      });

      expect(result.success).toBe(true);
      expect(result.subgraph.relationships[0].type).toBe("KNOWS");
    });

    it("should validate maxDepth parameter", async () => {
      const search = new GraphTraversalSearch(createMockDriver(createMockSession()));

      const result = await search.findConnectedSubgraph({
        entityNames: ["Steve"],
        maxDepth: 4 as any, // Invalid
        minConfidence: 0.7,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("maxDepth must be 1, 2, or 3");
    });

    it("should require at least one start entity", async () => {
      const search = new GraphTraversalSearch(createMockDriver(createMockSession()));

      const result = await search.findConnectedSubgraph({
        entityNames: [],
        maxDepth: 2,
        minConfidence: 0.7,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("At least one start entity required");
    });

    it("should calculate path confidence correctly", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "connected") return { properties: { name: "Neo4j", type: "Technology" } };
              if (key === "rels")
                return [
                  { type: "WORKS_ON", properties: { confidence: 0.9 } },
                  { type: "USES", properties: { confidence: 0.95 } },
                ];
              if (key === "nodes")
                return [
                  { properties: { name: "Steve", type: "Person" } },
                  { properties: { name: "AURA", type: "Project" } },
                  { properties: { name: "Neo4j", type: "Technology" } },
                ];
              if (key === "pathConfidence") return 0.855; // 0.9 * 0.95
              return null;
            },
          },
        ],
      });

      const search = new GraphTraversalSearch(createMockDriver(mockSession));

      const result = await search.findConnectedSubgraph({
        entityNames: ["Steve"],
        maxDepth: 2,
        minConfidence: 0.7,
      });

      expect(result.success).toBe(true);
      expect(result.subgraph.paths).toHaveLength(1);
      // Path confidence is product of relationship confidences
      expect(result.subgraph.paths[0]?.confidence).toBe(0.855);
    });
  });

  describe("findRelated", () => {
    it("should find related entities", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "connected") return { properties: { name: "Daggerheart", type: "Game" } };
              if (key === "rels") return [{ type: "ENJOYS", properties: { confidence: 0.95 } }];
              if (key === "nodes")
                return [
                  { properties: { name: "Steve", type: "Person" } },
                  { properties: { name: "Daggerheart", type: "Game" } },
                ];
              if (key === "pathConfidence") return 0.95;
              return null;
            },
          },
        ],
      });

      const search = new GraphTraversalSearch(createMockDriver(mockSession));
      const related = await search.findRelated("Steve", "ENJOYS", 1);

      expect(related).toHaveLength(1);
      expect(related[0].name).toBe("Daggerheart");
    });

    it("should exclude start entity from results", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "connected") return { properties: { name: "Steve", type: "Person" } };
              if (key === "rels") return [];
              if (key === "nodes") return [{ properties: { name: "Steve", type: "Person" } }];
              if (key === "pathConfidence") return 1.0;
              return null;
            },
          },
        ],
      });

      const search = new GraphTraversalSearch(createMockDriver(mockSession));
      const related = await search.findRelated("Steve");

      // Should filter out the start entity
      expect(related.every((e) => e.name !== "Steve")).toBe(true);
    });
  });

  describe("findPaths", () => {
    it("should find paths between entities", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "connected") return { properties: { name: "Daggerheart", type: "Game" } };
              if (key === "rels") return [{ type: "ENJOYS", properties: { confidence: 0.95 } }];
              if (key === "nodes")
                return [
                  { properties: { name: "Steve", type: "Person" } },
                  { properties: { name: "Daggerheart", type: "Game" } },
                ];
              if (key === "pathConfidence") return 0.95;
              return null;
            },
          },
        ],
      });

      const search = new GraphTraversalSearch(createMockDriver(mockSession));
      const paths = await search.findPaths("Steve", "Daggerheart", 1);

      expect(paths).toHaveLength(1);
      expect(paths[0].end).toBe("Daggerheart");
    });
  });

  describe("areConnected", () => {
    it("should return true when entities are connected", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "connected") return { properties: { name: "Daggerheart", type: "Game" } };
              if (key === "rels") return [{ type: "ENJOYS", properties: { confidence: 0.95 } }];
              if (key === "nodes")
                return [
                  { properties: { name: "Steve", type: "Person" } },
                  { properties: { name: "Daggerheart", type: "Game" } },
                ];
              if (key === "pathConfidence") return 0.95;
              return null;
            },
          },
        ],
      });

      const search = new GraphTraversalSearch(createMockDriver(mockSession));
      const connected = await search.areConnected("Steve", "Daggerheart", 1);

      expect(connected).toBe(true);
    });

    it("should return false when not connected", async () => {
      const mockSession = createMockSession({
        records: [],
      });

      const search = new GraphTraversalSearch(createMockDriver(mockSession));
      const connected = await search.areConnected("Steve", "Unknown", 2);

      expect(connected).toBe(false);
    });
  });

  describe("configuration", () => {
    it("should get configuration", () => {
      const search = new GraphTraversalSearch(createMockDriver(createMockSession()), {
        defaultMaxDepth: 3,
        defaultMinConfidence: 0.8,
      });

      const config = search.getConfig();

      expect(config.defaultMaxDepth).toBe(3);
      expect(config.defaultMinConfidence).toBe(0.8);
    });

    it("should update configuration", () => {
      const search = new GraphTraversalSearch(createMockDriver(createMockSession()));

      search.updateConfig({ defaultMinConfidence: 0.9 });

      expect(search.getConfig().defaultMinConfidence).toBe(0.9);
    });
  });
});
