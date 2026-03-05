/**
 * Cron Orchestrator - Main scheduling and execution logic
 */

import { randomUUID } from "crypto";
import type { IMemoryStoreAdapter } from "../adapters/types.js";
import type { AgentOrchestrator } from "../agents/AgentOrchestrator.js";
import type { EncryptionService } from "../encryption/EncryptionService.js";
import type { KnowledgeGraphIntegration } from "../graph/KnowledgeGraphIntegration.js";
import type { SmartExtractionService } from "../integration/SmartExtractionService.js";
import type { IReviewQueue } from "../review/types.js";
import type {
  ICronOrchestrator,
  CronConfig,
  JobRun,
  JobStatusInfo,
  IOverlapPrevention,
  IMessageFetcher,
  IJobStateStorage,
  JobState,
  JobError,
  RoutedExtraction,
  AgentPipelineResult,
} from "./types.js";
import { DEFAULT_CRON_CONFIG } from "./types.js";

// Simple correlation ID generator
function generateCorrelationId(): string {
  return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Logger interface
interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, error?: Error, meta?: Record<string, unknown>) => void;
}

// Simple Logger implementation
class LoggerImpl implements Logger {
  info() {}
  debug() {}
  warn() {}
  error() {}
}

/**
 * Main cron orchestrator for automated memory extraction
 */
export class CronOrchestrator implements ICronOrchestrator {
  private config: CronConfig;
  private overlapPrevention: IOverlapPrevention;
  private messageFetcher: IMessageFetcher;
  private agentOrchestrator: AgentOrchestrator;
  private knowledgeGraphIntegration?: KnowledgeGraphIntegration;
  private reviewQueue: IReviewQueue;
  private memoryStore: IMemoryStoreAdapter;
  private jobStateStorage: IJobStateStorage;
  private encryptionService?: EncryptionService;
  private smartExtraction?: SmartExtractionService;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;
  private readonly logger: Logger;

  constructor(options: {
    config?: Partial<CronConfig>;
    overlapPrevention: IOverlapPrevention;
    messageFetcher: IMessageFetcher;
    agentOrchestrator: AgentOrchestrator;
    knowledgeGraphIntegration?: KnowledgeGraphIntegration;
    reviewQueue: IReviewQueue;
    memoryStore: IMemoryStoreAdapter;
    jobStateStorage: IJobStateStorage;
    encryptionService?: EncryptionService;
    smartExtraction?: SmartExtractionService;
  }) {
    this.config = { ...DEFAULT_CRON_CONFIG, ...options.config };
    this.overlapPrevention = options.overlapPrevention;
    this.messageFetcher = options.messageFetcher;
    this.agentOrchestrator = options.agentOrchestrator;
    this.knowledgeGraphIntegration = options.knowledgeGraphIntegration;
    this.reviewQueue = options.reviewQueue;
    this.memoryStore = options.memoryStore;
    this.jobStateStorage = options.jobStateStorage;
    this.encryptionService = options.encryptionService;
    this.smartExtraction = options.smartExtraction;
    this.logger = new LoggerImpl("CronOrchestrator");
  }

  /**
   * Start the cron scheduler
   */
  async start(): Promise<void> {
    // DEBUG: Cron start confirmation
    this.logger.info("[AURA Memory] ==========================================");
    this.logger.info("[AURA Memory] CRON ORCHESTRATOR START CALLED");
    this.logger.info("[AURA Memory] ==========================================");

    if (this.isRunning) {
      this.logger.warn("Cron orchestrator already running");
      return;
    }

    this.logger.info("Starting cron orchestrator", {
      intervalMinutes: this.config.intervalMinutes,
      mode: this.config.mode,
    });

    // Run immediately on start, then schedule
    this.runNow().catch((error) => {
      this.logger.error("Initial cron run failed", error as Error);
    });

    // Schedule recurring runs
    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    this.intervalId = setInterval(() => {
      this.runNow().catch((error) => {
        this.logger.error("Scheduled cron run failed", error as Error);
      });
    }, intervalMs);

    this.isRunning = true;
  }

  /**
   * Stop the cron scheduler
   */
  async stop(): Promise<void> {
    this.logger.info("Stopping cron orchestrator");

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.isRunning = false;
  }

  /**
   * Execute a single cron run immediately
   */
  async runNow(): Promise<JobRun> {
    // DEBUG: Cron run confirmation
    this.logger.info("[AURA Memory] ==========================================");
    this.logger.info("[AURA Memory] CRON RUNNOW EXECUTING");
    this.logger.info("[AURA Memory] ==========================================");

    const jobId = randomUUID();
    const correlationId = `cron-${jobId}`;
    const startedAt = Date.now();

    this.logger.info("Starting cron job run", { jobId, correlationId });

    // Try to acquire lock
    const lockAcquired = await this.overlapPrevention.acquireLock(jobId);
    if (!lockAcquired) {
      this.logger.warn("Skipping cron run - another job is already running", { jobId });
      throw new OverlapError("Another cron job is already running");
    }

    const jobRun: JobRun = {
      id: jobId,
      startedAt,
      status: "running",
      messagesProcessed: 0,
      memoriesExtracted: 0,
      errors: [],
      correlationId,
    };

    try {
      // Load state and get last run timestamp
      const state = await this.jobStateStorage.loadState();
      const sinceTimestamp = state.lastRunTimestamp;

      this.logger.info("Processing messages since", {
        correlationId,
        since: new Date(sinceTimestamp).toISOString(),
      });

      // Execute the job with timeout
      const result = await this.executeJob(jobRun, sinceTimestamp);

      // Update state on success
      await this.updateStateOnSuccess(jobId, startedAt);

      this.logger.info("Cron job completed", {
        jobId,
        status: result.status,
        messagesProcessed: result.messagesProcessed,
        memoriesExtracted: result.memoriesExtracted,
        errorCount: result.errors.length,
      });

      return result;
    } catch (error) {
      // Handle job failure
      const failedJob = await this.handleJobFailure(jobRun, error);

      // Update state on failure
      await this.updateStateOnFailure(jobId, startedAt);

      return failedJob;
    } finally {
      // Always release lock
      await this.overlapPrevention.releaseLock(jobId);
    }
  }

  /**
   * Get current cron status
   */
  async getStatus(): Promise<JobStatusInfo> {
    const state = await this.jobStateStorage.loadState();
    const lastRun = await this.jobStateStorage.getLastJobRun();
    const currentLock = await this.overlapPrevention.getCurrentLock();

    return {
      isRunning: !!currentLock,
      currentJob: currentLock ? await this.buildCurrentJobFromLock(currentLock) : undefined,
      lastRun,
      nextScheduledRun: state.nextScheduledRun,
      consecutiveFailures: state.consecutiveFailures,
    };
  }

  /**
   * Execute the main job logic
   */
  private async executeJob(jobRun: JobRun, sinceTimestamp: number): Promise<JobRun> {
    this.logger.info("[DEBUG] CronOrchestrator.executeJob() START", {
      jobId: jobRun.id,
      sinceTimestamp,
      batchSize: this.config.batchSize,
    });

    const maxDurationMs = this.config.maxDurationMinutes * 60 * 1000;
    const deadline = Date.now() + maxDurationMs;

    // Fetch and process messages in batches
    this.logger.debug("[DEBUG] Fetching message batches...", {
      sinceTimestamp,
      batchSize: this.config.batchSize,
    });
    const batchGenerator = this.messageFetcher.streamBatches(sinceTimestamp, this.config.batchSize);

    let hasPartialFailure = false;

    for await (const batch of batchGenerator) {
      // Check deadline
      if (Date.now() > deadline) {
        this.logger.warn("Cron job approaching deadline, stopping", {
          jobId: jobRun.id,
          messagesProcessed: jobRun.messagesProcessed,
        });
        jobRun.errors.push({
          phase: "execution",
          message: "Job stopped due to time limit",
          timestamp: Date.now(),
          recoverable: true,
        });
        hasPartialFailure = true;
        break;
      }

      this.logger.debug("[DEBUG] Processing batch", { batchSize: batch.length, jobId: jobRun.id });

      try {
        // Process batch through agent pipeline
        this.logger.debug("[DEBUG] Calling processBatch()...", { batchSize: batch.length });
        const batchResult = await this.processBatch(batch, jobRun.correlationId);
        this.logger.debug("[DEBUG] processBatch() returned", {
          memoriesCount: batchResult.memories.length,
          entitiesCount: batchResult.entities.length,
        });

        jobRun.messagesProcessed += batch.length;
        jobRun.memoriesExtracted += batchResult.memories.length;

        // Route memories and entities to storage
        this.logger.debug("[DEBUG] Calling routePipelineResults()...", {
          memoriesCount: batchResult.memories.length,
          entitiesCount: batchResult.entities.length,
        });
        await this.routePipelineResults(batchResult, jobRun.correlationId);
        this.logger.debug("[DEBUG] routePipelineResults() completed");
      } catch (error) {
        // Log error but continue with next batch (partial failure)
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error("Batch processing failed, continuing", error as Error, {
          jobId: jobRun.id,
        });

        jobRun.errors.push({
          phase: "batch_processing",
          message: errorMsg,
          timestamp: Date.now(),
          recoverable: true,
        });
        hasPartialFailure = true;
      }
    }

    // Determine final status
    jobRun.completedAt = Date.now();
    if (jobRun.errors.length === 0) {
      jobRun.status = "completed";
    } else if (hasPartialFailure && jobRun.memoriesExtracted > 0) {
      jobRun.status = "partial";
    } else {
      // Total failure - mark all errors as non-recoverable
      jobRun.status = "failed";
      jobRun.errors = jobRun.errors.map((e) => ({ ...e, recoverable: false }));
    }

    // Persist job run
    await this.jobStateStorage.saveJobRun(jobRun);

    return jobRun;
  }

  /**
   * Process a batch of messages using the Agent Pipeline
   */
  private async processBatch(
    messages: import("../types").Message[],
    correlationId: string,
  ): Promise<AgentPipelineResult> {
    this.logger.debug("[DEBUG] processBatch() START", {
      correlationId,
      totalMessages: messages.length,
    });

    // Filter to valid extraction roles only (user/assistant)
    const validMessages = messages.filter(
      (m): m is { id: string; role: "user" | "assistant"; content: string; timestamp: number } =>
        m.role === "user" || m.role === "assistant",
    );

    this.logger.debug("[DEBUG] Filtered messages", {
      total: messages.length,
      valid: validMessages.length,
      invalid: messages.length - validMessages.length,
    });

    // Run agent pipeline (extraction + entity extraction)
    this.logger.debug("[DEBUG] Calling agentOrchestrator.runPipeline()...", {
      validMessagesCount: validMessages.length,
      mode: this.config.mode,
    });
    const pipelineResult = await this.agentOrchestrator.runPipeline({
      messages: validMessages,
      mode: this.config.mode,
      correlationId,
    });

    // FIX: Use semanticRelationships from pipeline result
    const relationships =
      pipelineResult.semanticRelationships || pipelineResult.relationships || [];

    this.logger.debug("[DEBUG] agentOrchestrator.runPipeline() returned", {
      success: pipelineResult.success,
      memoriesCount: pipelineResult.memories?.length ?? 0,
      entitiesCount: pipelineResult.entities?.length ?? 0,
      relationshipsCount: relationships.length,
      error: pipelineResult.error ?? null,
    });

    if (!pipelineResult.success) {
      this.logger.error(
        "Agent pipeline failed",
        new Error(pipelineResult.error || "Unknown error"),
        {
          correlationId,
        },
      );
      return { memories: [], entities: [] };
    }

    this.logger.debug("Agent pipeline completed", {
      correlationId,
      memoriesCount: pipelineResult.memories.length,
      entitiesCount: pipelineResult.entities.length,
      relationshipsCount: relationships.length,
    });

    return {
      memories: pipelineResult.memories,
      entities: pipelineResult.entities,
      relationships: relationships,
    };
  }

  /**
   * Route pipeline results to appropriate destinations (memory store + knowledge graph)
   */
  private async routePipelineResults(
    result: AgentPipelineResult,
    parentCorrelationId: string,
  ): Promise<void> {
    this.logger.debug("[DEBUG] routePipelineResults() START", {
      parentCorrelationId,
      memoriesCount: result.memories.length,
      entitiesCount: result.entities.length,
      relationshipsCount: result.relationships?.length ?? 0,
    });

    let { memories, entities, relationships } = result;

    // Phase 1: Smart Extraction - Entity Canonicalization
    if (this.smartExtraction) {
      // Canonicalize entities
      entities = entities.map((e) => ({
        ...e,
        name: this.smartExtraction!.canonicalizeEntity(e.name),
        // Also canonicalize any aliases or related entity names
        ...(e.aliases && { aliases: this.smartExtraction!.canonicalizeEntities(e.aliases) }),
      }));

      // Canonicalize entities in memories
      memories = memories.map((m) => ({
        ...m,
        entities: this.smartExtraction!.canonicalizeEntities(m.entities || []),
      }));

      // Canonicalize relationship entity names
      if (relationships) {
        relationships = relationships.map((r) => ({
          ...r,
          from: this.smartExtraction!.canonicalizeEntity(r.from),
          to: this.smartExtraction!.canonicalizeEntity(r.to),
        }));
      }

      this.logger.debug("[SmartExtraction] Entities canonicalized", {
        entityCount: entities.length,
      });
    }

    // Phase 1: Smart Extraction - Deduplication
    if (this.smartExtraction && memories.length > 0) {
      const memoriesWithUUID = memories.map((m) => ({
        ...m,
        uuid: m.id || generateCorrelationId(),
        contentHash: this.generateContentHash(m.content),
      }));

      const dedupResult = await this.smartExtraction.deduplicateMemories(
        memoriesWithUUID,
        parentCorrelationId,
      );

      memories = dedupResult.newMemories;

      this.logger.info("[SmartExtraction] Deduplication complete", {
        checked: dedupResult.stats.checked,
        duplicates: dedupResult.stats.duplicates,
        new: dedupResult.stats.new,
      });

      if (dedupResult.duplicates.length > 0) {
        this.logger.debug("[SmartExtraction] Duplicate memories filtered", {
          duplicateIds: dedupResult.duplicates.map((d) => d.uuid),
        });
      }
    }

    // Store memories and collect their IDs for entity linking
    const memoryIdMap = new Map<string, string>(); // Maps pipeline memory ID -> stored memory ID

    this.logger.debug("[DEBUG] Processing memories for storage", { count: memories.length });

    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i];
      const correlationId = generateCorrelationId();
      const storedMemoryId = generateCorrelationId();
      memoryIdMap.set(memory.id, storedMemoryId);

      this.logger.debug("[DEBUG] Processing memory", {
        index: i,
        memoryId: memory.id,
        storedMemoryId,
        category: memory.category,
        importance: memory.importance,
        confidence: memory.confidence,
        contentLength: memory.content?.length ?? 0,
        mode: this.config.mode,
      });

      if (this.config.mode === "review") {
        await this.reviewQueue.add({
          id: storedMemoryId,
          content: memory.content,
          category: memory.category,
          confidence: memory.confidence,
          importance: memory.importance,
          reasoning: memory.reasoning,
          source: "automated",
          sourceMessageIds: memory.sourceMessageIds,
          status: "pending",
          createdAt: Date.now(),
          correlationId,
        });
      } else {
        // Store in tiered memory store
        const tier: "Hot" | "Warm" | "Cold" =
          memory.importance >= 0.7 ? "Hot" : memory.importance >= 0.4 ? "Warm" : "Cold";
        const source: "manual" | "automated" = "automated";

        // Determine if this memory should be encrypted (User category only)
        const shouldEncrypt = memory.category === "User";

        let content = memory.content;

        // Encrypt content if needed
        if (shouldEncrypt && this.encryptionService) {
          this.logger.debug("[DEBUG] Encrypting User memory...", { storedMemoryId });
          try {
            const encryptResult = await this.encryptionService.encrypt({
              plaintext: content,
              associatedData: JSON.stringify({ memoryId: storedMemoryId, timestamp: Date.now() }),
            });

            if (encryptResult.success && encryptResult.data) {
              content = JSON.stringify(encryptResult.data);
              this.logger.debug("[DEBUG] Memory encrypted successfully", { storedMemoryId });
            } else {
              this.logger.warn("[DEBUG] Encryption failed, storing plaintext", {
                storedMemoryId,
                error: encryptResult.error,
              });
            }
          } catch (encryptError) {
            this.logger.error(
              "[DEBUG] Encryption error, storing plaintext",
              encryptError as Error,
              {
                storedMemoryId,
              },
            );
          }
        }

        const categorizedMemory = {
          memoryId: storedMemoryId,
          content,
          category: memory.category,
          confidence: memory.confidence,
          importance: memory.importance,
          sourceMessageIds: memory.sourceMessageIds,
          tier,
          encrypted: shouldEncrypt,
          source,
          timestamp: Date.now(),
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          accessCount: 1,
          correlationId,
        };

        this.logger.debug("[DEBUG] Calling memoryStore.store()...", {
          storedMemoryId,
          tier: categorizedMemory.tier,
          category: categorizedMemory.category,
          encrypted: categorizedMemory.encrypted,
        });

        try {
          await this.memoryStore.store(categorizedMemory);
          this.logger.debug("[DEBUG] memoryStore.store() SUCCESS", {
            storedMemoryId,
            encrypted: categorizedMemory.encrypted,
          });
        } catch (storeError) {
          this.logger.error("[DEBUG] memoryStore.store() FAILED", storeError as Error, {
            storedMemoryId,
            tier: categorizedMemory.tier,
          });
          throw storeError;
        }

        // Process through knowledge graph if available
        if (this.knowledgeGraphIntegration) {
          try {
            await this.knowledgeGraphIntegration.processMemory(categorizedMemory);
            this.logger.debug("Memory processed through knowledge graph", {
              memoryId: storedMemoryId,
              correlationId,
            });
          } catch (error) {
            // KG is best-effort, don't fail the whole job
            this.logger.warn("Knowledge graph processing failed", {
              memoryId: storedMemoryId,
              error: error instanceof Error ? error.message : "Unknown error",
              correlationId,
            });
          }
        }
      }
    }

    // Log entity extraction results
    if (entities.length > 0) {
      this.logger.info("Entities extracted from batch", {
        count: entities.length,
        parentCorrelationId,
        entities: entities.map((e) => ({ name: e.name, type: e.type })),
      });
    }

    // Log relationship extraction results
    if (relationships && relationships.length > 0) {
      this.logger.info("Relationships extracted from batch", {
        count: relationships.length,
        parentCorrelationId,
        relationships: relationships.map((r) => ({ from: r.from, to: r.to, type: r.type })),
      });

      // Process relationships through knowledge graph
      if (this.knowledgeGraphIntegration) {
        try {
          for (const relationship of relationships) {
            await this.knowledgeGraphIntegration.processRelationship(relationship);
          }
          this.logger.info("Relationships processed through knowledge graph", {
            count: relationships.length,
            parentCorrelationId,
          });
        } catch (error) {
          this.logger.warn("Failed to process relationships", {
            error: error instanceof Error ? error.message : "Unknown error",
            parentCorrelationId,
          });
        }
      }
    }
  }

  /**
   * Handle job failure
   */
  private async handleJobFailure(jobRun: JobRun, error: unknown): Promise<JobRun> {
    const errorMsg = error instanceof Error ? error.message : String(error);

    this.logger.error("Cron job failed completely", error as Error, {
      jobId: jobRun.id,
    });

    jobRun.status = "failed";
    jobRun.completedAt = Date.now();
    jobRun.errors.push({
      phase: "execution",
      message: errorMsg,
      timestamp: Date.now(),
      recoverable: false,
    });

    await this.jobStateStorage.saveJobRun(jobRun);

    return jobRun;
  }

  /**
   * Update state on successful run
   */
  private async updateStateOnSuccess(jobId: string, startedAt: number): Promise<void> {
    const state = await this.jobStateStorage.loadState();

    await this.jobStateStorage.saveState({
      lastRunTimestamp: startedAt, // Use job start as cutoff for next run
      lastJobId: jobId,
      consecutiveFailures: 0,
      nextScheduledRun: Date.now() + this.config.intervalMinutes * 60 * 1000,
    });
  }

  /**
   * Update state on failed run
   */
  private async updateStateOnFailure(jobId: string, startedAt: number): Promise<void> {
    const state = await this.jobStateStorage.loadState();
    const consecutiveFailures = state.consecutiveFailures + 1;

    // Calculate backoff delay
    const backoffMs = Math.min(
      this.config.backoff.initialDelayMs *
        Math.pow(this.config.backoff.multiplier, consecutiveFailures - 1),
      this.config.backoff.maxDelayMs,
    );

    this.logger.warn("Cron job failure, applying backoff", {
      jobId,
      consecutiveFailures,
      backoffMs,
      nextRetryIn: `${backoffMs / 1000}s`,
    });

    await this.jobStateStorage.saveState({
      lastRunTimestamp: state.lastRunTimestamp, // Don't advance on failure
      lastJobId: jobId,
      consecutiveFailures,
      nextScheduledRun: Date.now() + backoffMs,
    });
  }

  /**
   * Build current job info from lock
   */
  private async buildCurrentJobFromLock(lock: {
    jobId: string;
    acquiredAt: number;
  }): Promise<JobRun> {
    return {
      id: lock.jobId,
      startedAt: lock.acquiredAt,
      status: "running",
      messagesProcessed: 0,
      memoriesExtracted: 0,
      errors: [],
      correlationId: `cron-${lock.jobId}`,
    };
  }

  /**
   * Generate content hash for deduplication
   */
  private generateContentHash(content: string): string {
    // Simple hash function for content comparison
    let hash = 0;
    const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `hash-${Math.abs(hash).toString(16)}`;
  }
}

/**
 * Error thrown when overlap prevents job execution
 */
export class OverlapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OverlapError";
  }
}
