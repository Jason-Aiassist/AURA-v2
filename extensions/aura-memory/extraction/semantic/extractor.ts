/**
 * Semantic Extractor
 * Main orchestrator for semantic entity and relationship extraction
 */

import { createLogger } from "../../shared/debug-logger.js";
import { parseLLMOutput, attemptRepair, SemanticParseError } from "./parser.js";
import {
  buildSemanticExtractionPrompt,
  formatMessages,
  getDefaultPromptVariables,
} from "./prompt-builder.js";
import type {
  SemanticExtractionInput,
  SemanticExtractionOutput,
  SemanticExtractionResult,
} from "./types.js";
import { validateSemanticExtraction } from "./validator.js";

/**
 * LLM client interface
 */
interface LLMClient {
  complete(params: { prompt: string; maxTokens: number; temperature: number }): Promise<{
    content: string;
    tokensUsed: { input: number; output: number };
  }>;
}

/**
 * Semantic extractor configuration
 */
interface SemanticExtractorConfig {
  /** LLM client for extraction */
  llm: LLMClient;
  /** Maximum tokens for LLM call (default: 2000) */
  maxTokens?: number;
  /** Temperature for LLM (default: 0.3) */
  temperature?: number;
  /** Maximum entities to extract (default: 20) */
  maxEntities?: number;
  /** Maximum relationships to extract (default: 30) */
  maxRelationships?: number;
  /** Minimum confidence threshold (default: 0.5) */
  minConfidence?: number;
  /** Whether to attempt JSON repair (default: true) */
  attemptRepair?: boolean;
}

/**
 * Semantic extractor
 */
export class SemanticExtractor {
  private config: Required<SemanticExtractorConfig>;
  private logger = createLogger("SemanticExtractor");

  constructor(config: SemanticExtractorConfig) {
    this.config = {
      maxTokens: 2000,
      temperature: 0.3,
      maxEntities: 20,
      maxRelationships: 30,
      minConfidence: 0.5,
      attemptRepair: true,
      ...config,
    };
  }

  /**
   * Extract entities and relationships from messages
   * @param input - Extraction input
   * @returns Extraction output
   */
  async extract(input: SemanticExtractionInput): Promise<SemanticExtractionOutput> {
    const startTime = Date.now();
    const correlationId = this.logger.getContext().correlationId;

    this.logger.start("extract", {
      messageCount: input.messages.length,
      maxEntities: this.config.maxEntities,
      maxRelationships: this.config.maxRelationships,
    });

    try {
      // Step 1: Build prompt
      this.logger.progress("building-prompt");
      const prompt = this.buildPrompt(input);
      this.logger.progress("prompt-built", { promptLength: prompt.length });

      // Step 2: Call LLM
      this.logger.progress("calling-llm", {
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });
      const llmResponse = await this.config.llm.complete({
        prompt,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });
      this.logger.progress("llm-complete", {
        responseLength: llmResponse.content.length,
        tokensUsed: llmResponse.tokensUsed,
      });

      // Step 3: Parse output
      this.logger.progress("parsing-output");
      let parsedResult: SemanticExtractionResult;
      try {
        parsedResult = parseLLMOutput(llmResponse.content);
      } catch (parseError) {
        if (this.config.attemptRepair && parseError instanceof SemanticParseError) {
          this.logger.progress("attempting-repair");
          const repaired = attemptRepair(parseError.rawContent);
          if (repaired) {
            parsedResult = parseLLMOutput(repaired);
            this.logger.progress("repair-successful");
          } else {
            throw parseError;
          }
        } else {
          throw parseError;
        }
      }

      // Update metadata
      parsedResult.metadata.tokensUsed = {
        input: llmResponse.tokensUsed.input,
        output: llmResponse.tokensUsed.output,
        total: llmResponse.tokensUsed.input + llmResponse.tokensUsed.output,
      };

      this.logger.progress("parsed-success", {
        entityCount: parsedResult.entities.length,
        relationshipCount: parsedResult.relationships.length,
      });

      // Step 4: Validate
      this.logger.progress("validating");
      const validationResult = validateSemanticExtraction(
        parsedResult.entities,
        parsedResult.relationships,
      );
      parsedResult.metadata.wasValidated = true;

      this.logger.progress("validation-complete", {
        validEntities: validationResult.validEntities.length,
        validRelationships: validationResult.validRelationships.length,
        errorCount: validationResult.errors.length,
      });

      // Build output
      const durationMs = Date.now() - startTime;
      parsedResult.metadata.durationMs = durationMs;

      const output: SemanticExtractionOutput = {
        success: true,
        memories: [], // Memories built separately from entities/relationships
        entities: validationResult.validEntities,
        relationships: validationResult.validRelationships,
        tokensUsed: parsedResult.metadata.tokensUsed,
        durationMs,
        wasValidated: true,
      };

      this.logger.success({
        durationMs,
        entityCount: output.entities.length,
        relationshipCount: output.relationships.length,
        tokenTotal: output.tokensUsed.total,
      });

      return output;
    } catch (error) {
      this.logger.error(error as Error, {
        phase: "extraction",
        inputSample: input.messages.slice(0, 2).map((m) => ({
          role: m.role,
          contentPreview: m.content.substring(0, 100),
        })),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        memories: [],
        entities: [],
        relationships: [],
        tokensUsed: { input: 0, output: 0, total: 0 },
        durationMs: Date.now() - startTime,
        wasValidated: false,
      };
    }
  }

  /**
   * Build extraction prompt
   * @param input - Input parameters
   * @returns Prompt string
   */
  private buildPrompt(input: SemanticExtractionInput): string {
    const formattedMessages = formatMessages(input.messages);
    const variables = getDefaultPromptVariables(formattedMessages);

    variables.maxEntities = input.maxEntities ?? this.config.maxEntities;
    variables.maxRelationships = input.maxRelationships ?? this.config.maxRelationships;

    return buildSemanticExtractionPrompt(variables);
  }

  /**
   * Check if extractor is available (LLM is configured)
   * @returns Whether available
   */
  isAvailable(): boolean {
    return !!this.config.llm;
  }

  /**
   * Get extractor configuration
   * @returns Current configuration
   */
  getConfig(): SemanticExtractorConfig {
    return { ...this.config };
  }
}

/**
 * Create semantic extractor with default configuration
 * @param llm - LLM client
 * @returns Semantic extractor instance
 */
export function createSemanticExtractor(llm: LLMClient): SemanticExtractor {
  return new SemanticExtractor({ llm });
}

/**
 * Extract entities and relationships (convenience function)
 * @param input - Extraction input
 * @param llm - LLM client
 * @returns Extraction output
 */
export async function extractSemantic(
  input: SemanticExtractionInput,
  llm: LLMClient,
): Promise<SemanticExtractionOutput> {
  const extractor = createSemanticExtractor(llm);
  return extractor.extract(input);
}
