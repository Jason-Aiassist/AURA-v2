/**
 * Debugging utilities for AURA Context Injection System
 * Ported from Python debug_utils.py to TypeScript
 */

import { type SearchResult, type BuiltContext } from "./models.js";

// Environment-based debug level
const DEBUG_LEVEL = process.env.MEMORY_DEBUG?.toUpperCase() ?? "INFO";
const isDebugMode = () => DEBUG_LEVEL === "DEBUG";

// Logger prefix
const LOG_PREFIX = "[AURA-CONTEXT]";

// ============================================================================
// Search Debugging
// ============================================================================

export function debugSearchStart(query: string, limit: number, memoryPath: string): void {
  if (isDebugMode()) {
    console.log(
      `${LOG_PREFIX} 🔍 SEARCH START - Query: '${query}', Limit: ${limit}, Path: ${memoryPath}`,
    );
  }
}

export function debugSearchResults(
  results: SearchResult[],
  query: string,
  durationMs: number,
): void {
  if (isDebugMode()) {
    console.log(
      `${LOG_PREFIX} ✅ SEARCH COMPLETE - Found ${results.length} results for '${query.slice(0, 30)}...' in ${durationMs.toFixed(1)}ms`,
    );
    if (results.length > 0) {
      console.log(
        `${LOG_PREFIX}    Top result: score=${results[0].score.toFixed(2)}, content='${results[0].content.slice(0, 50)}...'`,
      );
    }
  }
}

export function debugSearchError(query: string, error: Error, durationMs: number): void {
  console.error(
    `${LOG_PREFIX} ❌ SEARCH FAILED - Query: '${query.slice(0, 30)}...', Error: ${error.name}: ${error.message}, Duration: ${durationMs.toFixed(1)}ms`,
  );
}

// ============================================================================
// Context Building Debugging
// ============================================================================

export function debugContextBuildStart(query: string, tokenLimit: number): number {
  if (isDebugMode()) {
    console.log(
      `${LOG_PREFIX} 🏗️ CONTEXT BUILD START - Query: '${query.slice(0, 50)}...', Token limit: ${tokenLimit}`,
    );
  }
  return Date.now();
}

export function debugContextBuildComplete(result: BuiltContext, startTime: number): void {
  const durationMs = Date.now() - startTime;
  if (isDebugMode()) {
    console.log(
      `${LOG_PREFIX} ✅ CONTEXT BUILD COMPLETE - ${durationMs.toFixed(1)}ms, tokens: ${result.tokenCount}, relevance: ${result.relevanceScore.toFixed(2)}`,
    );
  }
}

// ============================================================================
// Three-Stage Pipeline Debugging
// ============================================================================

export function debugStage1Start(query: string, entityCount: number): void {
  if (isDebugMode()) {
    console.log(
      `${LOG_PREFIX} 🎯 STAGE 1 START - Knowledge Graph search with ${entityCount} entities`,
    );
  }
}

export function debugStage1Complete(resultCount: number, durationMs: number): void {
  if (isDebugMode()) {
    console.log(
      `${LOG_PREFIX} ✅ STAGE 1 COMPLETE - ${resultCount} results in ${durationMs.toFixed(1)}ms`,
    );
  }
}

export function debugStage2Start(query: string): void {
  if (isDebugMode()) {
    console.log(`${LOG_PREFIX} 📚 STAGE 2 START - Semantic search`);
  }
}

export function debugStage2Complete(resultCount: number, durationMs: number): void {
  if (isDebugMode()) {
    console.log(
      `${LOG_PREFIX} ✅ STAGE 2 COMPLETE - ${resultCount} results in ${durationMs.toFixed(1)}ms`,
    );
  }
}

export function debugStage3Start(level: string, inputCount: number): void {
  if (isDebugMode()) {
    console.log(
      `${LOG_PREFIX} 🔄 STAGE 3 START - REPL filter (${level}) with ${inputCount} results`,
    );
  }
}

export function debugStage3Complete(outputCount: number, threshold: number): void {
  if (isDebugMode()) {
    console.log(
      `${LOG_PREFIX} ✅ STAGE 3 COMPLETE - ${outputCount} results after filtering (threshold: ${threshold})`,
    );
  }
}

export function debugTwoStagePipeline(
  stage1Count: number,
  stage2Count: number,
  durationMs: number,
): void {
  const reduction = stage1Count > 0 ? ((stage1Count - stage2Count) / stage1Count) * 100 : 0;
  console.log(
    `${LOG_PREFIX} 🔄 PIPELINE COMPLETE - Stage 1: ${stage1Count} → Stage 2: ${stage2Count} (${reduction.toFixed(0)}% reduction) in ${durationMs.toFixed(1)}ms`,
  );
}

export function debugStage1Fallback(reason: string): void {
  console.warn(`${LOG_PREFIX} ⚠️ STAGE 1 FALLBACK - ${reason}`);
}

export function debugStage2Filter(
  inputCount: number,
  outputCount: number,
  threshold: number,
  level: string,
): void {
  if (isDebugMode()) {
    const filtered = inputCount - outputCount;
    console.log(
      `${LOG_PREFIX} 🎯 STAGE 2 FILTER - ${inputCount} → ${outputCount} (filtered ${filtered}) at threshold=${threshold.toFixed(2)}, level=${level}`,
    );
  }
}

// ============================================================================
// REPL Debugging
// ============================================================================

export function debugREPLCommand(command: string, sourcesUsed: number, relevance: number): void {
  console.log(
    `${LOG_PREFIX} 🔄 REPL COMMAND - '${command}' → ${sourcesUsed} sources, relevance: ${relevance.toFixed(2)}`,
  );
}

// ============================================================================
// Performance Debugging
// ============================================================================

export function debugPerformanceMetric(
  operation: string,
  durationMs: number,
  thresholdMs: number = 200,
): void {
  if (durationMs > thresholdMs) {
    console.warn(
      `${LOG_PREFIX} ⚠️ SLOW OPERATION - ${operation} took ${durationMs.toFixed(1)}ms (threshold: ${thresholdMs}ms)`,
    );
  } else if (isDebugMode()) {
    console.log(`${LOG_PREFIX} ⚡ PERFORMANCE - ${operation}: ${durationMs.toFixed(1)}ms`);
  }
}

export function debugMemoryStats(
  totalMemories: number,
  indexSize: number,
  avgRelevance: number,
): void {
  console.log(
    `${LOG_PREFIX} 📊 MEMORY STATS - Total: ${totalMemories}, Index: ${indexSize}, Avg Relevance: ${avgRelevance.toFixed(2)}`,
  );
}

export function debugErrorContext(operation: string, context: Record<string, unknown>): void {
  console.error(`${LOG_PREFIX} ❌ ERROR CONTEXT - ${operation}`);
  for (const [key, value] of Object.entries(context)) {
    console.error(`${LOG_PREFIX}    ${key}: ${value}`);
  }
}

// ============================================================================
// Performance Tracking Decorator
// ============================================================================

export function trackPerformance(operationName: string) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      const startTime = Date.now();
      try {
        const result = await originalMethod.apply(this, args);
        const durationMs = Date.now() - startTime;
        debugPerformanceMetric(operationName, durationMs);
        return result;
      } catch (error) {
        const durationMs = Date.now() - startTime;
        console.error(
          `${LOG_PREFIX} ❌ ${operationName} failed after ${durationMs.toFixed(1)}ms: ${error}`,
        );
        throw error;
      }
    };

    return descriptor;
  };
}

// ============================================================================
// Index Building Debugging
// ============================================================================

export function debugIndexBuildStart(path: string): void {
  if (isDebugMode()) {
    console.log(`${LOG_PREFIX} 📚 INDEX BUILD START - Path: ${path}`);
  }
}

export function debugIndexBuildComplete(fileCount: number, durationMs: number): void {
  if (isDebugMode()) {
    console.log(
      `${LOG_PREFIX} ✅ INDEX BUILD COMPLETE - ${fileCount} files in ${durationMs.toFixed(1)}ms`,
    );
  }
}

// ============================================================================
// Environment Helpers
// ============================================================================

export function enableVerboseLogging(): void {
  process.env.MEMORY_DEBUG = "DEBUG";
  console.log(`${LOG_PREFIX} 🔊 Verbose logging enabled`);
}

export function disableVerboseLogging(): void {
  process.env.MEMORY_DEBUG = "INFO";
  console.log(`${LOG_PREFIX} 🔇 Verbose logging disabled`);
}
