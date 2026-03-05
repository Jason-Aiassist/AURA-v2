/**
 * Context Builder Factory
 * Creates appropriate builder based on feature flags
 */

import type { DatabaseSync } from "better-sqlite3";
import type { ConcreteKnowledgeGraph } from "../../adapters/ConcreteKnowledgeGraph.js";
import type { Neo4jDriver } from "../../adapters/kg-storage/types.js";
import type { TieredMemoryStore } from "../../adapters/TieredMemoryStore.js";
import type { EncryptionService } from "../../encryption/EncryptionService.js";
import type { KnowledgeGraphIntegration } from "../../graph/KnowledgeGraphIntegration.js";
import type { QueryEmbeddingService } from "../services/QueryEmbeddingService.js";
import { GraphAwareContextBuilder } from "./graph-aware-builder.js";
import { ThreeStageContextBuilder } from "./three-stage-builder.js";

export interface BuilderFactoryConfig {
  /** SQLite database */
  db: DatabaseSync;
  /** Knowledge Graph */
  knowledgeGraph?: KnowledgeGraphIntegration;
  /** Neo4j driver (required for graph-aware builder) */
  neo4jDriver?: Neo4jDriver;
  /** Memory store */
  memoryStore?: TieredMemoryStore;
  /** Encryption service */
  encryptionService?: EncryptionService;
  /** Query embedding service */
  queryEmbeddingService?: QueryEmbeddingService;
  /** Provider model */
  providerModel?: string;
  /** Token limit */
  defaultTokenLimit?: number;
  /** Core files */
  coreFiles?: string[];
  /** Feature flag: use graph-aware builder */
  useGraphAwareBuilder?: boolean;
}

/**
 * Create context builder based on configuration
 */
export function createContextBuilder(config: BuilderFactoryConfig) {
  const useGraphAware = config.useGraphAwareBuilder ?? true;

  if (useGraphAware && config.neo4jDriver) {
    return new GraphAwareContextBuilder({
      db: config.db,
      knowledgeGraph: config.knowledgeGraph,
      neo4jDriver: config.neo4jDriver,
      memoryStore: config.memoryStore,
      encryptionService: config.encryptionService,
      queryEmbeddingService: config.queryEmbeddingService,
      providerModel: config.providerModel,
      defaultTokenLimit: config.defaultTokenLimit,
      coreFiles: config.coreFiles,
      enableTraversal: true,
    });
  } else {
    return new ThreeStageContextBuilder({
      db: config.db,
      knowledgeGraph: config.knowledgeGraph,
      memoryStore: config.memoryStore,
      encryptionService: config.encryptionService,
      queryEmbeddingService: config.queryEmbeddingService,
      providerModel: config.providerModel,
      defaultTokenLimit: config.defaultTokenLimit,
      coreFiles: config.coreFiles,
    });
  }
}
