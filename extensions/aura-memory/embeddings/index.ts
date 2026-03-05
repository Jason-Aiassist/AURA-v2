/**
 * Embeddings Module - Vector search infrastructure for AURA
 *
 * Exports:
 * - EmbeddingService: Ollama-based embedding generation
 * - VectorSearchSchema: sqlite-vec table management
 * - FtsSearchSchema: FTS5 text search management
 * - Utility functions for service management
 */

export {
  EmbeddingService,
  createEmbeddingService,
  initializeEmbeddingService,
  getEmbeddingService,
  getEmbeddingServiceSafe,
  isEmbeddingServiceInitialized,
} from "./EmbeddingService.js";

export type {
  EmbeddingServiceConfig,
  EmbeddingResult,
  EmbeddingError,
} from "./EmbeddingService.js";

export { VectorSearchSchema, createVectorSearchSchema } from "./VectorSearchSchema.js";

export type { VectorSearchSchemaConfig } from "./VectorSearchSchema.js";

export { FtsSearchSchema, createFtsSearchSchema } from "./FtsSearchSchema.js";

export type { FtsSearchSchemaConfig } from "./FtsSearchSchema.js";

export { SearchIndexBuilder, createSearchIndexBuilder } from "./SearchIndexBuilder.js";

export type {
  SearchIndexBuilderConfig,
  IndexResult,
  BatchIndexResult,
} from "./SearchIndexBuilder.js";
