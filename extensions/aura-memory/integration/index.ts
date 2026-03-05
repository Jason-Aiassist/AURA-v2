/**
 * Integration Module
 * Exports for Phase 1 integration
 */

// Types
export type {
  BridgeConfig,
  BridgeDependencies,
  BridgeExtractionInput,
  BridgeExtractionOutput,
  FeatureFlagConfig,
} from "./types.js";

// Bridge
export { SemanticExtractionBridge, createSemanticExtractionBridge } from "./bridge.js";

// Feature Flags
export {
  FeatureFlagProvider,
  getFeatureFlags,
  isSemanticExtractionEnabled,
  isDryRun,
} from "./feature-flags.js";

// Agent Adapter
export { AgentOrchestratorAdapter, createAgentAdapter, hasSemanticData } from "./agent-adapter.js";

// Smart Extraction (Phase 1 Enhancement)
export { SmartExtractionService, createSmartExtractionService } from "./SmartExtractionService.js";
export type {
  SmartExtractionConfig,
  SmartExtractionDependencies,
  MemoryWithUUID,
} from "./SmartExtractionService.js";
