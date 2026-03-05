/**
 * Context Builders Module
 * Exports both legacy and graph-aware context builders
 */

// Legacy builder (backward compatible)
export { ThreeStageContextBuilder } from "./three-stage-builder.js";

// Graph-aware builder (new, with EntityResolver + GraphTraversal)
export { GraphAwareContextBuilder } from "./graph-aware-builder.js";

// Re-export types
export type { ThreeStageBuilderConfig } from "./three-stage-builder.js";
export type { GraphAwareBuilderConfig } from "./graph-aware-builder.js";
