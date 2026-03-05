/**
 * Relationship Store Tests
 */

import { describe, it, expect, vi } from "vitest";
import { RelationshipStore } from "../kg-storage/relationship-store.js";
import type { CreateRelationshipParams, Neo4jDriver } from "../kg-storage/types.js";

// Mock Neo4j
const createMockSession = (returnValue: unknown = []) => ({
  run: vi.fn().mockResolvedValue(returnValue),
  close: vi.fn().mockResolvedValue(undefined),
});

const createMockDriver = (session: ReturnType<typeof createMockSession>): Neo4jDriver => ({
  session: vi.fn().mockReturnValue(session),
});

describe("RelationshipStore", () => {
  describe("createRelationship", () => {
    it("should create new relationship", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "fromName") return "Steve";
              if (key === "toName") return "Daggerheart";
              if (key === "confidence") return 0.95;
              if (key === "createdAt") return "2024-01-01";
              return null;
            },
          },
        ],
      });

      const store = new RelationshipStore({
        driver: createMockDriver(mockSession),
      });

      const params: CreateRelationshipParams = {
        fromEntity: "Steve",
        toEntity: "Daggerheart",
        type: "ENJOYS",
        confidence: 0.95,
        fact: "Steve enjoys playing Daggerheart",
      };

      const result = await store.createRelationship(params);

      expect(result.success).toBe(true);
      expect(result.action).toBe("created");
      expect(result.confidence).toBe(0.95);
      expect(mockSession.run).toHaveBeenCalled();
    });

    it("should reject invalid relationship type", async () => {
      const store = new RelationshipStore({
        driver: createMockDriver(createMockSession()),
      });

      const params: CreateRelationshipParams = {
        fromEntity: "Steve",
        toEntity: "Daggerheart",
        type: "INVALID_TYPE" as any,
        confidence: 0.95,
      };

      const result = await store.createRelationship(params);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid relationship type");
    });

    it("should handle database errors", async () => {
      const mockSession = {
        run: vi.fn().mockRejectedValue(new Error("DB connection failed")),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const store = new RelationshipStore({
        driver: createMockDriver(mockSession),
      });

      const params: CreateRelationshipParams = {
        fromEntity: "Steve",
        toEntity: "Daggerheart",
        type: "ENJOYS",
        confidence: 0.95,
      };

      const result = await store.createRelationship(params);

      expect(result.success).toBe(false);
      expect(result.error).toBe("DB connection failed");
    });
  });

  describe("createRelationships", () => {
    it("should create multiple relationships", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "fromName") return "Test";
              if (key === "toName") return "Other";
              if (key === "confidence") return 0.9;
              return null;
            },
          },
        ],
      });

      const store = new RelationshipStore({
        driver: createMockDriver(mockSession),
      });

      const relationships: CreateRelationshipParams[] = [
        { fromEntity: "Steve", toEntity: "Daggerheart", type: "ENJOYS", confidence: 0.95 },
        { fromEntity: "Steve", toEntity: "AURA", type: "WORKS_ON", confidence: 0.9 },
      ];

      const results = await store.createRelationships(relationships);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
  });

  describe("getRelationship", () => {
    it("should return existing relationship", async () => {
      const mockSession = createMockSession({
        records: [
          {
            get: (key: string) => {
              if (key === "confidence") return 0.95;
              if (key === "fact") return "Evidence text";
              if (key === "createdAt") return "2024-01-01";
              return null;
            },
          },
        ],
      });

      const store = new RelationshipStore({
        driver: createMockDriver(mockSession),
      });

      const result = await store.getRelationship("Steve", "Daggerheart", "ENJOYS");

      expect(result).not.toBeNull();
      expect(result?.confidence).toBe(0.95);
      expect(result?.fact).toBe("Evidence text");
    });

    it("should return null for non-existent relationship", async () => {
      const mockSession = createMockSession({ records: [] });

      const store = new RelationshipStore({
        driver: createMockDriver(mockSession),
      });

      const result = await store.getRelationship("Unknown", "Other", "ENJOYS");

      expect(result).toBeNull();
    });
  });

  describe("deleteRelationship", () => {
    it("should delete existing relationship", async () => {
      const mockSession = createMockSession({
        records: [{ get: () => 1 }],
      });

      const store = new RelationshipStore({
        driver: createMockDriver(mockSession),
      });

      const result = await store.deleteRelationship("Steve", "Daggerheart", "ENJOYS");

      expect(result).toBe(true);
    });

    it("should return false for non-existent relationship", async () => {
      const mockSession = createMockSession({
        records: [{ get: () => 0 }],
      });

      const store = new RelationshipStore({
        driver: createMockDriver(mockSession),
      });

      const result = await store.deleteRelationship("Unknown", "Other", "ENJOYS");

      expect(result).toBe(false);
    });
  });
});
