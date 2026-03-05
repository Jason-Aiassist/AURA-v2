/**
 * Graph Context Builder Types
 * Types for structured context building from graph subgraphs
 */

import type {
  Subgraph,
  GraphEntity,
  GraphRelationship,
  ReasoningHint,
} from "../../graph/traversal/types.js";
import type { SearchLevel } from "../models.js";

/**
 * Context section types
 */
export type ContextSection =
  | "entity_resolution"
  | "known_facts"
  | "reasoning_paths"
  | "related_memories"
  | "entity_details";

/**
 * Built graph context structure
 */
export interface GraphContext {
  /** Entity resolution information */
  entityResolution: {
    original: string;
    resolved: string;
    confidence: number;
    method: string;
  }[];

  /** Known facts from relationships */
  knownFacts: {
    statement: string;
    confidence: number;
    source: string;
  }[];

  /** Reasoning paths and hints */
  reasoningPaths: {
    hint: string;
    confidence: number;
    pattern: string;
  }[];

  /** Entity details with descriptions */
  entityDetails: {
    name: string;
    type: string;
    aliases: string[];
    summary?: string;
  }[];

  /** Related memory references */
  relatedMemories: {
    memoryId: string;
    content: string;
    timestamp: number;
    relevance: number;
  }[];

  /** Metadata */
  metadata: {
    entityCount: number;
    relationshipCount: number;
    reasoningHintCount: number;
    tokenEstimate: number;
  };
}

/**
 * Context builder configuration
 */
export interface ContextBuilderConfig {
  /** Maximum tokens for context */
  maxTokens: number;
  /** Sections to include */
  sections: ContextSection[];
  /** Priority order for sections (higher = more important) */
  sectionPriority: Record<ContextSection, number>;
  /** Minimum confidence for facts */
  minFactConfidence: number;
  /** Include entity summaries */
  includeSummaries: boolean;
}

/**
 * Token budget allocation by section
 */
export interface TokenBudget {
  /** Total available tokens */
  total: number;
  /** Allocated per section */
  allocated: Record<ContextSection, number>;
  /** Used per section */
  used: Record<ContextSection, number>;
  /** Remaining tokens */
  remaining: number;
}

/**
 * Context formatting options
 */
export interface FormatOptions {
  /** Output format */
  format: "xml" | "markdown" | "json";
  /** Include confidence scores */
  showConfidence: boolean;
  /** Include reasoning hints */
  includeReasoning: boolean;
  /** Header style */
  headerStyle: "minimal" | "detailed";
}

/**
 * Context build result
 */
export interface ContextBuildResult {
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Structured context */
  context: GraphContext;
  /** Formatted output string */
  formatted: string;
  /** Token usage statistics */
  tokens: {
    used: number;
    total: number;
    bySection: Record<ContextSection, number>;
  };
  /** Performance metrics */
  metrics: {
    durationMs: number;
    entitiesProcessed: number;
    relationshipsProcessed: number;
  };
}

/**
 * Section builder function type
 */
export type SectionBuilder = (
  subgraph: Subgraph,
  memories: RelatedMemory[],
  budget: TokenBudget,
  config: ContextBuilderConfig,
) => Promise<string>;

/**
 * Related memory reference
 */
export interface RelatedMemory {
  /** Memory ID */
  id: string;
  /** Memory content */
  content: string;
  /** Timestamp */
  timestamp: number;
  /** Relevance score */
  relevance: number;
  /** Source message IDs */
  sourceMessageIds: string[];
}

/**
 * Search level configurations
 */
export const LEVEL_CONFIGS: Record<SearchLevel, ContextBuilderConfig> = {
  focused: {
    maxTokens: 1000,
    sections: ["entity_resolution", "known_facts", "reasoning_paths"],
    sectionPriority: {
      entity_resolution: 4,
      known_facts: 3,
      reasoning_paths: 2,
      entity_details: 1,
      related_memories: 0,
    },
    minFactConfidence: 0.8,
    includeSummaries: false,
  },
  moderate: {
    maxTokens: 2500,
    sections: ["entity_resolution", "known_facts", "reasoning_paths", "entity_details"],
    sectionPriority: {
      entity_resolution: 4,
      known_facts: 3,
      reasoning_paths: 2,
      entity_details: 2,
      related_memories: 1,
    },
    minFactConfidence: 0.6,
    includeSummaries: true,
  },
  general: {
    maxTokens: 4000,
    sections: [
      "entity_resolution",
      "known_facts",
      "reasoning_paths",
      "entity_details",
      "related_memories",
    ],
    sectionPriority: {
      entity_resolution: 5,
      known_facts: 4,
      reasoning_paths: 3,
      entity_details: 2,
      related_memories: 2,
    },
    minFactConfidence: 0.4,
    includeSummaries: true,
  },
};
