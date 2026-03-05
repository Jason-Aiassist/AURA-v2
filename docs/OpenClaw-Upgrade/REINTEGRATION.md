# OpenClaw Upgrade - File-by-File Re-Integration Guide

This guide provides step-by-step instructions for re-integrating AURA-specific changes into OpenClaw core files after an upgrade.

## Overview

When upgrading OpenClaw, the upstream repository may overwrite local modifications. This guide helps you identify and re-apply AURA-specific changes.

## Critical Files Requiring Re-Integration

### 1. `src/plugins/loader.ts` 🔴 CRITICAL

**Purpose:** Registers the default `before_prompt_build` hook that AURA depends on.

**AURA Changes:**

- Adds type imports for `PluginHookBeforePromptBuildEvent` and `PluginHookAgentContext`
- Updates default hook handler with proper types
- Makes logger access defensive (`logger?.debug?.`)

**Re-Integration Steps:**

```bash
# 1. Check if AURA changes are still present
grep -n "PluginHookBeforePromptBuildEvent" src/plugins/loader.ts

# 2. If missing, apply these changes:
```

**Code Changes:**

```typescript
# Add to imports (around line 28):
import type {
  OpenClawPluginModule,
  PluginDiagnostic,
  PluginLogger,
  PluginHookBeforePromptBuildEvent,  // ADD THIS
  PluginHookAgentContext,            // ADD THIS
} from "./types.js";

# Update default hook handler (around line 675):
registry.typedHooks.push({
  pluginId: "core-defaults",
  hookName: "before_prompt_build",
  handler: async (_event: PluginHookBeforePromptBuildEvent, _ctx: PluginHookAgentContext) => {  // ADD TYPES
    // Default hook handler - logs execution and can inject default context
    logger?.debug?.("[core-defaults] before_prompt_build hook executed");  // MAKE DEFENSIVE
    // Return empty result to indicate hook ran (doesn't modify anything by default)
    return undefined;
  },
});
```

**Verification:**

```bash
npm run test:aura:post-upgrade
# Should show: ✅ PluginApi logger interface intact
```

---

### 2. `src/plugins/types.ts` 🟡 HIGH

**Purpose:** Defines plugin hook types that AURA uses.

**AURA Dependencies:**

- `before_prompt_build` hook name
- `PluginHookBeforePromptBuildEvent` type
- `PluginHookBeforePromptBuildResult` type
- `PluginHookAgentContext` type

**Re-Integration Steps:**

```bash
# Check if types are present
grep -n "before_prompt_build" src/plugins/types.ts
grep -n "PluginHookBeforePromptBuildEvent" src/plugins/types.ts
```

**If Missing:** These types are usually stable. If removed, this is a **breaking change**:

```typescript
# Ensure these types exist in the file:

export type PluginHookBeforePromptBuildEvent = {
  prompt: string;
  messages: unknown[];
};

export type PluginHookBeforePromptBuildResult = {
  systemPrompt?: string;
  prependContext?: string;
};

export type PluginHookAgentContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
};

# And in PluginHookName:
export type PluginHookName =
  | "before_model_resolve"
  | "before_prompt_build"  // MUST BE PRESENT
  | "before_agent_start"
  # ... etc
```

**Verification:**

```bash
grep -A5 "before_prompt_build" src/plugins/types.ts | head -10
```

---

### 3. `src/hooks/internal-hooks.ts` 🟡 HIGH

**Purpose:** Provides `registerInternalHook` function that AURA uses for `message:sent` events.

**AURA Dependencies:**

- `registerInternalHook` export
- `MessageSentHookEvent` type
- `InternalHookEvent` type

**Re-Integration Steps:**

```bash
# Check exports
grep -n "export.*registerInternalHook" src/hooks/internal-hooks.ts
```

**Usually Stable:** This file rarely changes. If `registerInternalHook` is removed, it's a **breaking change**.

**Verification:**

```bash
npm run test:aura:post-upgrade
# Should show: ✅ registerInternalHook still exported
```

---

### 4. `package.json` 🔴 CRITICAL

**Purpose:** Defines dependencies required by AURA.

**AURA Dependencies:**

- `better-sqlite3` - For tiered memory storage
- `neo4j-driver` - For knowledge graph

**Re-Integration Steps:**

```bash
# Check dependencies
grep -E "better-sqlite3|neo4j-driver" package.json

# If missing, add them:
```

**Code Changes:**

```json
{
  "dependencies": {
    # ... other deps ...
    "better-sqlite3": "^12.6.2",
    "neo4j-driver": "^6.0.1",
    # ... other deps ...
  }
}
```

**After modifying:**

```bash
npm install
npm rebuild better-sqlite3
```

**Verification:**

```bash
npm run test:aura:post-upgrade
# Should show: ✅ better-sqlite3 in package.json
# Should show: ✅ neo4j-driver in package.json
```

---

### 5. `src/agents/pi-embedded-runner/run/attempt.ts` 🟡 HIGH

**Purpose:** Executes `before_prompt_build` hook and applies context.

**AURA Dependencies:**

- Hook execution via `runBeforePromptBuild`
- `prependContext` result handling

**Re-Integration Steps:**

```bash
# Check if hook execution is present
grep -n "before_prompt_build" src/agents/pi-embedded-runner/run/attempt.ts
```

**Usually Stable:** This file should already call the hook. The key is that it uses the hook runner correctly.

**What to Look For:**

```typescript
# Around line 881-920, should have:
const promptBuildResult = hookRunner?.hasHooks("before_prompt_build")
  ? await hookRunner
      .runBeforePromptBuild(
        {
          prompt: params.prompt,
          messages: activeSession.messages,
        },
        hookCtx,
      )
      .then((result) => {
        # ... handle result ...
        return result;
      })
      .catch((hookErr: unknown) => {
        log.warn(`before_prompt_build hook failed: ${String(hookErr)}`);
        return undefined;
      })
  : undefined;

# And later, should apply prependContext:
if (promptBuildResult?.prependContext) {
  effectivePrompt = promptBuildResult.prependContext + "\n" + effectivePrompt;
}
```

**Verification:**

```bash
npm run test:aura:post-upgrade
# Should show: ✅ Agent runner executes before_prompt_build hook
# Should show: ✅ Agent runner handles prependContext
```

---

## Re-Integration Workflow

### Step 1: Before Upgrade

```bash
# 1. Document current state
git diff HEAD -- src/plugins/loader.ts > docs/OpenClaw-Upgrade/patches/loader.ts.patch
git diff HEAD -- package.json > docs/OpenClaw-Upgrade/patches/package.json.patch

# 2. Run pre-upgrade tests
npm run test:aura:pre-upgrade
```

### Step 2: After Upgrade

```bash
# 1. Check which files changed
git status

# 2. Check for AURA changes in each critical file
git diff HEAD -- src/plugins/loader.ts | grep -E "PluginHook|before_prompt_build"
git diff HEAD -- package.json | grep -E "better-sqlite3|neo4j-driver"
```

### Step 3: Re-Apply Changes

For each file that lost AURA changes:

#### Option A: Manual Patch Application

```bash
# Apply saved patch
git apply docs/OpenClaw-Upgrade/patches/loader.ts.patch

# If conflicts, resolve manually
git add src/plugins/loader.ts
```

#### Option B: Manual Code Edit

Follow the "Re-Integration Steps" for each file above.

### Step 4: Verify

```bash
# Run post-upgrade tests
npm run test:aura:post-upgrade

# Build
npm run build

# Run smoke tests
npm run test:aura:smoke
```

---

## Automated Re-Integration Script

Create this script for automated re-integration:

```bash
#!/bin/bash
# docs/OpenClaw-Upgrade/reintegrate-aura-changes.sh

echo "Re-integrating AURA changes into OpenClaw core..."

# Check each critical file
FILES=(
  "src/plugins/loader.ts"
  "src/plugins/types.ts"
  "src/hooks/internal-hooks.ts"
  "package.json"
)

for file in "${FILES[@]}"; do
  echo "Checking $file..."

  case $file in
    "src/plugins/loader.ts")
      if ! grep -q "PluginHookBeforePromptBuildEvent" "$file"; then
        echo "  ⚠️  Missing type imports in $file"
        echo "  Apply changes from File-by-File Guide section 1"
      else
        echo "  ✅ AURA changes present"
      fi
      ;;

    "package.json")
      if ! grep -q "better-sqlite3" "$file"; then
        echo "  ⚠️  Missing better-sqlite3 dependency"
        echo "  Apply changes from File-by-File Guide section 4"
      else
        echo "  ✅ Dependencies present"
      fi
      ;;

    *)
      echo "  ℹ️  Manual check required (see File-by-File Guide)"
      ;;
  esac
done

echo ""
echo "Run 'npm run test:aura:post-upgrade' to verify"
```

---

## Common Scenarios

### Scenario 1: Clean Upgrade (No Conflicts)

```bash
# AURA changes preserved
git merge upstream/main
npm install
npm run build
npm run test:aura:post-upgrade
```

### Scenario 2: Minor Conflicts in loader.ts

```bash
git merge upstream/main
# Edit src/plugins/loader.ts to preserve AURA changes
npm install
npm run build
npm run test:aura:post-upgrade
```

### Scenario 3: Major Restructure (Breaking Changes)

```bash
git merge upstream/main
# Review all critical files
# Re-apply AURA changes per File-by-File Guide
# May need to update AURA extension for new APIs
npm install
npm run build
npm run test:aura:post-upgrade
```

---

## Verification Checklist

After re-integration:

- [ ] `src/plugins/loader.ts` has AURA type imports
- [ ] `src/plugins/loader.ts` has typed default hook handler
- [ ] `package.json` has `better-sqlite3` dependency
- [ ] `package.json` has `neo4j-driver` dependency
- [ ] `src/plugins/types.ts` has `before_prompt_build` hook types
- [ ] `src/hooks/internal-hooks.ts` exports `registerInternalHook`
- [ ] All post-upgrade tests pass
- [ ] Build succeeds
- [ ] Smoke tests pass

---

## Emergency Contacts

If re-integration fails:

1. Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
2. Review OpenClaw upstream changelog
3. Create issue with upgrade details

---

_Last updated: 2026-03-05_
