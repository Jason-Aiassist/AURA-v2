# OpenClaw Upgrade - Quick Reference

## One-Command Upgrade Process

```bash
# Full upgrade with all tests
npm run test:aura:upgrade
```

## Individual Test Commands

```bash
# Before upgrade - establish baseline
npm run test:aura:pre-upgrade

# After upgrade - verify integration
npm run test:aura:post-upgrade

# Runtime smoke tests (requires running gateway)
npm run test:aura:smoke

# Quick diagnostics
npm run test:aura:diagnostics
```

## Manual Upgrade Steps

### 1. Pre-Upgrade

```bash
# Create backup
git checkout -b backup/pre-upgrade-$(date +%Y%m%d)
git add -A && git commit -m "backup: Pre-upgrade"

# Run pre-upgrade tests
npm run test:aura:pre-upgrade
```

### 2. Upgrade OpenClaw

```bash
# Fetch and merge
git fetch upstream
git checkout -b upgrade/openclaw-$(date +%Y%m%d)
git merge upstream/main

# Install and build
npm install
npm run build
```

### 3. Post-Upgrade

```bash
# Run post-upgrade tests
npm run test:aura:post-upgrade

# Start gateway
npm start

# Run smoke tests
npm run test:aura:smoke
```

## Critical Files to Watch

| File                                           | Purpose           | Risk        |
| ---------------------------------------------- | ----------------- | ----------- |
| `src/hooks/internal-hooks.ts`                  | Hook registration | 🔴 Critical |
| `src/plugins/types.ts`                         | Plugin API        | 🔴 Critical |
| `src/plugins/loader.ts`                        | Plugin loading    | 🟡 High     |
| `src/agents/pi-embedded-runner/run/attempt.ts` | Hook execution    | 🟡 High     |

## Quick Checks

### Verify Hook System

```bash
grep -n "registerInternalHook" src/hooks/internal-hooks.ts
grep -n "before_prompt_build" src/plugins/types.ts
```

### Verify AURA Loading

```bash
grep -n "AURA Memory" extensions/aura-memory/index.ts
grep -n "before_prompt_build" extensions/aura-memory/index.ts
```

### Verify Dependencies

```bash
grep "better-sqlite3\|neo4j-driver" package.json
```

## Emergency Rollback

```bash
# Quick rollback
git checkout backup/pre-upgrade-$(date +%Y%m%d)
npm install && npm run build
npm restart
```

## Getting Help

1. Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
2. Review [CHECKLIST.md](CHECKLIST.md)
3. Read full [README.md](README.md)

## Exit Codes

| Code | Meaning                                  |
| ---- | ---------------------------------------- |
| 0    | All tests passed                         |
| 1    | Tests passed with warnings               |
| 2    | Critical failures - rollback recommended |

---

_Quick reference for AURA Memory OpenClaw upgrades_
