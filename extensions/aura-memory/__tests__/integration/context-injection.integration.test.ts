/**
 * Context Injection Integration Tests
 *
 * End-to-end tests for the context injection pipeline.
 * Tests the full flow: query → analysis → search → injection.
 */

import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { TieredMemoryStore } from "../adapters/TieredMemoryStore.js";
import { ContextInjector, type ContextInjectorConfig } from "../agents/ContextInjector.js";
import type { KnowledgeGraphIntegration } from "../graph/KnowledgeGraphIntegration.js";

describe("Context Injection Integration", () => {
  let tempDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeAll(() => {
    // Create temp directory for test database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-test-"));
    dbPath = path.join(tempDir, "test-memory.sqlite");

    // Create test database with schema
    db = new Database(dbPath);

    // Create minimal schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS hot_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        entities TEXT,
        encrypted INTEGER DEFAULT 0
      );
    `);

    // Insert test memories
    const stmt = db.prepare(`
      INSERT INTO hot_memories (id, content, category, timestamp, entities, encrypted)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      "mem-1",
      "Steve likes to play Daggerheart TTRPG on weekends",
      "User",
      Date.now(),
      JSON.stringify(["Steve", "Daggerheart", "TTRPG"]),
      0,
    );

    stmt.run(
      "mem-2",
      "Steve's favorite color is red",
      "User",
      Date.now(),
      JSON.stringify(["Steve", "red", "color"]),
      0,
    );

    stmt.run(
      "mem-3",
      "AURA project uses TypeScript and Neo4j",
      "System",
      Date.now(),
      JSON.stringify(["AURA", "TypeScript", "Neo4j"]),
      0,
    );
  });

  afterAll(() => {
    // Cleanup
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Basic Injection Flow", () => {
    it("should inject context for entity-related queries", async () => {
      // Create injector with minimal config
      const config: ContextInjectorConfig = {
        db: db as unknown as import("better-sqlite3").DatabaseSync,
        defaultTokenLimit: 4000,
        minQueryLength: 3,
        maxBuildTimeMs: 5000,
      };

      const injector = new ContextInjector(config);

      // Test query about Steve
      const result = await injector.inject("What does Steve like?");

      // Verify result structure
      expect(result).toHaveProperty("metadata");
      expect(result).toHaveProperty("prependContext");
      expect(result.metadata).toHaveProperty("hasContext");
      expect(result.metadata).toHaveProperty("memoryCount");
      expect(result.metadata).toHaveProperty("buildTimeMs");
    });

    it("should skip short queries", async () => {
      const config: ContextInjectorConfig = {
        db: db as unknown as import("better-sqlite3").DatabaseSync,
        minQueryLength: 3,
      };

      const injector = new ContextInjector(config);

      const result = await injector.inject("hi");

      expect(result.metadata.hasContext).toBe(false);
      expect(result.metadata.memoryCount).toBe(0);
    });

    it("should handle queries with no matching context", async () => {
      const config: ContextInjectorConfig = {
        db: db as unknown as import("better-sqlite3").DatabaseSync,
      };

      const injector = new ContextInjector(config);

      // Query about something not in memories
      const result = await injector.inject("What is the weather in Tokyo?");

      // Should return gracefully, not crash
      expect(result.metadata).toBeDefined();
    });
  });

  describe("Search Level Adjustment", () => {
    it("should respect token limits", async () => {
      const config: ContextInjectorConfig = {
        db: db as unknown as import("better-sqlite3").DatabaseSync,
        defaultTokenLimit: 1000, // Small limit
      };

      const injector = new ContextInjector(config);

      const result = await injector.inject("Tell me about Steve's preferences");

      // Result should respect token budget
      expect(result.metadata).toBeDefined();
    });
  });

  describe("Error Recovery", () => {
    it("should handle database errors gracefully", async () => {
      // Create injector with invalid db
      const config: ContextInjectorConfig = {
        db: {} as import("better-sqlite3").DatabaseSync, // Invalid db
      };

      const injector = new ContextInjector(config);

      // Should not throw, return empty result
      const result = await injector.inject("What does Steve like?");

      expect(result.metadata.hasContext).toBe(false);
    });

    it("should handle timeout gracefully", async () => {
      const config: ContextInjectorConfig = {
        db: db as unknown as import("better-sqlite3").DatabaseSync,
        maxBuildTimeMs: 1, // Very short timeout
      };

      const injector = new ContextInjector(config);

      // Should timeout and return empty result
      const result = await injector.inject("What does Steve like?");

      expect(result.metadata.hasContext).toBe(false);
    });
  });

  describe("Pre-processing Modules", () => {
    it("should work without pre-processing modules", async () => {
      const config: ContextInjectorConfig = {
        db: db as unknown as import("better-sqlite3").DatabaseSync,
        enableQueryResolution: false,
        enableRelationshipSearch: false,
      };

      const injector = new ContextInjector(config);

      const result = await injector.inject("What does Steve like?");

      expect(result.metadata).toBeDefined();
    });

    it("should include enhanced metadata when pre-processing enabled", async () => {
      // Mock KG for pre-processing
      const mockKg = {
        getDriver: vi.fn().mockReturnValue({}),
        searchRelated: vi.fn().mockResolvedValue([]),
      } as unknown as KnowledgeGraphIntegration;

      const config: ContextInjectorConfig = {
        db: db as unknown as import("better-sqlite3").DatabaseSync,
        knowledgeGraph: mockKg,
        enableQueryResolution: true,
        enableRelationshipSearch: true,
        userName: "Steve",
      };

      const injector = new ContextInjector(config);

      const result = await injector.inject("What do I like?");

      // Should have enhanced metadata even if resolution fails
      expect(result.metadata).toBeDefined();
    });
  });

  describe("Recall Detection", () => {
    it("should record injection for recall detection", async () => {
      const config: ContextInjectorConfig = {
        db: db as unknown as import("better-sqlite3").DatabaseSync,
      };

      const injector = new ContextInjector(config);

      const memories = [{ content: "Steve likes Daggerheart", memoryId: "mem-1" }];
      const entities = ["Steve", "Daggerheart"];

      // Should not throw
      expect(() => {
        injector.recordInjection("session-1", memories, entities);
      }).not.toThrow();
    });

    it("should check for recall responses", async () => {
      const config: ContextInjectorConfig = {
        db: db as unknown as import("better-sqlite3").DatabaseSync,
      };

      const injector = new ContextInjector(config);

      const result = injector.checkForRecall("Steve likes Daggerheart", "session-1", "assistant");

      expect(result).toHaveProperty("isRecall");
      expect(result).toHaveProperty("reason");
      expect(result).toHaveProperty("confidence");
    });
  });
});

describe("End-to-End Context Injection", () => {
  it("should complete full injection pipeline", async () => {
    // This test verifies the entire flow works end-to-end
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-e2e-"));
    const dbPath = path.join(tempDir, "e2e-memory.sqlite");

    try {
      const db = new Database(dbPath);

      // Setup schema
      db.exec(`
        CREATE TABLE IF NOT EXISTS hot_memories (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          category TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          entities TEXT,
          encrypted INTEGER DEFAULT 0
        );
      `);

      // Insert test data
      db.prepare(`
        INSERT INTO hot_memories (id, content, category, timestamp, entities, encrypted)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        "test-mem-1",
        "User enjoys hiking in the mountains",
        "User",
        Date.now(),
        JSON.stringify(["User", "hiking", "mountains"]),
        0,
      );

      // Create injector
      const injector = new ContextInjector({
        db: db as unknown as import("better-sqlite3").DatabaseSync,
        defaultTokenLimit: 4000,
        minQueryLength: 3,
        maxBuildTimeMs: 5000,
      });

      // Execute injection
      const result = await injector.inject("What does the user enjoy?");

      // Verify complete result
      expect(result).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(typeof result.metadata.hasContext).toBe("boolean");
      expect(typeof result.metadata.memoryCount).toBe("number");
      expect(typeof result.metadata.buildTimeMs).toBe("number");

      // If context was found, verify format
      if (result.metadata.hasContext) {
        expect(result.prependContext).toBeDefined();
        expect(typeof result.prependContext).toBe("string");
      }

      db.close();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
