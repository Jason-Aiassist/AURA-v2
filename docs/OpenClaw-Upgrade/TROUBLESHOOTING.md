# Troubleshooting Guide

Common issues encountered during OpenClaw upgrades and their solutions.

## Quick Diagnostics

Run the diagnostic script:

```bash
npm run test:aura:diagnostics
```

This will check:

- Hook system integrity
- Plugin API compatibility
- AURA extension loading
- Database connectivity
- Knowledge Graph status

---

## Critical Issues (Rollback Recommended)

### Issue: Hook Registration Completely Broken

**Symptoms:**

```
[AURA Memory] FAILED to get ContextInjector
TypeError: registerInternalHook is not a function
```

**Diagnosis:**

```bash
# Check if function still exists
grep -n "registerInternalHook" src/hooks/internal-hooks.ts

# Check exports
grep -n "export.*registerInternalHook" src/hooks/internal-hooks.ts
```

**Solutions:**

1. **Function moved or renamed:**
   - Check `src/hooks/hooks.ts` for re-exports
   - Update AURA import if path changed

2. **Function removed:**
   - **ROLLBACK IMMEDIATELY**
   - File issue with OpenClaw upstream
   - Request restoration of hook API

3. **Export changed:**

   ```typescript
   // Old import (may need update)
   import { registerInternalHook } from "../../src/hooks/internal-hooks.js";

   // Try new location
   import { registerInternalHook } from "../../src/hooks/hooks.js";
   ```

---

### Issue: before_prompt_build Hook Removed

**Symptoms:**

```
[AURA Memory] Hook registration failed: Unknown hook "before_prompt_build"
```

**Diagnosis:**

```bash
# Check if hook still exists in types
grep -n "before_prompt_build" src/plugins/types.ts

# Check if hook is executed in agent runner
grep -n "before_prompt_build" src/agents/pi-embedded-runner/run/attempt.ts
```

**Solutions:**

1. **Hook renamed:**
   - Check for alternatives like `before_model_call` or `pre_inference`
   - Update AURA to use new hook name

2. **Hook removed entirely:**
   - **ROLLBACK IMMEDIATELY**
   - This is a breaking change for AURA
   - Request restoration or migration path from OpenClaw

---

### Issue: Plugin API Interface Changed

**Symptoms:**

```
TypeError: api.on is not a function
Property 'logger' does not exist on type 'OpenClawPluginApi'
```

**Diagnosis:**

```bash
# Check current API interface
grep -A50 "export type OpenClawPluginApi" src/plugins/types.ts
```

**Solutions:**

1. **Method renamed:**
   - Update AURA to use new method names
   - Common renames: `on` → `registerHook`, `logger` → `log`

2. **Interface restructuring:**
   - Check if API was split into multiple interfaces
   - May need to update how AURA accesses plugin context

3. **Breaking changes without migration:**
   - **ROLLBACK RECOMMENDED**
   - Document required changes
   - Plan AURA update for compatibility

---

## High Priority Issues

### Issue: Context Injection Not Working

**Symptoms:**

- No memories injected into prompts
- `[AURA Memory] No context found for this query` always
- Agent doesn't recall previous conversations

**Diagnosis:**

```bash
# Check if hook fires
DEBUG=aura:* npm start 2>&1 | grep -i "hook\|injection"

# Check hook result handling
grep -A20 "runBeforePromptBuild" src/agents/pi-embedded-runner/run/attempt.ts
```

**Solutions:**

1. **Hook fires but context not applied:**

   ```typescript
   // Check if prependContext is still handled
   // In src/agents/pi-embedded-runner/run/attempt.ts:

   // OLD (may have changed):
   if (result?.prependContext) {
     effectivePrompt = result.prependContext + "\n" + effectivePrompt;
   }

   // NEW (may be different):
   if (result?.context) {
     // Property renamed?
     effectivePrompt = result.context + "\n" + effectivePrompt;
   }
   ```

2. **Hook result type changed:**

   ```typescript
   // Check PluginHookBeforePromptBuildResult in src/plugins/types.ts
   // Ensure prependContext is still a valid return field
   ```

3. **Prompt parsing regex broken:**
   ```typescript
   // In extensions/aura-memory/index.ts
   // Check if prompt format changed:
   const match = prompt.match(
     /\[(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+UTC\]\s*(.+)/s,
   );
   ```

---

### Issue: TypeScript Compilation Errors

**Symptoms:**

```
error TS2307: Cannot find module '../../src/hooks/internal-hooks.js'
error TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'
```

**Diagnosis:**

```bash
# Check specific errors
npx tsc --noEmit extensions/aura-memory/index.ts 2>&1 | head -30
```

**Solutions:**

1. **Import path changed:**

   ```typescript
   // Try alternative paths
   import { registerInternalHook } from "../../src/hooks/hooks.js";
   import { registerInternalHook } from "openclaw/hooks";
   ```

2. **Type definitions changed:**

   ```typescript
   // Check if types moved
   import type { MessageSentHookEvent } from "../../src/hooks/types.js";
   ```

3. **Interface changes:**
   - Update AURA to match new interfaces
   - May need type assertions temporarily

---

### Issue: Knowledge Graph Connection Failed

**Symptoms:**

```
[AURA Memory] Neo4j connection failed
Error: Connection was closed
```

**Diagnosis:**

```bash
# Check Neo4j container
docker ps | grep neo4j

# Test connection
curl -s http://localhost:7474

# Check AURA config
grep -r "neo4j" extensions/aura-memory/startup.ts
```

**Solutions:**

1. **Neo4j not running:**

   ```bash
   docker start neo4j-memory  # or your container name
   ```

2. **Connection config changed:**
   - Check if OpenClaw changed Neo4j connection handling
   - Verify credentials in config

3. **Driver version mismatch:**

   ```bash
   # Check neo4j-driver version
   npm list neo4j-driver

   # May need to update
   npm install neo4j-driver@latest
   ```

---

## Medium Priority Issues

### Issue: Memory Store Not Initializing

**Symptoms:**

```
[AURA Memory] TieredMemoryStore not available
Error: Cannot find module 'better-sqlite3'
```

**Solutions:**

1. **Native module not built:**

   ```bash
   npm rebuild better-sqlite3

   # Or full reinstall
   rm -rf node_modules package-lock.json
   npm install
   ```

2. **Database file permissions:**

   ```bash
   mkdir -p ~/.openclaw/agents/main
   chmod 755 ~/.openclaw/agents/main
   ```

3. **sqlite-vec extension not loading:**
   - Check if extension path changed
   - Verify extension is in node_modules

---

### Issue: AURA CLI Commands Not Working

**Symptoms:**

```
$ openclaw aura-memory:status
Unknown command: aura-memory:status
```

**Diagnosis:**

```bash
# Check if CLI registration still works
grep -n "registerCli" src/plugins/loader.ts
grep -n "onCliReady" extensions/aura-memory/index.ts
```

**Solutions:**

1. **CLI registration API changed:**

   ```typescript
   // Check if onCliReady still exists in OpenClawPluginApi
   // May need to use alternative registration method
   ```

2. **Command registration timing:**
   - CLI commands may need to register earlier/later
   - Check plugin lifecycle changes

---

### Issue: Performance Degradation

**Symptoms:**

- Context injection taking > 1000ms
- High CPU usage during extraction
- Slow response times

**Diagnosis:**

```bash
# Enable debug logging
DEBUG=aura:* npm start

# Check timing in logs
grep "duration\|time\|ms" logs/openclaw.log | tail -20
```

**Solutions:**

1. **Build not optimized:**

   ```bash
   npm run build:production
   # or
   NODE_ENV=production npm start
   ```

2. **Database indexes missing:**

   ```bash
   # Reindex memories
   openclaw aura-memory:reindex
   ```

3. **Hook execution order:**
   - Check if other plugins are interfering
   - Verify hook priority is respected

---

## Low Priority Issues

### Issue: Warning Messages in Logs

**Symptoms:**

```
[AURA Memory] Warning: Deprecated API usage
Plugin "aura-memory" uses deprecated feature
```

**Solution:**

- Note for next AURA update
- Usually safe to ignore temporarily
- Plan migration to new API

---

### Issue: Debug Logs Too Verbose

**Symptoms:**

- Logs flooded with AURA debug messages
- Difficult to see other important logs

**Solution:**

```bash
# Reduce log level
LOG_LEVEL=info npm start

# Or filter AURA logs
npm start 2>&1 | grep -v "\[AURA Memory\]"
```

---

## Emergency Rollback

If critical issues cannot be resolved:

```bash
# Immediate rollback
git checkout backup/pre-upgrade-$(date +%Y%m%d)
npm install
npm run build
npm restart

# Verify rollback
npm run test:aura:post-upgrade
```

---

## Getting Help

1. **Check OpenClaw changelog:**

   ```bash
   git log upstream/main --oneline -20
   ```

2. **Review AURA issues:**
   - Search for similar issues in project tracker
   - Tag new issues with `openclaw-upgrade`

3. **Contact maintainers:**
   - OpenClaw: Check upstream repository
   - AURA: Create issue with upgrade details

---

## Prevention Checklist

Before future upgrades:

- [ ] Run pre-upgrade tests
- [ ] Review OpenClaw changelog for breaking changes
- [ ] Check hook system changes
- [ ] Verify plugin API compatibility
- [ ] Test in staging environment
- [ ] Have rollback plan ready
- [ ] Schedule maintenance window

---

_Last updated: 2026-03-05_
