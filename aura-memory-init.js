#!/usr/bin/env node
/**
 * AURA Memory System - Gateway Integration Script
 *
 * This script initializes the AURA memory extraction system
 * when the OpenClaw gateway starts.
 */

const { startAuraMemorySystem } = require("./dist/aura-memory/startup.js");

async function main() {
  console.log("[AURA] Initializing memory extraction system...");

  try {
    await startAuraMemorySystem();
    console.log("[AURA] Memory extraction system started successfully");
  } catch (error) {
    console.error("[AURA] Failed to start memory extraction:", error);
    // Don't crash the gateway - log and continue
  }
}

// Run initialization
main().catch((error) => {
  console.error("[AURA] Unhandled error during initialization:", error);
  process.exit(1);
});
