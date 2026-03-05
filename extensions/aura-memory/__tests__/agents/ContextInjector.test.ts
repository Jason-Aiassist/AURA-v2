/**
 * ContextInjector Unit Tests
 *
 * Tests for the consolidated ContextInjector.
 * These are simpler tests that verify the core functionality.
 */

import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ContextInjector,
  createContextInjector,
  type ContextInjectorConfig,
} from "../../agents/ContextInjector.js";

describe("ContextInjector", () => {
  let tempDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
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
  });

  afterEach(() => {
    // Cleanup
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create injector with minimal config", () => {
      const injector = new ContextInjector({
        db: db as unknown as import("better-sqlite3").DatabaseSync,
      });

      expect(injector).toBeDefined();
      expect(injector.getStats()).toEqual({
        analyzerReady: true,
        builderReady: true,
        stageStats: expect.any(Object),
        preProcessingModules: {
          queryResolver: false,
          relationshipSearcher: false,
        },
      });
    });

    it("should create injector with full config", () => {
      const injector = new ContextInjector({
        db: db as unknown as import("better-sqlite3").DatabaseSync,
        defaultTokenLimit: 4000,
        minQueryLength: 3,
        maxBuildTimeMs: 1000,
        enableQueryResolution: false,
        enableRelationshipSearch: false,
        userName: "Steve",
      });

      expect(injector).toBeDefined();
    });
  });

  describe("inject", () => {
    it("should skip short queries", async () => {
      const injector = new ContextInjector({
        db: db as unknown as import("better-sqlite3").DatabaseSync,
        minQueryLength: 3,
      });

      const result = await injector.inject("hi");

      expect(result.metadata.hasContext).toBe(false);
      expect(result.metadata.memoryCount).toBe(0);
    });

    it("should skip empty queries", async () => {
      const injector = new ContextInjector({
        db: db as unknown as import("better-sqlite3").DatabaseSync,
      });

      const result = await injector.inject("");

      expect(result.metadata.hasContext).toBe(false);
      expect(result.metadata.memoryCount).toBe(0);
    });

    it("should return result structure for valid queries", async () => {
      const injector = new ContextInjector({
        db: db as unknown as import("better-sqlite3").DatabaseSync,
        defaultTokenLimit: 4000,
        minQueryLength: 3,
        maxBuildTimeMs: 5000,
      });

      const result = await injector.inject("What does Steve like?");

      // Verify result structure
      expect(result).toHaveProperty("metadata");
      expect(result.metadata).toHaveProperty("hasContext");
      expect(result.metadata).toHaveProperty("memoryCount");
      expect(result.metadata).toHaveProperty("buildTimeMs");
      expect(typeof result.metadata.hasContext).toBe("boolean");
      expect(typeof result.metadata.memoryCount).toBe("number");
      expect(typeof result.metadata.buildTimeMs).toBe("number");
    });
  });

  describe("getStats", () => {
    it("should return current stats", () => {
      const injector = new ContextInjector({
        db: db as unknown as import("better-sqlite3").DatabaseSync,
      });

      const stats = injector.getStats();

      expect(stats.analyzerReady).toBe(true);
      expect(stats.builderReady).toBe(true);
      expect(stats.preProcessingModules.queryResolver).toBe(false);
      expect(stats.preProcessingModules.relationshipSearcher).toBe(false);
    });
  });

  describe("clearCaches", () => {
    it("should clear analyzer cache without throwing", () => {
      const injector = new ContextInjector({
        db: db as unknown as import("better-sqlite3").DatabaseSync,
      });

      expect(() => injector.clearCaches()).not.toThrow();
    });
  });

  describe("recordInjection", () => {
    it("should record injection for recall detection without throwing", () => {
      const injector = new ContextInjector({
        db: db as unknown as import("better-sqlite3").DatabaseSync,
      });

      const memories = [{ content: "Steve likes Daggerheart", memoryId: "mem-1" }];
      const entities = ["Steve", "Daggerheart"];

      expect(() => {
        injector.recordInjection("session-1", memories, entities);
      }).not.toThrow();
    });
  });

  describe("checkForRecall", () => {
    it("should check if message is recall", () => {
      const injector = new ContextInjector({
        db: db as unknown as import("better-sqlite3").DatabaseSync,
      });

      const result = injector.checkForRecall("Steve likes Daggerheart", "session-1", "assistant");

      expect(result).toHaveProperty("isRecall");
      expect(result).toHaveProperty("reason");
      expect(result).toHaveProperty("confidence");
    });
  });
});

describe("createContextInjector", () => {
  it("should create injector instance", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-test-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    const db = new Database(dbPath);

    try {
      const injector = createContextInjector({
        db: db as unknown as import("better-sqlite3").DatabaseSync,
      });
      expect(injector).toBeInstanceOf(ContextInjector);
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
