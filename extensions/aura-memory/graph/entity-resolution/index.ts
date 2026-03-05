/**
 * Entity Resolution Module
 * Exports for entity resolution functionality
 */

// Main class
export { EntityResolver, createEntityResolver, isResolved } from "./EntityResolver.js";

// Types
export type {
  ResolutionMethod,
  ResolvedEntity,
  ResolutionOptions,
  BatchResolutionResult,
} from "./types.js";
