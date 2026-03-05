# OpenClaw Upgrade Guide for AURA Memory

This guide provides comprehensive instructions for safely upgrading OpenClaw core while preserving AURA Memory extension functionality.

## 📚 Documentation Suite

| Document                                     | Purpose                                  | When to Use                            |
| -------------------------------------------- | ---------------------------------------- | -------------------------------------- |
| **[UPGRADE-PROCESS.md](UPGRADE-PROCESS.md)** | Complete end-to-end upgrade process      | **Start here** for full upgrade        |
| **[REINTEGRATION.md](REINTEGRATION.md)**     | File-by-file re-integration instructions | When OpenClaw files need manual fixing |
| **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** | Common issues and solutions              | When something goes wrong              |
| **[CHECKLIST.md](CHECKLIST.md)**             | Step-by-step checklist                   | During upgrade to track progress       |
| **[QUICKREF.md](QUICKREF.md)**               | Quick reference card                     | For quick command lookup               |

## 🚀 Quick Start

```bash
# 1. Run pre-upgrade tests
npm run test:aura:pre-upgrade

# 2. Upgrade OpenClaw
git fetch upstream
git merge upstream/main

# 3. Check re-integration
bash docs/OpenClaw-Upgrade/reintegrate-aura-changes.sh --check-only

# 4. Install & build
npm install && npm run build

# 5. Run post-upgrade tests
npm run test:aura:post-upgrade

# 6. Start gateway and test
npm start
```

## Table of Contents

1. [Pre-Upgrade Checklist](#pre-upgrade-checklist)
2. [Understanding Integration Points](#understanding-integration-points)
3. [Step-by-Step Upgrade Process](#step-by-step-upgrade-process)
4. [Automated Verification Tests](#automated-verification-tests)
5. [Troubleshooting Common Issues](#troubleshooting-common-issues)
6. [Rollback Procedures](#rollback-procedures)

---

## Pre-Upgrade Checklist

### 1. Backup Current State

```bash
# Create a backup branch
git checkout -b backup/pre-upgrade-$(date +%Y%m%d)
git add -A
git commit -m "backup: Pre-OpenClaw upgrade state"

# Tag the current state
git tag aura-stable-$(date +%Y%m%d)
```

### 2. Document Current Versions

```bash
# Record current OpenClaw version
git log --oneline -1 > docs/OpenClaw-Upgrade/versions-current.txt

# Record AURA extension state
git log --oneline --all -- extensions/aura-memory/ >> docs/OpenClaw-Upgrade/versions-current.txt

# Record dependencies
npm list --depth=0 > docs/OpenClaw-Upgrade/dependencies-current.txt
```

### 3. Verify Current System Health

Run the pre-upgrade verification script:

```bash
npm run test:aura:pre-upgrade
```

Expected output:

- ✅ AURA extension loads successfully
- ✅ Context injection hook registered
- ✅ Knowledge Graph connection active
- ✅ Memory store initialized
- ✅ All AURA CLI commands responsive

---

## Understanding Integration Points

AURA Memory integrates with OpenClaw core at these critical points:

### Critical Integration Points

| Integration Point | OpenClaw File                                  | AURA Usage                                  | Risk Level  |
| ----------------- | ---------------------------------------------- | ------------------------------------------- | ----------- |
| Hook Registration | `src/hooks/internal-hooks.ts`                  | `registerInternalHook('message:sent', ...)` | 🔴 Critical |
| Plugin Hooks      | `src/plugins/hooks.ts`                         | `before_prompt_build` hook                  | 🔴 Critical |
| Plugin API        | `src/plugins/types.ts`                         | `OpenClawPluginApi` interface               | 🔴 Critical |
| Plugin Loader     | `src/plugins/loader.ts`                        | Hook registration                           | 🟡 High     |
| Agent Runner      | `src/agents/pi-embedded-runner/run/attempt.ts` | Hook execution                              | 🟡 High     |

### Dependency Requirements

AURA requires these OpenClaw dependencies:

- `better-sqlite3` - For tiered memory storage
- `neo4j-driver` - For knowledge graph

---

## Step-by-Step Upgrade Process

### Phase 1: Preparation (5 minutes)

1. **Create upgrade branch:**

   ```bash
   git checkout -b upgrade/openclaw-$(date +%Y%m%d)
   ```

2. **Fetch upstream changes:**

   ```bash
   git fetch upstream
   git log --oneline HEAD..upstream/main --stat | head -100
   ```

3. **Review changes to critical files:**

   ```bash
   # Check for hook system changes
   git diff HEAD..upstream/main -- src/hooks/

   # Check for plugin system changes
   git diff HEAD..upstream/main -- src/plugins/

   # Check for agent runner changes
   git diff HEAD..upstream/main -- src/agents/pi-embedded-runner/run/attempt.ts
   ```

### Phase 2: Dependency Check (2 minutes)

Verify required dependencies are still present:

```bash
# Check package.json for required deps
grep -E "better-sqlite3|neo4j-driver" package.json

# If missing, add them:
npm install better-sqlite3@^12.6.2 neo4j-driver@^6.0.1
```

### Phase 3: Merge Strategy (10 minutes)

#### Option A: Clean Merge (No Conflicts)

```bash
# Merge upstream changes
git merge upstream/main

# If successful, skip to Phase 4
```

#### Option B: Conflict Resolution

If conflicts occur in critical files:

1. **For `src/hooks/internal-hooks.ts`:**
   - Preserve AURA's `registerInternalHook` function
   - Keep `MessageSentHookEvent` type definition
   - Merge carefully - don't lose hook handler registration logic

2. **For `src/plugins/types.ts`:**
   - Preserve `OpenClawPluginApi` interface
   - Keep `before_prompt_build` hook types
   - Maintain backward compatibility

3. **For `src/plugins/loader.ts`:**
   - Ensure synchronous plugin registration
   - Preserve hook loading mechanism

4. **For `src/agents/pi-embedded-runner/run/attempt.ts`:**
   - Keep `before_prompt_build` hook execution
   - Preserve `prependContext` handling

### Phase 4: Build Verification (5 minutes)

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Check for TypeScript errors specifically in AURA
npx tsc --noEmit extensions/aura-memory/index.ts 2>&1 | grep -v "node_modules"
```

### Phase 5: Runtime Verification (10 minutes)

Run the comprehensive test suite:

```bash
# Run all AURA verification tests
npm run test:aura:upgrade

# Or run individually:
npm run test:aura:hooks
npm run test:aura:context-injection
npm run test:aura:kg-connection
npm run test:aura:memory-store
```

---

## Automated Verification Tests

### Test Suite Overview

The upgrade test suite consists of:

1. **Hook Registration Tests** - Verify hooks register correctly
2. **Context Injection Tests** - Verify memory injection works
3. **Knowledge Graph Tests** - Verify Neo4j connection
4. **Memory Store Tests** - Verify SQLite operations
5. **Integration Tests** - End-to-end workflow tests

### Running Tests

```bash
# Run all tests
npm run test:aura:upgrade

# Run specific test categories
npm run test:aura:hooks          # Hook system tests
npm run test:aura:context        # Context injection tests
npm run test:aura:storage        # Memory storage tests
npm run test:aura:kg             # Knowledge graph tests
```

### Expected Test Results

All tests should pass with:

- ✅ 100% hook registration success
- ✅ Context injection responding < 1000ms
- ✅ Knowledge Graph connectivity confirmed
- ✅ Memory store operations successful
- ✅ No TypeScript compilation errors

---

## Troubleshooting Common Issues

### Issue 1: Hook Registration Fails

**Symptoms:**

- `[AURA Memory] FAILED to get ContextInjector` in logs
- Context injection not working

**Diagnosis:**

```bash
# Check if hooks are registered
grep -r "before_prompt_build" src/plugins/loader.ts
```

**Solution:**

1. Verify `src/plugins/loader.ts` has the default hook
2. Check that plugin registration is synchronous
3. Ensure hook types are exported in `src/plugins/types.ts`

### Issue 2: TypeScript Compilation Errors

**Symptoms:**

- Build fails with type errors in AURA
- `OpenClawPluginApi` type not found

**Diagnosis:**

```bash
# Check type exports
grep "export.*OpenClawPluginApi" src/plugins/types.ts
```

**Solution:**

1. Update import paths if types moved
2. Add type declarations if interfaces changed
3. Check for renamed exports

### Issue 3: Context Injection Not Working

**Symptoms:**

- No memories injected into prompts
- `[AURA Memory] No context found for this query` always

**Diagnosis:**

```bash
# Check hook execution
DEBUG=aura:* npm start 2>&1 | grep -i "hook\|injection"
```

**Solution:**

1. Verify `before_prompt_build` hook fires
2. Check `prependContext` is returned correctly
3. Ensure prompt parsing regex still matches

### Issue 4: Knowledge Graph Connection Failed

**Symptoms:**

- Neo4j connection errors
- Entity resolution not working

**Diagnosis:**

```bash
# Test Neo4j connection
npm run aura-memory:kg-status
```

**Solution:**

1. Verify Neo4j container is running
2. Check connection credentials
3. Ensure `neo4j-driver` is installed

### Issue 5: Memory Store Initialization Failed

**Symptoms:**

- SQLite errors on startup
- TieredMemoryStore not available

**Diagnosis:**

```bash
# Check SQLite setup
npm run aura-memory:search-status
```

**Solution:**

1. Verify `better-sqlite3` is installed
2. Check database file permissions
3. Ensure sqlite-vec extension loads

---

## Rollback Procedures

### Quick Rollback (Emergency)

```bash
# Immediate rollback to last known good state
git checkout backup/pre-upgrade-$(date +%Y%m%d)
npm install
npm run build
npm restart
```

### Selective Rollback (Partial)

If only specific files have issues:

```bash
# Restore specific OpenClaw core files
git checkout backup/pre-upgrade-$(date +%Y%m%d) -- src/hooks/internal-hooks.ts
git checkout backup/pre-upgrade-$(date +%Y%m%d) -- src/plugins/types.ts

# Keep AURA extension changes
git checkout HEAD -- extensions/aura-memory/

# Rebuild
npm run build
```

### Full Rollback

```bash
# Reset to pre-upgrade state
git reset --hard backup/pre-upgrade-$(date +%Y%m%d)

# Clean and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

## Post-Upgrade Validation Checklist

After successful upgrade:

- [ ] Build completes without errors
- [ ] All AURA tests pass
- [ ] Gateway starts successfully
- [ ] AURA Memory extension loads
- [ ] Context injection works (test with query)
- [ ] Knowledge Graph connected
- [ ] Memory store operational
- [ ] CLI commands responsive
- [ ] No errors in logs

---

## Maintenance Recommendations

### Regular Tasks

1. **Weekly:** Run verification tests
2. **Monthly:** Review upstream OpenClaw changes
3. **Quarterly:** Plan upgrade cycles

### Monitoring

Set up alerts for:

- Hook registration failures
- Context injection latency > 1000ms
- Knowledge Graph connection drops
- Memory store errors

---

## Support Resources

- **AURA Documentation:** `extensions/aura-memory/docs/`
- **OpenClaw Changelog:** Check upstream releases
- **Test Scripts:** `docs/OpenClaw-Upgrade/tests/`
- **Issue Tracking:** Tag issues with `aura-upgrade`

---

## Version History

| Date       | OpenClaw Version | AURA Version | Notes                 |
| ---------- | ---------------- | ------------ | --------------------- |
| 2026-03-05 | -                | 1.0.0        | Initial upgrade guide |

---

_Last updated: 2026-03-05_
_Maintainer: AURA Dev Team_
