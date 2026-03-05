/**
 * Smart Extraction Integration
 *
 * Integrates SmartExtractor, EntityCanonicalizer, and DeduplicationService
 * into the existing cron workflow without breaking existing functionality.
 */

// UUID generation without external dependency
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
import type { TieredMemoryStore } from "../adapters/TieredMemoryStore.js";
import type { MemoryCategory, StorageTier } from "../categories/types.js";
import { getUserName, getUserAliases } from "../config/user-config.js";
import type { EmbeddingService } from "../embeddings/EmbeddingService.js";
import type { SearchIndexBuilder } from "../embeddings/SearchIndexBuilder.js";
import type { EncryptionService } from "../encryption/EncryptionService.js";
import {
  createDeduplicationService,
  DeduplicationService,
  Memory as DeduplicationMemory,
} from "../extraction/DeduplicationService.js";
import {
  createEntityCanonicalizer,
  EntityCanonicalizer,
} from "../extraction/EntityCanonicalizer.js";
import {
  createRecallDetectionService,
  RecallDetectionService,
} from "../extraction/RecallDetectionService.js";
import {
  createSmartExtractor,
  SmartExtractor,
  ExtractedMemory,
} from "../extraction/SmartExtractor.js";
import type { KnowledgeGraphIntegration } from "../graph/KnowledgeGraphIntegration.js";
import type { Logger } from "../types.js";

export interface SmartExtractionConfig {
  enabled: boolean;
  userName: string;
  useSmartExtractor: boolean;
  useCanonicalization: boolean;
  useDeduplication: boolean;
  useRecallDetection: boolean;
  coderFastModel: string;
  coderFastBaseUrl: string;
  similarityThreshold: number;
}

export interface SmartExtractionDependencies {
  knowledgeGraph?: KnowledgeGraphIntegration;
  embeddingService?: EmbeddingService;
  memoryStore: TieredMemoryStore;
  encryptionService?: EncryptionService;
  searchIndexBuilder?: SearchIndexBuilder;
  log: Logger;
}

export interface MemoryWithUUID extends ExtractedMemory {
  uuid: string;
  contentHash?: string;
}

/**
 * Smart Extraction Service
 * Wraps the new extraction components with backward compatibility
 */
export class SmartExtractionService {
  private config: SmartExtractionConfig;
  private deps: SmartExtractionDependencies;
  private extractor?: SmartExtractor;
  private canonicalizer: EntityCanonicalizer;
  private deduplicator: DeduplicationService;
  private recallDetector: RecallDetectionService;
  private existingMemoryCache: DeduplicationMemory[] = [];
  private entityCache: Set<string> = new Set();

  constructor(config: Partial<SmartExtractionConfig>, deps: SmartExtractionDependencies) {
    const userName = getUserName();
    const userAliases = getUserAliases();
    this.config = {
      enabled: true,
      userName: userName,
      useSmartExtractor: false, // Disabled by default for safety
      useCanonicalization: true, // Safe to enable
      useDeduplication: true, // Safe to enable
      coderFastModel: "qwen2.5-coder:14b",
      coderFastBaseUrl: "http://ollama-embed-gpu0:11434",
      similarityThreshold: 0.85,
      ...config,
    };
    this.deps = deps;

    // Initialize canonicalizer
    this.canonicalizer = createEntityCanonicalizer({
      userCanonicalName: this.config.userName,
      userAliases: [
        userName.toLowerCase(),
        "user",
        "USER",
        "my",
        "me",
        "mine",
        "myself",
        "I",
        "i",
        "my",
        "we",
        "our",
        "ours",
        ...userAliases,
      ],
    });

    // Initialize deduplicator
    this.deduplicator = createDeduplicationService(
      {
        similarityThreshold: this.config.similarityThreshold,
        exactMatchThreshold: 0.95,
        contentHashMatch: true,
        semanticCheck: !!deps.embeddingService,
        maxCandidates: 10,
      },
      deps.embeddingService,
    );

    // Initialize smart extractor only if enabled
    if (this.config.useSmartExtractor) {
      this.extractor = createSmartExtractor(
        {
          model: this.config.coderFastModel,
          baseUrl: this.config.coderFastBaseUrl,
          userName: this.config.userName,
        },
        deps.embeddingService,
      );
    }

    // Initialize recall detector
    this.recallDetector = createRecallDetectionService(
      {
        similarityThreshold: 0.75,
        minNovelContentRatio: 0.3,
        contextWindowMs: 5 * 60 * 1000,
      },
      deps.log,
    );

    this.deps.log.info("[SmartExtraction] Service initialized", {
      enabled: this.config.enabled,
      useSmartExtractor: this.config.useSmartExtractor,
      useCanonicalization: this.config.useCanonicalization,
      useDeduplication: this.config.useDeduplication,
    });
  }

  /**
   * Initialize with existing data from knowledge graph
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) return;

    try {
      // Load existing entities from KG for canonicalization
      if (this.deps.knowledgeGraph) {
        const entities = (await this.deps.knowledgeGraph.getAllEntityNames?.()) || [];
        this.canonicalizer.registerEntities(entities);
        entities.forEach((e) => this.entityCache.add(e.toLowerCase()));

        this.deps.log.info("[SmartExtraction] Loaded entities from KG", {
          count: entities.length,
        });
      }
    } catch (error) {
      this.deps.log.warn("[SmartExtraction] Failed to initialize from KG", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Canonicalize entities from extraction output
   * Safe to call even if canonicalization is disabled (returns originals)
   */
  canonicalizeEntities(entities: string[]): string[] {
    if (!this.config.enabled || !this.config.useCanonicalization) {
      return entities;
    }

    const results = this.canonicalizer.canonicalizeMany(entities);

    // Log mappings for debugging
    const mappings = results.filter((r) => r.original !== r.canonical);
    if (mappings.length > 0) {
      this.deps.log.debug("[SmartExtraction] Entity canonicalization", {
        mappings: mappings.map((m) => ({
          from: m.original,
          to: m.canonical,
          confidence: m.confidence,
        })),
      });
    }

    return results.map((r) => r.canonical);
  }

  /**
   * Canonicalize a single entity
   */
  canonicalizeEntity(entity: string): string {
    if (!this.config.enabled || !this.config.useCanonicalization) {
      return entity;
    }

    const result = this.canonicalizer.canonicalize(entity);
    return result.canonical;
  }

  /**
   * Check for duplicates and filter them out
   * Returns only new, non-duplicate memories
   */
  async deduplicateMemories(
    memories: MemoryWithUUID[],
    context?: string,
  ): Promise<{
    newMemories: MemoryWithUUID[];
    duplicates: MemoryWithUUID[];
    stats: {
      checked: number;
      duplicates: number;
      new: number;
    };
  }> {
    if (!this.config.enabled || !this.config.useDeduplication) {
      return {
        newMemories: memories,
        duplicates: [],
        stats: { checked: memories.length, duplicates: 0, new: memories.length },
      };
    }

    const newMemories: MemoryWithUUID[] = [];
    const duplicates: MemoryWithUUID[] = [];

    for (const memory of memories) {
      const checkResult = await this.deduplicator.check(
        {
          uuid: memory.uuid,
          content: memory.content,
          entities: memory.entities,
        },
        this.existingMemoryCache,
      );

      if (checkResult.isDuplicate) {
        duplicates.push(memory);
        this.deps.log.debug("[SmartExtraction] Duplicate detected", {
          uuid: memory.uuid,
          reason: checkResult.reasoning,
          similarity: checkResult.similarityScore,
        });
      } else {
        newMemories.push(memory);
        // Add to cache for future deduplication in this session
        this.existingMemoryCache.push({
          uuid: memory.uuid,
          content: memory.content,
          entities: memory.entities,
        });
        // Register content hash
        if (memory.contentHash) {
          this.deduplicator.registerContentHash(memory.contentHash);
        }
      }
    }

    this.deps.log.info("[SmartExtraction] Deduplication complete", {
      context,
      checked: memories.length,
      duplicates: duplicates.length,
      new: newMemories.length,
    });

    return {
      newMemories,
      duplicates,
      stats: {
        checked: memories.length,
        duplicates: duplicates.length,
        new: newMemories.length,
      },
    };
  }

  /**
   * Register memories as existing (for deduplication)
   */
  registerExistingMemories(
    memories: Array<{ uuid: string; content: string; entities?: string[]; contentHash?: string }>,
  ): void {
    for (const memory of memories) {
      this.existingMemoryCache.push({
        uuid: memory.uuid,
        content: memory.content,
        entities: memory.entities,
      });
      if (memory.contentHash) {
        this.deduplicator.registerContentHash(memory.contentHash);
      }
    }
  }

  /**
   * Extract memories using SmartExtractor (if enabled)
   * Falls back to false to use existing extraction
   */
  async extractWithSmartExtractor(
    conversation: string,
    existingEntities?: string[],
  ): Promise<{
    success: boolean;
    memories: ExtractedMemory[];
    relationships: Array<{
      from: string;
      to: string;
      type: string;
      evidence: string;
    }>;
    error?: string;
  }> {
    if (!this.config.enabled || !this.config.useSmartExtractor || !this.extractor) {
      return {
        success: false,
        memories: [],
        relationships: [],
        error: "SmartExtractor not enabled",
      };
    }

    try {
      const result = await this.extractor.extract(
        conversation,
        existingEntities || Array.from(this.entityCache),
      );

      this.deps.log.info("[SmartExtraction] Smart extraction complete", {
        memories: result.memories.length,
        relationships: result.relationships.length,
      });

      return {
        success: true,
        memories: result.memories,
        relationships: result.relationships.map((r) => ({
          from: r.from,
          to: r.to,
          type: r.type,
          evidence: r.evidence,
        })),
      };
    } catch (error) {
      this.deps.log.error("[SmartExtraction] Smart extraction failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        memories: [],
        relationships: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if a message should be skipped as recall
   */
  checkForRecall(
    messageContent: string,
    sessionId: string,
    messageRole: "user" | "assistant" | "system" = "assistant",
  ): {
    isRecall: boolean;
    reason: string;
    confidence: number;
  } {
    if (!this.config.enabled || !this.config.useRecallDetection) {
      return {
        isRecall: false,
        reason: "Recall detection disabled",
        confidence: 0,
      };
    }

    return this.recallDetector.isRecallResponse(messageContent, sessionId, messageRole);
  }

  /**
   * Record context injection for recall detection
   */
  recordContextInjection(
    sessionId: string,
    memories: Array<{ content: string; memoryId?: string }>,
    entities: string[],
  ): void {
    this.recallDetector.recordContextInjection(sessionId, memories, entities);
  }

  /**
   * Get the recall detector instance
   */
  getRecallDetector(): RecallDetectionService {
    return this.recallDetector;
  }

  /**
   * Get service status
   */
  getStatus(): {
    enabled: boolean;
    useSmartExtractor: boolean;
    useCanonicalization: boolean;
    useDeduplication: boolean;
    useRecallDetection: boolean;
    entityCacheSize: number;
    memoryCacheSize: number;
  } {
    return {
      enabled: this.config.enabled,
      useSmartExtractor: this.config.useSmartExtractor,
      useCanonicalization: this.config.useCanonicalization,
      useDeduplication: this.config.useDeduplication,
      useRecallDetection: this.config.useRecallDetection,
      entityCacheSize: this.entityCache.size,
      memoryCacheSize: this.existingMemoryCache.length,
    };
  }

  /**
   * Clear caches
   */
  clearCaches(): void {
    this.existingMemoryCache = [];
    this.entityCache.clear();
    this.canonicalizer.clearCache();
    this.deduplicator["contentHashCache"]?.clear?.();
  }

  /**
   * Store a single memory with full pipeline:
   * - Deduplication check
   * - Generate embedding
   * - Determine tier
   * - Encrypt if needed
   * - Store in TieredMemoryStore
   * - Index for search
   * - Update Knowledge Graph
   */
  async storeMemory(memory: ExtractedMemory): Promise<{
    success: boolean;
    memoryId?: string;
    error?: string;
  }> {
    try {
      this.deps.log.info("[SmartExtraction] Storing memory...", {
        contentPreview: memory.content?.substring(0, 100),
        category: memory.category,
        importance: memory.importance,
      });

      // Step 1: Deduplication check
      const dedupeResult = await this.deduplicator.check(
        {
          uuid: generateUUID(), // Temporary UUID for dedup check
          content: memory.content,
          entities: memory.entities,
        },
        this.existingMemoryCache,
      );

      if (dedupeResult.isDuplicate) {
        this.deps.log.info("[SmartExtraction] Duplicate memory detected, skipping", {
          reason: dedupeResult.reasoning,
          similarity: dedupeResult.similarityScore,
        });
        return { success: true, memoryId: dedupeResult.existingMemoryId };
      }

      // Step 2: Generate UUID and timestamps
      const memoryId = generateUUID();
      const now = Date.now();
      const nowIso = new Date(now).toISOString();

      // Step 3: Map category
      const category = this.mapExtractedCategoryToMemoryCategory(memory.category);

      // Step 4: Determine storage tier
      const tier = this.determineStorageTier(category, memory.importance);

      // Step 5: Generate embedding (async, don't block if fails)
      let embedding: number[] | undefined;
      if (this.deps.embeddingService) {
        try {
          const embedResult = await this.deps.embeddingService.generateEmbedding(memory.content);
          if (embedResult?.embedding) {
            embedding = embedResult.embedding;
          }
        } catch (embedError) {
          this.deps.log.warn("[SmartExtraction] Embedding generation failed (non-fatal)", {
            error: embedError instanceof Error ? embedError.message : String(embedError),
          });
        }
      }

      // Step 6: Encrypt if User category
      let content = memory.content;
      let encrypted = false;
      if (category === "User" && this.deps.encryptionService) {
        try {
          const encryptResult = await this.deps.encryptionService.encrypt(memory.content, category);
          if (encryptResult.success && encryptResult.encrypted) {
            content = encryptResult.encrypted;
            encrypted = true;
          }
        } catch (encryptError) {
          this.deps.log.warn("[SmartExtraction] Encryption failed (non-fatal)", {
            error: encryptError instanceof Error ? encryptError.message : String(encryptError),
          });
        }
      }

      // Step 7: Create CategorizedMemory
      const categorizedMemory = {
        memoryId,
        content,
        category,
        tier,
        encrypted,
        importance: memory.importance,
        confidence: memory.confidence,
        source: "automated" as const,
        sourceMessageIds: [], // TODO: Get from extraction context
        timestamp: now,
        createdAt: nowIso,
        lastAccessedAt: nowIso,
        accessCount: 0,
        correlationId: `extraction-${now}`,
      };

      // Step 8: Store in TieredMemoryStore
      await this.deps.memoryStore.store(categorizedMemory);
      this.deps.log.info("[SmartExtraction] Memory stored in tier", {
        memoryId,
        tier,
        category,
      });

      // Step 9: Index for search (if searchIndexBuilder available)
      if (this.deps.searchIndexBuilder) {
        try {
          await this.deps.searchIndexBuilder.indexMemory(categorizedMemory);
          this.deps.log.debug("[SmartExtraction] Memory indexed for search", { memoryId });
        } catch (indexError) {
          this.deps.log.warn("[SmartExtraction] Search indexing failed (non-fatal)", {
            error: indexError instanceof Error ? indexError.message : String(indexError),
          });
        }
      }

      // Step 10: Update Knowledge Graph with entities
      if (this.deps.knowledgeGraph) {
        try {
          // Use processMemory to handle entity extraction, episode creation, and linking
          await this.deps.knowledgeGraph.processMemory(categorizedMemory);
          this.deps.log.debug("[SmartExtraction] Memory processed in Knowledge Graph", {
            memoryId,
            entityCount: memory.entities?.length || 0,
          });
        } catch (kgError) {
          this.deps.log.warn("[SmartExtraction] Knowledge Graph update failed (non-fatal)", {
            error: kgError instanceof Error ? kgError.message : String(kgError),
          });
        }
      }

      // Step 11: Update deduplication cache
      this.existingMemoryCache.push({
        uuid: memoryId,
        content: memory.content,
        entities: memory.entities,
      });

      this.deps.log.info("[SmartExtraction] Memory stored successfully", {
        memoryId,
        category,
        tier,
        encrypted,
        hasEmbedding: !!embedding,
      });

      return { success: true, memoryId };
    } catch (error) {
      this.deps.log.error("[SmartExtraction] Failed to store memory", error as Error, {
        contentPreview: memory.content?.substring(0, 100),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Map extracted category to MemoryCategory
   */
  private mapExtractedCategoryToMemoryCategory(
    extractedCategory: ExtractedMemory["category"],
  ): MemoryCategory {
    const mapping: Record<ExtractedMemory["category"], MemoryCategory> = {
      personal: "User",
      preference: "User",
      relationship: "User",
      professional: "CurrentProject",
      event: "FutureTask",
      fact: "KnowledgeBase",
    };
    return mapping[extractedCategory] || "KnowledgeBase";
  }

  /**
   * Determine storage tier based on category and importance
   */
  private determineStorageTier(category: MemoryCategory, importance: number): StorageTier {
    // Hot tier: User category or high importance
    if (category === "User" || importance >= 0.8) {
      return "Hot";
    }

    // Warm tier: Current projects or medium importance
    if (category === "CurrentProject" || category === "FutureTask" || importance >= 0.5) {
      return "Warm";
    }

    // Cold tier: Everything else
    return "Cold";
  }
}

// Factory function
export function createSmartExtractionService(
  config: Partial<SmartExtractionConfig>,
  deps: SmartExtractionDependencies,
): SmartExtractionService {
  return new SmartExtractionService(config, deps);
}
