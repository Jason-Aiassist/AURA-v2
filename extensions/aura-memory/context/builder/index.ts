/**
 * Context Builder Module
 * Exports for graph context building
 */

// Types
export type {
  GraphContext,
  ContextBuilderConfig,
  TokenBudget,
  FormatOptions,
  ContextBuildResult,
  RelatedMemory,
  ContextSection,
  LEVEL_CONFIGS,
} from "./builder/types.js";

// Builder
export { GraphContextBuilder, createGraphContextBuilder } from "./builder/graph-context-builder.js";

// Injector
export {
  GraphContextInjector,
  createGraphContextInjector,
  injectGraphContext,
} from "./injector/graph-context-injector.js";

export type {
  GraphInjectionInput,
  GraphInjectionResult,
} from "./injector/graph-context-injector.js";
