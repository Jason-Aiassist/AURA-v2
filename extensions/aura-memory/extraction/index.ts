/**
 * Extraction Module
 *
 * Smart memory extraction with:
 * - LLM-driven relationship extraction (coder_fast)
 * - Semantic deduplication
 * - Entity canonicalization
 */

export {
  EntityCanonicalizer,
  createEntityCanonicalizer,
  type CanonicalizationResult,
  type CanonicalizationConfig,
} from "./EntityCanonicalizer.js";

export {
  DeduplicationService,
  createDeduplicationService,
  type Memory,
  type DuplicateCheckResult,
  type DeduplicationConfig,
} from "./DeduplicationService.js";

export {
  SmartExtractor,
  createSmartExtractor,
  type ExtractedMemory,
  type ExtractedRelationship,
  type ExtractionResult,
  type SmartExtractorConfig,
} from "./SmartExtractor.js";

export {
  RecallDetectionService,
  createRecallDetectionService,
  type RecallDetectionConfig,
  type ContextInjectionRecord,
  type RelationshipPattern,
  DEFAULT_RELATIONSHIP_PATTERNS,
} from "./RecallDetectionService.js";
