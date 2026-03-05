// Extraction Engine
// Story 3.1: LLM-Based Extraction Engine

import { analyzeConfidence, isValidConfidence } from "./confidenceScorer.js";
import { validateRawOutput, parseLLMOutput } from "./outputValidator.js";
import {
  buildExtractionPrompt,
  formatMessages,
  escapeUserContent,
  getCategoriesList,
} from "./promptBuilder.js";
import type {
  ExtractionInput,
  ExtractionOutput,
  ExtractionConfig,
  ExtractionDependencies,
  MemoryExtraction,
  ExtractedEntity,
  ExtractedRelationship,
} from "./types.js";

/**
 * Default extraction configuration
 */
const DEFAULT_CONFIG: ExtractionConfig = {
  minConfidence: 0.75,
  maxTokens: 2000,
  maxMemories: 5,
  validateOutput: true,
  temperature: 0.2,
};

/**
 * Extraction Engine
 *
 * Analyzes conversation segments using LLM to extract memorable information.
 * Returns structured extractions with confidence scores.
 */
export class ExtractionEngine {
  private config: ExtractionConfig;
  private deps: ExtractionDependencies;

  constructor(deps: ExtractionDependencies, config?: Partial<ExtractionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;
  }

  /**
   * Extract memories from conversation messages
   *
   * @param input - Extraction input
   * @returns Extraction output
   */
  async extract(input: ExtractionInput): Promise<ExtractionOutput> {
    const correlationId = this.deps.generateId();
    const startTime = this.deps.now();

    try {
      // Sanitize input messages
      const sanitizedMessages = await this.sanitizeMessages(input.messages);

      // Build prompt
      const prompt = this.buildPrompt(sanitizedMessages, input);

      // Call LLM
      const llmResponse = await this.deps.llm.complete({
        prompt,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });

      // Parse output
      const parsed = parseLLMOutput(llmResponse.content);
      if (!parsed.success) {
        await this.logFailure(correlationId, startTime, parsed.error!, input.mode);
        return {
          success: false,
          error: `Failed to parse LLM output: ${parsed.error}`,
          memories: [],
          entities: [],
          relationships: [],
          tokensUsed: {
            input: llmResponse.tokensUsed.input,
            output: llmResponse.tokensUsed.output,
            total: llmResponse.tokensUsed.input + llmResponse.tokensUsed.output,
          },
          durationMs: this.deps.now() - startTime,
          wasValidated: false,
        };
      }

      // Validate output
      const messageIds = new Set(input.messages.map((m) => m.id));
      const validation = this.config.validateOutput
        ? validateRawOutput(parsed.data, messageIds)
        : { valid: true, errors: [], data: parsed.data as MemoryExtraction[] };

      if (!validation.valid) {
        const errorMsg = validation.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
        await this.logFailure(correlationId, startTime, errorMsg, input.mode);
        return {
          success: false,
          error: `Validation failed: ${errorMsg}`,
          memories: [],
          entities: [],
          relationships: [],
          tokensUsed: {
            input: llmResponse.tokensUsed.input,
            output: llmResponse.tokensUsed.output,
            total: llmResponse.tokensUsed.input + llmResponse.tokensUsed.output,
          },
          durationMs: this.deps.now() - startTime,
          wasValidated: true,
        };
      }

      // Filter by confidence threshold
      const validMemories = (validation.data?.memories || []).filter(
        (m) => isValidConfidence(m.confidence) && m.confidence >= this.config.minConfidence,
      );

      // Extract entities and relationships
      const validEntities: ExtractedEntity[] = (parsed.data?.entities || [])
        .filter((e) => e.name && e.name.trim().length > 0)
        .map((e) => ({
          name: e.name!.trim(),
          type: e.type || "Thing",
          aliases: e.aliases || [],
        }));

      const validRelationships: ExtractedRelationship[] = (parsed.data?.relationships || [])
        .filter((r) => r.from && r.to && r.type)
        .map((r) => ({
          from: r.from!.trim(),
          to: r.to!.trim(),
          type: r.type!,
          confidence: r.confidence ?? 0.8,
        }));

      // Log success
      await this.deps.auditLog({
        operation: "memory_extraction",
        correlationId,
        metadata: {
          mode: input.mode,
          messagesCount: input.messages.length,
          extractedCount: validMemories.length,
          entityCount: validEntities.length,
          relationshipCount: validRelationships.length,
          tokensUsed: llmResponse.tokensUsed,
          durationMs: this.deps.now() - startTime,
        },
      });

      return {
        success: true,
        memories: validMemories,
        entities: validEntities,
        relationships: validRelationships,
        tokensUsed: {
          input: llmResponse.tokensUsed.input,
          output: llmResponse.tokensUsed.output,
          total: llmResponse.tokensUsed.input + llmResponse.tokensUsed.output,
        },
        durationMs: this.deps.now() - startTime,
        wasValidated: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown extraction error";

      await this.logFailure(correlationId, startTime, errorMessage, input.mode);

      return {
        success: false,
        error: errorMessage,
        memories: [],
        entities: [],
        relationships: [],
        tokensUsed: { input: 0, output: 0, total: 0 },
        durationMs: this.deps.now() - startTime,
        wasValidated: false,
      };
    }
  }

  /**
   * Sanitize all messages through PII layer and filter AURA content
   */
  private async sanitizeMessages(
    messages: Array<{ id: string; role: string; content: string; timestamp: number }>,
  ): Promise<Array<{ id: string; role: string; content: string; timestamp: number }>> {
    // First, filter out AURA commands and verbose think blocks
    const filteredMessages = messages.filter((m) => this.shouldIncludeMessage(m));

    // Then sanitize remaining messages through PII layer
    return Promise.all(
      filteredMessages.map(async (m) => ({
        ...m,
        content: (await this.deps.sanitize(m.content)).sanitizedText,
      })),
    );
  }

  /**
   * Filter: Should this message be included in extraction?
   * Filters out:
   * - System/tool messages (AURA commands)
   * - Assistant messages with verbose think blocks
   */
  private shouldIncludeMessage(message: { role: string; content: string }): boolean {
    // Skip system and tool messages (AURA commands)
    if (message.role === "system" || message.role === "tool") {
      return false;
    }

    // Skip assistant messages that are verbose think blocks
    if (message.role === "assistant") {
      if (this.isVerboseThinkBlock(message.content)) {
        return false;
      }

      // Skip pure command output (tool results)
      if (this.isToolOutput(message.content)) {
        return false;
      }
    }

    // Skip very short messages
    if (message.content.length < 20) {
      return false;
    }

    return true;
  }

  /**
   * Detect verbose think blocks in assistant messages
   */
  private isVerboseThinkBlock(content: string): boolean {
    const verbosePatterns = [
      /^\s*Thinking\s*process\s*:/i,
      /^\s*Let\s+me\s+think\s*:/i,
      /^\s*Step\s+\d+[:.)]\s*/i,
      /^\s*Analysis\s*:/i,
      /^\s*Reasoning\s*:/i,
      /^\s*I'll\s+analyze\s+this\s+step\s+by\s+step/i,
      /^\s*Breaking\s+this\s+down\s*:/i,
      /^\s*Let\s+me\s+break\s+this\s+down/i,
      /^\s*First,\s+I('ll|\s+will)/i,
      /^\s*Now\s+let\s+me\s+analyze/i,
    ];

    const lines = content.split("\n");
    const verboseLineCount = lines.filter((line) =>
      verbosePatterns.some((p) => p.test(line)),
    ).length;

    // Skip if >40% of lines are verbose think markers
    return verboseLineCount > lines.length * 0.4;
  }

  /**
   * Detect tool/command output (not conversational content)
   */
  private isToolOutput(content: string): boolean {
    const toolPatterns = [
      /^\s*Executing\s+(command|tool|function)\s*:/i,
      /^\s*Running\s+\w+\s*:/i,
      /^\s*Result\s+from\s+\w+\s*:/i,
      /^```\w*\s*\n*\$/, // Code blocks starting with $
      /^\s*npm\s+(install|run|test|build)/i,
      /^\s*(docker|git|curl|wget|python|node)\s+/i,
      /^\s*\[System\s+Message\]/i,
    ];

    return toolPatterns.some((p) => p.test(content));
  }

  /**
   * Build extraction prompt
   */
  private buildPrompt(
    messages: Array<{ id: string; role: string; content: string; timestamp: number }>,
    input: ExtractionInput,
  ): string {
    // Escape user content to prevent prompt injection
    const escapedMessages = messages.map((m) => ({
      ...m,
      content: escapeUserContent(m.content),
    }));

    return buildExtractionPrompt({
      messages: formatMessages(escapedMessages),
      userHint: input.userHint ? escapeUserContent(input.userHint) : undefined,
      maxMemories: input.maxMemories ?? this.config.maxMemories,
      categories: getCategoriesList(),
      currentTime: new Date(this.deps.now()).toISOString(),
    });
  }

  /**
   * Log extraction failure
   */
  private async logFailure(
    correlationId: string,
    startTime: number,
    error: string,
    mode: string,
  ): Promise<void> {
    await this.deps.auditLog({
      operation: "memory_extraction_failed",
      correlationId,
      metadata: {
        mode,
        error,
        durationMs: this.deps.now() - startTime,
      },
    });
  }

  /**
   * Get engine configuration
   */
  getConfig(): ExtractionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ExtractionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Factory function to create extraction engine
 */
export function createExtractionEngine(
  deps: ExtractionDependencies,
  config?: Partial<ExtractionConfig>,
): ExtractionEngine {
  return new ExtractionEngine(deps, config);
}
