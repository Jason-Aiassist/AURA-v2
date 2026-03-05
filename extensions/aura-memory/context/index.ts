/**
 * Context Injection Module - Refactored
 *
 * No god files - each has single responsibility
 */

// Models
export type {
  MemoryContent,
  SearchResult,
  BuiltContext,
  ContextBuildOptions,
  SearchLevel,
  Stage3Config,
  Stage1Result,
} from "./models.js";

// Stages (Single Responsibility)
export { Stage1KnowledgeGraphSearch, type Stage1Config } from "./stages/stage1-knowledge-graph.js";
export {
  Stage1KnowledgeGraphSearch as Stage1KnowledgeGraphSearchV2,
  type ResolvedEntities as Stage1ResolvedEntities,
} from "./stages/stage1-knowledge-graph-v2.js";
export { Stage2HybridSearch, type Stage2Config } from "./stages/stage2-hybrid-search.js";
export { Stage3REPLFilter, type Stage3Options } from "./stages/stage3-repl-filter.js";

// Formatters
export { ContextFormatter, type FormatterConfig } from "./formatters/context-formatter.js";

// Builders (Orchestrators only)
export {
  ThreeStageContextBuilder,
  type ThreeStageBuilderConfig,
} from "./builders/three-stage-builder.js";
export {
  GraphAwareContextBuilder,
  type GraphAwareBuilderConfig,
} from "./builders/graph-aware-builder.js";
export { createContextBuilder } from "./builders/factory.js";

// Search Engines
export { HybridSearchEngine, type HybridSearchConfig } from "./hybrid-search-engine.js";

// Utilities
export { RelevanceScorer } from "./relevance-scorer.js";

// Context Deduplication (Runtime)
export {
  ContextDeduplicator,
  createContextDeduplicator,
  type Memory as DeduplicationMemory,
  type DeduplicationOptions,
} from "./ContextDeduplicator.js";

// Phase 2: Query Enhancement
export {
  QueryEntityResolver,
  createQueryEntityResolver,
  DEFAULT_RELATIONSHIP_PATTERNS,
  type ResolvedQuery,
  type ResolvedEntity,
  type RelationshipPattern,
  type QueryResolverConfig,
} from "./QueryEntityResolver.js";

export {
  RelationshipAwareSearcher,
  createRelationshipAwareSearcher,
  type SearchResult,
  type RelationshipSearchStrategy,
  type RelationshipAwareSearchConfig,
} from "./RelationshipAwareSearcher.js";

export {
  EnhancedContextInjector,
  createEnhancedContextInjector,
  type EnhancedInjectorConfig,
  type EnhancedInjectionResult,
} from "./EnhancedContextInjector.js";

// Debug (Comprehensive logging)
export {
  debugSearchStart,
  debugSearchResults,
  debugSearchError,
  debugContextBuildStart,
  debugContextBuildComplete,
  debugStage1Start,
  debugStage1Complete,
  debugStage2Start,
  debugStage2Complete,
  debugStage3Start,
  debugStage3Complete,
  debugStage1Fallback,
  debugStage2Filter,
  debugREPLCommand,
  debugPerformanceMetric,
  debugMemoryStats,
  debugErrorContext,
  debugIndexBuildStart,
  debugIndexBuildComplete,
  trackPerformance,
  enableVerboseLogging,
  disableVerboseLogging,
} from "./debug-utils.js";
