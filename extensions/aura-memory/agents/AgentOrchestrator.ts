/**
 * Agent Pipeline Orchestrator (Phase 1 Enhanced)
 * Manages multi-agent workflows for memory processing with semantic extraction
 */

import type { EntityExtractor } from "../entities/EntityExtractor.js";
import type { AgentOrchestratorAdapter } from "../integration/agent-adapter.js";
import type { Logger } from "../types.js";
import type { DeepCoderAgent } from "./DeepCoderAgent.js";
import type {
  AgentPipelineInput,
  AgentPipelineOutput,
  AgentPipelineConfig,
  AgentStep,
  AgentStepResult,
} from "./types.js";

export interface AgentOrchestratorConfig {
  steps: AgentStep[];
  parallel: boolean;
  retryAttempts: number;
  timeoutMs: number;
}

export interface AgentOrchestratorDependencies {
  extractionAgent: DeepCoderAgent;
  entityExtractor: EntityExtractor;
  log: Logger;
  /**
   * Optional Phase 1 semantic extraction adapter.
   * When provided, adds Step 3 for semantic relationship extraction.
   */
  semanticAdapter?: AgentOrchestratorAdapter;
}

/**
 * Orchestrates multi-agent pipeline for memory processing
 * Pipeline: Extract → Entity Extraction → Semantic Extraction (Phase 1)
 */
export class AgentOrchestrator {
  private config: AgentOrchestratorConfig;
  private deps: AgentOrchestratorDependencies;

  constructor(config: AgentOrchestratorConfig, deps: AgentOrchestratorDependencies) {
    this.config = config;
    this.deps = deps;
  }

  /**
   * Run the full agent pipeline on input messages
   */
  async runPipeline(input: AgentPipelineInput): Promise<AgentPipelineOutput> {
    const startTime = Date.now();
    const correlationId = input.correlationId || `pipeline-${Date.now()}`;

    this.deps.log.info("[AgentPipeline] Starting pipeline", {
      correlationId,
      messageCount: input.messages.length,
      mode: input.mode,
      hasSemanticAdapter: !!this.deps.semanticAdapter,
    });

    // Log first few messages for debugging
    this.deps.log.debug("[DEBUG] Pipeline input messages", {
      correlationId,
      messageCount: input.messages.length,
      sampleMessages: input.messages.slice(0, 3).map((m) => ({
        id: m.id,
        role: m.role,
        contentPreview: m.content?.substring(0, 100),
      })),
    });

    try {
      // Step 1: Extract memories using DeepCoder
      this.deps.log.debug("[DEBUG] Starting Step 1: Memory extraction", { correlationId });
      const extractionResult = await this.runExtractionStep(input, correlationId);

      this.deps.log.debug("[DEBUG] Step 1 complete", {
        correlationId,
        extractionSuccess: extractionResult.success,
        memoriesCount: extractionResult.memories?.length ?? 0,
        error: extractionResult.error ?? null,
      });

      if (!extractionResult.success || extractionResult.memories.length === 0) {
        this.deps.log.warn("[DEBUG] No memories extracted, returning empty result", {
          correlationId,
          extractionSuccess: extractionResult.success,
          memoriesCount: extractionResult.memories?.length ?? 0,
        });
        return {
          success: true, // Pipeline succeeded even if no memories found
          memories: [],
          entities: [],
          durationMs: Date.now() - startTime,
          correlationId,
        };
      }

      // Log DeepCoder extracted entities and relationships
      this.deps.log.info("[AgentPipeline] DeepCoder extraction results", {
        correlationId,
        deepCoderEntities: extractionResult.entities?.length ?? 0,
        deepCoderRelationships: extractionResult.relationships?.length ?? 0,
      });

      // Step 2: Extract entities from each memory
      this.deps.log.debug("[DEBUG] Starting Step 2: Entity extraction", {
        correlationId,
        memoriesCount: extractionResult.memories.length,
      });
      const entityResults = await this.runEntityExtractionStep(
        extractionResult.memories,
        correlationId,
      );

      this.deps.log.debug("[DEBUG] Step 2 complete", {
        correlationId,
        entitiesCount: entityResults.entities?.length ?? 0,
        error: entityResults.error ?? null,
      });

      // Step 3: Semantic extraction (Phase 1 - optional)
      let semanticResults:
        | { success: boolean; entities: any[]; relationships: any[]; error?: string }
        | undefined;

      if (this.deps.semanticAdapter?.isReady()) {
        this.deps.log.debug("[DEBUG] Starting Step 3: Semantic extraction", {
          correlationId,
          memoriesCount: extractionResult.memories.length,
        });

        try {
          const adapterResult = await this.deps.semanticAdapter.runSemanticStep(
            {
              messages: input.messages,
              correlationId,
            },
            extractionResult.memories,
          );

          semanticResults = {
            success: adapterResult.success,
            entities: adapterResult.semanticEntities || [],
            relationships: adapterResult.semanticRelationships || [],
            error: adapterResult.error,
          };

          this.deps.log.debug("[DEBUG] Step 3 complete", {
            correlationId,
            semanticSuccess: adapterResult.success,
            semanticEntities: semanticResults.entities.length,
            semanticRelationships: semanticResults.relationships.length,
            error: adapterResult.error ?? null,
          });
        } catch (semanticError) {
          this.deps.log.warn("[AgentPipeline] Semantic extraction step failed", {
            correlationId,
            error: semanticError instanceof Error ? semanticError.message : "Unknown error",
          });
          // Don't fail pipeline - semantic extraction is optional
          semanticResults = {
            success: false,
            entities: [],
            relationships: [],
            error: semanticError instanceof Error ? semanticError.message : "Unknown error",
          };
        }
      } else {
        this.deps.log.debug("[DEBUG] Skipping Step 3: Semantic adapter not ready", {
          correlationId,
          hasAdapter: !!this.deps.semanticAdapter,
          isReady: this.deps.semanticAdapter?.isReady() ?? false,
        });
      }

      const durationMs = Date.now() - startTime;

      // Group entities by memoryId
      const entitiesByMemory = new Map<string, string[]>();
      for (const entity of entityResults.entities) {
        const memoryId = entity.memoryId;
        if (!entitiesByMemory.has(memoryId)) {
          entitiesByMemory.set(memoryId, []);
        }
        entitiesByMemory.get(memoryId)!.push(entity.name);
      }

      // Attach entities to their respective memories
      const memoriesWithEntities = extractionResult.memories.map((memory) => ({
        ...memory,
        entities: entitiesByMemory.get(memory.id) || [],
      }));

      // Combine DeepCoder entities with entity extraction step entities
      const allEntities = [...(extractionResult.entities || [])];
      for (const entity of entityResults.entities) {
        if (!allEntities.some((e) => e.name === entity.name)) {
          allEntities.push({
            name: entity.name,
            type: entity.type,
            confidence: entity.confidence,
          });
        }
      }

      this.deps.log.info("[AgentPipeline] Pipeline complete", {
        correlationId,
        memoriesExtracted: memoriesWithEntities.length,
        entitiesExtracted: allEntities.length,
        deepCoderRelationships: extractionResult.relationships?.length ?? 0,
        semanticEntities: semanticResults?.entities.length ?? 0,
        semanticRelationships: semanticResults?.relationships.length ?? 0,
        durationMs,
      });

      return {
        success: true,
        memories: memoriesWithEntities,
        entities: entityResults.entities,
        durationMs,
        correlationId,
        // Include DeepCoder extracted data
        semanticEntities: allEntities,
        semanticRelationships: extractionResult.relationships || [],
      };
    } catch (error) {
      this.deps.log.error("[AgentPipeline] Pipeline failed", error as Error, { correlationId });

      return {
        success: false,
        memories: [],
        entities: [],
        durationMs: Date.now() - startTime,
        correlationId,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Step 1: Run DeepCoder extraction agent
   */
  private async runExtractionStep(
    input: AgentPipelineInput,
    correlationId: string,
  ): Promise<AgentStepResult & { memories: any[]; entities: any[]; relationships: any[] }> {
    this.deps.log.debug("[AgentPipeline] Step 1: Memory extraction", { correlationId });

    try {
      // Call DeepCoder agent
      this.deps.log.debug("[DEBUG] Calling extractionAgent.extract()...", {
        correlationId,
        messageCount: input.messages.length,
        mode: input.mode,
        maxMemories: input.maxMemories,
      });

      const result = await this.deps.extractionAgent.extract({
        messages: input.messages,
        mode: input.mode,
        userHint: input.userHint,
        maxMemories: input.maxMemories,
      });

      this.deps.log.debug("[DEBUG] extractionAgent.extract() returned", {
        correlationId,
        success: result.success,
        memoriesCount: result.memories?.length ?? 0,
        durationMs: result.durationMs,
        tokensUsed: result.tokensUsed,
        error: result.error ?? null,
        sampleMemory: result.memories?.[0]
          ? {
              id: result.memories[0].id,
              category: result.memories[0].category,
              contentPreview: result.memories[0].content?.substring(0, 100),
            }
          : null,
      });

      return {
        success: result.success,
        memories: result.memories || [],
        entities: result.entities || [],
        relationships: result.relationships || [],
        durationMs: result.durationMs,
        correlationId,
      };
    } catch (error) {
      this.deps.log.error("[AgentPipeline] Extraction step failed", error as Error, {
        correlationId,
      });
      this.deps.log.error("[DEBUG] Extraction step exception", error as Error, {
        correlationId,
        errorType: typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : "No stack",
      });
      return {
        success: false,
        memories: [],
        entities: [],
        relationships: [],
        durationMs: 0,
        correlationId,
        error: error instanceof Error ? error.message : "Extraction failed",
      };
    }
  }

  /**
   * Step 2: Extract entities from memories
   */
  private async runEntityExtractionStep(
    memories: any[],
    correlationId: string,
  ): Promise<AgentStepResult & { entities: any[] }> {
    this.deps.log.debug("[AgentPipeline] Step 2: Entity extraction", {
      correlationId,
      memoryCount: memories.length,
    });

    const allEntities: any[] = [];
    const startTime = Date.now();

    // Extract entities from each memory
    for (const memory of memories) {
      try {
        const result = await this.deps.entityExtractor.extract(memory.content);

        if (result.entities && result.entities.length > 0) {
          allEntities.push(
            ...result.entities.map((e: any) => ({
              ...e,
              memoryId: memory.memoryId || memory.id,
              sourceContent: memory.content.substring(0, 200), // Truncate for storage
            })),
          );
        }
      } catch (error) {
        this.deps.log.warn("[AgentPipeline] Entity extraction failed for memory", {
          correlationId,
          memoryId: memory.memoryId || memory.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        // Continue with other memories
      }
    }

    return {
      success: true,
      entities: allEntities,
      durationMs: Date.now() - startTime,
      correlationId,
    };
  }
}

/**
 * Factory function to create agent orchestrator
 */
export function createAgentOrchestrator(deps: AgentOrchestratorDependencies): AgentOrchestrator {
  return new AgentOrchestrator(
    {
      steps: ["extract", "entities", "semantic"],
      parallel: false,
      retryAttempts: 2,
      timeoutMs: 120000, // Increased timeout for semantic extraction
    },
    deps,
  );
}
