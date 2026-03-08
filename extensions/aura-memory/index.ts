/**
 * AURA Memory Extension for OpenClaw
 *
 * Features:
 * - Automatic session extraction every 5 minutes
 * - Knowledge graph integration (Neo4j)
 * - Intelligent context injection via before_prompt_build hook
 * - Semantic search with query embeddings
 *
 * FIX: Registration is now synchronous (async init moved to postRegister)
 */

import os from "os";
import path from "path";
import { z } from "zod";
import { registerInternalHook, type MessageSentHookEvent } from "../../src/hooks/internal-hooks.js";
import type { OpenClawPluginApi } from "../plugin-sdk/types.js";
import {
  initializeContextInjector,
  getContextInjector,
  isContextInjectorInitialized,
} from "./agents/ContextInjector.js";
import { getUserName } from "./config/user-config.js";
import { isEmbeddingServiceInitialized } from "./embeddings/EmbeddingService.js";
import {
  createImmediateExtractionService,
  type ImmediateExtractionService,
} from "./extraction/ImmediateExtractionService.js";
import { createSessionWatcher, type SessionWatcher } from "./extraction/SessionWatcher.js";
import {
  startAuraMemorySystem,
  stopAuraMemorySystem,
  getAuraMemoryStatus,
  getTieredMemoryStore,
  getKnowledgeGraphIntegration,
  getEmbeddingService,
  getEncryptionService,
  getSessionFetcher,
  getAgentOrchestrator,
  getSmartExtraction,
} from "./startup.js";

/**
 * Extract user query from full prompt (removes metadata wrapper)
 */
function extractUserQuery(prompt: string | undefined): string {
  if (!prompt) return "";

  // Try to find the user message after the metadata block
  // Pattern: [Day YYYY-MM-DD HH:MM UTC] user message
  // Day can be: Mon, Tue, Wed, Thu, Fri, Sat, Sun
  const match = prompt.match(
    /\[(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+UTC\]\s*(.+)/s,
  );
  if (match && match[2]) {
    return match[2].trim();
  }

  // Fallback: look for "user:" in the prompt
  const userMatch = prompt.match(/user:\s*(.+)/is);
  if (userMatch && userMatch[1]) {
    return userMatch[1].trim();
  }

  // If no pattern matches, return the last non-empty line
  const lines = prompt.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length > 0) {
    return lines[lines.length - 1].trim();
  }

  return prompt.trim();
}

const auraMemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().default(5),
  maxDurationMinutes: z.number().default(10),
  batchSize: z.number().default(100),
  contextInjection: z
    .object({
      enabled: z.boolean().default(true),
      minQueryLength: z.number().default(3),
      maxBuildTimeMs: z.number().default(1000),
      defaultTokenLimit: z.number().default(4000),
    })
    .default({}),
  embedding: z
    .object({
      enabled: z.boolean().default(true),
      baseUrl: z.string().default("http://ollama-embed-gpu0:11434"),
      model: z.string().default("nomic-embed-text"),
      dimensions: z.number().default(768),
      timeoutMs: z.number().default(10000),
      batchSize: z.number().default(100),
    })
    .default({}),
});

// Store API reference for post-register initialization
let pluginApi: OpenClawPluginApi | null = null;
let immediateExtractionService: ImmediateExtractionService | null = null;
let sessionWatcher: SessionWatcher | null = null;
let pluginConfig: z.infer<typeof auraMemoryConfigSchema> | null = null;

// LAZY HOOK REGISTRATION (Race Condition Fix)
// Store the context injection hook registration function to be called AFTER initialization
let pendingContextInjectionHook: (() => void) | null = null;
let contextInjectionHookRegistered = false;

const auraMemoryPlugin = {
  id: "aura-memory",
  name: "AURA Memory",
  description: "Session extraction, knowledge graph integration, and intelligent context injection",
  kind: "extension",
  configSchema: auraMemoryConfigSchema,

  // ==========================================
  // SYNCHRONOUS REGISTRATION (REQUIRED by OpenClaw)
  // ==========================================
  register(api: OpenClawPluginApi) {
    api.logger.info("[AURA Memory] ==========================================");
    api.logger.info("[AURA Memory] EXTENSION REGISTER FUNCTION CALLED");
    api.logger.info("[AURA Memory] ==========================================");

    const config = api.pluginConfig as z.infer<typeof auraMemoryConfigSchema> | undefined;

    api.logger.info("[AURA Memory] Config retrieved:", {
      enabled: config?.enabled,
      contextInjection: config?.contextInjection?.enabled,
    });

    if (config?.enabled === false) {
      api.logger.info("[AURA Memory] Extension disabled in config - exiting");
      return;
    }

    // Store for post-register async initialization
    pluginApi = api;
    pluginConfig = config ?? auraMemoryConfigSchema.parse({});

    // ==========================================
    // LAZY HOOK REGISTRATION (Race Condition Fix)
    // ==========================================
    // Instead of registering the hook immediately (which creates a race condition),
    // we store a registration function that will be called AFTER initialization completes.
    // This ensures the hook only exists when the system is ready to handle it.

    const contextInjectionEnabled = pluginConfig.contextInjection?.enabled !== false;

    if (contextInjectionEnabled) {
      api.logger.info(
        "[AURA Memory] Context injection enabled - hook will be registered after initialization",
      );

      // Store the registration function for later use
      pendingContextInjectionHook = () => {
        if (contextInjectionHookRegistered) {
          api.logger.warn(
            "[AURA Memory] Context injection hook already registered, skipping duplicate",
          );
          return;
        }

        api.logger.info("[AURA Memory] Registering before_prompt_build hook (lazy)...");

        api.on(
          "before_prompt_build",
          async (event) => {
            const hookStartTime = Date.now();

            api.logger.info("[AURA Memory] ==========================================");
            api.logger.info("[AURA Memory] HOOK TRIGGERED - before_prompt_build");
            api.logger.info("[AURA Memory] ==========================================");
            api.logger.info("[AURA Memory] Event details:", {
              promptPreview: event.prompt?.substring(0, 100),
              promptLength: event.prompt?.length,
              hasPrompt: !!event.prompt,
            });

            // ==========================================
            // GET INJECTOR (guaranteed initialized via lazy registration)
            // ==========================================
            let injector;
            try {
              injector = getContextInjector();
              api.logger.info("[AURA Memory] ContextInjector obtained successfully");
            } catch (error) {
              api.logger.error("[AURA Memory] FAILED to get ContextInjector:", {
                error: error instanceof Error ? error.message : String(error),
              });
              return {};
            }

            // ==========================================
            // EXTRACT USER QUERY
            // ==========================================
            const userQuery = extractUserQuery(event.prompt);
            api.logger.info("[AURA Memory] Query extraction:", {
              originalLength: event.prompt?.length ?? 0,
              extractedLength: userQuery.length,
              extractedQuery: userQuery.substring(0, 100),
              isEmpty: userQuery.length === 0,
            });

            // Skip if query too short
            if (userQuery.trim().length < 3) {
              api.logger.info("[AURA Memory] Query too short (< 3 chars), skipping injection");
              return {};
            }

            // ==========================================
            // EXECUTE INJECTION PIPELINE
            // ==========================================
            api.logger.info("[AURA Memory] Starting context injection pipeline...");
            const pipelineStartTime = Date.now();

            try {
              // Use consolidated ContextInjector (includes optional pre-processing modules)
              const result = await injector.inject(userQuery);
              const pipelineDuration = Date.now() - pipelineStartTime;

              api.logger.info("[AURA Memory] ==========================================");
              api.logger.info("[AURA Memory] INJECTION PIPELINE COMPLETE");
              api.logger.info("[AURA Memory] ==========================================");
              api.logger.info("[AURA Memory] Pipeline results:", {
                hasContext: result.metadata.hasContext,
                memoryCount: result.metadata.memoryCount,
                buildTimeMs: result.metadata.buildTimeMs,
                pipelineDurationMs: pipelineDuration,
                intent: result.metadata.intent,
                entities: result.metadata.entities,
              });

              if (result.metadata.hasContext && result.prependContext) {
                api.logger.info("[AURA Memory] SUCCESS - Returning context:", {
                  contextLength: result.prependContext.length,
                  memoryCount: result.metadata.memoryCount,
                  preview: result.prependContext.substring(0, 200),
                });

                // ==========================================
                // RECORD INJECTION FOR RECALL DETECTION
                // ==========================================
                try {
                  const sessionId = event.sessionId || "unknown";
                  const memoriesForRecall =
                    result.metadata.memoryIds?.map((id: string, idx: number) => ({
                      memoryId: id,
                      content: result.prependContext?.substring(idx * 100, idx * 100 + 200) || "",
                    })) || [];

                  api.logger.info("[AURA Memory] Recording injection for recall detection:", {
                    sessionId,
                    memoryCount: memoriesForRecall.length,
                    entities: result.metadata.entities,
                  });

                  injector.recordInjection?.(
                    sessionId,
                    memoriesForRecall,
                    result.metadata.entities || [],
                  );

                  api.logger.info("[AURA Memory] Injection recorded successfully");
                } catch (recallError) {
                  api.logger.warn("[AURA Memory] Failed to record injection (non-fatal):", {
                    error: recallError instanceof Error ? recallError.message : String(recallError),
                  });
                }

                return {
                  prependContext: result.prependContext,
                };
              }

              api.logger.info("[AURA Memory] No context found for this query");
              return {};
            } catch (error) {
              const pipelineDuration = Date.now() - pipelineStartTime;
              api.logger.error("[AURA Memory] ==========================================");
              api.logger.error("[AURA Memory] INJECTION PIPELINE FAILED");
              api.logger.error("[AURA Memory] ==========================================");
              api.logger.error("[AURA Memory] Error details:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                pipelineDurationMs: pipelineDuration,
                query: userQuery.substring(0, 100),
              });
              return {};
            }
          },
          { priority: 100 },
        );

        contextInjectionHookRegistered = true;
        api.logger.info("[AURA Memory] before_prompt_build hook registered SUCCESSFULLY (lazy)");
      };
    } else {
      api.logger.info("[AURA Memory] Context injection disabled in config");
    }

    // ==========================================
    // REGISTER INTERNAL message:sent HOOK (Immediate Extraction)
    // ==========================================
    // Note: Using internal hooks (message:sent) NOT plugin hooks (message_sent)
    // Internal hooks fire for agent responses, plugin hooks fire for external channels
    api.logger.info(
      "[AURA Memory] Registering internal message:sent hook for immediate extraction...",
    );

    registerInternalHook("message:sent", async (event: MessageSentHookEvent) => {
      api.logger.info("[EXTRACTION_DEBUG] Internal message:sent hook triggered", {
        type: event.type,
        action: event.action,
        hasImmediateExtraction: !!immediateExtractionService,
        sessionKey: event.sessionKey,
      });

      // Skip if immediate extraction not initialized yet
      if (!immediateExtractionService) {
        api.logger.info("[EXTRACTION_DEBUG] Skipping - immediate extraction not ready yet");
        return;
      }

      try {
        const sessionKey = event.sessionKey;
        if (!sessionKey) {
          api.logger.warn("[EXTRACTION_DEBUG] No session key found in event");
          return;
        }

        api.logger.info("[EXTRACTION_DEBUG] Triggering immediate extraction", {
          sessionKey,
          contentLength: event.context?.content?.length,
          success: event.context?.success,
        });

        await immediateExtractionService.triggerExtraction({
          sessionKey,
          sessionId: sessionKey, // Use sessionKey as sessionId
        });

        api.logger.info("[EXTRACTION_DEBUG] Immediate extraction triggered successfully");
      } catch (error) {
        api.logger.error("[EXTRACTION_DEBUG] message:sent hook error:", error as Error);
        // Don't throw - extraction failure shouldn't block message sending
      }
    });

    api.logger.info("[AURA Memory] Internal message:sent hook registered SUCCESSFULLY");

    // ==========================================
    // SCHEDULE ASYNC INITIALIZATION
    // ==========================================
    // ContextInjector initialization is now deferred to startAsyncSystems()
    // This ensures startAuraMemorySystem() runs first and initializes the
    // TieredMemoryStore before ContextInjector tries to use it.
    api.logger.info("[AURA Memory] Scheduling async system initialization...");

    setTimeout(() => {
      startAsyncSystems(api, pluginConfig!).catch((error) => {
        api.logger.error("[AURA Memory] Async initialization failed:", error);
      });
    }, 100);

    api.logger.info("[AURA Memory] ==========================================");
    api.logger.info("[AURA Memory] SYNCHRONOUS REGISTRATION COMPLETE");
    api.logger.info("[AURA Memory] ==========================================");
  },
};

// ==========================================
// ASYNC SYSTEM INITIALIZATION (POST-REGISTER)
// ==========================================
// Initializes ContextInjector AFTER startAuraMemorySystem() completes.
// This ensures TieredMemoryStore is available before ContextInjector needs it.
async function startAsyncSystems(
  api: OpenClawPluginApi,
  config: z.infer<typeof auraMemoryConfigSchema>,
) {
  api.logger.info("[AURA Memory] ==========================================");
  api.logger.info("[AURA Memory] STARTING ASYNC SYSTEMS");
  api.logger.info("[AURA Memory] ==========================================");
  api.logger.info("[AURA Memory] ContextInjector will be initialized after memory store is ready");

  // 1. Start extraction system (CronOrchestrator, etc.)
  // This initializes TieredMemoryStore, KnowledgeGraph, etc.
  let memoryStoreInitialized = false;
  try {
    api.logger.info("[AURA Memory] Starting session extraction system...");
    await startAuraMemorySystem(api.logger);
    api.logger.info("[AURA Memory] Session extraction system started successfully");
    memoryStoreInitialized = true;
  } catch (error) {
    api.logger.error("[AURA Memory] Failed to start extraction system:", error);
    // Continue anyway - context injection might still work if stores initialized
  }

  // 2. Initialize ContextInjector (NOW, after memory stores are ready)
  const contextInjectionEnabled = config.contextInjection?.enabled !== false;

  if (contextInjectionEnabled) {
    api.logger.info("[AURA Memory] ==========================================");
    api.logger.info("[AURA Memory] INITIALIZING CONTEXT INJECTOR");
    api.logger.info("[AURA Memory] ==========================================");

    const initStartTime = Date.now();

    try {
      // Get all the stores (now they should be initialized)
      const memoryStore = getTieredMemoryStore();
      const knowledgeGraph = getKnowledgeGraphIntegration();
      const embeddingService = getEmbeddingService();
      const encryptionService = getEncryptionService();

      api.logger.info("[AURA Memory] Store status:", {
        hasMemoryStore: !!memoryStore,
        hasKnowledgeGraph: !!knowledgeGraph,
        hasEmbeddingService: !!embeddingService,
        hasEncryptionService: !!encryptionService,
        memoryStoreInitialized,
      });

      if (!memoryStore) {
        throw new Error("TieredMemoryStore not available - startAuraMemorySystem may have failed");
      }

      api.logger.info("[AURA Memory] Initializing ContextInjector...");

      initializeContextInjector({
        db: memoryStore.getDatabase(),
        knowledgeGraph: knowledgeGraph ?? undefined,
        memoryStore: memoryStore,
        providerModel: "default",
        defaultTokenLimit: config.contextInjection?.defaultTokenLimit ?? 4000,
        minQueryLength: config.contextInjection?.minQueryLength ?? 3,
        maxBuildTimeMs: config.contextInjection?.maxBuildTimeMs ?? 1000,
        embeddingService: embeddingService ?? undefined,
        encryptionService: encryptionService ?? undefined,
        // Optional pre-processing modules (integrated into consolidated injector)
        enableQueryResolution: true,
        enableRelationshipSearch: true,
        userName: getUserName(),
      });

      // Verify it worked
      const isNowInitialized = isContextInjectorInitialized();
      const initDuration = Date.now() - initStartTime;

      if (isNowInitialized) {
        api.logger.info("[AURA Memory] ==========================================");
        api.logger.info("[AURA Memory] CONTEXT INJECTOR INITIALIZED SUCCESSFULLY");
        api.logger.info("[AURA Memory] ==========================================");
        api.logger.info("[AURA Memory] Initialization duration:", { ms: initDuration });

        // Phase 2: Wrap with EnhancedContextInjector
        // Consolidated ContextInjector now includes optional pre-processing modules
        // (QueryEntityResolver, RelationshipAwareSearcher) integrated directly
        try {
          const injector = getContextInjector();
          const stats = injector.getStats();
          api.logger.info("[AURA Memory] Injector stats:", stats);
        } catch (error) {
          api.logger.warn("[AURA Memory] Could not get injector stats:", error);
        }

        // ==========================================
        // LAZY HOOK REGISTRATION: Register context injection hook NOW
        // ==========================================
        // Hook is registered AFTER initialization completes to eliminate race condition
        if (pendingContextInjectionHook) {
          api.logger.info("[AURA Memory] ==========================================");
          api.logger.info("[AURA Memory] REGISTERING CONTEXT INJECTION HOOK (LAZY)");
          api.logger.info("[AURA Memory] ==========================================");
          pendingContextInjectionHook();
          pendingContextInjectionHook = null; // Clear after registration
        } else {
          api.logger.warn("[AURA Memory] No pending context injection hook to register");
        }
      } else {
        throw new Error("initializeContextInjector completed but injector not initialized");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const initDuration = Date.now() - initStartTime;

      api.logger.error("[AURA Memory] ==========================================");
      api.logger.error("[AURA Memory] CONTEXT INJECTOR INITIALIZATION FAILED");
      api.logger.error("[AURA Memory] ==========================================");
      api.logger.error("[AURA Memory] Error details:", {
        error: errorMsg,
        stack: errorStack,
        durationMs: initDuration,
      });
      api.logger.error("[AURA Memory] Context injection will NOT be available");
    }
  } else {
    api.logger.info("[AURA Memory] Context injection disabled - skipping initialization");
  }

  // ==========================================
  // INITIALIZE IMMEDIATE EXTRACTION SERVICE
  // ==========================================
  api.logger.info("[AURA Memory] ==========================================");
  api.logger.info("[AURA Memory] INITIALIZING IMMEDIATE EXTRACTION SERVICE");
  api.logger.info("[AURA Memory] ==========================================");

  try {
    const sessionFetcher = getSessionFetcher();
    const agentOrchestrator = getAgentOrchestrator();
    const knowledgeGraphIntegration = getKnowledgeGraphIntegration();
    const encryptionService = getEncryptionService();
    const smartExtraction = getSmartExtraction();

    if (!sessionFetcher || !agentOrchestrator) {
      api.logger.warn(
        "[AURA Memory] Cannot initialize immediate extraction - missing dependencies",
        {
          hasSessionFetcher: !!sessionFetcher,
          hasAgentOrchestrator: !!agentOrchestrator,
        },
      );
    } else {
      immediateExtractionService = createImmediateExtractionService(
        {
          debounceMs: 2000, // 2 second debounce
          maxDebounceMs: 10000, // 10 second max wait
          debug: false,
        },
        {
          agentOrchestrator,
          sessionFileFetcher: sessionFetcher,
          knowledgeGraphIntegration: knowledgeGraphIntegration ?? undefined,
          encryptionService: encryptionService ?? undefined,
          smartExtraction: smartExtraction ?? undefined,
          log: {
            info: (msg: string, meta?: Record<string, unknown>) => api.logger.info(msg, meta),
            debug: (msg: string, meta?: Record<string, unknown>) => api.logger.debug(msg, meta),
            warn: (msg: string, meta?: Record<string, unknown>) => api.logger.warn(msg, meta),
            error: (msg: string, error?: Error, meta?: Record<string, unknown>) =>
              api.logger.error(msg, error, meta),
          },
        },
      );

      api.logger.info("[AURA Memory] Immediate Extraction Service initialized successfully");
      api.logger.info("[AURA Memory] Event-driven extraction active (2s debounce)");

      // ==========================================
      // INITIALIZE SESSION WATCHER (File-based trigger)
      // ==========================================
      // This watches session files for changes and triggers extraction
      // Works for all channels including webchat (bypasses hook limitations)
      api.logger.info("[AURA Memory] Initializing session file watcher...");

      try {
        // Use same path as default config
        const sessionsDir = path.join(os.homedir(), ".openclaw", "agents", "main", "sessions");

        api.logger.info("[AURA Memory] Session watcher config:", { sessionsDir });

        sessionWatcher = createSessionWatcher(
          {
            sessionsDir,
            enabled: true,
          },
          {
            immediateExtractionService,
            log: {
              info: (msg: string, meta?: Record<string, unknown>) => api.logger.info(msg, meta),
              debug: (msg: string, meta?: Record<string, unknown>) => api.logger.debug(msg, meta),
              warn: (msg: string, meta?: Record<string, unknown>) => api.logger.warn(msg, meta),
              error: (msg: string, error?: Error, meta?: Record<string, unknown>) =>
                api.logger.error(msg, error, meta),
            },
          },
        );

        sessionWatcher.start();
        api.logger.info("[AURA Memory] Session file watcher started successfully");
        api.logger.info("[AURA Memory] File-based extraction trigger active");
      } catch (watcherError) {
        api.logger.error("[AURA Memory] Failed to start session watcher:", watcherError as Error);
        sessionWatcher = null;
      }
    }
  } catch (error) {
    api.logger.error(
      "[AURA Memory] Failed to initialize Immediate Extraction Service:",
      error as Error,
    );
    immediateExtractionService = null;
  }

  // 3. Register CLI commands
  registerCliCommands(api);

  api.logger.info("[AURA Memory] Async systems initialization complete");
}

// ==========================================
// CLI COMMANDS
// ==========================================
function registerCliCommands(api: OpenClawPluginApi) {
  api.onCliReady?.((program) => {
    // Status command
    program
      .command("aura-memory:status")
      .description("Show AURA memory system status")
      .action(() => {
        const status = getAuraMemoryStatus();
        console.log("AURA Memory System Status:");
        console.log(JSON.stringify(status, null, 2));
      });

    // Context injection status
    program
      .command("aura-memory:context-status")
      .description("Show AURA context injection status")
      .action(() => {
        if (isContextInjectorInitialized()) {
          const injector = getContextInjector();
          const stats = injector.getStats();
          console.log("AURA Context Injection Status:");
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log("AURA Context Injection: Not initialized");
        }
      });

    // Clear cache
    program
      .command("aura-memory:clear-cache")
      .description("Clear AURA context injection cache")
      .action(() => {
        if (isContextInjectorInitialized()) {
          const injector = getContextInjector();
          injector.clearCaches();
          console.log("AURA cache cleared");
        } else {
          console.log("AURA Context Injection: Not initialized");
        }
      });

    // Embedding service status
    program
      .command("aura-memory:embed-status")
      .description("Show AURA embedding service status")
      .action(async () => {
        const embeddingService = getEmbeddingService();
        if (embeddingService) {
          const status = await embeddingService.getStatus();
          console.log("AURA Embedding Service Status:");
          console.log(JSON.stringify(status, null, 2));
        } else {
          console.log("AURA Embedding Service: Not initialized");
        }
      });

    // Test embedding
    program
      .command("aura-memory:embed-test")
      .description("Test embedding generation")
      .argument("<text>", "Text to embed")
      .action(async (text: string) => {
        const embeddingService = getEmbeddingService();
        if (!embeddingService) {
          console.log("AURA Embedding Service: Not initialized");
          return;
        }

        console.log(`Generating embedding for: "${text}"`);
        const result = await embeddingService.generateEmbedding(text);

        if (result) {
          console.log("Success!");
          console.log(`  Dimensions: ${result.embedding.length}`);
          console.log(`  Duration: ${result.durationMs}ms`);
          console.log(
            `  Sample values: [${result.embedding
              .slice(0, 5)
              .map((v) => v.toFixed(4))
              .join(", ")}, ...]`,
          );
        } else {
          console.log("Failed to generate embedding");
        }
      });

    // Search status
    program
      .command("aura-memory:search-status")
      .description("Show AURA search index status")
      .action(() => {
        const memoryStore = getTieredMemoryStore();
        if (!memoryStore) {
          console.log("AURA Memory Store: Not initialized");
          return;
        }

        const hotTier = memoryStore.getHotTier();
        if (!hotTier) {
          console.log("AURA HotTier: Not available");
          return;
        }

        const vectorStats = hotTier.getVectorSchema().getStats();
        const ftsStats = hotTier.getFtsSchema().getStats();

        console.log("AURA Search Index Status:");
        console.log("  Vector Search (sqlite-vec):");
        console.log(`    Available: ${vectorStats.available}`);
        console.log(`    Table: ${vectorStats.tableName}`);
        console.log(`    Dimensions: ${vectorStats.dimensions}`);
        console.log(`    Indexed vectors: ${vectorStats.count}`);
        console.log("  Text Search (FTS5):");
        console.log(`    Available: ${ftsStats.available}`);
        console.log(`    Table: ${ftsStats.tableName}`);
        console.log(`    Tokenizer: ${ftsStats.tokenizer}`);
        console.log(`    Indexed documents: ${ftsStats.count}`);
      });

    // Reindex
    program
      .command("aura-memory:reindex")
      .description("Reindex all hot memories for search")
      .option("-b, --batch-size <n>", "Batch size for indexing", "50")
      .action(async (options) => {
        const memoryStore = getTieredMemoryStore();
        if (!memoryStore) {
          console.log("AURA Memory Store: Not initialized");
          return;
        }

        const indexBuilder = memoryStore.getSearchIndexBuilder();
        if (!indexBuilder) {
          console.log("AURA Search Index Builder: Not initialized");
          return;
        }

        console.log("Starting reindex of all hot memories...");
        // ... reindex logic
      });
  });

  // ==========================================
  // SHUTDOWN HANDLERS
  // ==========================================
  // Flush pending immediate extractions on shutdown
  process.on("SIGTERM", async () => {
    api.logger.info("[AURA Memory] SIGTERM received, shutting down...");
    if (sessionWatcher) {
      sessionWatcher.stop();
      api.logger.info("[AURA Memory] Session watcher stopped");
    }
    if (immediateExtractionService) {
      await immediateExtractionService.flushAll();
    }
  });

  process.on("SIGINT", async () => {
    api.logger.info("[AURA Memory] SIGINT received, shutting down...");
    if (sessionWatcher) {
      sessionWatcher.stop();
      api.logger.info("[AURA Memory] Session watcher stopped");
    }
    if (immediateExtractionService) {
      await immediateExtractionService.flushAll();
    }
  });
}

export default auraMemoryPlugin;

// Re-export for external use
export {
  startAuraMemorySystem,
  stopAuraMemorySystem,
  getAuraMemoryStatus,
  getTieredMemoryStore,
  getKnowledgeGraphIntegration,
  getSessionFetcher,
  getAgentOrchestrator,
  getSmartExtraction,
} from "./startup.js";

export {
  createImmediateExtractionService,
  ImmediateExtractionService,
} from "./extraction/ImmediateExtractionService.js";

export {
  initializeContextInjector,
  getContextInjector,
  isContextInjectorInitialized,
} from "./agents/ContextInjector.js";

export {
  EmbeddingService,
  createEmbeddingService,
  initializeEmbeddingService,
  getEmbeddingServiceSafe,
  isEmbeddingServiceInitialized,
} from "./embeddings/EmbeddingService.js";

export { VectorSearchSchema, createVectorSearchSchema } from "./embeddings/VectorSearchSchema.js";

export { FtsSearchSchema, createFtsSearchSchema } from "./embeddings/FtsSearchSchema.js";

export { SearchIndexBuilder, createSearchIndexBuilder } from "./embeddings/SearchIndexBuilder.js";

export {
  QueryEmbeddingService,
  createQueryEmbeddingService,
} from "./context/services/QueryEmbeddingService.js";

export type {
  QueryEmbeddingServiceConfig,
  QueryEmbeddingResult,
} from "./context/services/QueryEmbeddingService.js";

// Context builders (for evaluation framework)
export { GraphAwareContextBuilder } from "./context/builders/graph-aware-builder.js";
export { ThreeStageContextBuilder } from "./context/builders/three-stage-builder.js";

// Graph context injector (for system prompt integration)
export {
  GraphContextInjector,
  createGraphContextInjector,
  injectGraphContext,
} from "./context/injector/graph-context-injector.js";
export type {
  GraphInjectionInput,
  GraphInjectionResult,
} from "./context/injector/graph-context-injector.js";

// Simple system prompt integration
export { getGraphContextForQuery } from "./agents/ContextInjector.js";

// Graph traversal and entity resolution (for evaluation framework)
export { GraphTraversalSearch } from "./graph/traversal/traversal-search.js";
export { EntityResolver } from "./graph/entity-resolution/EntityResolver.js";

// Types for evaluation framework
export type { Neo4jDriver } from "./adapters/kg-storage/types.js";
