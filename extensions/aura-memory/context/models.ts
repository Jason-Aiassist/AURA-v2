/**
 * Memory content models for AURA Context Injection System
 * Ported from Python (Super-Agent) to TypeScript
 */

export interface MemoryContent {
  /** Unique memory identifier */
  id: string;
  /** Memory content text */
  content: string;
  /** Metadata (path, timestamp, etc.) */
  metadata: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: Date;
  /** Importance score (0-1) */
  importanceScore: number;
  /** Number of times accessed */
  accessCount: number;
  /** Last access timestamp */
  lastAccessed?: Date;
}

export interface SearchResult {
  /** Memory identifier */
  memoryId: string;
  /** Memory content */
  content: string;
  /** Relevance score (0-1) */
  score: number;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

export interface BuiltContext {
  /** Compiled context content */
  content: string;
  /** Estimated token count */
  tokenCount: number;
  /** Source memory IDs */
  sources: string[];
  /** Average relevance score */
  relevanceScore: number;
  /** Build time in milliseconds */
  buildTimeMs: number;
}

export interface ContextBuildOptions {
  /** Maximum tokens for context */
  tokenLimit?: number;
  /** Search strategy: 'general' | 'moderate' | 'focused' */
  searchLevel?: SearchLevel;
  /** Minimum relevance threshold */
  minRelevance?: number;
  /** Maximum results per stage */
  maxResults?: number;
}

export type SearchLevel = "general" | "moderate" | "focused";

export interface Stage1Result {
  /** Expanded query from LLM */
  expandedQuery: string;
  /** Related concepts */
  relatedConcepts: string[];
  /** Key terms */
  keyTerms: string[];
}

export interface Stage3Config {
  /** Search level */
  level: SearchLevel;
  /** Relevance threshold */
  threshold: number;
  /** Max results to return */
  maxResults: number;
  /** Whether to include entity expansion */
  expandEntities: boolean;
}
