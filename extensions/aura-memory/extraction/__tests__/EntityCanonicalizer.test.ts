/**
 * Entity Canonicalizer Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createEntityCanonicalizer, EntityCanonicalizer } from "../EntityCanonicalizer.js";

describe("EntityCanonicalizer", () => {
  let canonicalizer: EntityCanonicalizer;

  beforeEach(() => {
    canonicalizer = createEntityCanonicalizer({
      userCanonicalName: "Steve",
      userAliases: ["steve", "user", "USER", "my", "me", "mine", "myself", "I", "i"],
    });
  });

  describe("User Alias Canonicalization", () => {
    it('should canonicalize "Steve" to "Steve"', () => {
      const result = canonicalizer.canonicalize("Steve");
      expect(result.canonical).toBe("Steve");
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should canonicalize "steve" to "Steve"', () => {
      const result = canonicalizer.canonicalize("steve");
      expect(result.canonical).toBe("Steve");
    });

    it('should canonicalize "user" to "Steve"', () => {
      const result = canonicalizer.canonicalize("user");
      expect(result.canonical).toBe("Steve");
    });

    it('should canonicalize "USER" to "Steve"', () => {
      const result = canonicalizer.canonicalize("USER");
      expect(result.canonical).toBe("Steve");
    });

    it('should canonicalize "my" to "Steve"', () => {
      const result = canonicalizer.canonicalize("my");
      expect(result.canonical).toBe("Steve");
    });

    it('should canonicalize "me" to "Steve"', () => {
      const result = canonicalizer.canonicalize("me");
      expect(result.canonical).toBe("Steve");
    });

    it('should canonicalize "I" to "Steve"', () => {
      const result = canonicalizer.canonicalize("I");
      expect(result.canonical).toBe("Steve");
    });

    it('should canonicalize "mine" to "Steve"', () => {
      const result = canonicalizer.canonicalize("mine");
      expect(result.canonical).toBe("Steve");
    });
  });

  describe("Fuzzy Matching", () => {
    it("should match similar entity names", () => {
      canonicalizer.registerEntities(["Ken", "Sally", "Neo4j"]);

      const result = canonicalizer.canonicalize("ken");
      expect(result.canonical).toBe("ken"); // Fuzzy match returns lowercase registered
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should not match dissimilar names", () => {
      canonicalizer.registerEntities(["Ken", "Sally"]);

      const result = canonicalizer.canonicalize("CompletelyDifferent");
      expect(result.canonical).toBe("CompletelyDifferent");
      expect(result.confidence).toBe(0.5);
    });
  });

  describe("Batch Canonicalization", () => {
    it("should canonicalize multiple entities", () => {
      const results = canonicalizer.canonicalizeMany(["Steve", "user", "Ken", "Sally"]);

      expect(results).toHaveLength(4);
      expect(results[0].canonical).toBe("Steve");
      expect(results[1].canonical).toBe("Steve");
      expect(results[2].canonical).toBe("Ken");
      expect(results[3].canonical).toBe("Sally");
    });
  });

  describe("Extraction Canonicalization", () => {
    it("should canonicalize extraction output", () => {
      const extraction = {
        entities: ["Steve", "user", "Ken"],
        relationships: [
          { from: "Steve", to: "Ken", type: "father" },
          { from: "user", to: "Sally", type: "sister" },
        ],
      };

      const result = canonicalizer.canonicalizeExtraction(extraction);

      // Should have unique canonical entities
      expect(result.entities).toContain("Steve");
      expect(result.entities).toContain("Ken");
      expect(result.entities).toContain("Sally");
      expect(result.entities).not.toContain("user");

      // Relationships should be canonicalized
      expect(result.canonicalizedRelationships[0].from).toBe("Steve");
      expect(result.canonicalizedRelationships[1].from).toBe("Steve");
      expect(result.canonicalizedRelationships[1].originalFrom).toBe("user");

      // Entity map should show mappings
      expect(result.entityMap.get("user")).toBe("Steve");
      expect(result.entityMap.get("Steve")).toBe("Steve");
    });
  });

  describe("Caching", () => {
    it("should cache canonicalization results", () => {
      const result1 = canonicalizer.canonicalize("user");
      const result2 = canonicalizer.canonicalize("user");

      expect(result1.canonical).toBe(result2.canonical);
      expect(result2.reasoning).toContain("Cache hit");
    });

    it("should clear cache", () => {
      canonicalizer.canonicalize("user");
      canonicalizer.clearCache();

      const result = canonicalizer.canonicalize("user");
      expect(result.reasoning).not.toContain("Cache hit");
    });
  });
});
