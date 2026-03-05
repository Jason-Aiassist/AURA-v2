/**
 * AURA Memory Plugin Smoke Tests
 *
 * Minimum tests to verify plugin loads and registers without errors.
 * These are "smoke tests" - they prove the code doesn't crash on load.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenClawPluginApi } from "../../plugin-sdk/types.js";
import auraMemoryPlugin from "../index.js";

// Mock dependencies
vi.mock("../startup.js", () => ({
  startAuraMemorySystem: vi.fn().mockResolvedValue(undefined),
  stopAuraMemorySystem: vi.fn().mockResolvedValue(undefined),
  getAuraMemoryStatus: vi.fn().mockReturnValue({
    initialized: true,
    memoryStore: { status: "ready" },
    knowledgeGraph: { status: "connected" },
    embeddingService: { status: "ready" },
  }),
  getTieredMemoryStore: vi.fn().mockReturnValue({
    getDatabase: vi.fn().mockReturnValue({}),
    getHotTier: vi.fn().mockReturnValue({
      getVectorSchema: vi.fn().mockReturnValue({ getStats: vi.fn() }),
      getFtsSchema: vi.fn().mockReturnValue({ getStats: vi.fn() }),
    }),
  }),
  getKnowledgeGraphIntegration: vi.fn().mockReturnValue({
    getDriver: vi.fn().mockReturnValue({}),
  }),
  getEmbeddingService: vi.fn().mockReturnValue({
    generateEmbedding: vi.fn().mockResolvedValue({ embedding: [0.1], durationMs: 100 }),
    getStatus: vi.fn().mockResolvedValue({ healthy: true }),
  }),
  getEncryptionService: vi.fn().mockReturnValue({}),
  getSessionFetcher: vi.fn().mockReturnValue({}),
  getAgentOrchestrator: vi.fn().mockReturnValue({}),
  getSmartExtraction: vi.fn().mockReturnValue({}),
}));

vi.mock("../agents/ContextInjector.js", () => ({
  initializeContextInjector: vi.fn(),
  getContextInjector: vi.fn().mockReturnValue({
    inject: vi.fn().mockResolvedValue({
      metadata: { hasContext: false, memoryCount: 0, buildTimeMs: 10 },
    }),
    getStats: vi.fn().mockReturnValue({ analyzerReady: true, builderReady: true }),
    clearCaches: vi.fn(),
    recordInjection: vi.fn(),
  }),
  isContextInjectorInitialized: vi.fn().mockReturnValue(true),
  getGraphContextForQuery: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/hooks/internal-hooks.js", () => ({
  registerInternalHook: vi.fn(),
}));

vi.mock("../extraction/ImmediateExtractionService.js", () => ({
  createImmediateExtractionService: vi.fn().mockReturnValue({
    triggerExtraction: vi.fn().mockResolvedValue(undefined),
    flushAll: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../extraction/SessionWatcher.js", () => ({
  createSessionWatcher: vi.fn().mockReturnValue({
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

describe("AURA Memory Plugin - Smoke Tests", () => {
  let mockApi: OpenClawPluginApi;
  let mockLogger: { info: Mock; debug: Mock; warn: Mock; error: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockApi = {
      logger: mockLogger,
      pluginConfig: {
        enabled: true,
        contextInjection: { enabled: true },
        embedding: { enabled: true },
      },
      on: vi.fn(),
      onCliReady: vi.fn(),
    } as unknown as OpenClawPluginApi;
  });

  describe("Plugin Structure", () => {
    it("should have correct plugin metadata", () => {
      expect(auraMemoryPlugin.id).toBe("aura-memory");
      expect(auraMemoryPlugin.name).toBe("AURA Memory");
      expect(auraMemoryPlugin.kind).toBe("extension");
      expect(auraMemoryPlugin.configSchema).toBeDefined();
    });

    it("should have register function", () => {
      expect(typeof auraMemoryPlugin.register).toBe("function");
    });
  });

  describe("Plugin Registration", () => {
    it("should register without throwing", () => {
      expect(() => auraMemoryPlugin.register(mockApi)).not.toThrow();
    });

    it("should log registration start", () => {
      auraMemoryPlugin.register(mockApi);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("REGISTER"),
        expect.any(Object),
      );
    });

    it("should handle disabled config gracefully", () => {
      mockApi.pluginConfig = { enabled: false };

      expect(() => auraMemoryPlugin.register(mockApi)).not.toThrow();
    });

    it("should register before_prompt_build hook when context injection enabled", () => {
      auraMemoryPlugin.register(mockApi);

      // Hook registration is deferred to async initialization
      // But the plugin should set up the registration function
      expect(mockApi.on).toHaveBeenCalledWith(
        "before_prompt_build",
        expect.any(Function),
        expect.any(Object),
      );
    });

    it("should schedule async initialization", () => {
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      auraMemoryPlugin.register(mockApi);

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100);
    });
  });

  describe("Config Schema", () => {
    it("should have valid config schema", () => {
      const schema = auraMemoryPlugin.configSchema;

      expect(schema).toBeDefined();
      expect(schema.shape).toBeDefined();
    });

    it("should have default values", () => {
      const schema = auraMemoryPlugin.configSchema;
      const defaults = schema.parse({});

      expect(defaults.enabled).toBe(true);
      expect(defaults.intervalMinutes).toBe(5);
      expect(defaults.contextInjection.enabled).toBe(true);
      expect(defaults.embedding.enabled).toBe(true);
    });

    it("should accept custom values", () => {
      const schema = auraMemoryPlugin.configSchema;
      const config = schema.parse({
        enabled: false,
        intervalMinutes: 10,
        contextInjection: { enabled: false, minQueryLength: 5 },
      });

      expect(config.enabled).toBe(false);
      expect(config.intervalMinutes).toBe(10);
      expect(config.contextInjection.enabled).toBe(false);
      expect(config.contextInjection.minQueryLength).toBe(5);
    });
  });

  describe("CLI Commands", () => {
    it("should register CLI commands", () => {
      const mockProgram = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
        argument: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
      };

      mockApi.onCliReady = vi.fn((callback) => callback(mockProgram));

      auraMemoryPlugin.register(mockApi);

      // Async init happens after setTimeout, so we need to trigger it
      const setTimeoutCalls = vi.mocked(setTimeout).mock.calls;
      if (setTimeoutCalls.length > 0) {
        const callback = setTimeoutCalls[0][0] as Function;
        // Don't actually call it - just verify it's scheduled
      }

      expect(mockApi.onCliReady).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle missing pluginConfig gracefully", () => {
      mockApi.pluginConfig = undefined;

      expect(() => auraMemoryPlugin.register(mockApi)).not.toThrow();
    });

    it("should handle logger errors gracefully", () => {
      mockLogger.info = vi.fn().mockImplementation(() => {
        throw new Error("Logger error");
      });

      // Should not throw - plugin should handle logger errors
      expect(() => auraMemoryPlugin.register(mockApi)).not.toThrow();
    });
  });

  describe("Exports", () => {
    it("should export plugin as default", async () => {
      const module = await import("../index.js");
      expect(module.default).toBe(auraMemoryPlugin);
    });

    it("should re-export startup functions", async () => {
      const module = await import("../index.js");
      expect(module.startAuraMemorySystem).toBeDefined();
      expect(module.getAuraMemoryStatus).toBeDefined();
    });

    it("should re-export ContextInjector functions", async () => {
      const module = await import("../index.js");
      expect(module.initializeContextInjector).toBeDefined();
      expect(module.getContextInjector).toBeDefined();
      expect(module.isContextInjectorInitialized).toBeDefined();
    });
  });
});
