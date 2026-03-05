/**
 * AURA Memory Core Types
 * Minimal types for session extraction functionality
 */

import type { MemoryCategory } from "./categories/types.js";

/**
 * Logger interface used throughout AURA
 */
export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, error?: Error, meta?: Record<string, unknown>) => void;
}

/**
 * Message format from OpenClaw session files
 */
export interface Message {
  /** Unique message ID */
  id: string;
  /** Message role: user or assistant */
  role: "user" | "assistant" | "system" | "tool";
  /** Message content (plain text) */
  content: string;
  /** Unix timestamp (ms) */
  timestamp: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Memory extraction result from a session
 */
export interface SessionMemory {
  /** Unique memory ID */
  memoryId: string;
  /** Memory content */
  content: string;
  /** Assigned category */
  category: MemoryCategory;
  /** Confidence score (0-1) */
  confidence: number;
  /** Source session ID */
  sessionId: string;
  /** Source message IDs */
  sourceMessageIds: string[];
  /** Extracted entities */
  entities: Array<{ name: string; type: string }>;
  /** Creation timestamp */
  createdAt: number;
  /** Whether encrypted (User category) */
  encrypted: boolean;
}

/**
 * Extraction job result
 */
export interface ExtractionJobResult {
  /** Job ID */
  jobId: string;
  /** Sessions processed */
  sessionsProcessed: number;
  /** Total messages read */
  messagesRead: number;
  /** Messages after filtering */
  messagesFiltered: number;
  /** Memories extracted */
  memoriesExtracted: number;
  /** Individual message failures: messageId -> error */
  failedMessages: Record<string, string>;
  /** Processing duration (ms) */
  durationMs: number;
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * AURA Memory configuration
 */
export interface AuraMemoryConfig {
  /** Cron interval in minutes (default: 5) */
  intervalMinutes: number;
  /** Maximum job duration in minutes (default: 10) */
  maxDurationMinutes: number;
  /** Batch size for processing (default: 100) */
  batchSize: number;
  /** Session files directory */
  sessionsDir: string;
  /** Working directory for file copies */
  workDir: string;
  /** Checkpoint storage path */
  checkpointPath: string;
  /** LLM configuration */
  llm: {
    model: string;
    baseUrl: string;
    apiKey: string;
  };
  /** Neo4j configuration */
  neo4j: {
    url: string;
    username: string;
    password: string;
  };
  /** Encryption configuration */
  encryption: {
    enabled: boolean;
    password?: string;
  };
  /** Embedding configuration for vector search */
  embedding: {
    /** Enable embedding generation (default: true) */
    enabled: boolean;
    /** Ollama base URL (default: http://ollama-embed-gpu0:11434) */
    baseUrl: string;
    /** Embedding model (default: nomic-embed-text) */
    model: string;
    /** Embedding dimensions (default: 768 for nomic-embed-text) */
    dimensions: number;
    /** Request timeout in ms (default: 10000) */
    timeoutMs: number;
    /** Batch size for bulk operations (default: 100) */
    batchSize: number;
  };
}
