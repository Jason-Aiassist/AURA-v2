/**
 * Smart Extractor
 *
 * LLM-driven memory extraction using coder_fast.
 * Extracts rich relationships and detailed memory structures.
 */

import { getUserName } from "../config/user-config.js";
import { createEmbeddingService, EmbeddingService } from "../embeddings/EmbeddingService.js";
import { DeduplicationService, createDeduplicationService } from "./DeduplicationService.js";
import { EntityCanonicalizer, createEntityCanonicalizer } from "./EntityCanonicalizer.js";

export interface ExtractedMemory {
  content: string;
  importance: number;
  confidence: number;
  category: "personal" | "professional" | "preference" | "relationship" | "event" | "fact";
  entities: string[];
  temporalContext?: string;
  reasoning?: string;
}

export interface ExtractedRelationship {
  from: string;
  to: string;
  type: string;
  typeExamples?: string[];
  evidence: string;
  bidirectional: boolean;
  confidence: number;
}

export interface ExtractionResult {
  memories: ExtractedMemory[];
  relationships: ExtractedRelationship[];
  canonicalMappings: Array<{
    mentionedAs: string;
    canonicalName: string;
    entityType: string;
    reasoning: string;
  }>;
}

export interface SmartExtractorConfig {
  model: string;
  baseUrl: string;
  maxTokens: number;
  temperature: number;
  userName: string;
}

export class SmartExtractor {
  private config: SmartExtractorConfig;
  private embeddingService?: EmbeddingService;
  private canonicalizer: EntityCanonicalizer;
  private deduplicationService: DeduplicationService;

  constructor(config?: Partial<SmartExtractorConfig>, embeddingService?: EmbeddingService) {
    this.config = {
      model: "qwen2.5-coder:14b",
      baseUrl: "http://ollama-embed-gpu0:11434",
      maxTokens: 2000,
      temperature: 0.1,
      userName: getUserName(),
      ...config,
    };
    this.embeddingService = embeddingService;
    this.canonicalizer = createEntityCanonicalizer({
      userCanonicalName: this.config.userName,
    });
    this.deduplicationService = createDeduplicationService({}, embeddingService);
  }

  /**
   * Extract memories and relationships from conversation text
   */
  async extract(conversation: string, existingEntities: string[] = []): Promise<ExtractionResult> {
    // Register existing entities for canonicalization
    this.canonicalizer.registerEntities(existingEntities);

    // Build extraction prompt
    const prompt = this.buildExtractionPrompt(conversation, existingEntities);

    // Call coder_fast
    const response = await this.callCoderFast(prompt);

    // Parse and validate
    const extraction = this.parseExtraction(response);

    // Canonicalize entities
    const canonicalized = this.canonicalizer.canonicalizeExtraction({
      entities: extraction.memories.flatMap((m) => m.entities),
      relationships: extraction.relationships.map((r) => ({
        from: r.from,
        to: r.to,
        type: r.type,
      })),
    });

    // Update memories with canonical entities
    const canonicalMemories = extraction.memories.map((mem) => ({
      ...mem,
      entities: mem.entities.map((e) => canonicalized.entityMap.get(e) || e),
    }));

    // Update relationships with canonical entities
    const canonicalRelationships = extraction.relationships.map((rel) => ({
      ...rel,
      from: canonicalized.entityMap.get(rel.from) || rel.from,
      to: canonicalized.entityMap.get(rel.to) || rel.to,
    }));

    return {
      memories: canonicalMemories,
      relationships: canonicalRelationships,
      canonicalMappings: extraction.canonicalMappings,
    };
  }

  /**
   * Extract with deduplication
   */
  async extractWithDeduplication(
    conversation: string,
    existingMemories: Array<{ uuid: string; content: string; entities?: string[] }>,
    existingEntities: string[] = [],
  ): Promise<{
    newMemories: ExtractedMemory[];
    relationships: ExtractedRelationship[];
    duplicates: Array<{ memory: ExtractedMemory; reason: string }>;
  }> {
    // Extract
    const extraction = await this.extract(conversation, existingEntities);

    // Check for duplicates
    const newMemories: ExtractedMemory[] = [];
    const duplicates: Array<{ memory: ExtractedMemory; reason: string }> = [];

    for (const memory of extraction.memories) {
      const dupeCheck = await this.deduplicationService.check(
        {
          content: memory.content,
          entities: memory.entities,
        },
        existingMemories.map((m) => ({
          uuid: m.uuid,
          content: m.content,
          entities: m.entities,
        })),
      );

      if (dupeCheck.isDuplicate) {
        duplicates.push({
          memory,
          reason: dupeCheck.reasoning,
        });
      } else {
        newMemories.push(memory);
      }
    }

    return {
      newMemories,
      relationships: extraction.relationships,
      duplicates,
    };
  }

  /**
   * Build extraction prompt for coder_fast
   */
  private buildExtractionPrompt(conversation: string, existingEntities: string[]): string {
    return `You are an expert memory extraction system. Analyze this conversation and extract structured memories.

CONVERSATION:
${conversation}

EXISTING ENTITIES (for canonicalization):
${existingEntities.join(", ") || "None"}

TASK 1 - Extract Memories:
Identify important facts, preferences, relationships, and events about ${this.config.userName}. Return as JSON:
{
  "memories": [
    {
      "content": "Clear, standalone statement",
      "importance": 0.0-1.0,
      "confidence": 0.0-1.0,
      "category": "personal|professional|preference|relationship|event|fact",
      "entities": ["entity names mentioned"],
      "temporalContext": "when this occurred (if known)",
      "reasoning": "why this memory is important"
    }
  ]
}

TASK 2 - Extract Relationships:
Identify specific relationships between entities. Be precise - use specific relationship types, not generic ones:
{
  "relationships": [
    {
      "from": "entity name",
      "to": "entity name",
      "type": "specific_relationship_type",
      "typeExamples": ["father", "mother", "sister", "brother", "colleague", "manager", "friend", "spouse", "pet_owner", "works_on", "enjoys", "expert_in"],
      "evidence": "quote from conversation supporting this relationship",
      "bidirectional": true|false,
      "confidence": 0.0-1.0
    }
  ]
}

TASK 3 - Canonicalize Entities:
Map mentioned entities to canonical forms:
{
  "canonicalMappings": [
    {
      "mentionedAs": "how entity appeared in text",
      "canonicalName": "standardized name",
      "entityType": "Person|Organization|Location|Concept|Technology|Project|PET",
      "reasoning": "why this canonical form"
    }
  ]
}

RULES:
- Extract SPECIFIC relationships: "father" not "friend", "manager" not "colleague", "sister" not "friend"
- Include evidence quotes for all relationships
- Use canonical forms consistently
- Confidence reflects certainty, not importance
- For pets, use "pet_owner" relationship type
- For family: father, mother, sister, brother, spouse are specific types
- For work: manager, colleague, reports_to, works_with are specific

Return ONLY valid JSON with all three fields (memories, relationships, canonicalMappings).`;
  }

  /**
   * Call coder_fast API
   */
  private async callCoderFast(prompt: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: "system",
            content: "You are a precise memory extraction system. Return only valid JSON.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      }),
    });

    if (!response.ok) {
      throw new Error(`coder_fast API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || "";
  }

  /**
   * Parse extraction response
   */
  private parseExtraction(response: string): ExtractionResult {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/) ||
      response.match(/```\n?([\s\S]*?)\n?```/) || [null, response];

    const jsonStr = jsonMatch[1].trim();

    try {
      const parsed = JSON.parse(jsonStr);

      return {
        memories: parsed.memories || [],
        relationships: parsed.relationships || [],
        canonicalMappings: parsed.canonicalMappings || [],
      };
    } catch {
      // Return empty result on parse failure
      return {
        memories: [],
        relationships: [],
        canonicalMappings: [],
      };
    }
  }
}

// Factory function
export function createSmartExtractor(
  config?: Partial<SmartExtractorConfig>,
  embeddingService?: EmbeddingService,
): SmartExtractor {
  return new SmartExtractor(config, embeddingService);
}
