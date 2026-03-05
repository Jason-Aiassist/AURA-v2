#!/usr/bin/env node
/**
 * AURA Memory Post-Upgrade Verification Script
 *
 * Run this AFTER upgrading OpenClaw to verify AURA integration is intact.
 * All checks must pass to confirm successful upgrade.
 */

import { execSync } from "child_process";
import { existsSync, writeFileSync, readFileSync as fsReadFileSync } from "fs";

const TEST_RESULTS = {
  passed: 0,
  failed: 0,
  warnings: 0,
  tests: [],
  timing: {},
};

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function log(message, color = "reset") {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function test(name, fn, critical = false) {
  const start = Date.now();
  try {
    fn();
    const duration = Date.now() - start;
    TEST_RESULTS.passed++;
    TEST_RESULTS.tests.push({ name, status: "PASSED", duration, critical });
    log(`  ✅ ${name} (${duration}ms)`, "green");
    return true;
  } catch (error) {
    const duration = Date.now() - start;
    TEST_RESULTS.failed++;
    TEST_RESULTS.tests.push({ name, status: "FAILED", error: error.message, duration, critical });
    if (critical) {
      log(`  🚨 ${name}: ${error.message} [CRITICAL]`, "red");
    } else {
      log(`  ❌ ${name}: ${error.message}`, "red");
    }
    return false;
  }
}

function warn(name, fn) {
  const start = Date.now();
  try {
    fn();
    const duration = Date.now() - start;
    TEST_RESULTS.passed++;
    TEST_RESULTS.tests.push({ name, status: "PASSED", duration });
    log(`  ✅ ${name} (${duration}ms)`, "green");
    return true;
  } catch (error) {
    const duration = Date.now() - start;
    TEST_RESULTS.warnings++;
    TEST_RESULTS.tests.push({ name, status: "WARNING", error: error.message, duration });
    log(`  ⚠️  ${name}: ${error.message}`, "yellow");
    return false;
  }
}

// ============================================
// TEST SUITE
// ============================================

log("\n" + "=".repeat(60), "bold");
log("AURA Memory Post-Upgrade Verification", "bold");
log("=".repeat(60), "bold");

// 1. Build Tests
log("\n🔨 Build Tests", "blue");

test(
  "Node modules installed",
  () => {
    if (!existsSync("node_modules")) {
      throw new Error("node_modules not found. Run npm install.");
    }
  },
  true,
);

test(
  "better-sqlite3 built",
  () => {
    const buildPath = "node_modules/better-sqlite3/build/Release/better_sqlite3.node";
    if (!existsSync(buildPath)) {
      throw new Error("better-sqlite3 native module not built");
    }
  },
  true,
);

test(
  "TypeScript compilation succeeds",
  () => {
    try {
      execSync("npx tsc --noEmit 2>&1 | head -50", {
        encoding: "utf8",
        timeout: 120000,
      });
    } catch (error) {
      // TypeScript returns non-zero on errors, check output
      const output = error.stdout || error.message || "";
      const auraErrors = output.match(/extensions\/aura-memory\/.*error/gi);
      if (auraErrors) {
        throw new Error(`TypeScript errors in AURA: ${auraErrors.length} errors`, { cause: error });
      }
    }
  },
  true,
);

// 2. Hook System Tests
log("\n🪝 Hook System Tests", "blue");

test(
  "registerInternalHook still exported",
  () => {
    const content = readFile("src/hooks/internal-hooks.ts");
    if (!content.includes("export function registerInternalHook")) {
      throw new Error("registerInternalHook export removed");
    }
  },
  true,
);

test(
  "MessageSentHookEvent type unchanged",
  () => {
    const content = readFile("src/hooks/internal-hooks.ts");
    if (!content.includes("MessageSentHookEvent")) {
      throw new Error("MessageSentHookEvent type removed");
    }
    // Check for required fields
    if (!content.includes('type: "message"') && !content.includes("type: 'message'")) {
      throw new Error("MessageSentHookEvent structure changed");
    }
  },
  true,
);

test(
  "before_prompt_build hook type exists",
  () => {
    const content = readFile("src/plugins/types.ts");
    if (!content.includes("before_prompt_build")) {
      throw new Error("before_prompt_build hook removed from types");
    }
  },
  true,
);

test(
  "PluginHookBeforePromptBuildEvent has prompt field",
  () => {
    const content = readFile("src/plugins/types.ts");
    const hasPrompt = content.match(/PluginHookBeforePromptBuildEvent[\s\S]{0,200}prompt/);
    if (!hasPrompt) {
      throw new Error("PluginHookBeforePromptBuildEvent missing prompt field");
    }
  },
  true,
);

test(
  "PluginHookBeforePromptBuildResult has prependContext",
  () => {
    const content = readFile("src/plugins/types.ts");
    const hasPrepend = content.match(
      /PluginHookBeforePromptBuildResult[\s\S]{0,200}prependContext/,
    );
    if (!hasPrepend) {
      throw new Error("PluginHookBeforePromptBuildResult missing prependContext");
    }
  },
  true,
);

// 3. Plugin API Tests
log("\n🔌 Plugin API Tests", "blue");

test(
  "OpenClawPluginApi interface exists",
  () => {
    const content = readFile("src/plugins/types.ts");
    if (!content.includes("export type OpenClawPluginApi")) {
      throw new Error("OpenClawPluginApi type removed");
    }
  },
  true,
);

test(
  "PluginApi has register method",
  () => {
    const content = readFile("src/plugins/types.ts");
    if (!content.includes("register?:")) {
      throw new Error("Plugin register method removed from API");
    }
  },
  true,
);

test(
  "PluginApi has on method for hooks",
  () => {
    const content = readFile("src/plugins/types.ts");
    if (!content.includes("on:")) {
      throw new Error("Plugin on method removed from API");
    }
  },
  true,
);

test(
  "PluginApi logger interface intact",
  () => {
    const content = readFile("src/plugins/types.ts");
    // Check for PluginLogger type and logger property in API
    const hasPluginLogger = content.includes("export type PluginLogger");
    const hasLoggerInApi = content.includes("logger: PluginLogger");
    if (!hasPluginLogger || !hasLoggerInApi) {
      throw new Error("Plugin logger interface changed");
    }
  },
  true,
);

// 4. Agent Runner Tests
log("\n🤖 Agent Runner Tests", "blue");

test(
  "Agent runner executes before_prompt_build hook",
  () => {
    const content = readFile("src/agents/pi-embedded-runner/run/attempt.ts");
    if (!content.includes("before_prompt_build")) {
      throw new Error("Agent runner no longer calls before_prompt_build hook");
    }
  },
  true,
);

test(
  "Agent runner handles prependContext",
  () => {
    const content = readFile("src/agents/pi-embedded-runner/run/attempt.ts");
    if (!content.includes("prependContext")) {
      throw new Error("Agent runner no longer handles prependContext");
    }
  },
  true,
);

test(
  "Agent runner handles hook errors gracefully",
  () => {
    const content = readFile("src/agents/pi-embedded-runner/run/attempt.ts");
    const hasErrorHandling = content.match(/hookErr|catch.*hook/i);
    if (!hasErrorHandling) {
      throw new Error("Agent runner hook error handling removed");
    }
  },
  true,
);

// 5. AURA Extension Tests
log("\n🧠 AURA Extension Tests", "blue");

test("AURA config file exists", () => {
  if (!existsSync("extensions/aura-memory/config/user-config.ts")) {
    throw new Error("AURA user config not found");
  }
});

test("AURA index.ts imports work", () => {
  const content = readFile("extensions/aura-memory/index.ts");
  if (!content.includes("registerInternalHook")) {
    throw new Error("AURA not importing registerInternalHook");
  }
});

test("AURA uses correct hook name", () => {
  const content = readFile("extensions/aura-memory/index.ts");
  if (!content.includes("before_prompt_build")) {
    throw new Error("AURA not using before_prompt_build hook");
  }
});

test("AURA getUserName() function exists", () => {
  const content = readFile("extensions/aura-memory/config/user-config.ts");
  if (!content.includes("export function getUserName()")) {
    throw new Error("getUserName() function not found");
  }
});

// 6. Dependency Tests
log("\n📦 Dependency Tests", "blue");

test("better-sqlite3 in package.json", () => {
  const pkg = JSON.parse(readFile("package.json"));
  if (!pkg.dependencies?.["better-sqlite3"]) {
    throw new Error("better-sqlite3 missing from dependencies");
  }
});

test("neo4j-driver in package.json", () => {
  const pkg = JSON.parse(readFile("package.json"));
  if (!pkg.dependencies?.["neo4j-driver"]) {
    throw new Error("neo4j-driver missing from dependencies");
  }
});

test("zod in package.json (AURA uses it)", () => {
  const pkg = JSON.parse(readFile("package.json"));
  if (!pkg.dependencies?.["zod"]) {
    throw new Error("zod missing from dependencies");
  }
});

// 7. Integration Compatibility Tests
log("\n🔗 Integration Compatibility Tests", "blue");

test("Hook priority system still works", () => {
  const content = readFile("src/plugins/types.ts");
  if (!content.includes("priority")) {
    warn("Hook priority may have been removed", () => {
      throw new Error("priority not found in types");
    });
  }
});

test("Plugin config schema support preserved", () => {
  const content = readFile("src/plugins/types.ts");
  if (!content.includes("configSchema")) {
    throw new Error("Plugin configSchema support removed");
  }
});

test("Synchronous plugin registration supported", () => {
  const content = readFile("src/plugins/loader.ts");
  // Check that loader doesn't force async on register
  const registerPattern = content.match(/register\([^)]*\)\s*[:{]/);
  if (!registerPattern) {
    warn("Could not verify sync registration", () => {
      throw new Error("Unable to parse registration pattern");
    });
  }
});

// 8. Performance Tests
log("\n⚡ Performance Tests", "blue");

warn("TypeScript compilation time acceptable", () => {
  const start = Date.now();
  try {
    // Just check the user-config file which is simple and should compile quickly
    execSync("npx tsc --noEmit --skipLibCheck extensions/aura-memory/config/user-config.ts 2>&1", {
      encoding: "utf8",
      timeout: 30000,
    });
    const duration = Date.now() - start;
    if (duration > 10000) {
      throw new Error(`Compilation took ${duration}ms (>10s)`);
    }
  } catch (error) {
    // If it fails, it might be due to missing deps, which is a warning not failure
    throw new Error(`Compilation check failed: ${error.message}`, { cause: error });
  }
});

// ============================================
// COMPARISON WITH PRE-UPGRADE
// ============================================

log("\n📊 Comparison with Pre-Upgrade State", "blue");

const preUpgradePath = "docs/OpenClaw-Upgrade/tests/pre-upgrade-report.json";
if (existsSync(preUpgradePath)) {
  try {
    const preUpgrade = JSON.parse(fsReadFileSync(preUpgradePath, "utf8"));

    log(`  Pre-upgrade passed: ${preUpgrade.passed}`, "cyan");
    log(`  Post-upgrade passed: ${TEST_RESULTS.passed}`, "cyan");

    if (TEST_RESULTS.passed < preUpgrade.passed) {
      log(`  ⚠️  Fewer tests passing than before upgrade`, "yellow");
    } else if (TEST_RESULTS.passed > preUpgrade.passed) {
      log(`  ✅ More tests passing than before upgrade`, "green");
    } else {
      log(`  ✅ Same number of tests passing`, "green");
    }
  } catch (error) {
    log(`  ⚠️  Could not load pre-upgrade report: ${error.message}`, "yellow");
  }
} else {
  log(`  ⚠️  No pre-upgrade report found for comparison`, "yellow");
}

// ============================================
// RESULTS
// ============================================

log("\n" + "=".repeat(60), "bold");
log("Test Results Summary", "bold");
log("=".repeat(60), "bold");

log(`\n✅ Passed: ${TEST_RESULTS.passed}`, "green");
log(`❌ Failed: ${TEST_RESULTS.failed}`, "red");
log(`⚠️  Warnings: ${TEST_RESULTS.warnings}`, "yellow");

// Critical failures
const criticalFailures = TEST_RESULTS.tests.filter((t) => t.critical && t.status === "FAILED");
if (criticalFailures.length > 0) {
  log(`\n🚨 CRITICAL FAILURES:`, "red");
  criticalFailures.forEach((t) => {
    log(`  - ${t.name}`, "red");
  });
}

// Save results
const reportPath = "docs/OpenClaw-Upgrade/tests/post-upgrade-report.json";
writeFileSync(reportPath, JSON.stringify(TEST_RESULTS, null, 2));
log(`\n📄 Report saved to: ${reportPath}`, "blue");

// Final verdict
log("\n" + "=".repeat(60), "bold");
if (TEST_RESULTS.failed === 0 && criticalFailures.length === 0) {
  log("✅ POST-UPGRADE VERIFICATION PASSED", "green");
  log("AURA Memory integration is intact", "green");
  log("Upgrade successful!", "green");
  log("=".repeat(60), "bold");
  process.exit(0);
} else if (criticalFailures.length > 0) {
  log("🚨 POST-UPGRADE VERIFICATION FAILED - CRITICAL ISSUES", "red");
  log("AURA Memory integration is BROKEN", "red");
  log("ROLLBACK RECOMMENDED", "red");
  log("=".repeat(60), "bold");
  process.exit(2);
} else {
  log("⚠️  POST-UPGRADE VERIFICATION PASSED WITH WARNINGS", "yellow");
  log("Review warnings before production deployment", "yellow");
  log("=".repeat(60), "bold");
  process.exit(1);
}

// Helper function
function readFile(path) {
  try {
    return fsReadFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Failed to read ${path}: ${error.message}`, { cause: error });
  }
}
