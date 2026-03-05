/**
 * Immediate Extraction Service
 *
 * Event-driven memory extraction triggered by message_sent hook.
 * Replaces cron-based batch extraction with immediate per-session processing.
 */

import type { AgentOrchestrator } from "../agents/AgentOrchestrator.js";
import type { SessionFileFetcher } from "../cron/SessionFileFetcher.js";
import type { EncryptionService } from "../encryption/EncryptionService.js";
import type { KnowledgeGraphIntegration } from "../graph/KnowledgeGraphIntegration.js";
import type { SmartExtractionService } from "../integration/SmartExtractionService.js";
import type { Logger } from "../types.js";

export interface ImmediateExtractionConfig {
  /** Debounce time in ms (wait for conversation pause) */
  debounceMs: number;
  /** Maximum time to wait for debounce */
  maxDebounceMs: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface ImmediateExtractionDependencies {
  agentOrchestrator: AgentOrchestrator;
  sessionFileFetcher: SessionFileFetcher;
  knowledgeGraphIntegration?: KnowledgeGraphIntegration;
  encryptionService?: EncryptionService;
  smartExtraction?: SmartExtractionService;
  log: Logger;
}

/**
 * Immediate extraction service - processes sessions on message_sent hook
 */
export class ImmediateExtractionService {
  private config: ImmediateExtractionConfig;
  private deps: ImmediateExtractionDependencies;
  private processingSessions = new Set<string>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private debounceStartTimes = new Map<string, number>();

  constructor(config: ImmediateExtractionConfig, deps: ImmediateExtractionDependencies) {
    this.config = {
      debounceMs: 2000, // 2 second default debounce
      maxDebounceMs: 10000, // 10 second max wait
      debug: false,
      ...config,
    };
    this.deps = deps;
  }

  /**
   * Trigger extraction for a session (called from message_sent hook)
   * Uses debouncing to avoid extracting mid-conversation
   */
  async triggerExtraction(params: {
    sessionKey: string;
    sessionId?: string;
    messageId?: string;
  }): Promise<void> {
    const { sessionKey } = params;

    // Clear existing debounce timer for this session
    const existingTimer = this.debounceTimers.get(sessionKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(sessionKey);
    }

    // Check if we've been debouncing too long (maxDebounceMs)
    const debounceStart = this.debounceStartTimes.get(sessionKey);
    if (debounceStart && Date.now() - debounceStart > this.config.maxDebounceMs) {
      // Force extraction after max wait time
      this.deps.log.info("[ImmediateExtraction] Max debounce reached, forcing extraction", {
        sessionKey,
        waitedMs: Date.now() - debounceStart,
      });
      this.debounceStartTimes.delete(sessionKey);
      await this.processSession(sessionKey);
      return;
    }

    // Start debounce timer if not already started
    if (!debounceStart) {
      this.debounceStartTimes.set(sessionKey, Date.now());
    }

    // Set new debounce timer
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(sessionKey);
      this.debounceStartTimes.delete(sessionKey);
      await this.processSession(sessionKey);
    }, this.config.debounceMs);

    this.debounceTimers.set(sessionKey, timer);

    if (this.config.debug) {
      this.deps.log.debug("[ImmediateExtraction] Debounce started", {
        sessionKey,
        debounceMs: this.config.debounceMs,
      });
    }
  }

  /**
   * Process a session immediately (after debounce)
   */
  private async processSession(sessionKey: string): Promise<void> {
    // Prevent concurrent processing of same session
    if (this.processingSessions.has(sessionKey)) {
      this.deps.log.debug("[ImmediateExtraction] Already processing, skipping", { sessionKey });
      return;
    }

    this.processingSessions.add(sessionKey);
    const pipelineStartTime = Date.now();

    try {
      this.deps.log.info("[EXTRACTION_DEBUG] ========== EXTRACTION PIPELINE START ==========");
      this.deps.log.info("[EXTRACTION_DEBUG] Session:", {
        sessionKey,
        startTime: new Date().toISOString(),
      });

      // DEBUG: Check dependencies
      this.deps.log.info("[EXTRACTION_DEBUG] Checking dependencies...");
      this.deps.log.info("[EXTRACTION_DEBUG] sessionFileFetcher:", {
        exists: !!this.deps.sessionFileFetcher,
        type: typeof this.deps.sessionFileFetcher,
        hasFetchMethod: !!this.deps.sessionFileFetcher?.fetchSessionMessages,
      });
      this.deps.log.info("[EXTRACTION_DEBUG] agentOrchestrator:", {
        exists: !!this.deps.agentOrchestrator,
        type: typeof this.deps.agentOrchestrator,
        hasRunPipeline: !!this.deps.agentOrchestrator?.runPipeline,
      });
      this.deps.log.info("[EXTRACTION_DEBUG] smartExtraction:", {
        exists: !!this.deps.smartExtraction,
        type: typeof this.deps.smartExtraction,
      });

      // STAGE 1: Fetch messages from session file
      this.deps.log.info("[EXTRACTION_DEBUG] Stage 1: Fetching messages from session file...");

      if (!this.deps.sessionFileFetcher) {
        throw new Error("sessionFileFetcher dependency is undefined");
      }

      const fetchStartTime = Date.now();
      let messages: Message[] = [];

      try {
        messages = await this.deps.sessionFileFetcher.fetchSessionMessages(sessionKey);
      } catch (fetchError) {
        this.deps.log.error("[EXTRACTION_DEBUG] Stage 1 FETCH ERROR:", {
          errorType: typeof fetchError,
          errorName: fetchError instanceof Error ? fetchError.name : "N/A",
          errorMessage: fetchError instanceof Error ? fetchError.message : String(fetchError),
          errorStack: fetchError instanceof Error ? fetchError.stack : "No stack",
          stringified: JSON.stringify(fetchError, Object.getOwnPropertyNames(fetchError)),
        });
        throw fetchError;
      }

      const fetchDuration = Date.now() - fetchStartTime;

      this.deps.log.info("[EXTRACTION_DEBUG] Stage 1 Complete:", {
        messageCount: messages.length,
        durationMs: fetchDuration,
        sampleMessage: messages[0]
          ? {
              role: messages[0].role,
              contentPreview: messages[0].content?.substring(0, 100),
            }
          : null,
      });

      if (messages.length === 0) {
        this.deps.log.warn("[EXTRACTION_DEBUG] Stage 1: NO MESSAGES FOUND - aborting extraction", {
          sessionKey,
          possibleCauses: [
            "Session file doesn't exist",
            "Session file is empty",
            "Session file path incorrect",
            "File permissions issue",
          ],
        });
        return;
      }

      // STAGE 2: Process through agent orchestrator pipeline
      this.deps.log.info("[EXTRACTION_DEBUG] Stage 2: Running agent orchestrator pipeline...");
      const pipelineInput = {
        messages,
        mode: "extraction" as const,
        correlationId: `immediate-${Date.now()}`,
      };

      this.deps.log.info("[EXTRACTION_DEBUG] Stage 2 Input:", {
        messageCount: pipelineInput.messages.length,
        mode: pipelineInput.mode,
        correlationId: pipelineInput.correlationId,
      });

      const orchestratorStartTime = Date.now();
      const result = await this.deps.agentOrchestrator.runPipeline(pipelineInput);
      const orchestratorDuration = Date.now() - orchestratorStartTime;

      this.deps.log.info("[EXTRACTION_DEBUG] Stage 2 Complete:", {
        success: result.success,
        durationMs: orchestratorDuration,
        memoriesCount: result.memories?.length || 0,
        entitiesCount: result.entities?.length || 0,
        error: result.error || null,
      });

      // STAGE 3: Store extracted memories
      let storedCount = 0;
      if (result.success && result.memories && result.memories.length > 0) {
        this.deps.log.info("[EXTRACTION_DEBUG] Stage 3: Storing extracted memories...");

        if (this.deps.smartExtraction) {
          try {
            for (const memory of result.memories) {
              await this.deps.smartExtraction.storeMemory(memory);
              storedCount++;
            }
            this.deps.log.info("[EXTRACTION_DEBUG] Stage 3 Complete:", {
              storedCount,
              totalExtracted: result.memories.length,
            });
          } catch (storeError) {
            this.deps.log.error("[EXTRACTION_DEBUG] Stage 3 Failed:", storeError as Error);
          }
        } else {
          this.deps.log.warn(
            "[EXTRACTION_DEBUG] Stage 3: SmartExtraction not available, skipping storage",
          );
        }
      }

      // STAGE 4: Log detailed results
      const totalDuration = Date.now() - pipelineStartTime;

      if (result.success) {
        if (result.memories && result.memories.length > 0) {
          this.deps.log.info("[EXTRACTION_DEBUG] ========== EXTRACTION SUCCESS ==========");
          this.deps.log.info("[EXTRACTION_DEBUG] Results:", {
            sessionKey,
            memoriesExtracted: result.memories.length,
            entitiesExtracted: result.entities?.length || 0,
            stages: {
              fetch: { durationMs: fetchDuration, messages: messages.length },
              orchestrator: { durationMs: orchestratorDuration },
              storage: { storedCount },
              total: { durationMs: totalDuration },
            },
            sampleMemory: {
              id: result.memories[0]?.memoryId,
              category: result.memories[0]?.category,
              contentPreview: result.memories[0]?.content?.substring(0, 100),
            },
          });
        } else {
          this.deps.log.warn("[EXTRACTION_DEBUG] ========== EXTRACTION WARNING ==========");
          this.deps.log.warn("[EXTRACTION_DEBUG] Pipeline succeeded but ZERO memories extracted", {
            sessionKey,
            possibleCauses: [
              "LLM returned no memories",
              "All memories filtered by deduplication",
              "Entity extraction failed",
              "Memory categorization rejected all",
            ],
            messagesProcessed: messages.length,
            durationMs: totalDuration,
          });
        }
      } else {
        this.deps.log.error("[EXTRACTION_DEBUG] ========== EXTRACTION FAILURE ==========");
        this.deps.log.error("[EXTRACTION_DEBUG] Pipeline failed:", {
          sessionKey,
          error: result.error,
          errorStack: result.error ? new Error(result.error).stack : null,
          stages: {
            fetch: { durationMs: fetchDuration, success: messages.length > 0 },
            orchestrator: { durationMs: orchestratorDuration, success: false },
          },
        });
      }

      this.deps.log.info("[EXTRACTION_DEBUG] ========== EXTRACTION PIPELINE END ==========");
    } catch (error) {
      this.deps.log.error("[EXTRACTION_DEBUG] ========== EXTRACTION CRASH ==========");

      // Comprehensive error logging
      const errorDetails = {
        sessionKey,
        errorType: typeof error,
        errorName: error instanceof Error ? error.name : "N/A",
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : "No stack",
        errorConstructor: error?.constructor?.name || "N/A",
        stringified:
          typeof error === "object"
            ? JSON.stringify(error, Object.getOwnPropertyNames(error))
            : String(error),
        isNull: error === null,
        isUndefined: error === undefined,
      };

      this.deps.log.error("[EXTRACTION_DEBUG] Unhandled exception:", errorDetails);

      // Also log to console as fallback
      console.error("[EXTRACTION_CRASH]", errorDetails);
    } finally {
      this.processingSessions.delete(sessionKey);
    }
  }

  /**
   * Force immediate extraction (for shutdown or manual trigger)
   */
  async forceExtraction(sessionKey: string): Promise<void> {
    // Clear any pending debounce
    const timer = this.debounceTimers.get(sessionKey);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(sessionKey);
      this.debounceStartTimes.delete(sessionKey);
    }

    await this.processSession(sessionKey);
  }

  /**
   * Flush all pending extractions (call on shutdown)
   */
  async flushAll(): Promise<void> {
    this.deps.log.info("[ImmediateExtraction] Flushing all pending extractions");

    const pendingSessions = Array.from(this.debounceTimers.keys());

    // Clear all timers
    for (const [sessionKey, timer] of this.debounceTimers) {
      clearTimeout(timer);
      this.debounceTimers.delete(sessionKey);
      this.debounceStartTimes.delete(sessionKey);
    }

    // Process all pending sessions
    await Promise.all(pendingSessions.map((sessionKey) => this.processSession(sessionKey)));
  }

  /**
   * Get current status
   */
  getStatus(): {
    processingSessions: string[];
    pendingSessions: string[];
    debounceMs: number;
  } {
    return {
      processingSessions: Array.from(this.processingSessions),
      pendingSessions: Array.from(this.debounceTimers.keys()),
      debounceMs: this.config.debounceMs,
    };
  }
}

/**
 * Create immediate extraction service instance
 */
export function createImmediateExtractionService(
  config: ImmediateExtractionConfig,
  deps: ImmediateExtractionDependencies,
): ImmediateExtractionService {
  return new ImmediateExtractionService(config, deps);
}
