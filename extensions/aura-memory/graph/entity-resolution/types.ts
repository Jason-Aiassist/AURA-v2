/**
 * Entity Resolution Types
 * Type definitions for entity resolution system
 */

/**
 * Resolution method used
 */
export type ResolutionMethod = "exact" | "case_insensitive" | "alias" | "pronoun" | "fuzzy";

/**
 * Resolved entity result
 */
export interface ResolvedEntity {
  /** Entity name (canonical) */
  name: string;
  /** Entity type */
  type: string;
  /** Entity aliases */
  aliases: string[];
  /** Resolution confidence (0-1) */
  confidence: number;
  /** Resolution method used */
  method: ResolutionMethod;
  /** Original query */
  originalQuery: string;
}

/**
 * Resolution options
 */
export interface ResolutionOptions {
  /** Enable pronoun resolution */
  enablePronouns?: boolean;
  /** Enable alias matching */
  enableAliases?: boolean;
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Batch resolution result
 */
export interface BatchResolutionResult {
  /** Map of query to resolved entity */
  results: Map<string, ResolvedEntity | null>;
  /** Resolution statistics */
  stats: {
    total: number;
    resolved: number;
    failed: number;
    fromCache: number;
  };
}
