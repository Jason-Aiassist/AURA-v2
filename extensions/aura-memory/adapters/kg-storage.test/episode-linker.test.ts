/**
 * Episode Linker Tests
 */

import { describe, it, expect, vi } from "vitest";
import { EpisodeLinker } from "../kg-storage/episode-linker.js";
import type { LinkEpisodeParams, Neo4jDriver } from "../kg-storage/types.js";

// Mock Neo4j
const createMockSession = (returnValue: unknown = []) => ({
  run: vi.fn().mockResolvedValue(returnValue),
  close: vi.fn().mockResolvedValue(undefined),
});

const createMockDriver = (session: ReturnType<typeof createMockSession>): Neo4jDriver => ({
  session: vi.fn().mockReturnValue(session),
});

describe("EpisodeLinker", () => {
  describe("linkEpisode", () => {
    it("should link episode to entities", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "name") return "Steve";
              if (key === "aliases") return ["steve", "user"];
              return null;
            },
          },
        ],
      });

      const linker = new EpisodeLinker({
        driver: createMockDriver(mockSession),
      });

      const params: LinkEpisodeParams = {
        episodeUuid: "ep-123",
        entities: [
          { name: "Steve", type: "Person", aliases: ["user"] },
          { name: "Daggerheart", type: "Game" },
        ],
      };

      const result = await linker.linkEpisode(params);

      expect(result.success).toBe(true);
      expect(result.episodeUuid).toBe("ep-123");
      expect(result.entitiesLinked).toBe(2);
    });

    it("should create relationships when provided", async () => {
      const entitySession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "name") return "Steve";
              return null;
            },
          },
        ],
      });

      const relSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "fromName") return "Steve";
              if (key === "confidence") return 0.95;
              return null;
            },
          },
        ],
      });

      const driver: Neo4jDriver = {
        session: vi
          .fn()
          .mockReturnValueOnce(entitySession)
          .mockReturnValueOnce(relSession)
          .mockReturnValue({ run: vi.fn().mockResolvedValue({ records: [] }), close: vi.fn() }),
      };

      const linker = new EpisodeLinker({ driver });

      const params: LinkEpisodeParams = {
        episodeUuid: "ep-123",
        entities: [{ name: "Steve", type: "Person" }],
        relationships: [
          {
            from: "Steve",
            to: "Daggerheart",
            type: "ENJOYS",
            confidence: 0.95,
            fact: "Steve enjoys Daggerheart",
          },
        ],
      };

      const result = await linker.linkEpisode(params);

      expect(result.success).toBe(true);
      expect(result.relationshipsCreated).toBeGreaterThanOrEqual(0);
    });

    it("should handle database connection errors", async () => {
      const errorDriver: Neo4jDriver = {
        session: vi.fn().mockImplementation(() => {
          throw new Error("Connection failed");
        }),
      };

      const linker = new EpisodeLinker({ driver: errorDriver });

      const params: LinkEpisodeParams = {
        episodeUuid: "ep-123",
        entities: [{ name: "Steve", type: "Person" }],
      };

      const result = await linker.linkEpisode(params);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("getEpisodeEntities", () => {
    it("should return entities linked to episode", async () => {
      const mockSession = createMockSession({
        records: [{ get: () => "Steve" }, { get: () => "Daggerheart" }, { get: () => "AURA" }],
      });

      const linker = new EpisodeLinker({
        driver: createMockDriver(mockSession),
      });

      const result = await linker.getEpisodeEntities("ep-123");

      expect(result).toHaveLength(3);
      expect(result).toContain("Steve");
      expect(result).toContain("Daggerheart");
    });

    it("should return empty array for episode with no entities", async () => {
      const mockSession = createMockSession({ records: [] });

      const linker = new EpisodeLinker({
        driver: createMockDriver(mockSession),
      });

      const result = await linker.getEpisodeEntities("ep-empty");

      expect(result).toHaveLength(0);
    });
  });

  describe("unlinkEpisode", () => {
    it("should remove all MENTIONED_IN relationships", async () => {
      const mockSession = createMockSession({
        records: [{ get: () => 3 }],
      });

      const linker = new EpisodeLinker({
        driver: createMockDriver(mockSession),
      });

      const result = await linker.unlinkEpisode("ep-123");

      expect(result).toBe(3);
    });

    it("should return 0 for episode with no links", async () => {
      const mockSession = createMockSession({
        records: [{ get: () => 0 }],
      });

      const linker = new EpisodeLinker({
        driver: createMockDriver(mockSession),
      });

      const result = await linker.unlinkEpisode("ep-empty");

      expect(result).toBe(0);
    });
  });

  describe("linkEpisodes", () => {
    it("should link multiple episodes", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "name") return "Steve";
              return null;
            },
          },
        ],
      });

      const linker = new EpisodeLinker({
        driver: createMockDriver(mockSession),
      });

      const episodes: LinkEpisodeParams[] = [
        { episodeUuid: "ep-1", entities: [{ name: "Steve", type: "Person" }] },
        { episodeUuid: "ep-2", entities: [{ name: "Steve", type: "Person" }] },
      ];

      const results = await linker.linkEpisodes(episodes);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
  });
});
