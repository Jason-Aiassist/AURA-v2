/**
 * Cron orchestrator types
 */

import type { MemoryExtraction } from "../extraction/types";
import type { Message } from "../types";

/**
 * Cron job configuration
 */
export interface CronConfig {
  /** Interval in minutes (default: 5 for AURA) */
  intervalMinutes: number;
  /** Maximum job duration in minutes (default: 10) */
  maxDurationMinutes: number;
  /** Extraction mode: review or automatic */
  mode: ExtractionMode;
  /** Batch size for message fetching (default: 100) */
  batchSize: number;
  /** Backoff configuration for failures */
  backoff: BackoffConfig;
}

export type ExtractionMode = "review" | "automatic";

export interface BackoffConfig {
  /** Initial delay in ms (default: 60000) */
  initialDelayMs: number;
  /** Maximum delay in ms (default: 3600000) */
  maxDelayMs: number;
  /** Multiplier for each retry (default: 2) */
  multiplier: number;
}

/**
 * Job run metadata
 */
export interface JobRun {
  id: string;
  startedAt: number;
  completedAt?: number;
  status: JobStatus;
  messagesProcessed: number;
  memoriesExtracted: number;
  errors: JobError[];
  correlationId: string;
}

export type JobStatus = "running" | "completed" | "partial" | "failed";

export interface JobError {
  phase: string;
  message: string;
  timestamp: number;
  recoverable: boolean;
}

/**
 * Job state persisted between runs
 */
export interface JobState {
  lastRunTimestamp: number;
  lastJobId?: string;
  consecutiveFailures: number;
  nextScheduledRun: number;
  lock?: LockInfo;
}

export interface LockInfo {
  jobId: string;
  acquiredAt: number;
  expiresAt: number;
}

/**
 * Message fetch result
 */
export interface MessageFetchResult {
  messages: Message[];
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Extraction result with routing decision
 */
export interface RoutedExtraction {
  extraction: MemoryExtraction;
  route: "review" | "storage";
}

/**
 * Agent pipeline result with memories, entities, and relationships
 */
export interface AgentPipelineResult {
  memories: Array<{
    id: string;
    content: string;
    category: import("../categories/types.js").MemoryCategory;
    confidence: number;
    importance: number;
    reasoning: string;
    sourceMessageIds: string[];
    entities: string[];
  }>;
  entities: Array<{
    name: string;
    type: string;
    confidence: number;
    summary?: string;
    memoryId: string;
  }>;
  relationships?: Array<{
    from: string;
    to: string;
    type: string;
    confidence: number;
  }>;
}

/**
 * Cron orchestrator interface
 */
export interface ICronOrchestrator {
  start(): Promise<void>;
  stop(): Promise<void>;
  runNow(): Promise<JobRun>;
  getStatus(): Promise<JobStatusInfo>;
}

export interface JobStatusInfo {
  isRunning: boolean;
  currentJob?: JobRun;
  lastRun?: JobRun;
  nextScheduledRun: number;
  consecutiveFailures: number;
}

/**
 * Message fetcher interface
 */
export interface IMessageFetcher {
  fetchSince(timestamp: number, options: FetchOptions): Promise<MessageFetchResult>;
  streamBatches(timestamp: number, batchSize: number): AsyncGenerator<Message[]>;
}

export interface FetchOptions {
  batchSize: number;
  cursor?: string;
}

/**
 * Overlap prevention interface
 */
export interface IOverlapPrevention {
  acquireLock(jobId: string): Promise<boolean>;
  releaseLock(jobId: string): Promise<void>;
  isLocked(): Promise<boolean>;
  getCurrentLock(): Promise<LockInfo | undefined>;
}

/**
 * Job storage interface
 */
export interface IJobStateStorage {
  loadState(): Promise<JobState>;
  saveState(state: JobState): Promise<void>;
  saveJobRun(run: JobRun): Promise<void>;
  getLastJobRun(): Promise<JobRun | undefined>;
}

/**
 * Default configuration for AURA session extraction
 */
export const DEFAULT_CRON_CONFIG: CronConfig = {
  intervalMinutes: 5, // AURA: 5 minute interval as per spec
  maxDurationMinutes: 10,
  mode: "automatic", // AURA: automatic extraction (no review queue)
  batchSize: 100,
  backoff: {
    initialDelayMs: 60000, // 1 minute
    maxDelayMs: 3600000, // 1 hour
    multiplier: 2,
  },
};
