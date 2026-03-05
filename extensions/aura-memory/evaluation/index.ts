/**
 * Evaluation Module
 * Exports benchmarking and performance testing tools
 */

export {
  runBenchmark,
  formatReport,
  TEST_QUERIES,
  type EvaluationReport,
  type BenchmarkResult,
  type TestQuery,
} from "./benchmark.js";

export {
  PerformanceTester,
  formatPerformanceReport,
  type PerformanceReport,
  type PerformanceResult,
} from "./performance.js";

// Re-export for convenience
export { createLogger } from "../shared/debug-logger.js";
