/**
 * Performance Tests for Graph Operations
 *
 * Tests traversal speed, query latency, and scalability.
 */

import type { Neo4jDriver, GraphTraversalSearch, EntityResolver } from "../index.js";
import { createLogger } from "../shared/debug-logger.js";

const logger = createLogger("PerformanceTests");

export interface PerformanceResult {
  testName: string;
  durationMs: number;
  operations: number;
  opsPerSecond: number;
  p50LatencyMs?: number;
  p95LatencyMs?: number;
  p99LatencyMs?: number;
}

export interface PerformanceReport {
  timestamp: string;
  totalTests: number;
  results: PerformanceResult[];
  summary: {
    avgTraversalTimeMs: number;
    avgResolutionTimeMs: number;
    meetsSLA: boolean;
  };
}

/**
 * Performance test suite
 */
export class PerformanceTester {
  private driver: Neo4jDriver;
  private traversal: GraphTraversalSearch;
  private resolver: EntityResolver;

  constructor(driver: Neo4jDriver, traversal: GraphTraversalSearch, resolver: EntityResolver) {
    this.driver = driver;
    this.traversal = traversal;
    this.resolver = resolver;
  }

  /**
   * Run all performance tests
   */
  async runAllTests(): Promise<PerformanceReport> {
    logger.start("runAllTests");

    const results: PerformanceResult[] = [];

    // Test 1: Graph traversal speed
    results.push(await this.testTraversalSpeed());

    // Test 2: Entity resolution speed
    results.push(await this.testResolutionSpeed());

    // Test 3: 2-hop traversal (most common)
    results.push(await this.testTwoHopTraversal());

    // Test 4: Concurrent queries
    results.push(await this.testConcurrentQueries());

    // Test 5: Large result set handling
    results.push(await this.testLargeResultSet());

    // Calculate summary
    const traversalTimes = results
      .filter((r) => r.testName.includes("Traversal"))
      .map((r) => r.durationMs);

    const resolutionTimes = results
      .filter((r) => r.testName.includes("Resolution"))
      .map((r) => r.durationMs);

    const avgTraversal = traversalTimes.reduce((a, b) => a + b, 0) / traversalTimes.length;
    const avgResolution = resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length;

    // SLA: traversal <200ms, resolution <50ms
    const meetsSLA = avgTraversal < 200 && avgResolution < 50;

    const report: PerformanceReport = {
      timestamp: new Date().toISOString(),
      totalTests: results.length,
      results,
      summary: {
        avgTraversalTimeMs: avgTraversal,
        avgResolutionTimeMs: avgResolution,
        meetsSLA,
      },
    };

    logger.success({
      totalTests: results.length,
      avgTraversalTimeMs: avgTraversal.toFixed(1),
      avgResolutionTimeMs: avgResolution.toFixed(1),
      meetsSLA,
    });

    return report;
  }

  /**
   * Test graph traversal speed
   */
  private async testTraversalSpeed(): Promise<PerformanceResult> {
    logger.start("testTraversalSpeed");

    const iterations = 50;
    const latencies: number[] = [];

    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      const iterStart = Date.now();

      try {
        await this.traversal.findConnectedSubgraph({
          entityNames: ["User"],
          maxDepth: 2,
          minConfidence: 0.7,
        });
      } catch (e) {
        // Entity may not exist, continue
      }

      latencies.push(Date.now() - iterStart);
    }

    const durationMs = Date.now() - startTime;

    // Calculate percentiles
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    return {
      testName: "Graph Traversal (2-hop)",
      durationMs,
      operations: iterations,
      opsPerSecond: (iterations / durationMs) * 1000,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
    };
  }

  /**
   * Test entity resolution speed
   */
  private async testResolutionSpeed(): Promise<PerformanceResult> {
    logger.start("testResolutionSpeed");

    const queries = ["me", "I", "Steve", "you", "Daggerheart", "AURA"];
    const iterations = 100;
    const latencies: number[] = [];

    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      const query = queries[i % queries.length];
      const iterStart = Date.now();

      await this.resolver.resolve(query);
      latencies.push(Date.now() - iterStart);
    }

    const durationMs = Date.now() - startTime;

    latencies.sort((a, b) => a - b);

    return {
      testName: "Entity Resolution",
      durationMs,
      operations: iterations,
      opsPerSecond: (iterations / durationMs) * 1000,
      p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)],
      p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)],
      p99LatencyMs: latencies[Math.floor(latencies.length * 0.99)],
    };
  }

  /**
   * Test 2-hop traversal specifically
   */
  private async testTwoHopTraversal(): Promise<PerformanceResult> {
    logger.start("testTwoHopTraversal");

    const startEntities = ["User", "Steve", "AURA", "Daggerheart"];
    const iterations = 30;

    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      const entity = startEntities[i % startEntities.length];

      try {
        await this.traversal.findConnectedSubgraph({
          entityNames: [entity],
          maxDepth: 2,
          minConfidence: 0.7,
        });
      } catch (e) {
        // Continue
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      testName: "2-Hop Traversal (Multiple Start)",
      durationMs,
      operations: iterations,
      opsPerSecond: (iterations / durationMs) * 1000,
    };
  }

  /**
   * Test concurrent query handling
   */
  private async testConcurrentQueries(): Promise<PerformanceResult> {
    logger.start("testConcurrentQueries");

    const concurrentQueries = 10;
    const iterations = 5;

    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      const promises = Array(concurrentQueries)
        .fill(null)
        .map((_, idx) => this.resolver.resolve(["me", "I", "Steve", "you", "Aura"][idx % 5]));

      await Promise.all(promises);
    }

    const durationMs = Date.now() - startTime;
    const totalOps = concurrentQueries * iterations;

    return {
      testName: "Concurrent Resolution (10 parallel)",
      durationMs,
      operations: totalOps,
      opsPerSecond: (totalOps / durationMs) * 1000,
    };
  }

  /**
   * Test handling of large result sets
   */
  private async testLargeResultSet(): Promise<PerformanceResult> {
    logger.start("testLargeResultSet");

    const iterations = 10;

    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      try {
        // Query with broad search to get many results
        await this.traversal.findConnectedSubgraph({
          entityNames: ["User"],
          maxDepth: 3, // Deeper search = more results
          minConfidence: 0.5, // Lower threshold = more results
        });
      } catch (e) {
        // Continue
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      testName: "Large Result Set (3-hop, low threshold)",
      durationMs,
      operations: iterations,
      opsPerSecond: (iterations / durationMs) * 1000,
    };
  }
}

/**
 * Format performance report
 */
export function formatPerformanceReport(report: PerformanceReport): string {
  const lines = [
    "=".repeat(60),
    "PERFORMANCE TEST RESULTS",
    "=".repeat(60),
    ``,
    `Timestamp: ${report.timestamp}`,
    `Total Tests: ${report.totalTests}`,
    ``,
    "SLA COMPLIANCE",
    "-".repeat(40),
    `Meets SLA: ${report.summary.meetsSLA ? "✅ YES" : "❌ NO"}`,
    `  Target: Traversal <200ms, Resolution <50ms`,
    `  Actual: Traversal ${report.summary.avgTraversalTimeMs.toFixed(1)}ms, Resolution ${report.summary.avgResolutionTimeMs.toFixed(1)}ms`,
    ``,
    "DETAILED RESULTS",
    "-".repeat(40),
  ];

  for (const result of report.results) {
    lines.push(`\n${result.testName}:`);
    lines.push(`  Operations: ${result.operations}`);
    lines.push(`  Total Time: ${result.durationMs.toFixed(0)}ms`);
    lines.push(`  Throughput: ${result.opsPerSecond.toFixed(1)} ops/sec`);

    if (result.p50LatencyMs) {
      lines.push(`  Latency P50: ${result.p50LatencyMs.toFixed(1)}ms`);
      lines.push(`  Latency P95: ${result.p95LatencyMs?.toFixed(1)}ms`);
      lines.push(`  Latency P99: ${result.p99LatencyMs?.toFixed(1)}ms`);
    }
  }

  lines.push("=".repeat(60));

  return lines.join("\n");
}
