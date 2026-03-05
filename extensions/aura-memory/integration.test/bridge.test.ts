/**
 * Bridge Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SemanticExtractionBridge } from "../integration/bridge.js";
import { FeatureFlagProvider } from "../integration/feature-flags.js";
import type { BridgeDependencies, BridgeExtractionInput } from "../integration/types.js";

// Mock LLM
const createMockLLM = (responseContent: string) => ({
  complete: vi.fn().mockResolvedValue({
    content: responseContent,
    tokensUsed: { input: 100, output: 50 },
  }),
});

// Mock stores
const createMockRelationshipStore = () => ({
  createRelationship: vi.fn().mockResolvedValue({ success: true, action: "created" }),
});

const createMockAliasStore = () => ({
  updateAliases: vi.fn().mockResolvedValue({ success: true, isNewEntity: false }),
});

const createMockDeps = (llmResponse: string): BridgeDependencies => ({
  llm: createMockLLM(llmResponse),
  relationshipStore: createMockRelationshipStore(),
  aliasStore: createMockAliasStore(),
  now: () => Date.now(),
  generateId: () => `id-${Date.now()}`,
});

describe("SemanticExtractionBridge", () => {
  // Helper to create feature flags with specific settings
  const createFeatureFlags = (overrides: Record<string, boolean> = {}) => {
    const flags = new FeatureFlagProvider();
    // Override with test values
    Object.entries(overrides).forEach(([key, value]) => {
      flags.override(key as any, value);
    });
    return flags;
  };

  beforeEach(() => {
    // Reset environment
    delete process.env.AURA_SEMANTIC_EXTRACTION;
    delete process.env.AURA_DRY_RUN;
    delete process.env.AURA_RELATIONSHIP_STORAGE;
    delete process.env.AURA_ALIAS_UPDATES;
  });

  describe("process", () => {
    it("should extract and store semantic data when enabled", async () => {
      const mockResponse = JSON.stringify({
        entities: [
          { name: "Steve", type: "Person", confidence: 0.95 },
          { name: "Daggerheart", type: "Game", confidence: 0.9 },
        ],
        relationships: [{ from: "Steve", to: "Daggerheart", type: "ENJOYS", confidence: 0.95 }],
      });

      const deps = createMockDeps(mockResponse);
      const featureFlags = createFeatureFlags({
        semanticExtraction: true,
        relationshipStorage: true,
        aliasUpdates: true,
        dryRun: false,
      });
      const bridge = new SemanticExtractionBridge(deps, { enabled: true, featureFlags });

      const input: BridgeExtractionInput = {
        messages: [
          {
            id: "1",
            role: "user" as const,
            content: "Steve enjoys playing Daggerheart",
            timestamp: Date.now(),
          },
        ],
        memories: [
          {
            id: "mem-1",
            content: "Steve enjoys Daggerheart",
            category: "User",
            confidence: 0.9,
            importance: 0.8,
            sourceMessageIds: ["1"],
          },
        ],
        correlationId: "test-123",
      };

      const result = await bridge.process(input);

      expect(result.success).toBe(true);
      expect(result.entities).toHaveLength(2);
      expect(result.relationships).toHaveLength(1);
      expect(result.storage.relationshipsStored).toBe(1);
      expect(result.metrics.tokensUsed).toBe(150);
    });

    it("should return disabled output when feature flag off", async () => {
      const deps = createMockDeps("{}");
      const featureFlags = createFeatureFlags({
        semanticExtraction: false,
      });
      const bridge = new SemanticExtractionBridge(deps, { enabled: false, featureFlags });

      const input: BridgeExtractionInput = {
        messages: [{ id: "1", role: "user" as const, content: "Test", timestamp: Date.now() }],
        memories: [],
        correlationId: "test-123",
      };

      const result = await bridge.process(input);

      expect(result.success).toBe(true);
      expect(result.entities).toHaveLength(0);
      expect(result.relationships).toHaveLength(0);
      expect(result.metrics.extractionMs).toBe(0);
    });

    it("should handle extraction failures gracefully", async () => {
      const deps = createMockDeps("invalid json");
      deps.llm.complete = vi.fn().mockResolvedValue({
        content: "invalid json",
        tokensUsed: { input: 10, output: 5 },
      });

      const featureFlags = createFeatureFlags({
        semanticExtraction: true,
      });
      const bridge = new SemanticExtractionBridge(deps, { enabled: true, featureFlags });

      const input: BridgeExtractionInput = {
        messages: [{ id: "1", role: "user" as const, content: "Test", timestamp: Date.now() }],
        memories: [],
        correlationId: "test-123",
      };

      const result = await bridge.process(input);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.storage.failures).toBeGreaterThanOrEqual(1);
    });

    it("should filter low-confidence relationships", async () => {
      const mockResponse = JSON.stringify({
        entities: [{ name: "Steve", type: "Person", confidence: 0.9 }],
        relationships: [
          { from: "Steve", to: "A", type: "ENJOYS", confidence: 0.95 }, // High - keep
          { from: "Steve", to: "B", type: "KNOWS", confidence: 0.5 }, // Low - filter
        ],
      });

      const deps = createMockDeps(mockResponse);
      const featureFlags = createFeatureFlags({
        semanticExtraction: true,
        relationshipStorage: true,
      });
      const bridge = new SemanticExtractionBridge(deps, {
        enabled: true,
        minConfidence: 0.7,
        featureFlags,
      });

      const input: BridgeExtractionInput = {
        messages: [{ id: "1", role: "user" as const, content: "Test", timestamp: Date.now() }],
        memories: [],
        correlationId: "test-123",
      };

      const result = await bridge.process(input);

      expect(result.success).toBe(true);
      expect(result.relationships).toHaveLength(2);
      // Only high confidence should be stored
      expect(result.storage.relationshipsStored).toBe(1);
    });

    it.skip("should run in dry-run mode without storing", async () => {
      const mockResponse = JSON.stringify({
        entities: [{ name: "Steve", type: "Person", confidence: 0.9 }],
        relationships: [{ from: "Steve", to: "A", type: "ENJOYS", confidence: 0.95 }],
      });

      const deps = createMockDeps(mockResponse);
      const featureFlags = createFeatureFlags({
        semanticExtraction: true,
        relationshipStorage: true,
        aliasUpdates: true,
        dryRun: true,
      });
      const bridge = new SemanticExtractionBridge(deps, { enabled: true, featureFlags });

      const input: BridgeExtractionInput = {
        messages: [{ id: "1", role: "user" as const, content: "Test", timestamp: Date.now() }],
        memories: [],
        correlationId: "test-123",
      };

      const result = await bridge.process(input);

      expect(result.success).toBe(true);
      // In dry-run, relationships are counted but not actually stored
      expect(result.storage.relationshipsStored).toBe(1);
      expect(deps.relationshipStore.createRelationship).not.toHaveBeenCalled();
    });
  });

  describe("isEnabled", () => {
    it("should return true when enabled", () => {
      const deps = createMockDeps("{}");
      const featureFlags = createFeatureFlags({
        semanticExtraction: true,
      });
      const bridge = new SemanticExtractionBridge(deps, { enabled: true, featureFlags });

      expect(bridge.isEnabled()).toBe(true);
    });

    it("should return false when disabled", () => {
      const deps = createMockDeps("{}");
      const featureFlags = createFeatureFlags({
        semanticExtraction: false,
      });
      const bridge = new SemanticExtractionBridge(deps, { enabled: false, featureFlags });

      expect(bridge.isEnabled()).toBe(false);
    });
  });

  describe("getConfig", () => {
    it("should return current configuration", () => {
      const deps = createMockDeps("{}");
      const bridge = new SemanticExtractionBridge(deps, {
        enabled: true,
        minConfidence: 0.8,
        maxEntities: 15,
      });

      const config = bridge.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.minConfidence).toBe(0.8);
      expect(config.maxEntities).toBe(15);
    });
  });

  describe("updateConfig", () => {
    it("should update configuration", () => {
      const deps = createMockDeps("{}");
      const bridge = new SemanticExtractionBridge(deps, { enabled: true });

      bridge.updateConfig({ minConfidence: 0.9 });

      expect(bridge.getConfig().minConfidence).toBe(0.9);
    });
  });
});
