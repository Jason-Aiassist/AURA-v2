/**
 * RecallDetectionService Tests
 *
 * Tests for detecting and preventing feedback loops where agent responses
 * containing injected memories get extracted as "new" memories.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  RecallDetectionService,
  createRecallDetectionService,
  type RecallDetectionConfig,
} from "../RecallDetectionService.js";

describe("RecallDetectionService", () => {
  let service: RecallDetectionService;
  const mockLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    service = createRecallDetectionService({}, mockLog);
    mockLog.debug.mockClear();
    mockLog.info.mockClear();
  });

  describe("recordContextInjection", () => {
    it("should record injected memories for a session", () => {
      const sessionId = "session-123";
      const memories = [
        { memoryId: "mem-1", content: "Steve likes hiking" },
        { memoryId: "mem-2", content: "Steve works on AURA" },
      ];
      const entities = ["Steve", "AURA"];

      service.recordContextInjection(sessionId, memories, entities);

      const stats = service.getStats();
      expect(stats.totalInjections).toBe(1);
      expect(stats.historySize).toBe(1);
    });

    it("should overwrite previous injection for same session", () => {
      const sessionId = "session-123";

      service.recordContextInjection(sessionId, [{ content: "First" }], []);
      service.recordContextInjection(sessionId, [{ content: "Second" }], []);

      const stats = service.getStats();
      expect(stats.totalInjections).toBe(2);
      expect(stats.historySize).toBe(1); // Still 1 session
    });
  });

  describe("isRecallResponse", () => {
    it("should return false for non-assistant messages", () => {
      const result = service.isRecallResponse("Some content", "session-123", "user");

      expect(result.isRecall).toBe(false);
      expect(result.reason).toBe("Not an assistant message");
    });

    it("should return false when no injection recorded", () => {
      const result = service.isRecallResponse("Some content", "session-123", "assistant");

      expect(result.isRecall).toBe(false);
      expect(result.reason).toBe("No context injection recorded for this session");
    });

    it("should detect high similarity recall responses", () => {
      const sessionId = "session-123";
      const injectedContent = "Steve likes hiking and TTRPGs. He is working on the AURA project.";

      service.recordContextInjection(
        sessionId,
        [{ memoryId: "mem-1", content: injectedContent }],
        ["Steve", "AURA"],
      );

      // Agent response containing mostly the same content
      const agentResponse =
        "Based on my memory, Steve likes hiking and TTRPGs. He is working on the AURA project.";

      const result = service.isRecallResponse(agentResponse, sessionId, "assistant");

      expect(result.isRecall).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.75);
      expect(result.reason).toContain("highly similar");
    });

    it("should allow novel content in assistant responses", () => {
      const sessionId = "session-123";
      const injectedContent = "Steve likes hiking";

      service.recordContextInjection(
        sessionId,
        [{ memoryId: "mem-1", content: injectedContent }],
        ["Steve"],
      );

      // Agent response with new analysis
      const agentResponse =
        "Based on what you mentioned about hiking, have you considered trying trail running? It offers similar benefits with more intensity.";

      const result = service.isRecallResponse(agentResponse, sessionId, "assistant");

      expect(result.isRecall).toBe(false);
      expect(result.novelContentRatio).toBeGreaterThan(0.3);
    });

    it("should expire old injections after context window", () => {
      const sessionId = "session-123";

      // Record injection
      service.recordContextInjection(
        sessionId,
        [{ memoryId: "mem-1", content: "Steve likes hiking" }],
        ["Steve"],
      );

      // Fast forward time by 6 minutes (past 5 minute window)
      vi.advanceTimersByTime(6 * 60 * 1000);

      const result = service.isRecallResponse("Steve likes hiking", sessionId, "assistant");

      expect(result.isRecall).toBe(false);
      expect(result.reason).toBe("Context injection too old (>5 min)");
    });
  });

  describe("shouldSkipExtraction", () => {
    it("should return true for recall responses", () => {
      const sessionId = "session-123";

      service.recordContextInjection(
        sessionId,
        [{ memoryId: "mem-1", content: "Steve works on AURA with multi-tier memory" }],
        ["Steve", "AURA"],
      );

      const shouldSkip = service.shouldSkipExtraction(
        "Steve works on AURA with multi-tier memory system using SQLite and Neo4j.",
        sessionId,
        "assistant",
      );

      expect(shouldSkip).toBe(true);
    });

    it("should return false for novel content", () => {
      const sessionId = "session-123";

      service.recordContextInjection(
        sessionId,
        [{ memoryId: "mem-1", content: "Steve likes hiking" }],
        ["Steve"],
      );

      const shouldSkip = service.shouldSkipExtraction(
        "That is interesting! When did you start hiking?",
        sessionId,
        "assistant",
      );

      expect(shouldSkip).toBe(false);
    });
  });

  describe("calculateContentOverlap", () => {
    it("should detect exact sentence matches", () => {
      const sessionId = "session-123";

      service.recordContextInjection(
        sessionId,
        [{ memoryId: "mem-1", content: "Steve is debugging the hook system." }],
        ["Steve"],
      );

      const result = service.isRecallResponse(
        "Steve is debugging the hook system.",
        sessionId,
        "assistant",
      );

      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it("should handle partial matches", () => {
      const sessionId = "session-123";

      service.recordContextInjection(
        sessionId,
        [
          {
            memoryId: "mem-1",
            content: "Steve works on AURA with SQLite and Neo4j for multi-tier memory management.",
          },
        ],
        ["Steve", "AURA"],
      );

      const result = service.isRecallResponse(
        "Steve works on AURA with SQLite and Neo4j.",
        sessionId,
        "assistant",
      );

      // Should have high similarity but not 100%
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.confidence).toBeLessThan(1.0);
    });

    it("should be case insensitive", () => {
      const sessionId = "session-123";

      service.recordContextInjection(
        sessionId,
        [{ memoryId: "mem-1", content: "Steve LIKES HIKING" }],
        ["Steve"],
      );

      const result = service.isRecallResponse("steve likes hiking", sessionId, "assistant");

      expect(result.confidence).toBeGreaterThan(0.8);
    });
  });

  describe("integration with feedback loop prevention", () => {
    it("should prevent the classic feedback loop scenario", () => {
      const sessionId = "agent-main-session";

      // 1. Context is injected with memories
      const injectedMemories = [
        {
          memoryId: "mem-1",
          content:
            "Steve project AURA involves enhanced OpenClaw deployment with multi-tier memory management using SQLite and Neo4j.",
        },
        {
          memoryId: "mem-2",
          content: "Steve is debugging the AURA memory extension before_prompt_build hook.",
        },
      ];

      service.recordContextInjection(sessionId, injectedMemories, ["Steve", "AURA"]);

      // 2. Agent responds recalling the memories
      const agentResponse = `Based on my knowledge, Steve's project AURA involves enhanced OpenClaw deployment with multi-tier memory management using SQLite and Neo4j. Steve is debugging the AURA memory extension before_prompt_build hook.`;

      // 3. Check if this should be skipped
      const shouldSkip = service.shouldSkipExtraction(agentResponse, sessionId, "assistant");

      expect(shouldSkip).toBe(true);

      // 4. Verify the reason
      const result = service.isRecallResponse(agentResponse, sessionId, "assistant");
      expect(result.reason).toContain("similar");
      expect(result.confidence).toBeGreaterThan(0.75);
    });

    it("should allow genuinely new assistant insights", () => {
      const sessionId = "agent-main-session";

      service.recordContextInjection(
        sessionId,
        [{ memoryId: "mem-1", content: "Steve likes hiking" }],
        ["Steve"],
      );

      // Assistant provides new analysis, not just recall
      const assistantInsight = `Since you enjoy hiking, you might appreciate that studies show 30 minutes of hiking can reduce cortisol levels by 15%. The combination of physical activity and nature exposure has synergistic benefits for stress reduction.`;

      const shouldSkip = service.shouldSkipExtraction(assistantInsight, sessionId, "assistant");

      expect(shouldSkip).toBe(false);
    });
  });
});

describe("createRecallDetectionService", () => {
  it("should create service with default config", () => {
    const service = createRecallDetectionService();
    expect(service).toBeInstanceOf(RecallDetectionService);
  });

  it("should create service with custom config", () => {
    const config: Partial<RecallDetectionConfig> = {
      similarityThreshold: 0.9,
      minNovelContentRatio: 0.5,
      contextWindowMs: 10 * 60 * 1000, // 10 minutes
    };

    const service = createRecallDetectionService(config);
    expect(service).toBeInstanceOf(RecallDetectionService);
  });
});
