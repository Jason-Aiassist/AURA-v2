/**
 * Recall Detection Service
 *
 * Detects when agent responses are just recalling information from memory
 * vs providing new research/information.
 *
 * Prevents feedback loop where:
 * 1. Context is injected (memories A, B, C)
 * 2. Agent responds recalling A, B, C
 * 3. Response gets extracted as new memories A', B', C'
 * 4. Duplicates created
 */

import type { Logger } from "../types.js";

export interface RecallDetectionConfig {
  similarityThreshold: number;
  minNovelContentRatio: number;
  checkRecentContext: boolean;
  contextWindowMs: number;
}

export interface ContextInjectionRecord {
  timestamp: number;
  sessionId: string;
  memoriesInjected: Array<{
    content: string;
    memoryId?: string;
  }>;
  entities: string[];
}

export class RecallDetectionService {
  private config: RecallDetectionConfig;
  private log?: Logger;
  private injectionHistory: Map<string, ContextInjectionRecord> = new Map();
  private recentInjections: ContextInjectionRecord[] = [];

  constructor(config?: Partial<RecallDetectionConfig>, log?: Logger) {
    this.config = {
      similarityThreshold: 0.75,
      minNovelContentRatio: 0.3,
      checkRecentContext: true,
      contextWindowMs: 5 * 60 * 1000, // 5 minutes
      ...config,
    };
    this.log = log;
  }

  /**
   * Record that context was injected for a session
   * Call this when context injection happens
   */
  recordContextInjection(
    sessionId: string,
    memories: Array<{ content: string; memoryId?: string }>,
    entities: string[],
  ): void {
    const record: ContextInjectionRecord = {
      timestamp: Date.now(),
      sessionId,
      memoriesInjected: memories,
      entities,
    };

    this.injectionHistory.set(sessionId, record);
    this.recentInjections.push(record);

    // Clean up old records
    this.cleanupOldRecords();

    this.log?.debug("[RecallDetection] Recorded context injection", {
      sessionId,
      memoriesCount: memories.length,
      entities,
    });
  }

  /**
   * Check if a message is just recalling injected context
   * Returns true if the message should be SKIPPED (is recall)
   */
  isRecallResponse(
    messageContent: string,
    sessionId: string,
    messageRole: "user" | "assistant" | "system",
  ): {
    isRecall: boolean;
    reason: string;
    confidence: number;
    novelContentRatio: number;
  } {
    // Only check assistant messages
    if (messageRole !== "assistant") {
      return {
        isRecall: false,
        reason: "Not an assistant message",
        confidence: 0,
        novelContentRatio: 1.0,
      };
    }

    // Get recent context injection for this session
    const injection = this.injectionHistory.get(sessionId);

    if (!injection) {
      return {
        isRecall: false,
        reason: "No context injection recorded for this session",
        confidence: 0,
        novelContentRatio: 1.0,
      };
    }

    // Check if injection is too old
    const ageMs = Date.now() - injection.timestamp;
    if (ageMs > this.config.contextWindowMs) {
      return {
        isRecall: false,
        reason: "Context injection too old (>5 min)",
        confidence: 0,
        novelContentRatio: 1.0,
      };
    }

    // Compare message to injected memories
    let maxSimilarity = 0;
    let totalOverlap = 0;
    let bestMatchingMemory: string | undefined;

    for (const memory of injection.memoriesInjected) {
      const similarity = this.calculateContentOverlap(messageContent, memory.content);

      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        bestMatchingMemory = memory.memoryId || memory.content.substring(0, 50);
      }

      totalOverlap += similarity;
    }

    const avgOverlap =
      injection.memoriesInjected.length > 0 ? totalOverlap / injection.memoriesInjected.length : 0;

    // Calculate novel content ratio
    const novelContentRatio = 1 - maxSimilarity;

    // Determine if this is recall
    const isRecall =
      maxSimilarity >= this.config.similarityThreshold ||
      novelContentRatio < this.config.minNovelContentRatio;

    const reason = isRecall
      ? `Response highly similar (${Math.round(maxSimilarity * 100)}%) to injected memory: ${bestMatchingMemory}`
      : `Response contains novel content (${Math.round(novelContentRatio * 100)}%)`;

    this.log?.debug("[RecallDetection] Recall check", {
      sessionId,
      isRecall,
      maxSimilarity: Math.round(maxSimilarity * 100),
      novelContentRatio: Math.round(novelContentRatio * 100),
      reason,
    });

    return {
      isRecall,
      reason,
      confidence: maxSimilarity,
      novelContentRatio,
    };
  }

  /**
   * Check if extracted content should be skipped (is recall)
   */
  shouldSkipExtraction(
    content: string,
    sessionId: string,
    source: "user" | "assistant" | "system" = "assistant",
  ): boolean {
    const result = this.isRecallResponse(content, sessionId, source);
    return result.isRecall;
  }

  /**
   * Calculate content overlap between two texts
   * Returns 0-1 similarity score
   */
  private calculateContentOverlap(a: string, b: string): number {
    // Normalize texts
    const normalize = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const normA = normalize(a);
    const normB = normalize(b);

    // Split into sentences
    const sentencesA = normA
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);
    const sentencesB = normB
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);

    if (sentencesA.length === 0 || sentencesB.length === 0) {
      return 0;
    }

    // Count matching sentences
    let matches = 0;
    for (const sentA of sentencesA) {
      for (const sentB of sentencesB) {
        if (this.sentenceSimilarity(sentA, sentB) > 0.8) {
          matches++;
          break;
        }
      }
    }

    // Jaccard-like similarity
    return matches / Math.max(sentencesA.length, sentencesB.length);
  }

  /**
   * Calculate similarity between two sentences
   */
  private sentenceSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));

    const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Clean up old injection records
   */
  private cleanupOldRecords(): void {
    const cutoff = Date.now() - this.config.contextWindowMs;

    // Clean map
    for (const [sessionId, record] of this.injectionHistory) {
      if (record.timestamp < cutoff) {
        this.injectionHistory.delete(sessionId);
      }
    }

    // Clean array
    this.recentInjections = this.recentInjections.filter((r) => r.timestamp >= cutoff);
  }

  /**
   * Get recent injection history for debugging
   */
  getRecentInjections(limit: number = 10): ContextInjectionRecord[] {
    return this.recentInjections.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  /**
   * Clear all history
   */
  clearHistory(): void {
    this.injectionHistory.clear();
    this.recentInjections = [];
  }

  /**
   * Get stats
   */
  getStats(): {
    totalInjections: number;
    recentInjections: number;
    historySize: number;
  } {
    return {
      totalInjections: this.recentInjections.length,
      recentInjections: this.recentInjections.filter(
        (r) => Date.now() - r.timestamp < this.config.contextWindowMs,
      ).length,
      historySize: this.injectionHistory.size,
    };
  }
}

// Factory function
export function createRecallDetectionService(
  config?: Partial<RecallDetectionConfig>,
  log?: Logger,
): RecallDetectionService {
  return new RecallDetectionService(config, log);
}
