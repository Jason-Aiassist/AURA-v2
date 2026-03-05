/**
 * Overlap prevention - lock mechanism to prevent concurrent job runs
 */

import type { IOverlapPrevention, LockInfo } from "./types";

// Simple logger stub to avoid bundling issues
class Logger {
  constructor() {}
  info() {}
  debug() {}
  warn() {}
  error() {}
}

/**
 * In-memory overlap prevention with optional persistence
 */
export class OverlapPrevention implements IOverlapPrevention {
  private lockInfo?: LockInfo;
  private readonly lockTimeoutMs: number;
  private readonly logger: Logger;

  constructor(options: { lockTimeoutMs?: number } = {}) {
    this.lockTimeoutMs = options.lockTimeoutMs ?? 300000; // 5 minutes default
    this.logger = new Logger();
  }

  /**
   * Try to acquire a lock for the given job
   * @returns true if lock acquired, false if already locked
   */
  async acquireLock(jobId: string): Promise<boolean> {
    // Check if already locked and not expired
    if (await this.isLocked()) {
      this.logger.warn("Cron job lock already held", {
        currentJobId: this.lockInfo?.jobId,
        requestedBy: jobId,
      });
      return false;
    }

    const now = Date.now();
    this.lockInfo = {
      jobId,
      acquiredAt: now,
      expiresAt: now + this.lockTimeoutMs,
    };

    this.logger.info("Cron job lock acquired", {
      jobId,
      acquiredAt: now,
      expiresAt: this.lockInfo.expiresAt,
    });

    return true;
  }

  /**
   * Release the lock for the given job
   * Only releases if jobId matches current lock holder
   */
  async releaseLock(jobId: string): Promise<void> {
    if (!this.lockInfo) {
      this.logger.debug("No lock to release", { jobId });
      return;
    }

    if (this.lockInfo.jobId !== jobId) {
      this.logger.warn("Cannot release lock - different job holds it", {
        requestedBy: jobId,
        heldBy: this.lockInfo.jobId,
      });
      return;
    }

    this.logger.info("Cron job lock released", { jobId });
    this.lockInfo = undefined;
  }

  /**
   * Check if a lock is currently held and not expired
   */
  async isLocked(): Promise<boolean> {
    if (!this.lockInfo) {
      return false;
    }

    // Check if lock has expired
    if (Date.now() > this.lockInfo.expiresAt) {
      this.logger.warn("Cron job lock expired, auto-releasing", {
        jobId: this.lockInfo.jobId,
        expiredAt: this.lockInfo.expiresAt,
      });
      this.lockInfo = undefined;
      return false;
    }

    return true;
  }

  /**
   * Get current lock info if any
   */
  async getCurrentLock(): Promise<LockInfo | undefined> {
    if (await this.isLocked()) {
      return this.lockInfo;
    }
    return undefined;
  }

  /**
   * Force release any held lock (use with caution)
   */
  async forceRelease(): Promise<void> {
    if (this.lockInfo) {
      this.logger.warn("Force releasing cron job lock", {
        jobId: this.lockInfo.jobId,
      });
      this.lockInfo = undefined;
    }
  }
}
