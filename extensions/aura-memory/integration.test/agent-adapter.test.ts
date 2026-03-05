/**
 * Agent Adapter Tests
 */

import { describe, it, expect, vi } from "vitest";
import { AgentOrchestratorAdapter, hasSemanticData } from "../integration/agent-adapter.js";
import { SemanticExtractionBridge } from "../integration/bridge.js";
import type { BridgeDependencies } from "../integration/types.js";

// Mock bridge
const createMockBridge = (
  enabled: boolean,
  result?: { success: boolean; entities: any[]; relationships: any[] },
) => ({
  process: vi.fn().mockResolvedValue(
    result || {
      success: true,
      entities: [{ name: "Steve", type: "Person", confidence: 0.95 }],
      relationships: [{ from: "Steve", to: "A", type: "ENJOYS", confidence: 0.9 }],
      storage: { relationshipsStored: 1, entitiesUpdated: 1, failures: 0 },
      metrics: { extractionMs: 100, storageMs: 50, tokensUsed: 200 },
    },
  ),
  isEnabled: () => enabled,
  getConfig: () => ({
    enabled,
    minConfidence: 0.7,
    maxEntities: 20,
    maxRelationships: 30,
    debug: false,
  }),
});

describe("AgentOrchestratorAdapter", () => {
  describe("runSemanticStep", () => {
    it("should process messages and return extended result", async () => {
      const mockBridge = createMockBridge(true) as unknown as SemanticExtractionBridge;
      const adapter = new AgentOrchestratorAdapter(mockBridge);

      const result = await adapter.runSemanticStep(
        {
          messages: [
            {
              id: "1",
              role: "user" as const,
              content: "Steve enjoys Daggerheart",
              timestamp: Date.now(),
            },
          ],
          correlationId: "test-123",
        },
        [
          {
            id: "mem-1",
            content: "Steve enjoys Daggerheart",
            category: "User",
            confidence: 0.9,
            importance: 0.8,
            sourceMessageIds: ["1"],
          },
        ],
      );

      expect(result.success).toBe(true);
      expect(result.memories).toHaveLength(1);
      expect(result.semanticEntities).toHaveLength(1);
      expect(result.semanticRelationships).toHaveLength(1);
      expect(mockBridge.process).toHaveBeenCalled();
    });

    it("should attach entities to memories based on source messages", async () => {
      const mockBridge = createMockBridge(true, {
        success: true,
        entities: [
          { name: "Steve", type: "Person", confidence: 0.95 },
          { name: "Daggerheart", type: "Game", confidence: 0.9 },
        ],
        relationships: [],
      }) as unknown as SemanticExtractionBridge;

      const adapter = new AgentOrchestratorAdapter(mockBridge);

      const result = await adapter.runSemanticStep(
        {
          messages: [
            {
              id: "1",
              role: "user" as const,
              content: "Steve enjoys Daggerheart",
              timestamp: Date.now(),
            },
          ],
          correlationId: "test-123",
        },
        [
          {
            id: "mem-1",
            content: "Memory content",
            category: "User",
            confidence: 0.9,
            importance: 0.8,
            sourceMessageIds: ["1"], // References message 1
          },
        ],
      );

      // Memory should have entities that appear in its source messages
      expect(result.memories[0].entities).toContain("Steve");
      expect(result.memories[0].entities).toContain("Daggerheart");
    });

    it("should skip when bridge is disabled", async () => {
      const mockBridge = createMockBridge(false) as unknown as SemanticExtractionBridge;
      const adapter = new AgentOrchestratorAdapter(mockBridge);

      const result = await adapter.runSemanticStep(
        {
          messages: [{ id: "1", role: "user" as const, content: "Test", timestamp: Date.now() }],
          correlationId: "test-123",
        },
        [
          {
            id: "mem-1",
            content: "Test",
            category: "User",
            confidence: 0.9,
            importance: 0.8,
            sourceMessageIds: ["1"],
          },
        ],
      );

      expect(result.success).toBe(true);
      expect(result.semanticEntities).toBeUndefined();
      expect(result.semanticRelationships).toBeUndefined();
      expect(mockBridge.process).not.toHaveBeenCalled();
    });

    it("should skip when bridge is null", async () => {
      const adapter = new AgentOrchestratorAdapter(null);

      const result = await adapter.runSemanticStep(
        {
          messages: [{ id: "1", role: "user" as const, content: "Test", timestamp: Date.now() }],
          correlationId: "test-123",
        },
        [
          {
            id: "mem-1",
            content: "Test",
            category: "User",
            confidence: 0.9,
            importance: 0.8,
            sourceMessageIds: ["1"],
          },
        ],
      );

      expect(result.success).toBe(true);
      expect(result.semanticEntities).toBeUndefined();
    });

    it("should handle bridge errors gracefully", async () => {
      const mockBridge = {
        process: vi.fn().mockRejectedValue(new Error("Bridge failed")),
        isEnabled: () => true,
      } as unknown as SemanticExtractionBridge;

      const adapter = new AgentOrchestratorAdapter(mockBridge);

      const result = await adapter.runSemanticStep(
        {
          messages: [{ id: "1", role: "user" as const, content: "Test", timestamp: Date.now() }],
          correlationId: "test-123",
        },
        [
          {
            id: "mem-1",
            content: "Test",
            category: "User",
            confidence: 0.9,
            importance: 0.8,
            sourceMessageIds: ["1"],
          },
        ],
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Bridge failed");
      // Should still return memories (don't break pipeline)
      expect(result.memories).toHaveLength(1);
    });

    it("should return memories on bridge failure", async () => {
      const mockBridge = {
        process: vi.fn().mockRejectedValue(new Error("Error")),
        isEnabled: () => true,
      } as unknown as SemanticExtractionBridge;

      const adapter = new AgentOrchestratorAdapter(mockBridge);

      const inputMemories = [
        {
          id: "mem-1",
          content: "Test content",
          category: "User" as const,
          confidence: 0.9,
          importance: 0.8,
          sourceMessageIds: ["1"],
        },
      ];

      const result = await adapter.runSemanticStep(
        {
          messages: [{ id: "1", role: "user" as const, content: "Test", timestamp: Date.now() }],
          correlationId: "test-123",
        },
        inputMemories,
      );

      // Memories should be preserved even on error
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].content).toBe("Test content");
    });
  });

  describe("isReady", () => {
    it("should return true when bridge is enabled", () => {
      const mockBridge = createMockBridge(true) as unknown as SemanticExtractionBridge;
      const adapter = new AgentOrchestratorAdapter(mockBridge);

      expect(adapter.isReady()).toBe(true);
    });

    it("should return false when bridge is disabled", () => {
      const mockBridge = createMockBridge(false) as unknown as SemanticExtractionBridge;
      const adapter = new AgentOrchestratorAdapter(mockBridge);

      expect(adapter.isReady()).toBe(false);
    });

    it("should return false when bridge is null", () => {
      const adapter = new AgentOrchestratorAdapter(null);

      expect(adapter.isReady()).toBe(false);
    });
  });

  describe("getBridgeConfig", () => {
    it("should return config when bridge exists", () => {
      const mockBridge = createMockBridge(true) as unknown as SemanticExtractionBridge;
      const adapter = new AgentOrchestratorAdapter(mockBridge);

      const config = adapter.getBridgeConfig();

      expect(config).not.toBeNull();
      expect(config?.enabled).toBe(true);
    });

    it("should return null when bridge is null", () => {
      const adapter = new AgentOrchestratorAdapter(null);

      const config = adapter.getBridgeConfig();

      expect(config).toBeNull();
    });
  });
});

describe("hasSemanticData", () => {
  it("should return true when entities present", () => {
    const result = {
      success: true,
      memories: [],
      semanticEntities: [{ name: "Steve", type: "Person" }],
    };

    expect(hasSemanticData(result as any)).toBe(true);
  });

  it("should return true when relationships present", () => {
    const result = {
      success: true,
      memories: [],
      semanticRelationships: [{ from: "A", to: "B", type: "ENJOYS" }],
    };

    expect(hasSemanticData(result as any)).toBe(true);
  });

  it("should return false when no semantic data", () => {
    const result = {
      success: true,
      memories: [],
    };

    expect(hasSemanticData(result as any)).toBe(false);
  });

  it("should return false when unsuccessful", () => {
    const result = {
      success: false,
      memories: [],
      semanticEntities: [{ name: "Steve" }],
    };

    expect(hasSemanticData(result as any)).toBe(false);
  });
});
