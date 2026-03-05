/**
 * Agent Orchestrator Adapter
 * Adapter to integrate semantic extraction bridge into AgentOrchestrator
 */

import { createLogger } from "../shared/debug-logger.js";
import type { SemanticExtractionBridge } from "./bridge.js";
import type { BridgeDependencies } from "./types.js";

/**
 * Extended agent step result with semantic data
 */
export interface ExtendedAgentStepResult {
  /** Original step result data */
  memories: Array<{
    id: string;
    content: string;
    category: string;
    confidence: number;
    importance: number;
    sourceMessageIds: string[];
    entities?: string[];
  }>;
  /** Extracted semantic entities */
  semanticEntities?: Array<{
    name: string;
    type: string;
    confidence: number;
    aliases?: string[];
  }>;
  /** Extracted semantic relationships */
  semanticRelationships?: Array<{
    from: string;
    to: string;
    type: string;
    confidence: number;
    fact?: string;
  }>;
  /** Success status */
  success: boolean;
  /** Error if any */
  error?: string;
}

/**
 * Agent orchestrator adapter
 * Wraps the bridge to provide a simple interface for AgentOrchestrator
 */
export class AgentOrchestratorAdapter {
  private bridge: SemanticExtractionBridge | null;
  private logger = createLogger("AgentOrchestratorAdapter");

  constructor(bridge: SemanticExtractionBridge | null) {
    this.bridge = bridge;
    this.logger.start("constructor", {
      bridgeInitialized: bridge !== null,
      enabled: bridge?.isEnabled() ?? false,
    });
  }

  /**
   * Run semantic extraction as an additional pipeline step
   * This is called by AgentOrchestrator after entity extraction
   *
   * @param input - Pipeline input
   * @param memories - Memories extracted by DeepCoder
   * @returns Extended result with semantic data
   */
  async runSemanticStep(
    input: {
      messages: Array<{
        id: string;
        role: "user" | "assistant";
        content: string;
        timestamp: number;
      }>;
      correlationId: string;
    },
    memories: Array<{
      id: string;
      content: string;
      category: string;
      confidence: number;
      importance: number;
      sourceMessageIds: string[];
    }>,
  ): Promise<ExtendedAgentStepResult> {
    this.logger.start("runSemanticStep", {
      correlationId: input.correlationId,
      messageCount: input.messages.length,
      memoryCount: memories.length,
      hasBridge: this.bridge !== null,
    });

    // If no bridge or disabled, return empty result
    if (!this.bridge || !this.bridge.isEnabled()) {
      this.logger.progress("skipped", { reason: "Bridge not available or disabled" });
      return {
        success: true,
        memories: memories.map((m) => ({ ...m, entities: [] })),
      };
    }

    try {
      // Run through bridge
      this.logger.progress("calling-bridge");
      const result = await this.bridge.process({
        messages: input.messages,
        memories,
        correlationId: input.correlationId,
      });

      this.logger.progress("bridge-complete", {
        success: result.success,
        entityCount: result.entities.length,
        relationshipCount: result.relationships.length,
        stored: result.storage?.relationshipsStored ?? 0,
      });

      // Attach semantic data to memories
      const memoriesWithEntities = memories.map((memory) => {
        // Find entities mentioned in this memory's source messages
        const memoryEntityNames = new Set<string>();

        for (const msgId of memory.sourceMessageIds) {
          const msg = input.messages.find((m) => m.id === msgId);
          if (msg) {
            // Check which extracted entities are mentioned in this message
            for (const entity of result.entities) {
              if (msg.content.toLowerCase().includes(entity.name.toLowerCase())) {
                memoryEntityNames.add(entity.name);
              }
            }
          }
        }

        return {
          ...memory,
          entities: Array.from(memoryEntityNames),
        };
      });

      this.logger.success({
        memoriesProcessed: memoriesWithEntities.length,
        semanticEntities: result.entities.length,
        semanticRelationships: result.relationships.length,
      });

      return {
        success: result.success,
        memories: memoriesWithEntities,
        semanticEntities: result.entities,
        semanticRelationships: result.relationships,
        error: result.error,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        correlationId: input.correlationId,
        phase: "semantic-step",
      });

      // Return original memories on error (don't break pipeline)
      return {
        success: false,
        memories: memories.map((m) => ({ ...m, entities: [] })),
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Check if adapter has an active bridge
   * @returns Whether ready
   */
  isReady(): boolean {
    return this.bridge !== null && this.bridge.isEnabled();
  }

  /**
   * Get bridge configuration
   * @returns Config or null
   */
  getBridgeConfig() {
    return this.bridge?.getConfig() ?? null;
  }
}

/**
 * Create adapter
 * @param bridge - Bridge instance (or null if not configured)
 * @returns Adapter instance
 */
export function createAgentAdapter(
  bridge: SemanticExtractionBridge | null,
): AgentOrchestratorAdapter {
  return new AgentOrchestratorAdapter(bridge);
}

/**
 * Type guard for checking if adapter result has semantic data
 * @param result - Step result
 * @returns Whether has semantic data
 */
export function hasSemanticData(result: ExtendedAgentStepResult): boolean {
  return (
    (result.success && (result.semanticEntities?.length ?? 0) > 0) ||
    (result.semanticRelationships?.length ?? 0) > 0
  );
}
