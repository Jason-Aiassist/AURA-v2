/**
 * Entity Resolver Tests
 * Comprehensive tests for entity resolution functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Neo4jDriver } from "../../../adapters/kg-storage/types.js";
import {
  EntityResolver,
  createEntityResolver,
  isResolved,
} from "../entity-resolution/EntityResolver.js";

// Mock Neo4j driver
const createMockDriver = (records: any[] = []) => ({
  session: vi.fn().mockReturnValue({
    run: vi.fn().mockResolvedValue({ records }),
    close: vi.fn().mockResolvedValue(undefined),
  }),
});

describe("EntityResolver", () => {
  describe("pronoun resolution", () => {
    it("should resolve 'me' to User", async () => {
      const resolver = new EntityResolver(createMockDriver() as unknown as Neo4jDriver);
      const result = await resolver.resolve("me");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("User");
      expect(result!.type).toBe("Person");
      expect(result!.method).toBe("pronoun");
      expect(result!.confidence).toBe(0.95);
      expect(result!.aliases).toContain("me");
      expect(result!.aliases).toContain("I");
    });

    it("should resolve 'I' to User", async () => {
      const resolver = new EntityResolver(createMockDriver() as unknown as Neo4jDriver);
      const result = await resolver.resolve("I");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("User");
      expect(result!.method).toBe("pronoun");
    });

    it("should resolve 'you' to Aura", async () => {
      const resolver = new EntityResolver(createMockDriver() as unknown as Neo4jDriver);
      const result = await resolver.resolve("you");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("Aura");
      expect(result!.type).toBe("Assistant");
      expect(result!.method).toBe("pronoun");
      expect(result!.confidence).toBe(0.95);
    });

    it("should resolve 'yourself' to Aura", async () => {
      const resolver = new EntityResolver(createMockDriver() as unknown as Neo4jDriver);
      const result = await resolver.resolve("yourself");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("Aura");
      expect(result!.method).toBe("pronoun");
    });

    it("should handle case-insensitive pronouns", async () => {
      const resolver = new EntityResolver(createMockDriver() as unknown as Neo4jDriver);

      const upper = await resolver.resolve("ME");
      const lower = await resolver.resolve("me");
      const mixed = await resolver.resolve("Me");

      expect(upper!.name).toBe("User");
      expect(lower!.name).toBe("User");
      expect(mixed!.name).toBe("User");
    });

    it("should identify pronouns correctly", () => {
      const resolver = new EntityResolver(createMockDriver() as unknown as Neo4jDriver);

      expect(resolver.isPronoun("me")).toBe(true);
      expect(resolver.isPronoun("I")).toBe(true);
      expect(resolver.isPronoun("you")).toBe(true);
      expect(resolver.isPronoun("Steve")).toBe(false);
      expect(resolver.isPronoun("Daggerheart")).toBe(false);
    });
  });

  describe("database resolution", () => {
    it("should resolve exact match from database", async () => {
      const mockDriver = createMockDriver([
        {
          get: (key: string) => {
            const values: Record<string, any> = {
              name: "Steve",
              type: "Person",
              aliases: ["steve", "user"],
            };
            return values[key];
          },
        },
      ]);

      const resolver = new EntityResolver(mockDriver as unknown as Neo4jDriver);
      const result = await resolver.resolve("Steve");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("Steve");
      expect(result!.type).toBe("Person");
      expect(result!.method).toBe("exact");
      expect(result!.confidence).toBe(1.0);
    });

    it("should resolve case-insensitive match", async () => {
      const mockDriver = {
        session: vi.fn().mockReturnValue({
          run: vi.fn().mockImplementation((query: string) => {
            // First call (exact) returns empty
            if (query.includes("e.name = $query")) {
              return { records: [] };
            }
            // Second call (case-insensitive) returns match
            if (query.includes("toLower(e.name)")) {
              return {
                records: [
                  {
                    get: (key: string) => {
                      const values: Record<string, any> = {
                        name: "Daggerheart",
                        type: "Game",
                        aliases: null,
                      };
                      return values[key];
                    },
                  },
                ],
              };
            }
            return { records: [] };
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      };

      const resolver = new EntityResolver(mockDriver as unknown as Neo4jDriver);
      const result = await resolver.resolve("daggerheart"); // lowercase query

      expect(result).not.toBeNull();
      expect(result!.name).toBe("Daggerheart");
      expect(result!.method).toBe("case_insensitive");
      expect(result!.confidence).toBe(0.95);
    });

    it("should resolve via alias match", async () => {
      const mockDriver = {
        session: vi.fn().mockReturnValue({
          run: vi.fn().mockImplementation((query: string) => {
            // First two calls return empty
            if (query.includes("e.name = $query") || query.includes("toLower(e.name)")) {
              return { records: [] };
            }
            // Third call (alias) returns match
            if (query.includes("e.aliases")) {
              return {
                records: [
                  {
                    get: (key: string) => {
                      const values: Record<string, any> = {
                        name: "User",
                        type: "Person",
                        aliases: ["me", "I", "steve"],
                      };
                      return values[key];
                    },
                  },
                ],
              };
            }
            return { records: [] };
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      };

      const resolver = new EntityResolver(mockDriver as unknown as Neo4jDriver);
      const result = await resolver.resolve("steve"); // alias

      expect(result).not.toBeNull();
      expect(result!.name).toBe("User");
      expect(result!.method).toBe("alias");
      expect(result!.confidence).toBe(0.9);
    });

    it("should return null for unknown entity", async () => {
      const mockDriver = createMockDriver([]);
      const resolver = new EntityResolver(mockDriver as unknown as Neo4jDriver);

      const result = await resolver.resolve("UnknownEntity123");

      expect(result).toBeNull();
    });
  });

  describe("batch resolution", () => {
    it("should resolve multiple entities", async () => {
      const resolver = new EntityResolver(createMockDriver() as unknown as Neo4jDriver);

      const results = await resolver.resolveBatch(["me", "you", "I"]);

      expect(results.size).toBe(3);
      expect(results.get("me")!.name).toBe("User");
      expect(results.get("you")!.name).toBe("Aura");
      expect(results.get("I")!.name).toBe("User");
    });

    it("should deduplicate queries", async () => {
      const resolver = new EntityResolver(createMockDriver() as unknown as Neo4jDriver);

      // Same query multiple times
      const results = await resolver.resolveBatch(["me", "me", "me"]);

      // Should only resolve once but return for all
      expect(results.size).toBe(1);
      expect(results.get("me")!.name).toBe("User");
    });
  });

  describe("caching", () => {
    it("should cache resolution results", async () => {
      const mockDriver = createMockDriver([
        {
          get: (key: string) => {
            const values: Record<string, any> = {
              name: "Steve",
              type: "Person",
              aliases: null,
            };
            return values[key];
          },
        },
      ]);

      const resolver = new EntityResolver(mockDriver as unknown as Neo4jDriver);

      // First call hits database
      await resolver.resolve("Steve");

      // Second call should use cache
      await resolver.resolve("Steve");

      // Database should only be queried once
      expect(mockDriver.session).toHaveBeenCalledTimes(1);
    });

    it("should cache null results", async () => {
      const mockDriver = createMockDriver([]);
      const resolver = new EntityResolver(mockDriver as unknown as Neo4jDriver);

      // First call hits database
      await resolver.resolve("Unknown");

      // Second call should use cache
      await resolver.resolve("Unknown");

      // Database should only be queried once
      expect(mockDriver.session).toHaveBeenCalledTimes(1);
    });

    it("should clear cache", async () => {
      const mockDriver = createMockDriver([
        {
          get: (key: string) => {
            const values: Record<string, any> = {
              name: "Steve",
              type: "Person",
              aliases: null,
            };
            return values[key];
          },
        },
      ]);

      const resolver = new EntityResolver(mockDriver as unknown as Neo4jDriver);

      await resolver.resolve("Steve");
      resolver.clearCache();
      await resolver.resolve("Steve");

      // Database should be queried twice after cache clear
      expect(mockDriver.session).toHaveBeenCalledTimes(2);
    });
  });

  describe("type guard", () => {
    it("should identify resolved entities", () => {
      const resolved = {
        name: "User",
        type: "Person",
        aliases: ["me"],
        confidence: 0.95,
        method: "pronoun" as const,
        originalQuery: "me",
      };

      expect(isResolved(resolved)).toBe(true);
      expect(isResolved(null)).toBe(false);
    });
  });

  describe("factory function", () => {
    it("should create resolver instance", () => {
      const driver = createMockDriver() as unknown as Neo4jDriver;
      const resolver = createEntityResolver(driver);

      expect(resolver).toBeInstanceOf(EntityResolver);
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", async () => {
      const resolver = new EntityResolver(createMockDriver() as unknown as Neo4jDriver);
      const result = await resolver.resolve("");

      expect(result).toBeNull();
    });

    it("should handle whitespace", async () => {
      const mockDriver = createMockDriver([
        {
          get: (key: string) => {
            const values: Record<string, any> = {
              name: "Steve",
              type: "Person",
              aliases: null,
            };
            return values[key];
          },
        },
      ]);

      const resolver = new EntityResolver(mockDriver as unknown as Neo4jDriver);
      const result = await resolver.resolve("  me  "); // with whitespace

      // Should still resolve as pronoun
      expect(result).not.toBeNull();
    });

    it("should handle database errors gracefully", async () => {
      const mockDriver = {
        session: vi.fn().mockReturnValue({
          run: vi.fn().mockRejectedValue(new Error("Database connection failed")),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      };

      const resolver = new EntityResolver(mockDriver as unknown as Neo4jDriver);

      // Should return null, not throw
      const result = await resolver.resolve("Steve");
      expect(result).toBeNull();
    });
  });
});
