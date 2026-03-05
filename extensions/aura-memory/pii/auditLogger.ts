/**
 * PII Audit Logger
 *
 * Immutable append-only audit log for PII detection events.
 * Stores only hashes, never original content.
 */

import { PiiAuditEntry, DetectedPii } from "./types";

/** Audit logger interface */
export interface AuditLogger {
  log(entry: Omit<PiiAuditEntry, "id" | "timestamp">): string;
  getEntries(since?: number): PiiAuditEntry[];
}

/** In-memory audit logger (for testing/single-process use) */
class InMemoryAuditLogger implements AuditLogger {
  private entries: PiiAuditEntry[] = [];
  private idCounter = 0;

  log(entry: Omit<PiiAuditEntry, "id" | "timestamp">): string {
    const id = `audit-${Date.now()}-${++this.idCounter}`;
    const fullEntry: PiiAuditEntry = {
      ...entry,
      id,
      timestamp: Date.now(),
    };
    this.entries.push(fullEntry);
    return id;
  }

  getEntries(since?: number): PiiAuditEntry[] {
    if (since === undefined) {
      return [...this.entries];
    }
    return this.entries.filter((e) => e.timestamp >= since);
  }
}

/** Singleton instance */
let globalLogger: AuditLogger = new InMemoryAuditLogger();

/**
 * Get the global audit logger instance
 */
export function getAuditLogger(): AuditLogger {
  return globalLogger;
}

/**
 * Set a custom audit logger (for dependency injection/testing)
 */
export function setAuditLogger(logger: AuditLogger): void {
  globalLogger = logger;
}

/**
 * Log a PII detection event
 * @param pii - The detected PII
 * @param metadata - Optional metadata
 * @returns The audit entry ID
 */
export function logPiiDetection(pii: DetectedPii, metadata?: Record<string, unknown>): string {
  return getAuditLogger().log({
    hash: pii.hash,
    type: pii.type,
    detectedBy: pii.detectedBy,
    redacted: true,
    metadata,
  });
}

/**
 * Create audit entries for multiple PII detections
 * @param piiList - List of detected PII
 * @param correlationId - Optional correlation ID for grouping
 * @returns The primary audit ID (first entry)
 */
export function logMultiplePiiDetections(piiList: DetectedPii[], correlationId?: string): string {
  if (piiList.length === 0) {
    return `audit-${Date.now()}-none`;
  }

  const primaryId = logPiiDetection(piiList[0], {
    totalDetected: piiList.length,
    correlationId,
  });

  // Log remaining entries with reference to primary
  for (let i = 1; i < piiList.length; i++) {
    logPiiDetection(piiList[i], {
      primaryAuditId: primaryId,
      index: i,
      correlationId,
    });
  }

  return primaryId;
}
