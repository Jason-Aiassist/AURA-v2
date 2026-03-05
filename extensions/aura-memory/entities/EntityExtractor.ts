/**
 * Entity Extractor
 * Story 3.3: Knowledge Graph Entity Extraction
 *
 * LLM-based entity extraction from memory content
 */

import type {
  ExtractedEntity,
  EntityRelationship,
  EntityExtractionResult,
  EntityExtractorConfig,
  EntityExtractorDependencies,
  RawEntityExtraction,
  EntityValidationResult,
  EntityValidationError,
  EntityType,
  RelationshipType,
} from "./types.js";
import { ENTITY_TYPES, RELATIONSHIP_TYPES } from "./types.js";

/**
 * Default extractor configuration
 */
const DEFAULT_CONFIG: EntityExtractorConfig = {
  maxTokens: 1500,
  temperature: 0.2,
  maxEntities: 20,
  validateOutput: true,
  minConfidence: 0.5,
};

/**
 * Entity extraction prompt template
 */
const ENTITY_EXTRACTION_PROMPT = `You are an entity extraction specialist. Analyze the text below and extract entities and their relationships.

TEXT TO ANALYZE:
"""
{{content}}
"""

INSTRUCTIONS:
Extract up to {{maxEntities}} entities of the following types:
- Person: People, individuals, names
- Project: Projects, initiatives, products
- Technology: Technologies, tools, frameworks, programming languages
- Organization: Companies, teams, institutions, groups
- Location: Places, cities, countries, regions, addresses
- Concept: Abstract concepts, methodologies, ideas, domains

For each entity, provide:
- name: The entity name (be consistent with naming)
- type: One of the types above
- confidence: 0.0-1.0 score based on certainty
- summary: Brief 1-2 sentence description (optional)

Then extract relationships between entities:
- works_on: Person works on Project
- knows: Person knows Person (skill or acquaintance)
- uses: Person/Organization uses Technology
- located_in: Entity located in Location
- part_of: Entity is part of Organization
- created_by: Entity created by Person/Organization
- depends_on: Project/Technology depends on Technology
- related_to: General relatedness
- manages: Person manages Person/Project
- employs: Organization employs Person

For each relationship, provide:
- from: Source entity name
- to: Target entity name
- type: One of the types above
- confidence: 0.0-1.0 score

OUTPUT FORMAT (JSON):
{
  "entities": [
    {
      "name": "Entity Name",
      "type": "Person|Project|Technology|Organization|Location|Concept",
      "confidence": 0.95,
      "summary": "Brief description"
    }
  ],
  "relationships": [
    {
      "from": "Source Entity",
      "to": "Target Entity",
      "type": "works_on|knows|uses|located_in|part_of|created_by|depends_on|related_to|manages|employs",
      "confidence": 0.85
    }
  ]
}

Only output valid JSON. No markdown, no explanations outside JSON.`;

/**
 * Entity Extractor
 *
 * Uses LLM to extract entities and relationships from text content.
 * Includes caching and performance optimizations.
 */
export class EntityExtractor {
  private config: EntityExtractorConfig;
  private deps: EntityExtractorDependencies;
  private extractionCache: Map<string, { result: EntityExtractionResult; timestamp: number }>;
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache for identical content

  constructor(deps: EntityExtractorDependencies, config?: Partial<EntityExtractorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;
    this.extractionCache = new Map();
  }

  /**
   * Extract entities from content
   *
   * @param content - Text content to analyze
   * @returns Extraction result with entities and relationships
   */
  async extract(content: string): Promise<EntityExtractionResult> {
    const correlationId = this.deps.generateId();
    const startTime = this.deps.now();

    // SKIP: Don't extract entities from encrypted content (ciphertext JSON)
    if (this.isEncryptedContent(content)) {
      this.deps.log?.debug("[EntityExtractor] Skipping encrypted content", {
        contentPreview: content.substring(0, 50),
      });
      return {
        entities: [],
        relationships: [],
        durationMs: this.deps.now() - startTime,
      };
    }

    // Check cache for identical content
    const cacheKey = this.getCacheKey(content);
    const cached = this.getCachedResult(cacheKey);
    if (cached) {
      return {
        ...cached,
        durationMs: this.deps.now() - startTime, // Update duration for cache hit
      };
    }

    try {
      // Build extraction prompt
      const prompt = this.buildPrompt(content);

      // Call LLM
      const llmResponse = await this.deps.llm.complete({
        prompt,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });

      // Parse and validate output
      const parsed = this.parseLLMOutput(llmResponse.content);
      if (!parsed.success) {
        await this.logFailure(correlationId, startTime, parsed.error!, content.length);
        return {
          entities: [],
          relationships: [],
          durationMs: this.deps.now() - startTime,
        };
      }

      // Validate output
      let validation: EntityValidationResult;
      if (this.config.validateOutput) {
        validation = this.validateRawOutput(parsed.data!);
      } else {
        // Skip validation but still ensure proper typing
        const rawEntities = parsed.data?.entities || [];
        const rawRelationships = parsed.data?.relationships || [];
        validation = {
          valid: true,
          errors: [],
          entities: rawEntities
            .filter((e) => e.name && e.type && typeof e.confidence === "number")
            .map((e) => ({
              name: e.name!,
              type: e.type as EntityType,
              confidence: e.confidence!,
              summary: e.summary,
            })),
          relationships: rawRelationships
            .filter((r) => r.from && r.to && r.type && typeof r.confidence === "number")
            .map((r) => ({
              from: r.from!,
              to: r.to!,
              type: r.type as RelationshipType,
              confidence: r.confidence!,
            })),
        };
      }

      // Log validation errors but still process valid entities
      if (!validation.valid && validation.errors.length > 0) {
        const errorMsg = validation.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
        // Only log failure if no valid entities were found
        if (validation.entities.length === 0) {
          await this.logFailure(correlationId, startTime, errorMsg, content.length);
          return {
            entities: [],
            relationships: [],
            durationMs: this.deps.now() - startTime,
          };
        }
      }

      // Filter by confidence threshold
      const validEntities = validation.entities.filter(
        (e) => this.isValidConfidence(e.confidence) && e.confidence >= this.config.minConfidence,
      );

      const validRelationships = validation.relationships.filter(
        (r) => this.isValidConfidence(r.confidence) && r.confidence >= this.config.minConfidence,
      );

      const result: EntityExtractionResult = {
        entities: validEntities,
        relationships: validRelationships,
        durationMs: this.deps.now() - startTime,
      };

      // Cache result
      this.cacheResult(cacheKey, result);

      // Log success
      await this.deps.auditLog({
        operation: "entity_extraction",
        correlationId,
        metadata: {
          contentLength: content.length,
          entityCount: validEntities.length,
          relationshipCount: validRelationships.length,
          tokensUsed: llmResponse.tokensUsed,
          durationMs: result.durationMs,
        },
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown extraction error";

      await this.logFailure(correlationId, startTime, errorMessage, content.length);

      return {
        entities: [],
        relationships: [],
        durationMs: this.deps.now() - startTime,
      };
    }
  }

  /**
   * Extract entities from multiple memories in batch
   * More efficient for processing multiple items
   *
   * @param contents - Array of text contents to analyze
   * @returns Array of extraction results
   */
  async extractBatch(contents: string[]): Promise<EntityExtractionResult[]> {
    // Process in parallel with concurrency limit
    const CONCURRENCY = 5;
    const results: EntityExtractionResult[] = [];

    for (let i = 0; i < contents.length; i += CONCURRENCY) {
      const batch = contents.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map((c) => this.extract(c)));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Get current configuration
   */
  getConfig(): EntityExtractorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<EntityExtractorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Clear extraction cache
   */
  clearCache(): void {
    this.extractionCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; ttlMs: number } {
    return {
      size: this.extractionCache.size,
      ttlMs: this.CACHE_TTL_MS,
    };
  }

  /**
   * Build extraction prompt
   */
  private buildPrompt(content: string): string {
    // Escape content to prevent prompt injection
    const escapedContent = this.escapeContent(content);

    return ENTITY_EXTRACTION_PROMPT.replace("{{content}}", escapedContent).replace(
      "{{maxEntities}}",
      String(this.config.maxEntities),
    );
  }

  /**
   * Escape content to prevent prompt injection
   */
  private escapeContent(content: string): string {
    return content
      .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
      .replace(/\\/g, "\\\\") // Escape backslashes
      .replace(/"/g, '\\"'); // Escape quotes
  }

  /**
   * Check if content appears to be encrypted (ciphertext JSON)
   * Prevents extracting entities from encryption metadata
   */
  private isEncryptedContent(content: string): boolean {
    const trimmed = content.trim();

    // Check for encrypted JSON structure
    if (!trimmed.startsWith("{")) return false;

    try {
      const parsed = JSON.parse(trimmed);
      // If it has ciphertext and iv fields, it's encrypted
      if (parsed.ciphertext && parsed.iv) {
        return true;
      }
      // If it has algorithm and looks like encryption metadata
      if (
        parsed.algorithm &&
        (parsed.algorithm.includes("aes") || parsed.algorithm.includes("AES"))
      ) {
        return true;
      }
    } catch {
      // Not valid JSON, not encrypted
      return false;
    }

    return false;
  }

  /**
   * Generate cache key for content
   */
  private getCacheKey(content: string): string {
    // Simple hash for cache key
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return String(hash);
  }

  /**
   * Get cached result if valid
   */
  private getCachedResult(key: string): EntityExtractionResult | null {
    const cached = this.extractionCache.get(key);
    if (cached && this.deps.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.result;
    }
    // Remove expired entry
    if (cached) {
      this.extractionCache.delete(key);
    }
    return null;
  }

  /**
   * Cache extraction result
   */
  private cacheResult(key: string, result: EntityExtractionResult): void {
    this.extractionCache.set(key, {
      result,
      timestamp: this.deps.now(),
    });

    // Prevent cache from growing too large
    if (this.extractionCache.size > 1000) {
      const firstKey = this.extractionCache.keys().next().value;
      if (firstKey !== undefined) {
        this.extractionCache.delete(firstKey);
      }
    }
  }

  /**
   * Parse LLM output
   */
  private parseLLMOutput(raw: string): {
    success: boolean;
    data?: RawEntityExtraction;
    error?: string;
  } {
    try {
      const sanitized = this.sanitizeOutput(raw);
      const parsed = JSON.parse(sanitized);
      return { success: true, data: parsed };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to parse JSON",
      };
    }
  }

  /**
   * Sanitize LLM output
   */
  private sanitizeOutput(raw: string): string {
    let cleaned = raw;

    // Remove markdown code blocks
    cleaned = cleaned.replace(/```json\s*/g, "");
    cleaned = cleaned.replace(/```\s*$/g, "");
    cleaned = cleaned.replace(/```/g, "");

    // Remove leading/trailing whitespace
    cleaned = cleaned.trim();

    // Fix trailing commas
    cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

    return cleaned;
  }

  /**
   * Validate raw extraction output
   */
  private validateRawOutput(raw: RawEntityExtraction): EntityValidationResult {
    const errors: EntityValidationError[] = [];
    const validEntities: ExtractedEntity[] = [];
    const validRelationships: EntityRelationship[] = [];

    // Validate entities
    if (raw.entities && Array.isArray(raw.entities)) {
      for (let i = 0; i < raw.entities.length; i++) {
        const entity = raw.entities[i];
        const entityErrors = this.validateEntity(entity, i);

        if (entityErrors.length === 0) {
          // Construct validated entity with required fields
          validEntities.push({
            name: entity!.name!,
            type: entity!.type as EntityType,
            confidence: entity!.confidence!,
            summary: entity!.summary,
          });
        } else {
          errors.push(...entityErrors);
        }
      }
    }

    // Build set of valid entity names for relationship validation
    const entityNames = new Set(validEntities.map((e) => e.name));

    // Validate relationships
    if (raw.relationships && Array.isArray(raw.relationships)) {
      for (let i = 0; i < raw.relationships.length; i++) {
        const rel = raw.relationships[i];
        const relErrors = this.validateRelationship(rel, i, entityNames);

        if (relErrors.length === 0) {
          // Construct validated relationship with required fields
          validRelationships.push({
            from: rel!.from!,
            to: rel!.to!,
            type: rel!.type as RelationshipType,
            confidence: rel!.confidence!,
          });
        } else {
          errors.push(...relErrors);
        }
      }
    }

    // Return valid entities and relationships even if there were some errors
    // This allows partial extraction to succeed
    return {
      valid: errors.length === 0,
      errors,
      entities: validEntities,
      relationships: validRelationships,
    };
  }

  /**
   * Validate a single entity
   */
  private validateEntity(entity: unknown, index: number): EntityValidationError[] {
    const errors: EntityValidationError[] = [];
    const prefix = `entities[${index}]`;

    if (!entity || typeof entity !== "object") {
      return [{ field: prefix, message: "Entity must be an object" }];
    }

    const e = entity as Record<string, unknown>;

    // Validate name
    if (!e.name || typeof e.name !== "string") {
      errors.push({ field: `${prefix}.name`, message: "name is required and must be a string" });
    } else {
      if (e.name.length < 2) {
        errors.push({ field: `${prefix}.name`, message: "name must be at least 2 characters" });
      }
      if (e.name.length > 100) {
        errors.push({ field: `${prefix}.name`, message: "name must be at most 100 characters" });
      }
    }

    // Validate type
    if (!e.type || typeof e.type !== "string") {
      errors.push({ field: `${prefix}.type`, message: "type is required" });
    } else if (!ENTITY_TYPES.includes(e.type as EntityType)) {
      errors.push({
        field: `${prefix}.type`,
        message: `type must be one of: ${ENTITY_TYPES.join(", ")}`,
      });
    }

    // Validate confidence
    if (typeof e.confidence !== "number") {
      errors.push({
        field: `${prefix}.confidence`,
        message: "confidence is required and must be a number",
      });
    } else if (e.confidence < 0 || e.confidence > 1) {
      errors.push({ field: `${prefix}.confidence`, message: "confidence must be between 0 and 1" });
    }

    // Validate summary (optional)
    if (e.summary && typeof e.summary !== "string") {
      errors.push({ field: `${prefix}.summary`, message: "summary must be a string if provided" });
    }

    return errors;
  }

  /**
   * Validate a single relationship
   */
  private validateRelationship(
    rel: unknown,
    index: number,
    entityNames: Set<string>,
  ): EntityValidationError[] {
    const errors: EntityValidationError[] = [];
    const prefix = `relationships[${index}]`;

    if (!rel || typeof rel !== "object") {
      return [{ field: prefix, message: "Relationship must be an object" }];
    }

    const r = rel as Record<string, unknown>;

    // Validate from
    if (!r.from || typeof r.from !== "string") {
      errors.push({ field: `${prefix}.from`, message: "from is required and must be a string" });
    }

    // Validate to
    if (!r.to || typeof r.to !== "string") {
      errors.push({ field: `${prefix}.to`, message: "to is required and must be a string" });
    }

    // Validate type
    if (!r.type || typeof r.type !== "string") {
      errors.push({ field: `${prefix}.type`, message: "type is required" });
    } else if (!RELATIONSHIP_TYPES.includes(r.type as RelationshipType)) {
      errors.push({
        field: `${prefix}.type`,
        message: `type must be one of: ${RELATIONSHIP_TYPES.join(", ")}`,
      });
    }

    // Validate confidence
    if (typeof r.confidence !== "number") {
      errors.push({
        field: `${prefix}.confidence`,
        message: "confidence is required and must be a number",
      });
    } else if (r.confidence < 0 || r.confidence > 1) {
      errors.push({ field: `${prefix}.confidence`, message: "confidence must be between 0 and 1" });
    }

    // Validate that from and to entities exist (if we have entities)
    if (entityNames.size > 0) {
      if (r.from && typeof r.from === "string" && !entityNames.has(r.from)) {
        errors.push({
          field: `${prefix}.from`,
          message: `Entity "${r.from}" not found in extracted entities`,
        });
      }
      if (r.to && typeof r.to === "string" && !entityNames.has(r.to)) {
        errors.push({
          field: `${prefix}.to`,
          message: `Entity "${r.to}" not found in extracted entities`,
        });
      }
    }

    return errors;
  }

  /**
   * Check if confidence value is valid
   */
  private isValidConfidence(confidence: number): boolean {
    return (
      typeof confidence === "number" && !isNaN(confidence) && confidence >= 0 && confidence <= 1
    );
  }

  /**
   * Log extraction failure
   */
  private async logFailure(
    correlationId: string,
    startTime: number,
    error: string,
    contentLength: number,
  ): Promise<void> {
    await this.deps.auditLog({
      operation: "entity_extraction_failed",
      correlationId,
      metadata: {
        error,
        contentLength,
        durationMs: this.deps.now() - startTime,
      },
    });
  }
}

/**
 * Factory function to create entity extractor
 */
export function createEntityExtractor(
  deps: EntityExtractorDependencies,
  config?: Partial<EntityExtractorConfig>,
): EntityExtractor {
  return new EntityExtractor(deps, config);
}
