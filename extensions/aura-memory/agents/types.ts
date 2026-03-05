/**
 * Agent Pipeline Types
 */

import type { MemoryCategory } from "../categories/types.js";
import type { ExtractedEntity } from "../entities/types.js";

export type AgentStep = "extract" | "entities" | "score" | "categorize" | "store";

export interface AgentPipelineInput {
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
  }>;
  mode: "manual" | "review" | "automatic";
  userHint?: string;
  maxMemories?: number;
  correlationId?: string;
}

export interface AgentPipelineOutput {
  success: boolean;
  memories: AgentMemory[];
  entities: AgentEntity[];
  durationMs: number;
  correlationId: string;
  error?: string;
  /**
   * Semantic entities extracted in Phase 1 (optional)
   */
  semanticEntities?: Array<{
    name: string;
    type: string;
    confidence: number;
    aliases?: string[];
  }>;
  /**
   * Semantic relationships extracted in Phase 1 (optional)
   */
  semanticRelationships?: Array<{
    from: string;
    to: string;
    type: string;
    confidence: number;
    fact?: string;
  }>;
}

export interface AgentMemory {
  id: string;
  content: string;
  category: MemoryCategory;
  confidence: number;
  importance: number;
  reasoning: string;
  sourceMessageIds: string[];
  entities: string[];
}

export interface AgentEntity {
  name: string;
  type: string;
  confidence: number;
  summary?: string;
  memoryId: string;
  sourceContent: string;
}

export interface AgentPipelineConfig {
  steps: AgentStep[];
  parallel: boolean;
  retryAttempts: number;
  timeoutMs: number;
}

export interface AgentStepResult {
  success: boolean;
  durationMs: number;
  correlationId: string;
  error?: string;
}
