/**
 * Unit Tests for Stage 3: REPL Filter
 * Tests the General/Moderate/Focused filtering logic
 */

import { describe, it, expect } from "vitest";
import type { SearchResult } from "../models.js";
import { Stage3REPLFilter } from "../stages/stage3-repl-filter.js";

describe("Stage3REPLFilter", () => {
  const filter = new Stage3REPLFilter();

  const createMockResults = (count: number, baseScore: number): SearchResult[] => {
    return Array.from({ length: count }, (_, i) => ({
      memoryId: `mem-${i}`,
      content: `Content ${i}`,
      score: baseScore - i * 0.05,
      metadata: {},
    }));
  };

  describe("General Level", () => {
    it("should keep all results above threshold", () => {
      const results = createMockResults(10, 0.8);
      const { results: filtered, filteredCount } = filter.execute(results, {
        level: "general",
      });

      expect(filtered.length).toBe(10);
      expect(filteredCount).toBe(0);
      expect(filtered.every((r) => r.score >= 0.1)).toBe(true);
    });

    it("should filter results below threshold", () => {
      const results = [
        { memoryId: "1", content: "High", score: 0.8, metadata: {} },
        { memoryId: "2", content: "Low", score: 0.05, metadata: {} },
      ];
      const { results: filtered } = filter.execute(results, { level: "general" });

      expect(filtered.length).toBe(1);
      expect(filtered[0].memoryId).toBe("1");
    });
  });

  describe("Moderate Level", () => {
    it("should keep top 60% of results", () => {
      const results = createMockResults(10, 0.8);
      const { results: filtered } = filter.execute(results, {
        level: "moderate",
      });

      expect(filtered.length).toBe(6); // 60% of 10
    });

    it("should apply threshold of 0.3", () => {
      const results = [
        { memoryId: "1", content: "High", score: 0.8, metadata: {} },
        { memoryId: "2", content: "Medium", score: 0.2, metadata: {} },
      ];
      const { results: filtered } = filter.execute(results, { level: "moderate" });

      expect(filtered.every((r) => r.score >= 0.3)).toBe(true);
    });
  });

  describe("Focused Level", () => {
    it("should keep top 30% of results", () => {
      const results = createMockResults(10, 0.8);
      const { results: filtered } = filter.execute(results, {
        level: "focused",
      });

      expect(filtered.length).toBe(3); // 30% of 10
    });

    it("should apply strict threshold of 0.6", () => {
      const results = [
        { memoryId: "1", content: "High", score: 0.8, metadata: {} },
        { memoryId: "2", content: "Low", score: 0.4, metadata: {} },
      ];
      const { results: filtered } = filter.execute(results, { level: "focused" });

      expect(filtered.every((r) => r.score >= 0.6)).toBe(true);
    });
  });

  describe("Max Results", () => {
    it("should respect maxResults limit", () => {
      const results = createMockResults(100, 0.9);
      const { results: filtered } = filter.execute(results, {
        level: "general",
        maxResults: 10,
      });

      expect(filtered.length).toBe(10);
    });
  });

  describe("Empty Results", () => {
    it("should handle empty input", () => {
      const { results: filtered, filteredCount } = filter.execute([], {
        level: "general",
      });

      expect(filtered.length).toBe(0);
      expect(filteredCount).toBe(0);
    });
  });
});
