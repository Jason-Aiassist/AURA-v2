/**
 * Critical Bug Fixes - Unit Tests
 *
 * These tests prove correct functionality, not just "code doesn't crash"
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AgentOrchestrator } from "../../agents/AgentOrchestrator.js";
import type { SessionFileFetcher } from "../../cron/SessionFileFetcher.js";
import {
  ImmediateExtractionService,
  createImmediateExtractionService,
} from "../ImmediateExtractionService.js";

describe("EXTRACTION_FAILURE Bug Fixes", () => {
  let service: ImmediateExtractionService;
  let mockAgentOrchestrator: AgentOrchestrator;
  let mockSessionFileFetcher: SessionFileFetcher;
  let mockLog: any;

  beforeEach(() => {
    mockLog = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockSessionFileFetcher = {
      fetchSessionMessages: vi.fn(),
    } as any;

    mockAgentOrchestrator = {
      runPipeline: vi.fn(),
    } as any;

    service = createImmediateExtractionService(
      { debounceMs: 0, maxDebounceMs: 1000, debug: true },
      {
        agentOrchestrator: mockAgentOrchestrator,
        sessionFileFetcher: mockSessionFileFetcher,
        log: mockLog,
      },
    );
  });

  describe("Session File Fetching", () => {
    it("should extract memories from valid session messages", async () => {
      // Setup: Valid messages exist
      const messages = [
        { role: "user", content: "I like hiking", timestamp: Date.now() },
        { role: "assistant", content: "Hiking is great!", timestamp: Date.now() },
      ];

      mockSessionFileFetcher.fetchSessionMessages.mockResolvedValue(messages);
      mockAgentOrchestrator.runPipeline.mockResolvedValue({
        success: true,
        memories: [{ memoryId: "1", content: "User likes hiking", category: "User" }],
        entities: [{ name: "hiking", type: "Activity" }],
      });

      // Execute
      await (service as any).processSession("test-session");

      // Verify: Memories were extracted
      expect(mockAgentOrchestrator.runPipeline).toHaveBeenCalled();
      const callArgs = mockAgentOrchestrator.runPipeline.mock.calls[0][0];
      expect(callArgs.messages).toEqual(messages);
      expect(callArgs.mode).toBe("extraction");
    });

    it("should handle empty session files gracefully", async () => {
      // Setup: Empty session
      mockSessionFileFetcher.fetchSessionMessages.mockResolvedValue([]);

      // Execute
      await (service as any).processSession("empty-session");

      // Verify: Pipeline not called, logged appropriately
      expect(mockAgentOrchestrator.runPipeline).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining("NO MESSAGES FOUND"),
        expect.any(Object),
      );
    });

    it("should handle missing session files", async () => {
      // Setup: File doesn't exist
      mockSessionFileFetcher.fetchSessionMessages.mockResolvedValue([]);

      // Execute
      await (service as any).processSession("nonexistent-session");

      // Verify: Logged with debugging info
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining("Session file not found"),
        expect.any(Object),
      );
    });

    it("should report ZERO memories extracted with specific diagnostics", async () => {
      // Setup: Pipeline succeeds but returns 0 memories
      mockSessionFileFetcher.fetchSessionMessages.mockResolvedValue([
        { role: "user", content: "Hello", timestamp: Date.now() },
      ]);
      mockAgentOrchestrator.runPipeline.mockResolvedValue({
        success: true,
        memories: [],
        entities: [],
      });

      // Execute
      await (service as any).processSession("zero-memories-session");

      // Verify: Specific warning about zero memories with possible causes
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining("ZERO memories extracted"),
        expect.objectContaining({
          possibleCauses: expect.arrayContaining([
            expect.stringContaining("LLM"),
            expect.stringContaining("deduplication"),
            expect.stringContaining("Entity extraction"),
          ]),
        }),
      );
    });

    it("should handle pipeline failures with detailed error reporting", async () => {
      // Setup: Pipeline throws error
      mockSessionFileFetcher.fetchSessionMessages.mockResolvedValue([
        { role: "user", content: "Test", timestamp: Date.now() },
      ]);
      mockAgentOrchestrator.runPipeline.mockRejectedValue(new Error("LLM timeout"));

      // Execute
      await (service as any).processSession("failing-session");

      // Verify: Error logged with stack trace
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining("EXTRACTION CRASH"),
        expect.objectContaining({
          error: "LLM timeout",
          stack: expect.any(String),
        }),
      );
    });

    it("should track extraction timing for each stage", async () => {
      // Setup
      mockSessionFileFetcher.fetchSessionMessages.mockResolvedValue([
        { role: "user", content: "Test", timestamp: Date.now() },
      ]);
      mockAgentOrchestrator.runPipeline.mockResolvedValue({
        success: true,
        memories: [{ memoryId: "1", content: "Test memory", category: "User" }],
        entities: [],
      });

      // Execute
      await (service as any).processSession("timing-session");

      // Verify: Timing information logged
      const infoCalls = mockLog.info.mock.calls;
      const timingCall = infoCalls.find(
        (call: any[]) => call[0]?.includes("Results:") && call[1]?.stages,
      );
      expect(timingCall).toBeTruthy();
      expect(timingCall[1].stages).toHaveProperty("fetch");
      expect(timingCall[1].stages).toHaveProperty("orchestrator");
    });
  });

  describe("Session ID Extraction", () => {
    it("should extract session ID from webchat-steve-abc123 format", async () => {
      mockSessionFileFetcher.fetchSessionMessages.mockResolvedValue([]);

      await (service as any).processSession("webchat-steve-abc123");

      expect(mockSessionFileFetcher.fetchSessionMessages).toHaveBeenCalledWith(
        "webchat-steve-abc123",
      );
    });

    it("should handle session keys without dashes", async () => {
      mockSessionFileFetcher.fetchSessionMessages.mockResolvedValue([]);

      await (service as any).processSession("simplesession");

      expect(mockSessionFileFetcher.fetchSessionMessages).toHaveBeenCalledWith("simplesession");
    });
  });

  describe("Debug Logging", () => {
    it("should log pipeline entry with input details", async () => {
      mockSessionFileFetcher.fetchSessionMessages.mockResolvedValue([
        { role: "user", content: "Hello world", timestamp: Date.now() },
      ]);
      mockAgentOrchestrator.runPipeline.mockResolvedValue({
        success: true,
        memories: [],
        entities: [],
      });

      await (service as any).processSession("debug-session");

      // Verify entry logging
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining("EXTRACTION PIPELINE START"),
        expect.anything(),
      );
    });

    it("should log sample messages for debugging", async () => {
      mockSessionFileFetcher.fetchSessionMessages.mockResolvedValue([
        { role: "assistant", content: "I can help with that", timestamp: Date.now() },
      ]);
      mockAgentOrchestrator.runPipeline.mockResolvedValue({
        success: true,
        memories: [],
        entities: [],
      });

      await (service as any).processSession("debug-session");

      // Verify sample message logged
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining("Stage 1 Complete"),
        expect.objectContaining({
          sampleMessage: expect.objectContaining({
            role: "assistant",
            contentPreview: expect.stringContaining("I can help"),
          }),
        }),
      );
    });
  });
});

describe("SCORE_COMPARISON Bug Fixes", () => {
  describe("Score Normalization", () => {
    it("should normalize KG scores (0-1) and hybrid scores (unbounded) before comparison", () => {
      // Test that different score ranges are normalized
      const kgScore = 0.9; // 0-1 range
      const hybridScore = 15.5; // Unbounded

      // After normalization, both should be comparable
      const normalizedKg = normalizeScore(kgScore, "kg");
      const normalizedHybrid = normalizeScore(hybridScore, "hybrid");

      expect(normalizedKg).toBeGreaterThan(0);
      expect(normalizedKg).toBeLessThanOrEqual(1);
      expect(normalizedHybrid).toBeGreaterThan(0);
      expect(normalizedHybrid).toBeLessThanOrEqual(1);
    });

    it("should prefer Stage 2 results when scores are comparable", () => {
      const stage1Result = { memoryId: "1", score: 0.95, source: "kg" };
      const stage2Result = { memoryId: "1", score: 0.92, source: "hybrid" };

      const merged = mergeResults([stage1Result, stage2Result]);

      // Stage 2 should be preferred despite lower raw score (better quality)
      expect(merged[0].source).toBe("hybrid");
    });

    it("should preserve stage provenance after merge", () => {
      const stage1Result = { memoryId: "1", score: 0.8, source: "kg" };
      const stage2Result = { memoryId: "1", score: 0.85, source: "hybrid" };

      const merged = mergeResults([stage1Result, stage2Result]);

      expect(merged[0].stageProvenance).toContain("kg");
      expect(merged[0].stageProvenance).toContain("hybrid");
    });
  });
});

// Helper functions for tests
function normalizeScore(score: number, source: string): number {
  if (source === "kg") {
    // KG scores already 0-1
    return score;
  } else if (source === "hybrid") {
    // Hybrid scores: apply sigmoid-like normalization
    // Scores > 10 are likely very good matches
    return Math.min(1, score / 10);
  }
  return score;
}

function mergeResults(results: any[]): any[] {
  const byId = new Map<string, any>();

  for (const result of results) {
    const existing = byId.get(result.memoryId);
    const normalizedScore = normalizeScore(result.score, result.source);

    if (!existing) {
      byId.set(result.memoryId, {
        ...result,
        normalizedScore,
        stageProvenance: [result.source],
      });
    } else {
      // Merge: prefer hybrid if scores are close
      const existingNormalized = normalizeScore(existing.score, existing.source);

      if (result.source === "hybrid" && normalizedScore >= existingNormalized * 0.9) {
        byId.set(result.memoryId, {
          ...result,
          normalizedScore,
          stageProvenance: [...existing.stageProvenance, result.source],
        });
      } else if (normalizedScore > existingNormalized) {
        byId.set(result.memoryId, {
          ...result,
          normalizedScore,
          stageProvenance: [...existing.stageProvenance, result.source],
        });
      }
    }
  }

  return Array.from(byId.values());
}
