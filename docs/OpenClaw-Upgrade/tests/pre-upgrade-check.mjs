#!/usr/bin/env node
/**
 * AURA Memory Pre-Upgrade Verification Script
 *
 * Run this BEFORE upgrading OpenClaw to establish baseline system health.
 * All checks must pass before proceeding with upgrade.
 */

import { execSync } from "child_process";
import { existsSync, writeFileSync } from "fs";

const TEST_RESULTS = {
  passed: 0,
  failed: 0,
  warnings: 0,
  tests: [],
};

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  bold: "\x1b[1m",
};

function log(message, color = "reset") {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function test(name, fn) {
  try {
    fn();
    TEST_RESULTS.passed++;
    TEST_RESULTS.tests.push({ name, status: "PASSED" });
    log(`  ✅ ${name}`, "green");
    return true;
  } catch (error) {
    TEST_RESULTS.failed++;
    TEST_RESULTS.tests.push({ name, status: "FAILED", error: error.message });
    log(`  ❌ ${name}: ${error.message}`, "red");
    return false;
  }
}

function warn(name, fn) {
  try {
    fn();
    TEST_RESULTS.passed++;
    TEST_RESULTS.tests.push({ name, status: "PASSED" });
    log(`  ✅ ${name}`, "green");
    return true;
  } catch (error) {
    TEST_RESULTS.warnings++;
    TEST_RESULTS.tests.push({ name, status: "WARNING", error: error.message });
    log(`  ⚠️  ${name}: ${error.message}`, "yellow");
    return false;
  }
}

// ============================================
// TEST SUITE
// ============================================

log("\n" + "=".repeat(60), "bold");
log("AURA Memory Pre-Upgrade Verification", "bold");
log("=".repeat(60), "bold");

// 1. File Structure Tests
log("\n📁 File Structure Tests", "blue");

test("AURA extension directory exists", () => {
  if (!existsSync("extensions/aura-memory")) {
    throw new Error("extensions/aura-memory not found");
  }
});

test("AURA main entry point exists", () => {
  if (!existsSync("extensions/aura-memory/index.ts")) {
    throw new Error("extensions/aura-memory/index.ts not found");
  }
});

test("AURA config directory exists", () => {
  if (!existsSync("extensions/aura-memory/config")) {
    throw new Error("config directory not found");
  }
});

// 2. Dependency Tests
log("\n📦 Dependency Tests", "blue");

test("package.json exists", () => {
  if (!existsSync("package.json")) {
    throw new Error("package.json not found");
  }
});

test("better-sqlite3 in dependencies", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (!pkg.dependencies?.["better-sqlite3"]) {
    throw new Error("better-sqlite3 not in dependencies");
  }
});

test("neo4j-driver in dependencies", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (!pkg.dependencies?.["neo4j-driver"]) {
    throw new Error("neo4j-driver not in dependencies");
  }
});

// 3. OpenClaw Core Integration Tests
log("\n🔗 OpenClaw Core Integration Tests", "blue");

test("Hook system file exists", () => {
  if (!existsSync("src/hooks/internal-hooks.ts")) {
    throw new Error("src/hooks/internal-hooks.ts not found");
  }
});

test("Plugin types file exists", () => {
  if (!existsSync("src/plugins/types.ts")) {
    throw new Error("src/plugins/types.ts not found");
  }
});

test("Plugin loader file exists", () => {
  if (!existsSync("src/plugins/loader.ts")) {
    throw new Error("src/plugins/loader.ts not found");
  }
});

test("Agent runner file exists", () => {
  if (!existsSync("src/agents/pi-embedded-runner/run/attempt.ts")) {
    throw new Error("Agent runner not found at expected path");
  }
});

// 4. Hook API Tests
log("\n🪝 Hook API Tests", "blue");

test("registerInternalHook exported", () => {
  const content = readFileSync("src/hooks/internal-hooks.ts", "utf8");
  if (!content.includes("export function registerInternalHook")) {
    throw new Error("registerInternalHook not exported");
  }
});

test("MessageSentHookEvent type exists", () => {
  const content = readFileSync("src/hooks/internal-hooks.ts", "utf8");
  if (!content.includes("MessageSentHookEvent")) {
    throw new Error("MessageSentHookEvent type not found");
  }
});

test("before_prompt_build hook supported", () => {
  const content = readFileSync("src/plugins/types.ts", "utf8");
  if (!content.includes("before_prompt_build")) {
    throw new Error("before_prompt_build hook not in types");
  }
});

// 5. AURA Integration Tests
log("\n🧠 AURA Integration Tests", "blue");

test("AURA imports internal hooks correctly", () => {
  const content = readFileSync("extensions/aura-memory/index.ts", "utf8");
  if (!content.includes("registerInternalHook")) {
    throw new Error("registerInternalHook not imported in AURA");
  }
});

test("AURA uses before_prompt_build hook", () => {
  const content = readFileSync("extensions/aura-memory/index.ts", "utf8");
  if (!content.includes("before_prompt_build")) {
    throw new Error("before_prompt_build not used in AURA");
  }
});

test("AURA config uses getUserName()", () => {
  const content = readFileSync("extensions/aura-memory/config/user-config.ts", "utf8");
  if (!content.includes("getUserName")) {
    throw new Error("getUserName() not found in config");
  }
});

// 6. Build Tests
log("\n🔨 Build Tests", "blue");

warn("TypeScript compilation (quick check)", () => {
  try {
    execSync("npx tsc --noEmit extensions/aura-memory/config/user-config.ts 2>&1", {
      encoding: "utf8",
      timeout: 30000,
    });
  } catch {
    throw new Error("TypeScript compilation failed");
  }
});

// 7. Git State Tests
log("\n📜 Git State Tests", "blue");

test("Git repository initialized", () => {
  if (!existsSync(".git")) {
    throw new Error(".git directory not found");
  }
});

warn("No uncommitted changes in critical files", () => {
  const output = execSync("git status --porcelain src/hooks/ src/plugins/ 2>&1", {
    encoding: "utf8",
  });
  if (output.trim()) {
    throw new Error("Uncommitted changes in critical files:\n" + output);
  }
});

// ============================================
// RESULTS
// ============================================

log("\n" + "=".repeat(60), "bold");
log("Test Results", "bold");
log("=".repeat(60), "bold");

log(`\n✅ Passed: ${TEST_RESULTS.passed}`, "green");
log(`❌ Failed: ${TEST_RESULTS.failed}`, "red");
log(`⚠️  Warnings: ${TEST_RESULTS.warnings}`, "yellow");

// Save results to file
const reportPath = "docs/OpenClaw-Upgrade/tests/pre-upgrade-report.json";
writeFileSync(reportPath, JSON.stringify(TEST_RESULTS, null, 2));
log(`\n📄 Report saved to: ${reportPath}`, "blue");

// Final verdict
log("\n" + "=".repeat(60), "bold");
if (TEST_RESULTS.failed === 0) {
  log("✅ PRE-UPGRADE CHECKS PASSED", "green");
  log("System is ready for OpenClaw upgrade", "green");
  log("=".repeat(60), "bold");
  process.exit(0);
} else {
  log("❌ PRE-UPGRADE CHECKS FAILED", "red");
  log("Fix failed tests before proceeding with upgrade", "red");
  log("=".repeat(60), "bold");
  process.exit(1);
}

// Helper function
function readFileSync(path, encoding = "utf8") {
  try {
    return execSync(`cat ${path}`, { encoding });
  } catch (error) {
    throw new Error(`Failed to read ${path}: ${error.message}`, { cause: error });
  }
}
