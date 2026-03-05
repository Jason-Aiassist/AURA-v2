# OpenClaw Upgrade Checklist

Use this checklist during the upgrade process to ensure nothing is missed.

## Pre-Upgrade Phase

### 1. Preparation (REQUIRED)

- [ ] Create backup branch: `git checkout -b backup/pre-upgrade-$(date +%Y%m%d)`
- [ ] Commit current state: `git add -A && git commit -m "backup: Pre-upgrade"`
- [ ] Tag current version: `git tag aura-stable-$(date +%Y%m%d)`
- [ ] Document current versions in `docs/OpenClaw-Upgrade/versions-current.txt`
- [ ] Notify team of maintenance window
- [ ] Ensure rollback plan is ready

### 2. Review Upstream Changes (REQUIRED)

- [ ] Fetch upstream: `git fetch upstream`
- [ ] Review commit log: `git log --oneline HEAD..upstream/main`
- [ ] Check for hook system changes: `git diff HEAD..upstream/main -- src/hooks/`
- [ ] Check for plugin changes: `git diff HEAD..upstream/main -- src/plugins/`
- [ ] Check for agent runner changes: `git diff HEAD..upstream/main -- src/agents/`
- [ ] Review CHANGELOG.md if available

### 3. Run Pre-Upgrade Tests (REQUIRED)

```bash
npm run test:aura:pre-upgrade
```

- [ ] All pre-upgrade tests pass
- [ ] No critical failures
- [ ] Report saved to `docs/OpenClaw-Upgrade/tests/pre-upgrade-report.json`

### 4. Dependency Check (REQUIRED)

- [ ] Verify `better-sqlite3` still in dependencies
- [ ] Verify `neo4j-driver` still in dependencies
- [ ] Verify `zod` still in dependencies
- [ ] Check for new required dependencies
- [ ] Note any dependency version changes

---

## Upgrade Phase

### 5. Create Upgrade Branch (REQUIRED)

```bash
git checkout -b upgrade/openclaw-$(date +%Y%m%d)
```

- [ ] On new upgrade branch
- [ ] Clean working directory

### 6. Merge Upstream Changes (REQUIRED)

```bash
git merge upstream/main
```

#### If No Conflicts:

- [ ] Merge successful
- [ ] Skip to Step 8

#### If Conflicts:

**For `src/hooks/internal-hooks.ts`:**

- [ ] Preserve `registerInternalHook` function
- [ ] Preserve `MessageSentHookEvent` type
- [ ] Preserve hook handler registration

**For `src/plugins/types.ts`:**

- [ ] Preserve `OpenClawPluginApi` interface
- [ ] Preserve `before_prompt_build` hook types
- [ ] Preserve `PluginHookBeforePromptBuildResult`
- [ ] Preserve `PluginHookBeforePromptBuildEvent`

**For `src/plugins/loader.ts`:**

- [ ] Preserve synchronous plugin registration
- [ ] Preserve hook loading mechanism
- [ ] Preserve default hook handlers

**For `src/agents/pi-embedded-runner/run/attempt.ts`:**

- [ ] Preserve `before_prompt_build` hook execution
- [ ] Preserve `prependContext` handling
- [ ] Preserve hook error handling

### 7. Resolve Build Issues (REQUIRED)

```bash
npm install
npm run build
```

- [ ] `npm install` completes without errors
- [ ] `npm run build` completes without errors
- [ ] No TypeScript errors in AURA extension

### 8. Verify Dependencies (REQUIRED)

```bash
grep -E "better-sqlite3|neo4j-driver" package.json
```

- [ ] `better-sqlite3` present in dependencies
- [ ] `neo4j-driver` present in dependencies
- [ ] Native modules built: `ls node_modules/better-sqlite3/build/Release/`

---

## Post-Upgrade Phase

### 9. Run Post-Upgrade Tests (REQUIRED)

```bash
npm run test:aura:post-upgrade
```

- [ ] All post-upgrade tests pass
- [ ] No critical failures
- [ ] No hook API regressions
- [ ] No plugin API regressions
- [ ] Report saved to `docs/OpenClaw-Upgrade/tests/post-upgrade-report.json`

### 10. Start Gateway (REQUIRED)

```bash
npm start
# or
openclaw gateway start
```

- [ ] Gateway starts without errors
- [ ] AURA extension loads successfully
- [ ] No critical errors in logs

### 11. Verify Hook Registration (REQUIRED)

Check logs for:

- [ ] `[AURA Memory] EXTENSION REGISTER FUNCTION CALLED`
- [ ] `[AURA Memory] before_prompt_build hook registered SUCCESSFULLY`
- [ ] `[AURA Memory] ContextInjector initialized`
- [ ] `[AURA Memory] Session extraction system started`

### 12. Test Context Injection (REQUIRED)

- [ ] Send test message to agent
- [ ] Check logs for `[AURA Memory] HOOK TRIGGERED - before_prompt_build`
- [ ] Verify `[AURA Memory] INJECTION PIPELINE COMPLETE` appears
- [ ] Confirm context is injected (check `prependContext` in logs)

### 13. Test Memory Extraction (REQUIRED)

- [ ] Have conversation with agent
- [ ] Wait for extraction (check logs)
- [ ] Verify `[EXTRACTION_DEBUG]` messages appear
- [ ] Check that entities are extracted

### 14. Test Knowledge Graph (REQUIRED)

```bash
openclaw aura-memory:kg-status
```

- [ ] Neo4j connection verified
- [ ] Knowledge Graph accessible
- [ ] Entity resolution working

### 15. Test Memory Store (REQUIRED)

```bash
openclaw aura-memory:search-status
```

- [ ] SQLite database accessible
- [ ] Vector search available
- [ ] FTS search available

### 16. Run Smoke Tests (REQUIRED)

```bash
npm run test:aura:smoke
```

- [ ] Smoke tests complete
- [ ] Manual verification checklist reviewed
- [ ] All critical functions working

---

## Validation Phase

### 17. Final Verification (REQUIRED)

- [ ] Build completes without errors
- [ ] All AURA tests pass
- [ ] Gateway starts successfully
- [ ] AURA extension loads
- [ ] Context injection works
- [ ] Knowledge Graph connected
- [ ] Memory store operational
- [ ] CLI commands responsive
- [ ] No errors in logs

### 18. Performance Check (RECOMMENDED)

- [ ] Context injection < 1000ms
- [ ] No memory leaks
- [ ] CPU usage normal
- [ ] Response times acceptable

### 19. Documentation (REQUIRED)

- [ ] Update `docs/OpenClaw-Upgrade/versions-current.txt`
- [ ] Document any issues encountered
- [ ] Document any workarounds applied
- [ ] Update upgrade guide if needed

---

## Completion Phase

### 20. Merge Upgrade (REQUIRED)

```bash
git checkout main
git merge upgrade/openclaw-$(date +%Y%m%d)
git push origin main
```

- [ ] Upgrade branch merged to main
- [ ] Changes pushed to origin
- [ ] Tag new stable version: `git tag aura-v$(date +%Y%m%d)`

### 21. Cleanup (REQUIRED)

- [ ] Delete upgrade branch (after merge)
- [ ] Archive test reports
- [ ] Remove temporary files
- [ ] Update monitoring/alerting if needed

### 22. Notification (REQUIRED)

- [ ] Notify team upgrade is complete
- [ ] Share any important changes
- [ ] Document lessons learned

---

## Rollback Triggers

**ROLLBACK IMMEDIATELY if:**

- [ ] `registerInternalHook` function removed or broken
- [ ] `before_prompt_build` hook removed
- [ ] `OpenClawPluginApi` interface broken
- [ ] Gateway fails to start
- [ ] AURA extension fails to load
- [ ] Context injection completely broken
- [ ] Data corruption detected

**Rollback command:**

```bash
git checkout backup/pre-upgrade-$(date +%Y%m%d)
npm install && npm run build
npm restart
```

---

## Emergency Contacts

- **AURA Maintainer:** [Your contact]
- **OpenClaw Upstream:** [Upstream repo/issues]
- **On-Call Engineer:** [Contact info]

---

## Notes

Use this space for notes during the upgrade:

```
Upgrade Date: ___________
OpenClaw Version: ___________
AURA Version: ___________
Issues Encountered: ___________
Workarounds Applied: ___________
Performance Impact: ___________
```

---

_Checklist version: 1.0_
_Last updated: 2026-03-05_
