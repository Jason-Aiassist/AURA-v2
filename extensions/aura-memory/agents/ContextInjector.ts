/**
 * Simple Context Injector for AURA (Hello World Version)
 *
 * This is the simplified version for initial testing.
 * The full version is in ContextInjector.ts.backup
 */

/**
 * Configuration for the context injector
 */
export interface ContextInjectorConfig {
  /** Default token limit for context */
  defaultTokenLimit?: number;
  /** Minimum query length to trigger injection */
  minQueryLength?: number;
}

/**
 * Injection result
 */
export interface InjectionResult {
  /** Prepend context to add before user messages */
  prependContext?: string;
  /** System prompt addition */
  systemPrompt?: string;
  /** Metadata about the injection */
  metadata: {
    /** Whether context was found and injected */
    hasContext: boolean;
    /** Number of memories retrieved */
    memoryCount: number;
    /** Build time in ms */
    buildTimeMs: number;
    /** Analysis intent detected */
    intent?: string;
    /** Entities extracted */
    entities?: string[];
    /** Memory IDs that were injected (for recall detection) */
    memoryIds?: string[];
  };
}

/**
 * Simple Context Injector
 * Follows AURA's pattern but without async initialization complexity
 */
export class ContextInjector {
  private config: Required<ContextInjectorConfig>;

  constructor(config: ContextInjectorConfig = {}) {
    this.config = {
      defaultTokenLimit: config.defaultTokenLimit ?? 4000,
      minQueryLength: config.minQueryLength ?? 3,
    };
  }

  /**
   * Main entry point: build and return context
   */
  inject(query: string): InjectionResult {
    const startTime = Date.now();

    // Skip short queries
    if (!query || query.trim().length < this.config.minQueryLength) {
      return {
        metadata: {
          hasContext: false,
          memoryCount: 0,
          buildTimeMs: Date.now() - startTime,
        },
      };
    }

    // Build hello world context
    const context = this.buildContext(query);
    const buildTimeMs = Date.now() - startTime;

    return {
      prependContext: context,
      metadata: {
        hasContext: true,
        memoryCount: 1,
        buildTimeMs,
        intent: "hello_world",
        entities: [],
        memoryIds: [],
      },
    };
  }

  /**
   * Build the context string
   */
  private buildContext(query: string): string {
    const sections: string[] = [];

    sections.push("## Hello World Context");
    sections.push("");
    sections.push(`This is a test context injected by the ContextInjector.`);
    sections.push(`Query received: "${query.substring(0, 100)}${query.length > 100 ? "..." : ""}"`);
    sections.push(`Timestamp: ${new Date().toISOString()}`);
    sections.push("");

    return sections.join("\n");
  }

  /**
   * Get injector stats
   */
  getStats(): { minQueryLength: number; defaultTokenLimit: number } {
    return {
      minQueryLength: this.config.minQueryLength,
      defaultTokenLimit: this.config.defaultTokenLimit,
    };
  }

  /**
   * Clear all caches (no-op in simple version)
   */
  clearCaches(): void {
    // No caches in simple version
  }

  /**
   * Record context injection for recall detection (no-op in simple version)
   */
  recordInjection(
    _sessionId: string,
    _memories: Array<{ content: string; memoryId?: string }>,
    _entities: string[],
  ): void {
    // No-op in simple version
  }
}

// Global injector instance (lazy initialization)
let globalInjector: ContextInjector | null = null;

/**
 * Initialize the global context injector
 */
export function initializeContextInjector(config?: ContextInjectorConfig): ContextInjector {
  globalInjector = new ContextInjector(config);
  return globalInjector;
}

/**
 * Get the global context injector (creates default if not initialized)
 */
export function getContextInjector(): ContextInjector {
  if (!globalInjector) {
    globalInjector = new ContextInjector();
  }
  return globalInjector;
}

/**
 * Check if injector is initialized
 */
export function isContextInjectorInitialized(): boolean {
  return globalInjector !== null;
}

/**
 * Get graph context for a user query (for system prompt integration)
 * Simple version - returns null
 */
export async function getGraphContextForQuery(_query: string): Promise<string | null> {
  return null;
}
