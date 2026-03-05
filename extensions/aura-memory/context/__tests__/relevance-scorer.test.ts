/**
 * Unit Tests for Relevance Scorer
 */

import { describe, it, expect } from "vitest";
import type { SearchResult } from "../models.js";
import { RelevanceScorer } from "../relevance-scorer.js";

describe("RelevanceScorer", () => {
  const scorer = new RelevanceScorer();

  describe("scoreResults", () => {
    it("should boost score for query term matches", () => {
      const results: SearchResult[] = [
        {
          memoryId: "1",
          content: "The quick brown fox",
          score: 0.5,
          metadata: {},
        },
      ];

      const scored = scorer.scoreResults(results, "quick fox");

      // Should have boosted score due to term matches
      expect(scored[0].score).toBeGreaterThan(0.5);
    });

    it("should apply recency boost for recent memories", () => {
      const recentTimestamp = Date.now() / 1000; // Now
      const results: SearchResult[] = [
        {
          memoryId: "1",
          content: "Recent memory",
          score: 0.5,
          metadata: { modified: recentTimestamp },
        },
      ];

      const scored = scorer.scoreResults(results, "memory");

      // Should have recency boost
      expect(scored[0].score).toBeGreaterThan(0.5);
    });

    it("should not exceed max score of 1.0", () => {
      const results: SearchResult[] = [
        {
          memoryId: "1",
          content: "Perfect match with all terms",
          score: 0.95,
          metadata: { modified: Date.now() / 1000 },
        },
      ];

      const scored = scorer.scoreResults(results, "perfect match all terms");

      expect(scored[0].score).toBeLessThanOrEqual(1.0);
    });

    it("should sort results by score descending", () => {
      const results: SearchResult[] = [
        { memoryId: "1", content: "Low", score: 0.3, metadata: {} },
        { memoryId: "2", content: "High", score: 0.8, metadata: {} },
        { memoryId: "3", content: "Medium", score: 0.5, metadata: {} },
      ];

      const scored = scorer.scoreResults(results, "test");

      expect(scored[0].memoryId).toBe("2");
      expect(scored[1].memoryId).toBe("3");
      expect(scored[2].memoryId).toBe("1");
    });
  });

  describe("calculateAggregateRelevance", () => {
    it("should calculate average score", () => {
      const results: SearchResult[] = [
        { memoryId: "1", content: "A", score: 0.8, metadata: {} },
        { memoryId: "2", content: "B", score: 0.6, metadata: {} },
      ];

      const avg = scorer.calculateAggregateRelevance(results);

      expect(avg).toBe(0.7);
    });

    it("should return 0 for empty results", () => {
      const avg = scorer.calculateAggregateRelevance([]);

      expect(avg).toBe(0);
    });
  });

  describe("filterByThreshold", () => {
    it("should filter results below threshold", () => {
      const results: SearchResult[] = [
        { memoryId: "1", content: "High", score: 0.8, metadata: {} },
        { memoryId: "2", content: "Low", score: 0.2, metadata: {} },
        { memoryId: "3", content: "Medium", score: 0.5, metadata: {} },
      ];

      const filtered = scorer.filterByThreshold(results, 0.4);

      expect(filtered.length).toBe(2);
      expect(filtered.every((r) => r.score >= 0.4)).toBe(true);
    });
  });

  describe("getTopResults", () => {
    it("should return top N results", () => {
      const results: SearchResult[] = [
        { memoryId: "1", content: "A", score: 0.9, metadata: {} },
        { memoryId: "2", content: "B", score: 0.8, metadata: {} },
        { memoryId: "3", content: "C", score: 0.7, metadata: {} },
      ];

      const top = scorer.getTopResults(results, 2);

      expect(top.length).toBe(2);
      expect(top[0].memoryId).toBe("1");
      expect(top[1].memoryId).toBe("2");
    });
  });
});
