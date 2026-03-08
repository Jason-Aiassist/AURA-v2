/**
 * AURA Memory System - Startup and Initialization
 *
 * Wires the session extraction cron job into the OpenClaw container.
 * Called during gateway startup.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConcreteKnowledgeGraph as createKnowledgeGraph } from "./adapters/ConcreteKnowledgeGraph.js";
import { createRelationshipStore, createAliasStore } from "./adapters/kg-storage/index.js";
import { createTieredMemoryStore as createMemoryStore } from "./adapters/TieredMemoryStore.js";
import { AgentOrchestrator } from "./agents/AgentOrchestrator.js";
import { DeepCoderAgent } from "./agents/DeepCoderAgent.js";
import { getUserName } from "./config/user-config.js";
import { SessionFileFetcher } from "./cron/SessionFileFetcher.js";
import {
  EmbeddingService,
  initializeEmbeddingService,
} from "./embeddings/EmbeddingService.js";
import { SearchIndexBuilder } from "./embeddings/SearchIndexBuilder.js";
import { EncryptionService } from "./encryption/EncryptionService.js";
import { createPasswordKeyProvider } from "./encryption/keyDerivation.js";
import { EntityExtractor } from "./entities/EntityExtractor.js";
import { EntityLinker } from "./entities/EntityLinker.js";
import { KnowledgeGraphIntegration } from "./graph/KnowledgeGraphIntegration.js";
import { createAgentAdapter } from "./integration/agent-adapter.js";
// Phase 1: Semantic Extraction Integration
import { createSemanticExtractionBridge } from "./integration/bridge.js";
import { isSemanticExtractionEnabled } from "./integration/feature-flags.js";
import { createSmartExtractionService } from "./integration/SmartExtractionService.js";
import type { SmartExtractionService } from "./integration/SmartExtractionService.js";
import { sanitize } from "./pii/sanitize.js";
import type { AuraMemoryConfig } from "./types.js";

// Logger type matching OpenClaw PluginLogger
interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, error?: Error, meta?: Record<string, unknown>) => void;
}

// Global logger instance (set during initialization)
// Default to silent - will be replaced with actual logger during init
let log: Logger = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
};

// Global instance for cleanup
// Cron orchestrator removed - using immediate extraction via ImmediateExtractionService

// Global instances for context injection access
let globalMemoryStore: ReturnType<typeof createMemoryStore> | null = null;
let globalKnowledgeGraphIntegration: KnowledgeGraphIntegration | null = null;
let globalEmbeddingService: EmbeddingService | null = null;
let globalEncryptionService: EncryptionService | null = null;
let globalSessionFetcher: SessionFileFetcher | null = null;
let globalAgentOrchestrator: AgentOrchestrator | null = null;
let globalKnowledgeGraph: ReturnType<typeof createKnowledgeGraph> | null = null;
let globalSmartExtraction: SmartExtractionService | null = null;

/**
 * Default configuration for super-agent container
 */
function getDefaultConfig(): AuraMemoryConfig {
  return {
    intervalMinutes: 5,
    maxDurationMinutes: 10,
    batchSize: 100,
    sessionsDir: path.join(os.homedir(), ".openclaw", "agents", "main", "sessions"),
    workDir: path.join(os.homedir(), ".openclaw", "state", "aura", "work"),
    checkpointPath: path.join(os.homedir(), ".openclaw", "state", "aura", "checkpoints.json"),
    llm: {
      model: "coder_fast",
      baseUrl: process.env.CODE_WEAVER_URL || "https://llm.code-weaver.co.uk/v1",
      apiKey: process.env.CODE_WEAVER_API_KEY || "sk-local",
    },
    neo4j: {
      url: process.env.NEO4J_URL || "bolt://neo4j-memory:7687",
      username: process.env.NEO4J_USERNAME || "neo4j",
      password: process.env.NEO4J_PASSWORD || "poc-password-123",
    },
    encryption: {
      enabled: true,
      password: process.env.OPENCLAW_MEMORY_ENCRYPTION_PASSWORD || "aura-dev-password",
    },
    embedding: {
      enabled: process.env.OLLAMA_EMBED_ENABLED !== "false", // Enabled by default
      baseUrl: process.env.OLLAMA_EMBED_URL || "http://ollama-embed-gpu0:11434",
      model: process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text",
      dimensions: 768,
      timeoutMs: 10000,
      batchSize: 100,
    },
  };
}

/**
 * Ensure required directories exist
 */
async function ensureDirectories(config: AuraMemoryConfig): Promise<void> {
  log.info("[AURA Memory] ensureDirectories() called");
  const dirs = [
    path.dirname(config.checkpointPath),
    config.workDir,
    path.join(os.homedir(), ".openclaw", "state", "aura", "cold"),
  ];

  log.info("[AURA Memory] Creating directories:", { dirs });

  for (const dir of dirs) {
    try {
      log.info("[AURA Memory] Creating directory:", { dir });
      await fs.mkdir(dir, { recursive: true });
      log.info("[AURA Memory] Directory created:", { dir });
    } catch (dirError) {
      const errorMsg = dirError instanceof Error ? dirError.message : String(dirError);
      log.error("[AURA Memory] FAILED to create directory:", { dir, error: errorMsg });
      throw dirError;
    }
  }

  log.info("[AURA Memory] AURA memory directories ensured");
}

/**
 * Create job state storage (simplified JSON-based)
 */
function createJobStateStorage(checkpointPath: string) {
  const statePath = path.join(path.dirname(checkpointPath), "job-state.json");

  return {
    async loadState() {
      try {
        const data = await fs.readFile(statePath, "utf-8");
        return JSON.parse(data);
      } catch {
        return {
          lastRunTimestamp: 0,
          consecutiveFailures: 0,
          nextScheduledRun: Date.now(),
        };
      }
    },
    async saveState(state: unknown) {
      await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
    },
    async saveJobRun(run: unknown) {
      // Append to job runs log
      const runsPath = path.join(path.dirname(checkpointPath), "job-runs.jsonl");
      await fs.appendFile(runsPath, JSON.stringify(run) + "\n", "utf-8");
    },
    async getLastJobRun() {
      try {
        const runsPath = path.join(path.dirname(checkpointPath), "job-runs.jsonl");
        const data = await fs.readFile(runsPath, "utf-8");
        const lines = data.trim().split("\n").filter(Boolean);
        if (lines.length === 0) return undefined;
        return JSON.parse(lines[lines.length - 1]);
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Create stub review queue (automatic mode - no review)
 */
function createStubReviewQueue() {
  return {
    async add() {
      // No-op in automatic mode
    },
    async getPending() {
      return [];
    },
    async getById() {
      return null;
    },
    async approve() {
      // No-op
    },
    async reject() {
      // No-op
    },
    async getPendingCount() {
      return 0;
    },
  };
}

/**
 * Create tiered memory store with hot/warm/cold storage
 */
function initMemoryStore() {
  log.info("[AURA Memory] Creating tiered memory store (hot/warm/cold)...");
  try {
    const store = createMemoryStore(
      {
        dbPath: path.join(os.homedir(), ".openclaw", "state", "aura", "tiered-memory.sqlite"),
        archivePath: path.join(os.homedir(), ".openclaw", "state", "aura", "cold-archive"),
        hotMaxSize: 100,
        warmMaxSize: 1000,
      },
      log,
    );
    log.info("[AURA Memory] Tiered memory store created successfully");
    return store;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "No stack";
    log.error("[AURA Memory] ERROR creating tiered memory store:", {
      message: errorMsg,
      stack: errorStack,
    });
    throw error;
  }
}

/**
 * Create concrete knowledge graph with Neo4j-backed storage
 */
function initKnowledgeGraph() {
  log.info("[AURA Memory] Creating concrete knowledge graph (Neo4j-backed)...");
  try {
    const kg = createKnowledgeGraph(log);
    log.info("[AURA Memory] Concrete knowledge graph created successfully");
    return kg;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "No stack";
    log.error("[AURA Memory] ERROR creating knowledge graph:", {
      message: errorMsg,
      stack: errorStack,
    });
    throw error;
  }
}

/**
 * Initialize and start AURA memory extraction system
 */
export async function startAuraMemorySystem(pluginLogger?: Logger): Promise<void> {
  // Use provided logger or fall back to console
  if (pluginLogger) {
    log = pluginLogger;
  }

  // DEBUG: Startup entry confirmation
  log.info("[AURA Memory] ==========================================");
  log.info("[AURA Memory] STARTAURAMEMORYSYSTEM CALLED");
  log.info("[AURA Memory] ==========================================");
  log.info("Starting AURA memory system initialization");

  try {
    const config = getDefaultConfig();
    log.info("[AURA Memory] Config loaded:", {
      intervalMinutes: config.intervalMinutes,
      sessionsDir: config.sessionsDir,
      workDir: config.workDir,
    });

    // Ensure directories exist
    log.info("[AURA Memory] Ensuring directories exist...");
    await ensureDirectories(config);
    log.info("[AURA Memory] Directories ensured");

    // Initialize session file fetcher
    const sessionFetcher = new SessionFileFetcher({
      sessionsDir: config.sessionsDir,
      workDir: config.workDir,
      checkpointPath: config.checkpointPath,
    });
    await sessionFetcher.initialize();
    globalSessionFetcher = sessionFetcher;

    // Initialize DeepCoderAgent
    const deepCoderAgent = new DeepCoderAgent({
      model: config.llm.model,
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
    });

    // Initialize encryption service
    let encryptionService: EncryptionService | undefined;
    if (config.encryption.enabled) {
      const keyProvider = createPasswordKeyProvider(config.encryption.password!);
      encryptionService = new EncryptionService({
        config: { algorithm: "aes-256-gcm", pbkdf2Iterations: 100000, ivLength: 16 },
        keyProvider,
        now: () => Date.now(),
      });
      globalEncryptionService = encryptionService;
      log.info("Encryption service initialized");
    }

    // Initialize embedding service for vector search
    log.info("[AURA Memory] Initializing embedding service...");
    if (config.embedding.enabled) {
      const embeddingService = new EmbeddingService({
        baseUrl: config.embedding.baseUrl,
        model: config.embedding.model,
        dimensions: config.embedding.dimensions,
        timeoutMs: config.embedding.timeoutMs,
        batchSize: config.embedding.batchSize,
      });

      // Check Ollama health
      const ollamaHealthy = await embeddingService.healthCheck();
      if (ollamaHealthy) {
        log.info("[AURA Memory] Embedding service initialized successfully", {
          model: config.embedding.model,
          baseUrl: config.embedding.baseUrl,
        });
        globalEmbeddingService = embeddingService;
      } else {
        log.warn(
          "[AURA Memory] Ollama embedding service not available. Vector search will be disabled.",
          {
            baseUrl: config.embedding.baseUrl,
          },
        );
        globalEmbeddingService = null;
      }
    } else {
      log.info("[AURA Memory] Embedding service disabled in config");
    }

    // Create job state storage first (needed for various components)
    const jobStateStorage = createJobStateStorage(config.checkpointPath);

    // Create review queue (automatic mode - no human review)
    const reviewQueue = createStubReviewQueue();

    // Create concrete storage adapters (needed for Knowledge Graph Integration)
    log.info("[AURA Memory] Initializing memory store...");
    let memoryStore;
    try {
      memoryStore = initMemoryStore();
      log.info("[AURA Memory] Memory store initialized successfully");
    } catch (memError) {
      const memErrorMsg = memError instanceof Error ? memError.message : String(memError);
      const memErrorStack = memError instanceof Error ? memError.stack : "No stack";
      log.error("[AURA Memory] FAILED to initialize memory store:", {
        message: memErrorMsg,
        stack: memErrorStack,
      });
      throw memError;
    }

    log.info("[AURA Memory] Initializing knowledge graph...");
    let knowledgeGraph;
    try {
      knowledgeGraph = initKnowledgeGraph();
      log.info("[AURA Memory] Knowledge graph initialized successfully");
    } catch (kgError) {
      const kgErrorMsg = kgError instanceof Error ? kgError.message : String(kgError);
      const kgErrorStack = kgError instanceof Error ? kgError.stack : "No stack";
      log.error("[AURA Memory] FAILED to initialize knowledge graph:", {
        message: kgErrorMsg,
        stack: kgErrorStack,
      });
      throw kgError;
    }
    globalKnowledgeGraph = knowledgeGraph;

    // Phase 1: Initialize Semantic Extraction Bridge (if enabled)
    let semanticAdapter = null;
    if (isSemanticExtractionEnabled()) {
      log.info("[AURA Memory] Phase 1: Semantic extraction enabled, initializing bridge...");

      try {
        // Create Neo4j driver for bridge stores (same config as knowledgeGraph)
        const neo4j = await import("neo4j-driver");
        const driver = neo4j.default.driver(
          config.neo4j.url,
          neo4j.default.auth.basic(config.neo4j.username, config.neo4j.password),
        );

        // Verify connection
        const session = driver.session();
        await session.run("RETURN 1");
        await session.close();
        log.info("[AURA Memory] Bridge Neo4j connection verified");

        // Create bridge stores
        const relationshipStore = createRelationshipStore({ driver }, { database: "neo4j" });
        const aliasStore = createAliasStore({ driver }, { database: "neo4j" });

        // Create bridge
        const bridge = createSemanticExtractionBridge(
          {
            llm: llmClient,
            relationshipStore,
            aliasStore,
            now: () => Date.now(),
            generateId: () => `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          },
          {
            enabled: true,
            debug: process.env.DEBUG?.includes("aura:bridge") || false,
            minConfidence: 0.7,
            maxEntities: 20,
            maxRelationships: 30,
          },
        );

        // Create agent adapter
        semanticAdapter = createAgentAdapter(bridge);

        log.info("[AURA Memory] Phase 1: Semantic extraction bridge initialized", {
          enabled: bridge.isEnabled(),
          config: bridge.getConfig(),
        });
      } catch (error) {
        log.error("[AURA Memory] Phase 1: Failed to initialize semantic bridge", error as Error, {
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        });
        // Continue without semantic extraction (graceful degradation)
        semanticAdapter = null;
      }
    } else {
      log.info(
        "[AURA Memory] Phase 1: Semantic extraction disabled (set AURA_SEMANTIC_EXTRACTION=true to enable)",
      );
    }

    // Initialize Agent Pipeline components
    log.info("[AURA Memory] Initializing Agent Pipeline...");

    // Create LLM client wrapper for entity extraction
    const llmClient = {
      complete: async (params: { prompt: string; maxTokens?: number; temperature?: number }) => {
        const response = await deepCoderAgent["llmClient"].complete(params);
        return {
          content: response.content,
          tokensUsed: response.tokensUsed || { input: 0, output: 0 },
        };
      },
    };

    // Initialize Entity Extractor
    const entityExtractor = new EntityExtractor({
      llm: llmClient,
      auditLog: async (event) => {
        log.debug("Entity extraction audit", event);
      },
      now: () => Date.now(),
      generateId: () => `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    });

    // Initialize Entity Linker with Neo4j client adapter
    const entityLinker = new EntityLinker({
      neo4jClient: {
        addEntity: async (name: string, type: string, summary: string) => {
          // Use knowledge graph's internal Neo4j connection via createEpisode/linkEntities
          // This is a simplified adapter - the actual linking happens through KnowledgeGraphIntegration
          log.debug("EntityLinker.addEntity", { name, type });
          return { uuid: `ent-${Date.now()}`, name, entity_type: type, summary };
        },
        addMentions: async (_episodeUuid: string, _entityName: string) => {
          // Handled by KnowledgeGraphIntegration
        },
        addRelationship: async (_from: string, _to: string, _fact: string) => {
          // Handled by KnowledgeGraphIntegration
        },
        getEntity: async (_name: string) => {
          return null; // Simplified - KG handles deduplication
        },
      },
      auditLog: async (event) => {
        log.debug("Entity linking audit", event);
      },
      now: () => Date.now(),
      generateId: () => `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    });

    // Initialize Knowledge Graph Integration
    const knowledgeGraphIntegration = new KnowledgeGraphIntegration(
      {
        enabled: true,
        createEpisodes: true,
        extractEntities: true,
        linkEntities: true,
      },
      {
        knowledgeGraph,
        entityExtractor,
        entityLinker,
        log,
        encryptionService, // Pass encryption service for decrypting User memories
      },
    );

    // Store references for context injection
    globalMemoryStore = memoryStore;
    globalKnowledgeGraphIntegration = knowledgeGraphIntegration;

    // Initialize Search Index Builder (if embedding service available)
    let searchIndexBuilder: SearchIndexBuilder | undefined;
    if (globalEmbeddingService) {
      log.info("[AURA Memory] Initializing search index builder...");
      try {
        const hotTier = memoryStore.getHotTier();
        searchIndexBuilder = new SearchIndexBuilder({
          embeddingService: globalEmbeddingService,
          vectorSchema: hotTier.getVectorSchema(),
          ftsSchema: hotTier.getFtsSchema(),
          log,
          enableEncryption: config.encryption.enabled,
          indexEncryptedInFts: false,
        });

        // Attach to memory store for automatic indexing
        memoryStore.setSearchIndexBuilder(searchIndexBuilder);
        log.info("[AURA Memory] Search index builder initialized and attached");
      } catch (error) {
        log.error("[AURA Memory] Failed to initialize search index builder:", error as Error);
        // Continue without search indexing
        searchIndexBuilder = undefined;
      }
    } else {
      log.info("[AURA Memory] Search index builder skipped (embedding service not available)");
    }

    // Initialize Agent Orchestrator (replaces ExtractionEngine)
    // Phase 1: Pass semantic adapter if available
    const agentOrchestrator = new AgentOrchestrator(
      {
        steps: semanticAdapter ? ["extract", "entities", "semantic"] : ["extract", "entities"],
        parallel: false,
        retryAttempts: 2,
        timeoutMs: semanticAdapter ? 120000 : 60000, // Longer timeout with semantic extraction
      },
      {
        extractionAgent: deepCoderAgent,
        entityExtractor,
        log,
        semanticAdapter, // Phase 1: Optional semantic extraction
      },
    );

    log.info("[AURA Memory] Agent Pipeline initialized", {
      semanticExtraction: !!semanticAdapter,
      steps: semanticAdapter ? ["extract", "entities", "semantic"] : ["extract", "entities"],
    });
    globalAgentOrchestrator = agentOrchestrator;

    // Verify connections
    const neo4jConnected = await knowledgeGraph.verifyConnection();
    if (!neo4jConnected) {
      log.warn("[AURA Memory] Neo4j connection failed, Knowledge Graph will be unavailable");
    } else {
      log.info("[AURA Memory] Neo4j connection verified");
    }

    // Initialize Smart Extraction Service (Phase 1)
    log.info("[AURA Memory] Initializing Smart Extraction Service...");
    let smartExtraction;
    try {
      smartExtraction = createSmartExtractionService(
        {
          enabled: true,
          userName: getUserName(),
          useSmartExtractor: true, // Enabled for rich relationship extraction
          useCanonicalization: true, // Safe to enable
          useDeduplication: true, // Safe to enable
          useRecallDetection: true, // Prevent feedback loop
          coderFastModel: "qwen2.5-coder:14b",
          coderFastBaseUrl: "http://ollama-embed-gpu0:11434",
          similarityThreshold: 0.85,
        },
        {
          knowledgeGraph: knowledgeGraphIntegration,
          embeddingService: globalEmbeddingService || undefined,
          memoryStore: memoryStore, // NEW: Required for storeMemory
          encryptionService: globalEncryptionService || undefined, // NEW: For User category encryption
          searchIndexBuilder: searchIndexBuilder || undefined, // NEW: For FTS/vector indexing
          log,
        },
      );

      // Initialize smart extraction with existing KG data
      await smartExtraction.initialize();
    } catch (smartError) {
      const errorMsg = smartError instanceof Error ? smartError.message : String(smartError);
      const errorStack = smartError instanceof Error ? smartError.stack : "No stack";
      log.error("[AURA Memory] FAILED to initialize Smart Extraction Service:", {
        error: errorMsg,
        stack: errorStack,
        errorType: typeof smartError,
        errorName: smartError instanceof Error ? smartError.name : "N/A",
      });
      console.error("[AURA Memory] Smart Extraction Service initialization error:", smartError);
      throw smartError;
    }

    log.info("[AURA Memory] Smart Extraction Service initialized", {
      canonicalization: true,
      deduplication: true,
      smartExtractor: true,
      recallDetection: true,
    });
    globalSmartExtraction = smartExtraction;

    // EXTRACTION: Using immediate extraction via ImmediateExtractionService
    // Cron-based extraction has been removed - extraction now happens on every user prompt
    log.info("[AURA Memory] Using immediate extraction mode");

    log.info("AURA memory system started successfully (immediate extraction mode)", {
      sessionsDir: config.sessionsDir,
    });

    // Handle graceful shutdown
    process.on("SIGTERM", async () => {
      log.info("SIGTERM received, stopping AURA memory system");
      await stopAuraMemorySystem();
    });

    process.on("SIGINT", async () => {
      log.info("SIGINT received, stopping AURA memory system");
      await stopAuraMemorySystem();
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "No stack trace";
    log.error("[AURA Memory] ==========================================");
    log.error("[AURA Memory] FAILED TO START AURA MEMORY SYSTEM");
    log.error("[AURA Memory] ==========================================");
    log.error("[AURA Memory] Error message:", { message: errorMsg });
    log.error("[AURA Memory] Error stack:", { stack: errorStack });
    log.error("[AURA Memory] Full error object:", {
      error: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    });
    throw error;
  }
}

/**
 * Stop AURA memory extraction system
 */
export async function stopAuraMemorySystem(): Promise<void> {
  if (auraOrchestrator) {
    await auraOrchestrator.stop();
    auraOrchestrator = null;
    log.info("AURA memory system stopped");
  }
}

/**
 * Get AURA memory system status
 */
export async function getAuraMemoryStatus(): Promise<unknown> {
  if (!auraOrchestrator) {
    return { running: false };
  }
  return auraOrchestrator.getStatus();
}

/**
 * Get the initialized TieredMemoryStore
 * Used by context injection system
 */
export function getTieredMemoryStore(): ReturnType<typeof createMemoryStore> | null {
  return globalMemoryStore;
}

/**
 * Get the initialized KnowledgeGraphIntegration
 * Used by context injection system
 */
export function getKnowledgeGraphIntegration(): KnowledgeGraphIntegration | null {
  return globalKnowledgeGraphIntegration;
}

/**
 * Get the initialized EmbeddingService
 * Used for generating query embeddings during context injection
 */
export function getEmbeddingService(): EmbeddingService | null {
  return globalEmbeddingService;
}

/**
 * Get the initialized EncryptionService
 * Used for decrypting User category memories during context injection
 */
export function getEncryptionService(): EncryptionService | null {
  return globalEncryptionService;
}

/**
 * Get the initialized SessionFileFetcher
 * Used by ImmediateExtractionService for event-driven extraction
 */
export function getSessionFetcher(): SessionFileFetcher | null {
  return globalSessionFetcher;
}

/**
 * Get the initialized AgentOrchestrator
 * Used by ImmediateExtractionService for processing sessions
 */
export function getAgentOrchestrator(): AgentOrchestrator | null {
  return globalAgentOrchestrator;
}

/**
 * Get the initialized KnowledgeGraph
 * Used by ImmediateExtractionService
 */
export function getKnowledgeGraph(): ReturnType<typeof createKnowledgeGraph> | null {
  return globalKnowledgeGraph;
}

/**
 * Get the initialized SmartExtractionService
 * Used by ImmediateExtractionService
 */
export function getSmartExtraction(): SmartExtractionService | null {
  return globalSmartExtraction;
}
