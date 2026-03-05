/**
 * Shared Debug Logger
 * Factory for creating debug loggers with correlation tracking
 */

import { randomUUID } from "crypto";

/**
 * Log context for correlation tracking
 */
export interface LogContext {
  /** Unique correlation ID */
  correlationId: string;
  /** Current operation */
  operation: string;
  /** Module name */
  module: string;
}

/**
 * Debug logger interface
 */
export interface DebugLogger {
  /** Log operation start */
  start(operation: string, meta?: Record<string, unknown>): void;
  /** Log progress step */
  progress(step: string, meta?: Record<string, unknown>): void;
  /** Log success */
  success(meta?: Record<string, unknown>): void;
  /** Log error */
  error(error: Error, meta?: Record<string, unknown>): void;
  /** Get current context */
  getContext(): LogContext;
}

/**
 * Debug logger implementation
 */
class DebugLoggerImpl implements DebugLogger {
  private context: LogContext;

  constructor(module: string, correlationId?: string) {
    this.context = {
      correlationId: correlationId || randomUUID(),
      module,
      operation: "unknown",
    };
  }

  start(operation: string, meta?: Record<string, unknown>): void {
    this.context.operation = operation;
    console.log(`[${this.context.module}] ▶️ START: ${operation}`, {
      correlationId: this.context.correlationId,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }

  progress(step: string, meta?: Record<string, unknown>): void {
    console.log(`[${this.context.module}] ⏳ PROGRESS: ${this.context.operation} - ${step}`, {
      correlationId: this.context.correlationId,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }

  success(meta?: Record<string, unknown>): void {
    console.log(`[${this.context.module}] ✅ SUCCESS: ${this.context.operation}`, {
      correlationId: this.context.correlationId,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }

  error(error: Error, meta?: Record<string, unknown>): void {
    console.error(`[${this.context.module}] ❌ ERROR: ${this.context.operation}`, {
      correlationId: this.context.correlationId,
      timestamp: new Date().toISOString(),
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      ...meta,
    });
  }

  getContext(): LogContext {
    return { ...this.context };
  }
}

/**
 * Create a debug logger
 * @param module - Module name
 * @param correlationId - Optional correlation ID
 * @returns Debug logger instance
 */
export function createLogger(module: string, correlationId?: string): DebugLogger {
  return new DebugLoggerImpl(module, correlationId);
}

/**
 * Global logger for module-level logging
 * @param module - Module name
 * @returns Logger with static module context
 */
export function createModuleLogger(
  module: string,
): Pick<DebugLogger, "start" | "progress" | "success" | "error"> {
  const logger = createLogger(module);
  return {
    start: logger.start.bind(logger),
    progress: logger.progress.bind(logger),
    success: logger.success.bind(logger),
    error: logger.error.bind(logger),
  };
}
