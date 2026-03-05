/**
 * Feature Flag Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  FeatureFlagProvider,
  getFeatureFlags,
  isSemanticExtractionEnabled,
} from "../integration/feature-flags.js";

describe("FeatureFlagProvider", () => {
  beforeEach(() => {
    // Reset environment
    delete process.env.AURA_SEMANTIC_EXTRACTION;
    delete process.env.AURA_RELATIONSHIP_STORAGE;
    delete process.env.AURA_ALIAS_UPDATES;
    delete process.env.AURA_DRY_RUN;
  });

  describe("constructor", () => {
    it("should load from environment variables", () => {
      process.env.AURA_SEMANTIC_EXTRACTION = "true";
      process.env.AURA_DRY_RUN = "true";

      const provider = new FeatureFlagProvider();

      expect(provider.isEnabled("semanticExtraction")).toBe(true);
      expect(provider.isEnabled("dryRun")).toBe(true);
    });

    it("should default all to false", () => {
      const provider = new FeatureFlagProvider();

      expect(provider.isEnabled("semanticExtraction")).toBe(false);
      expect(provider.isEnabled("relationshipStorage")).toBe(false);
      expect(provider.isEnabled("aliasUpdates")).toBe(false);
      expect(provider.isEnabled("dryRun")).toBe(false);
    });

    it("should disable child flags when master is off", () => {
      process.env.AURA_SEMANTIC_EXTRACTION = "false";
      process.env.AURA_RELATIONSHIP_STORAGE = "true"; // Should be ignored

      const provider = new FeatureFlagProvider();

      expect(provider.isEnabled("semanticExtraction")).toBe(false);
      expect(provider.isEnabled("relationshipStorage")).toBe(false);
    });

    it("should enable child flags when master is on", () => {
      process.env.AURA_SEMANTIC_EXTRACTION = "true";
      // No explicit child flags - should default to true

      const provider = new FeatureFlagProvider();

      expect(provider.isEnabled("semanticExtraction")).toBe(true);
      expect(provider.isEnabled("relationshipStorage")).toBe(true);
      expect(provider.isEnabled("aliasUpdates")).toBe(true);
    });

    it("should allow disabling child flags explicitly", () => {
      process.env.AURA_SEMANTIC_EXTRACTION = "true";
      process.env.AURA_RELATIONSHIP_STORAGE = "false";

      const provider = new FeatureFlagProvider();

      expect(provider.isEnabled("semanticExtraction")).toBe(true);
      expect(provider.isEnabled("relationshipStorage")).toBe(false);
      expect(provider.isEnabled("aliasUpdates")).toBe(true);
    });
  });

  describe("isEnabled", () => {
    it("should return correct flag values", () => {
      const provider = new FeatureFlagProvider();
      provider.override("semanticExtraction", true);

      expect(provider.isEnabled("semanticExtraction")).toBe(true);
      expect(provider.isEnabled("dryRun")).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return all flags", () => {
      const provider = new FeatureFlagProvider();
      provider.override("semanticExtraction", true);
      provider.override("dryRun", true);

      const all = provider.getAll();

      expect(all.semanticExtraction).toBe(true);
      expect(all.dryRun).toBe(true);
      expect(all.relationshipStorage).toBe(false);
    });
  });

  describe("override", () => {
    it("should override flag value", () => {
      const provider = new FeatureFlagProvider();

      expect(provider.isEnabled("semanticExtraction")).toBe(false);

      provider.override("semanticExtraction", true);

      expect(provider.isEnabled("semanticExtraction")).toBe(true);
    });
  });

  describe("reset", () => {
    it("should reset to environment defaults", () => {
      process.env.AURA_SEMANTIC_EXTRACTION = "true";

      const provider = new FeatureFlagProvider();
      expect(provider.isEnabled("semanticExtraction")).toBe(true);

      provider.override("semanticExtraction", false);
      expect(provider.isEnabled("semanticExtraction")).toBe(false);

      provider.reset();
      expect(provider.isEnabled("semanticExtraction")).toBe(true);
    });
  });

  describe("isAnyEnabled", () => {
    it("should return true if semantic extraction enabled", () => {
      const provider = new FeatureFlagProvider();
      provider.override("semanticExtraction", true);

      expect(provider.isAnyEnabled()).toBe(true);
    });

    it("should return true if dry-run enabled", () => {
      const provider = new FeatureFlagProvider();
      provider.override("dryRun", true);

      expect(provider.isAnyEnabled()).toBe(true);
    });

    it("should return false if nothing enabled", () => {
      const provider = new FeatureFlagProvider();

      expect(provider.isAnyEnabled()).toBe(false);
    });
  });

  describe("getSummary", () => {
    it("should return formatted summary", () => {
      const provider = new FeatureFlagProvider();
      provider.override("semanticExtraction", true);
      provider.override("dryRun", true);

      const summary = provider.getSummary();

      expect(summary.semanticExtraction).toContain("✅");
      expect(summary.dryRun).toContain("✅");
      expect(summary.relationshipStorage).toContain("❌");
    });
  });
});

describe("getFeatureFlags", () => {
  it("should return singleton instance", () => {
    const flags1 = getFeatureFlags();
    const flags2 = getFeatureFlags();

    expect(flags1).toBe(flags2);
  });
});

describe("isSemanticExtractionEnabled", () => {
  it("should return true when enabled", () => {
    process.env.AURA_SEMANTIC_EXTRACTION = "true";
    // Reset singleton to pick up new env var
    const flags = getFeatureFlags();
    flags.reset();
    const result = isSemanticExtractionEnabled();
    expect(result).toBe(true);
    delete process.env.AURA_SEMANTIC_EXTRACTION;
  });

  it("should return false when disabled", () => {
    process.env.AURA_SEMANTIC_EXTRACTION = "false";
    // Reset singleton to pick up new env var
    const flags = getFeatureFlags();
    flags.reset();
    const result = isSemanticExtractionEnabled();
    expect(result).toBe(false);
    delete process.env.AURA_SEMANTIC_EXTRACTION;
  });
});
