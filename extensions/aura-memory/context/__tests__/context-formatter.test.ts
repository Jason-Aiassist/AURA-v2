/**
 * Unit Tests for Context Formatter
 */

import { describe, it, expect } from "vitest";
import { ContextFormatter } from "../formatters/context-formatter.js";
import type { SearchResult } from "../models.js";

describe("ContextFormatter", () => {
  const createFormatter = (tokenLimit: number, coreFiles?: string[]) => {
    return new ContextFormatter({
      tokenLimit,
      coreFiles,
    });
  };

  const createMockResult = (id: string, content: string, score: number): SearchResult => ({
    memoryId: id,
    content,
    score,
    metadata: {},
  });

  describe("format", () => {
    it("should format results within token limit", () => {
      const formatter = createFormatter(1000);
      const results: SearchResult[] = [
        createMockResult("1", "Short content", 0.8),
        createMockResult("2", "Another content", 0.7),
      ];

      const context = formatter.format(results);

      expect(context.content).toContain("Short content");
      expect(context.content).toContain("Another content");
      expect(context.sources).toHaveLength(2);
      expect(context.tokenCount).toBeGreaterThan(0);
      expect(context.relevanceScore).toBeGreaterThan(0);
    });

    it("should respect token limit", () => {
      const formatter = createFormatter(10); // Very small limit
      const results: SearchResult[] = [
        createMockResult("1", "This is a very long content that exceeds the limit", 0.8),
        createMockResult("2", "More content", 0.7),
      ];

      const context = formatter.format(results);

      // Should only include first result (can't fit both)
      expect(context.sources.length).toBeLessThanOrEqual(1);
    });

    it("should prioritize core files first", () => {
      const formatter = createFormatter(1000, ["SOUL.md"]);
      const results: SearchResult[] = [
        createMockResult("other", "Other content", 0.5),
        createMockResult("SOUL.md", "Soul content", 0.9),
        createMockResult("another", "Another content", 0.8),
      ];

      const context = formatter.format(results);

      // Core file should be first in content
      const soulIndex = context.content.indexOf("Soul content");
      const otherIndex = context.content.indexOf("Other content");

      if (soulIndex !== -1 && otherIndex !== -1) {
        expect(soulIndex).toBeLessThan(otherIndex);
      }
    });

    it("should deduplicate core files", () => {
      const formatter = createFormatter(1000, ["SOUL.md"]);
      const results: SearchResult[] = [
        createMockResult("SOUL.md", "Soul content", 0.9),
        createMockResult("SOUL.md", "Soul content duplicate", 0.8), // Same ID
      ];

      const context = formatter.format(results);

      // Should appear only once in sources
      const soulSources = context.sources.filter((s) => s.includes("SOUL.md"));
      expect(soulSources.length).toBeLessThanOrEqual(1);
    });

    it("should calculate aggregate relevance", () => {
      const formatter = createFormatter(1000);
      const results: SearchResult[] = [
        createMockResult("1", "A", 0.8),
        createMockResult("2", "B", 0.6),
      ];

      const context = formatter.format(results);

      expect(context.relevanceScore).toBe(0.7); // Average of 0.8 and 0.6
    });

    it("should handle empty results", () => {
      const formatter = createFormatter(1000);
      const context = formatter.format([]);

      expect(context.content).toBe("");
      expect(context.tokenCount).toBe(0);
      expect(context.sources).toHaveLength(0);
      expect(context.relevanceScore).toBe(0);
    });
  });

  describe("wouldFit", () => {
    it("should return true for result that fits", () => {
      const formatter = createFormatter(1000);
      const result = createMockResult("1", "Short", 0.8);

      expect(formatter.wouldFit(result, 0)).toBe(true);
    });

    it("should return false for result that exceeds limit", () => {
      const formatter = createFormatter(5); // ~1-2 tokens
      const result = createMockResult("1", "This is very long content", 0.8);

      expect(formatter.wouldFit(result, 0)).toBe(false);
    });
  });
});
