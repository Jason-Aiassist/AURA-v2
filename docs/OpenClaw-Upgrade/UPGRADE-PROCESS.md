# Complete OpenClaw Upgrade Process for AURA

This document provides the complete end-to-end process for upgrading OpenClaw while preserving AURA Memory integration.

## Table of Contents

1. [Pre-Upgrade Preparation](#pre-upgrade-preparation)
2. [The Upgrade Process](#the-upgrade-process)
3. [Post-Upgrade Re-Integration](#post-upgrade-re-integration)
4. [Verification](#verification)
5. [Troubleshooting](#troubleshooting)

---

## Pre-Upgrade Preparation

### Step 1: Create Backup

```bash
# Create backup branch
git checkout -b backup/pre-upgrade-$(date +%Y%m%d)
git add -A
git commit -m "backup: Pre-OpenClaw upgrade state"
git tag aura-stable-$(date +%Y%m%d)
```

### Step 2: Run Pre-Upgrade Tests

```bash
npm run test:aura:pre-upgrade
```

Expected result: ✅ All 19 tests pass

### Step 3: Document Current State

```bash
# Record versions
echo "OpenClaw: $(git log --oneline -1)" > docs/OpenClaw-Upgrade/upgrade-log.txt
echo "AURA: $(git log --oneline -1 -- extensions/aura-memory/)" >> docs/OpenClaw-Upgrade/upgrade-log.txt
echo "Date: $(date -Iseconds)" >> docs/OpenClaw-Upgrade/upgrade-log.txt
```

---

## The Upgrade Process

### Step 4: Fetch Upstream Changes

```bash
# Ensure upstream remote is configured
git remote add upstream https://github.com/openclaw/openclaw.git 2>/dev/null || true

# Fetch latest changes
git fetch upstream

# Review changes
git log --oneline HEAD..upstream/main | head -20
```

### Step 5: Create Upgrade Branch

```bash
git checkout -b upgrade/openclaw-$(date +%Y%m%d)
```

### Step 6: Merge Upstream Changes

```bash
# Attempt merge
git merge upstream/main
```

#### If No Conflicts:

```bash
# Great! Proceed to Step 7
```

#### If Conflicts:

**Critical files to watch:**

- `src/plugins/loader.ts` - May lose AURA type imports
- `package.json` - May lose AURA dependencies
- `src/plugins/types.ts` - May lose hook types

**Resolution approach:**

1. Keep upstream changes for most files
2. Preserve AURA changes for critical files (see [REINTEGRATION.md](REINTEGRATION.md))
3. Mark conflicts resolved: `git add <file>`

```bash
# After resolving all conflicts
git commit -m "merge: OpenClaw upstream changes"
```

---

## Post-Upgrade Re-Integration

### Step 7: Check AURA Integration

```bash
# Run re-integration check
bash docs/OpenClaw-Upgrade/reintegrate-aura-changes.sh --check-only
```

**If issues found:**

```bash
# Attempt automatic fixes
bash docs/OpenClaw-Upgrade/reintegrate-aura-changes.sh --apply

# Or manually fix per REINTEGRATION.md
```

### Step 8: Install Dependencies

```bash
# Install any new dependencies
npm install

# Rebuild native modules
npm rebuild better-sqlite3
```

### Step 9: Build Project

```bash
npm run build
```

**If build fails:**

1. Check TypeScript errors: `npx tsc --noEmit 2>&1 | grep "error TS" | head -20`
2. Fix AURA type issues if any
3. Rebuild: `npm run build`

---

## Verification

### Step 10: Run Post-Upgrade Tests

```bash
npm run test:aura:post-upgrade
```

Expected result: ✅ 26+ tests pass, 0 critical failures

### Step 11: Start Gateway

```bash
npm start
```

**Watch for these log messages:**

```
[AURA Memory] EXTENSION REGISTER FUNCTION CALLED
[AURA Memory] before_prompt_build hook registered SUCCESSFULLY
[AURA Memory] ContextInjector initialized
[AURA Memory] Session extraction system started
```

### Step 12: Run Smoke Tests

In another terminal:

```bash
npm run test:aura:smoke
```

Expected result: ✅ 13+ tests pass

### Step 13: Test Context Injection

1. Send a message to your agent
2. Check logs for: `[AURA Memory] HOOK TRIGGERED - before_prompt_build`
3. Verify: `[AURA Memory] INJECTION PIPELINE COMPLETE`
4. Confirm memories are injected (check for `prependContext` in logs)

### Step 14: Test CLI Commands

```bash
# Test AURA CLI commands
openclaw aura-memory:status
openclaw aura-memory:context-status
openclaw aura-memory:search-status
```

All should return valid output.

---

## Troubleshooting

### Issue: Build Fails with TypeScript Errors

```bash
# Check specific errors
npx tsc --noEmit 2>&1 | grep "extensions/aura-memory"

# Common fixes:
# 1. Import path changed - update import statement
# 2. Type renamed - update type reference
# 3. Missing dependency - npm install <package>
```

### Issue: Hook Not Registering

```bash
# Check if registerInternalHook exists
grep -n "export function registerInternalHook" src/hooks/internal-hooks.ts

# If missing, see REINTEGRATION.md section 3
```

### Issue: Context Injection Not Working

```bash
# Check if before_prompt_build hook exists
grep -n "before_prompt_build" src/plugins/types.ts

# Check if hook is being executed
grep -n "runBeforePromptBuild" src/agents/pi-embedded-runner/run/attempt.ts

# If missing, see REINTEGRATION.md sections 1 and 5
```

### Issue: Missing Dependencies

```bash
# Check package.json
grep -E "better-sqlite3|neo4j-driver" package.json

# If missing:
npm install better-sqlite3@^12.6.2 neo4j-driver@^6.0.1
```

---

## Quick Reference Commands

```bash
# Full upgrade with tests
npm run test:aura:upgrade

# Individual steps
npm run test:aura:pre-upgrade     # Before upgrade
npm run test:aura:post-upgrade    # After upgrade
npm run test:aura:smoke           # Runtime tests

# Re-integration check
bash docs/OpenClaw-Upgrade/reintegrate-aura-changes.sh --check-only
bash docs/OpenClaw-Upgrade/reintegrate-aura-changes.sh --apply

# Emergency rollback
git checkout backup/pre-upgrade-$(date +%Y%m%d)
npm install && npm run build
```

---

## Upgrade Checklist

- [ ] Backup created
- [ ] Pre-upgrade tests pass
- [ ] Upstream changes merged
- [ ] Conflicts resolved (if any)
- [ ] Re-integration check passes
- [ ] Dependencies installed
- [ ] Build succeeds
- [ ] Post-upgrade tests pass
- [ ] Gateway starts successfully
- [ ] Smoke tests pass
- [ ] Context injection works
- [ ] CLI commands work
- [ ] Upgrade documented

---

## Documents Reference

| Document                                 | Purpose                     |
| ---------------------------------------- | --------------------------- |
| [README.md](README.md)                   | Main upgrade guide          |
| [REINTEGRATION.md](REINTEGRATION.md)     | File-by-file re-integration |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common issues & solutions   |
| [CHECKLIST.md](CHECKLIST.md)             | Step-by-step checklist      |
| [QUICKREF.md](QUICKREF.md)               | Quick reference card        |

---

_Last updated: 2026-03-05_
