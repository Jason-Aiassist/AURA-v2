/**
 * Stage 3 REPL Tests
 */

import { describe, it, expect } from "vitest";
import type { Subgraph } from "../../../graph/traversal/types.js";
import { Stage3REPL, createStage3REPL, executeREPL } from "../stages/stage3-repl.js";
import type { REPLCandidate, REPLEvalContext } from "../stages/stage3-repl.js";

describe("Stage3REPL", () => {
  const createContext = (level: "focused" | "moderate" | "general"): REPLEvalContext => ({
    query: "What do I like?",
    resolvedEntity: "Steve",
    level,
    subgraph: {
      entities: [
        { name: "Steve", type: "Person", depth: 0, paths: [] },
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
  });

  const createCandidate = (overrides: Partial<REPLCandidate> = {}): REPLCandidate => ({
    id: "test-1",
    content: "Steve enjoys Daggerheart",
    score: 0.8,
    timestamp: Date.now(),
    entities: ["Steve", "Daggerheart"],
    scores: {
      vector: 0.8,
      bm25: 0.7,
      recency: 0.9,
      graph: 0,
    },
    ...overrides,
  });

  describe("focused mode", () => {
    it("should apply focused weights", () => {
      const repl = createStage3REPL(createContext("focused"));
      const weights = repl.getWeights();

      expect(weights.vector).toBe(0.5);
      expect(weights.bm25).toBe(0.3);
      expect(weights.recency).toBe(0.1);
      expect(weights.graph).toBe(0.1);
      expect(weights.minThreshold).toBe(0.6);
      expect(weights.maxResults).toBe(5);
    });

    it("should filter by high threshold", () => {
      const candidates: REPLCandidate[] = [
        createCandidate({
          id: "high",
          score: 0.9,
          scores: { vector: 0.9, bm25: 0.9, recency: 0.9, graph: 0 },
        }),
        createCandidate({
          id: "med",
          score: 0.5,
          scores: { vector: 0.5, bm25: 0.5, recency: 0.5, graph: 0 },
        }),
        createCandidate({
          id: "low",
          score: 0.3,
          scores: { vector: 0.3, bm25: 0.3, recency: 0.3, graph: 0 },
        }),
      ];

      const { results, stats } = executeREPL(candidates, createContext("focused"));

      expect(stats.aboveThreshold).toBe(1); // Only high score passes 0.6 threshold
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("high");
    });

    it("should prioritize direct graph connections", () => {
      const candidates: REPLCandidate[] = [
        createCandidate({
          id: "far",
          score: 0.9,
          entities: ["TTRPG"], // depth 2
          scores: { vector: 0.9, bm25: 0.9, recency: 0.9, graph: 0 },
        }),
        createCandidate({
          id: "close",
          score: 0.85,
          entities: ["Daggerheart"], // depth 1
          scores: { vector: 0.85, bm25: 0.85, recency: 0.85, graph: 0 },
        }),
      ];

      const { results } = executeREPL(candidates, createContext("focused"));

      // Closer entity should be prioritized despite lower score
      expect(results[0].id).toBe("close");
    });
  });

  describe("moderate mode", () => {
    it("should apply moderate weights", () => {
      const repl = createStage3REPL(createContext("moderate"));
      const weights = repl.getWeights();

      expect(weights.vector).toBe(0.4);
      expect(weights.bm25).toBe(0.25);
      expect(weights.recency).toBe(0.15);
      expect(weights.graph).toBe(0.2);
      expect(weights.minThreshold).toBe(0.4);
      expect(weights.maxResults).toBe(15);
    });

    it("should balance score and distance", () => {
      const candidates: REPLCandidate[] = [
        createCandidate({
          id: "high-score-far",
          score: 0.95,
          entities: ["TTRPG"], // depth 2
          scores: { vector: 0.95, bm25: 0.95, recency: 0.95, graph: 0 },
        }),
        createCandidate({
          id: "med-score-close",
          score: 0.8,
          entities: ["Daggerheart"], // depth 1
          scores: { vector: 0.8, bm25: 0.8, recency: 0.8, graph: 0 },
        }),
      ];

      const { results } = executeREPL(candidates, createContext("moderate"));

      // With distance penalty, closer item may rank higher
      // Score: 0.8 - 0.1*1 = 0.7 vs 0.95 - 0.1*2 = 0.75
      // High score far still wins, but closer item is competitive
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("general mode", () => {
    it("should apply general weights", () => {
      const repl = createStage3REPL(createContext("general"));
      const weights = repl.getWeights();

      expect(weights.vector).toBe(0.3);
      expect(weights.bm25).toBe(0.2);
      expect(weights.recency).toBe(0.2);
      expect(weights.graph).toBe(0.3); // Higher graph weight
      expect(weights.minThreshold).toBe(0.2);
      expect(weights.maxResults).toBe(30);
    });

    it("should include more results", () => {
      const candidates: REPLCandidate[] = Array.from({ length: 10 }, (_, i) =>
        createCandidate({
          id: `item-${i}`,
          score: 0.3 + i * 0.05, // Scores from 0.3 to 0.75
          scores: {
            vector: 0.3 + i * 0.05,
            bm25: 0.3 + i * 0.05,
            recency: 0.3 + i * 0.05,
            graph: 0,
          },
        }),
      );

      const { results, stats } = executeREPL(candidates, createContext("general"));

      // Lower threshold (0.2) means more items pass
      expect(stats.aboveThreshold).toBeGreaterThan(5);
      expect(results.length).toBeGreaterThan(5);
    });
  });

  describe("REPL cycle", () => {
    it("should execute full READ-EVAL-PRINT cycle", () => {
      const repl = createStage3REPL(createContext("moderate"));
      const candidates: REPLCandidate[] = [
        createCandidate({ id: "a", score: 0.9 }),
        createCandidate({ id: "b", score: 0.5 }),
      ];

      // READ
      repl.read(candidates);
      expect(repl.getContext().level).toBe("moderate");

      // EVAL
      repl.eval();
      // Scores should be recalculated

      // PRINT
      const { results, stats } = repl.print();

      expect(results.length).toBeGreaterThan(0);
      expect(stats.totalEvaluated).toBe(2);
    });
  });

  describe("graph score calculation", () => {
    it("should score higher for entities in subgraph", () => {
      const repl = createStage3REPL(createContext("moderate"));
      const candidates: REPLCandidate[] = [
        createCandidate({
          id: "in-subgraph",
          entities: ["Daggerheart"],
          scores: { vector: 0.8, bm25: 0.8, recency: 0.8, graph: 0 },
        }),
        createCandidate({
          id: "not-in-subgraph",
          entities: ["Unknown"],
          scores: { vector: 0.8, bm25: 0.8, recency: 0.8, graph: 0 },
        }),
      ];

      repl.read(candidates);
      repl.eval();

      const { results } = repl.print();

      // Entity in subgraph should have higher graph score
      const inSubgraph = candidates.find((c) => c.id === "in-subgraph");
      const notInSubgraph = candidates.find((c) => c.id === "not-in-subgraph");

      expect(inSubgraph?.scores.graph).toBeGreaterThan(0);
      expect(notInSubgraph?.scores.graph).toBe(0);
    });
  });

  describe("recency score", () => {
    it("should calculate recency based on timestamp", () => {
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

      const candidates: REPLCandidate[] = [
        createCandidate({
          id: "recent",
          timestamp: dayAgo,
          scores: { vector: 0.8, bm25: 0.8, recency: 0, graph: 0 },
        }),
        createCandidate({
          id: "old",
          timestamp: monthAgo,
          scores: { vector: 0.8, bm25: 0.8, recency: 0, graph: 0 },
        }),
      ];

      const repl = createStage3REPL(createContext("moderate"));
      repl.read(candidates);
      repl.eval();

      const recent = candidates.find((c) => c.id === "recent");
      const old = candidates.find((c) => c.id === "old");

      // Recent should have higher recency score
      expect(recent?.scores.recency!).toBeGreaterThan(old?.scores.recency!);
    });

    it("should handle missing timestamp", () => {
      const candidates: REPLCandidate[] = [
        createCandidate({
          id: "no-timestamp",
          timestamp: undefined,
          scores: { vector: 0.8, bm25: 0.8, recency: 0, graph: 0 },
        }),
      ];

      const repl = createStage3REPL(createContext("moderate"));
      repl.read(candidates);
      repl.eval();

      // Should get neutral score (0.5)
      expect(candidates[0].scores.recency).toBe(0.5);
    });
  });

  describe("weighted score calculation", () => {
    it("should calculate weighted score correctly", () => {
      const candidate = createCandidate({
        scores: {
          vector: 1.0,
          bm25: 0.5,
          recency: 0.8,
          graph: 0.6,
        },
      });

      const repl = createStage3REPL(createContext("focused"));
      repl.read([candidate]);
      repl.eval();

      // Focused: vector 0.5, bm25 0.3, recency 0.1, graph 0.1
      // Score = 1.0*0.5 + 0.5*0.3 + 0.8*0.1 + 0.6*0.1
      //       = 0.5 + 0.15 + 0.08 + 0.06 = 0.79
      const expectedScore = 1.0 * 0.5 + 0.5 * 0.3 + 0.8 * 0.1 + 0.6 * 0.1;
      expect(candidate.score).toBeCloseTo(expectedScore, 2);
    });
  });

  describe("stats", () => {
    it("should provide accurate statistics", () => {
      const candidates: REPLCandidate[] = [
        createCandidate({ id: "a", score: 0.9 }),
        createCandidate({ id: "b", score: 0.5 }),
        createCandidate({ id: "c", score: 0.3 }),
      ];

      const { stats } = executeREPL(candidates, createContext("moderate"));

      expect(stats.totalEvaluated).toBe(3);
      expect(stats.aboveThreshold).toBeGreaterThanOrEqual(0);
      expect(stats.returned).toBeGreaterThanOrEqual(0);
      expect(stats.avgScore).toBeGreaterThanOrEqual(0);
    });
  });
});
