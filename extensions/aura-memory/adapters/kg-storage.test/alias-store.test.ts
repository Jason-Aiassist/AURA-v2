/**
 * Alias Store Tests
 */

import { describe, it, expect, vi } from "vitest";
import { AliasStore } from "../kg-storage/alias-store.js";
import type { Neo4jDriver } from "../kg-storage/types.js";

// Mock Neo4j
const createMockSession = (returnValue: unknown = []) => ({
  run: vi.fn().mockResolvedValue(returnValue),
  close: vi.fn().mockResolvedValue(undefined),
});

const createMockDriver = (session: ReturnType<typeof createMockSession>): Neo4jDriver => ({
  session: vi.fn().mockReturnValue(session),
});

describe("AliasStore", () => {
  describe("updateAliases", () => {
    it("should create new entity with aliases", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "name") return "Steve";
              if (key === "type") return "Person";
              if (key === "aliases") return ["steve", "user", "me", "i"];
              if (key === "createdAt") return "2024-01-01";
              return null;
            },
          },
        ],
      });

      const store = new AliasStore({
        driver: createMockDriver(mockSession),
      });

      const result = await store.updateAliases({
        entityName: "Steve",
        entityType: "Person",
        aliases: ["steve", "user", "me", "I"],
      });

      expect(result.success).toBe(true);
      expect(result.entityName).toBe("Steve");
      expect(result.aliases).toContain("steve");
      expect(result.aliases).toContain("user");
      expect(result.isNewEntity).toBe(true);
    });

    it("should update existing entity aliases", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "name") return "Steve";
              if (key === "type") return "Person";
              if (key === "aliases") return ["steve", "me", "i", "user", "myself"];
              return null;
            },
          },
        ],
      });

      const store = new AliasStore({
        driver: createMockDriver(mockSession),
      });

      const result = await store.updateAliases({
        entityName: "Steve",
        entityType: "Person",
        aliases: ["myself"],
      });

      expect(result.success).toBe(true);
      expect(result.isNewEntity).toBe(false);
    });

    it("should normalize aliases to lowercase", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "aliases") return ["steve", "me", "i"];
              return null;
            },
          },
        ],
      });

      const store = new AliasStore({
        driver: createMockDriver(mockSession),
      });

      const result = await store.updateAliases({
        entityName: "Steve",
        entityType: "Person",
        aliases: ["Steve", "ME", "I"],
      });

      expect(result.success).toBe(true);
      expect(result.aliases).toContain("steve");
      expect(result.aliases).toContain("me");
      expect(result.aliases).not.toContain("Steve");
    });

    it("should remove duplicate aliases", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "aliases") return ["steve", "user"];
              return null;
            },
          },
        ],
      });

      const store = new AliasStore({
        driver: createMockDriver(mockSession),
      });

      const result = await store.updateAliases({
        entityName: "Steve",
        entityType: "Person",
        aliases: ["steve", "steve", "user"],
      });

      expect(result.success).toBe(true);
      const uniqueAliases = [...new Set(result.aliases)];
      expect(result.aliases.length).toBe(uniqueAliases.length);
    });
  });

  describe("lookupEntity", () => {
    it("should find entity by exact name", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "name") return "Steve";
              if (key === "type") return "Person";
              if (key === "aliases") return ["steve", "user"];
              return null;
            },
          },
        ],
      });

      const store = new AliasStore({
        driver: createMockDriver(mockSession),
      });

      const result = await store.lookupEntity("Steve");

      expect(result.found).toBe(true);
      expect(result.entityName).toBe("Steve");
      expect(result.resolutionMethod).toBe("exact");
    });

    it("should find entity by alias", async () => {
      // Single session that returns different results for each query
      const mockRun = vi.fn();
      mockRun
        .mockResolvedValueOnce({ records: [] }) // Exact match: not found
        .mockResolvedValueOnce({
          // Alias lookup: found
          records: [
            {
              get: (key: string) => {
                if (key === "name") return "Steve";
                if (key === "type") return "Person";
                if (key === "aliases") return ["steve", "user", "me"];
                return null;
              },
            },
          ],
        });

      const mockSession = {
        run: mockRun,
        close: vi.fn().mockResolvedValue(undefined),
      };

      const driver: Neo4jDriver = { session: vi.fn().mockReturnValue(mockSession) };
      const store = new AliasStore({ driver });

      const result = await store.lookupEntity("me");

      expect(result.found).toBe(true);
      expect(result.entityName).toBe("Steve");
      expect(result.resolutionMethod).toBe("alias");
    });

    it("should return not found for unknown entity", async () => {
      const mockSession = createMockSession({ records: [] });

      const driver: Neo4jDriver = {
        session: vi.fn().mockReturnValue(mockSession),
      };

      const store = new AliasStore({ driver });

      const result = await store.lookupEntity("UnknownEntity");

      expect(result.found).toBe(false);
    });
  });

  describe("getAliases", () => {
    it("should return aliases for existing entity", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: () => ["steve", "user", "me", "i"],
          },
        ],
      });

      const store = new AliasStore({
        driver: createMockDriver(mockSession),
      });

      const result = await store.getAliases("Steve");

      expect(result).toEqual(["steve", "user", "me", "i"]);
    });

    it("should return null for non-existent entity", async () => {
      const mockSession = createMockSession({ records: [] });

      const store = new AliasStore({
        driver: createMockDriver(mockSession),
      });

      const result = await store.getAliases("Unknown");

      expect(result).toBeNull();
    });
  });

  describe("addUserPronounAliases", () => {
    it("should add pronoun aliases for user", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "aliases") return ["steve", "me", "i", "myself", "my", "user"];
              return null;
            },
          },
        ],
      });

      const store = new AliasStore({
        driver: createMockDriver(mockSession),
      });

      const result = await store.addUserPronounAliases("Steve");

      expect(result.success).toBe(true);
      expect(result.aliases).toContain("me");
      expect(result.aliases).toContain("i");
      expect(result.aliases).toContain("user");
    });
  });
});
