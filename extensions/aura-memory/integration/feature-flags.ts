/**
 * Feature Flag Provider
 * Manages feature flags for safe rollout of semantic extraction
 */

import type { FeatureFlagConfig } from "./types.js";

/**
 * Default feature flag configuration
 */
const DEFAULT_FLAGS: FeatureFlagConfig = {
  semanticExtraction: process.env.AURA_SEMANTIC_EXTRACTION === "true",
  relationshipStorage: process.env.AURA_RELATIONSHIP_STORAGE !== "false", // Default true if extraction enabled
  aliasUpdates: process.env.AURA_ALIAS_UPDATES !== "false", // Default true if extraction enabled
  dryRun: process.env.AURA_DRY_RUN === "true",
};

/**
 * Feature flag provider
 *
 * Environment variables:
 * - AURA_SEMANTIC_EXTRACTION=true|false (master switch)
 * - AURA_RELATIONSHIP_STORAGE=true|false
 * - AURA_ALIAS_UPDATES=true|false
 * - AURA_DRY_RUN=true|false (log only, don't store)
 */
export class FeatureFlagProvider {
  private flags: FeatureFlagConfig;

  constructor() {
    this.flags = this.loadFromEnvironment();
  }

  /**
   * Load flags from environment variables
   * @returns Flag configuration
   */
  private loadFromEnvironment(): FeatureFlagConfig {
    const masterEnabled = process.env.AURA_SEMANTIC_EXTRACTION === "true";

    return {
      semanticExtraction: masterEnabled,
      // If master is off, everything is off
      // If master is on, individual flags default to true unless explicitly false
      relationshipStorage: masterEnabled && process.env.AURA_RELATIONSHIP_STORAGE !== "false",
      aliasUpdates: masterEnabled && process.env.AURA_ALIAS_UPDATES !== "false",
      dryRun: process.env.AURA_DRY_RUN === "true",
    };
  }

  /**
   * Check if a feature is enabled
   * @param flag - Feature flag name
   * @returns Whether enabled
   */
  isEnabled(flag: keyof FeatureFlagConfig): boolean {
    return this.flags[flag];
  }

  /**
   * Get all feature flags
   * @returns All flags
   */
  getAll(): FeatureFlagConfig {
    return { ...this.flags };
  }

  /**
   * Override a feature flag (for testing)
   * @param flag - Flag to override
   * @param value - New value
   */
  override(flag: keyof FeatureFlagConfig, value: boolean): void {
    this.flags = { ...this.flags, [flag]: value };
  }

  /**
   * Reset to environment defaults
   */
  reset(): void {
    this.flags = this.loadFromEnvironment();
  }

  /**
   * Check if any semantic features are enabled
   * @returns Whether any features active
   */
  isAnyEnabled(): boolean {
    return this.flags.semanticExtraction || this.flags.dryRun;
  }

  /**
   * Get feature flag summary for logging
   * @returns Summary object
   */
  getSummary(): Record<string, string> {
    return {
      semanticExtraction: this.flags.semanticExtraction ? "✅ ON" : "❌ OFF",
      relationshipStorage: this.flags.relationshipStorage ? "✅ ON" : "❌ OFF",
      aliasUpdates: this.flags.aliasUpdates ? "✅ ON" : "❌ OFF",
      dryRun: this.flags.dryRun ? "✅ ON" : "❌ OFF",
    };
  }
}

/**
 * Global feature flag instance
 */
let globalProvider: FeatureFlagProvider | null = null;

/**
 * Get global feature flag provider
 * @returns Global provider
 */
export function getFeatureFlags(): FeatureFlagProvider {
  if (!globalProvider) {
    globalProvider = new FeatureFlagProvider();
  }
  return globalProvider;
}

/**
 * Check if semantic extraction is enabled globally
 * @returns Whether enabled
 */
export function isSemanticExtractionEnabled(): boolean {
  return getFeatureFlags().isEnabled("semanticExtraction");
}

/**
 * Check if in dry-run mode
 * @returns Whether dry-run
 */
export function isDryRun(): boolean {
  return getFeatureFlags().isEnabled("dryRun");
}
