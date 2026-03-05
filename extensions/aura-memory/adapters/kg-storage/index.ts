/**
 * KG Storage Module
 * Knowledge Graph storage operations for entities and relationships
 */

// Types
export type {
  Neo4jDriver,
  Neo4jSession,
  Neo4jResult,
  Neo4jRecord,
  Neo4jSummary,
  CreateRelationshipParams,
  UpdateAliasesParams,
  LinkEpisodeParams,
  RelationshipResult,
  AliasResult,
  EpisodeLinkResult,
  EntityLookupResult,
  KGStorageConfig,
  KGStorageDependencies,
} from "./types.js";

// Relationship Store
export { RelationshipStore, createRelationshipStore } from "./relationship-store.js";

// Alias Store
export { AliasStore, createAliasStore } from "./alias-store.js";

// Episode Linker
export { EpisodeLinker, createEpisodeLinker } from "./episode-linker.js";
