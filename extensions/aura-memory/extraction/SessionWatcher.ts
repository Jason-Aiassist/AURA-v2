/**
 * Session File Watcher
 *
 * Polls session files for changes and triggers immediate extraction.
 * This replaces the cron-based polling with polling-based watching.
 */

import { stat, readdir } from "fs/promises";
import path from "path";
import type { Logger } from "../types.js";
import type { ImmediateExtractionService } from "./ImmediateExtractionService.js";

export interface SessionWatcherConfig {
  sessionsDir: string;
  enabled: boolean;
  pollIntervalMs?: number;
}

export interface SessionWatcherDependencies {
  immediateExtractionService: ImmediateExtractionService;
  log: Logger;
}

/**
 * Watches session files and triggers extraction on changes
 */
export class SessionWatcher {
  private config: SessionWatcherConfig;
  private deps: SessionWatcherDependencies;
  private isWatching = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private fileStats = new Map<string, { mtime: number; size: number }>();
  private processedFiles = new Map<string, number>(); // Track last processed time

  constructor(config: SessionWatcherConfig, deps: SessionWatcherDependencies) {
    this.config = {
      enabled: true,
      pollIntervalMs: 3000, // Poll every 3 seconds
      ...config,
    };
    this.deps = deps;
  }

  /**
   * Start watching session files
   */
  start(): void {
    if (!this.config.enabled || this.isWatching) {
      return;
    }

    this.deps.log.info("[SessionWatcher] Starting session file watcher (polling)...");

    this.isWatching = true;
    this.poll(); // Initial poll

    // Start polling interval
    this.pollTimer = setInterval(() => {
      this.poll();
    }, this.config.pollIntervalMs);

    this.deps.log.info("[SessionWatcher] Watching directory (polling):", {
      dir: this.config.sessionsDir,
      intervalMs: this.config.pollIntervalMs,
    });
  }

  /**
   * Stop watching session files
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isWatching = false;
    this.deps.log.info("[SessionWatcher] Stopped watching");
  }

  /**
   * Poll for file changes
   */
  private async poll(): Promise<void> {
    if (!this.isWatching) {
      return;
    }

    try {
      const files = await readdir(this.config.sessionsDir);
      const jsonlFiles = files.filter(
        (f) => f.endsWith(".jsonl") && !f.includes(".reset.") && !f.includes(".tmp"),
      );

      for (const filename of jsonlFiles) {
        await this.checkFile(filename);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.deps.log.error("[SessionWatcher] Poll error: " + errorMsg, error as Error, {
        dir: this.config.sessionsDir,
      });
    }
  }

  /**
   * Check if a file has changed
   */
  private async checkFile(filename: string): Promise<void> {
    const filepath = path.join(this.config.sessionsDir, filename);
    const sessionId = filename.replace(".jsonl", "");

    try {
      const stats = await stat(filepath);
      const currentMtime = stats.mtime.getTime();
      const currentSize = stats.size;

      const prevStats = this.fileStats.get(sessionId);

      if (!prevStats || prevStats.mtime !== currentMtime || prevStats.size !== currentSize) {
        // File changed or new file
        this.fileStats.set(sessionId, { mtime: currentMtime, size: currentSize });

        // Debounce: don't process same file more than once per 2 seconds
        const now = Date.now();
        const lastProcessed = this.processedFiles.get(sessionId) || 0;
        if (now - lastProcessed < 2000) {
          return;
        }
        this.processedFiles.set(sessionId, now);

        this.deps.log.info("[SessionWatcher] File changed:", {
          filename,
          sessionId,
          mtime: new Date(currentMtime).toISOString(),
          size: currentSize,
        });

        // Trigger extraction
        this.deps.immediateExtractionService
          .triggerExtraction({
            sessionKey: sessionId,
            sessionId,
          })
          .catch((error) => {
            this.deps.log.error("[SessionWatcher] Extraction failed:", error as Error, {
              sessionId,
            });
          });
      }
    } catch (error) {
      // File might have been deleted
      this.fileStats.delete(sessionId);
    }
  }

  /**
   * Manually trigger extraction for a session (for testing or direct calls)
   */
  async triggerForSession(sessionId: string): Promise<void> {
    this.deps.log.info("[SessionWatcher] Manual trigger:", { sessionId });

    await this.deps.immediateExtractionService.triggerExtraction({
      sessionKey: sessionId,
      sessionId,
    });
  }

  /**
   * Get watcher status
   */
  getStatus(): {
    isWatching: boolean;
    watchedDir: string;
    recentFiles: string[];
  } {
    const recentFiles = Array.from(this.processedFiles.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file]) => file);

    return {
      isWatching: this.isWatching,
      watchedDir: this.config.sessionsDir,
      recentFiles,
    };
  }
}

/**
 * Create session watcher instance
 */
export function createSessionWatcher(
  config: SessionWatcherConfig,
  deps: SessionWatcherDependencies,
): SessionWatcher {
  return new SessionWatcher(config, deps);
}
