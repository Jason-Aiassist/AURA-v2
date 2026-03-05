# AURA Memory Migrations

Database migration scripts for the AURA Memory Knowledge Graph system.

## Overview

These migrations transform existing data to support the new semantic relationship features introduced in the Knowledge Graph Semantic Search sprint.

## Migration Scripts

### 001: Add Semantic Relationships

**File:** `001-add-semantic-relationships.ts`

**Purpose:**

- Add `aliases` property (string array) to all Entity nodes
- Create indexes for efficient entity lookups
- Prepare schema for semantic relationship storage

**Changes:**

- Adds empty `aliases: []` to entities without aliases
- Creates indexes on `Entity.name` and `Entity.aliases`
- Idempotent - safe to run multiple times

**Run:**

```typescript
import { runMigration001 } from "./migrations/index.js";

const result = await runMigration001(driver, {
  dryRun: false, // Set true to preview changes
  batchSize: 100,
});

console.log(`Updated ${result.entitiesUpdated} entities`);
```

**Rollback:**

```typescript
import { rollbackMigration001 } from "./migrations/index.js";

await rollbackMigration001(driver, dryRun);
```

---

### 002: Deduplicate Entities

**File:** `002-dedupe-entities.ts`

**Purpose:**

- Merge duplicate entities (e.g., "Steve", "user", "User" → "User")
- Combine aliases from merged entities
- Transfer all relationships to canonical entity

**Default Canonical Mappings:**

```typescript
{
  "steve": "User",
  "user": "User",
  "me": "User",
  "i": "User",
  "aura": "Aura",
  "you": "Aura",
  "assistant": "Aura"
}
```

**Changes:**

- Creates canonical entity if doesn't exist
- Merges all aliases from duplicates
- Transfers MENTIONED_IN relationships
- Deletes duplicate entities
- Sums mention counts

**Run:**

```typescript
import { runMigration002 } from "./migrations/index.js";

const result = await runMigration002(driver, {
  dryRun: false,
  canonicalNames: {
    // Add custom mappings
    steven: "User",
    stephen: "User",
  },
});

console.log(`Merged ${result.entitiesMerged} entities into ${result.groupsFound} groups`);
```

**Find Potential Duplicates:**

```typescript
import { findPotentialDuplicates } from "./migrations/index.js";

const duplicates = await findPotentialDuplicates(driver, 0.8);
```

---

### 003: Backfill Semantic Relationships

**File:** `003-backfill-relationships.ts`

**Purpose:**

- Extract semantic relationships from existing episode content
- Use LLM-based SemanticExtractor to identify entities and relationships
- Store extracted relationships as typed Neo4j edges

**Process:**

1. Fetches unprocessed episodes in batches
2. Runs SemanticExtractor on each episode content
3. Creates/merges entities found in relationships
4. Creates typed relationships (ENJOYS, WORKS_ON, etc.)
5. Marks episodes as processed

**Configuration:**

```typescript
import { runMigration003 } from "./migrations/index.js";

const result = await runMigration003(driver, {
  dryRun: false,
  batchSize: 10, // Episodes per batch
  maxEpisodes: 100, // 0 = unlimited
  skipIfRelationshipsExist: true, // Skip already processed
});

console.log(`Processed ${result.episodesProcessed} episodes`);
console.log(`Created ${result.relationshipsStored} relationships`);
```

**Check Status:**

```typescript
import { checkMigration003Status } from "./migrations/index.js";

const status = await checkMigration003Status(driver);
console.log(`${status.percentComplete}% complete`);
console.log(`${status.pendingEpisodes} episodes remaining`);
```

---

## Migration Order

**Required order:** 001 → 002 → 003

1. **001** must run first to add aliases support
2. **002** should run second to clean up duplicates
3. **003** should run last to extract relationships from clean data

## Running All Migrations

```typescript
import { runMigration001, runMigration002, runMigration003 } from "./migrations/index.js";

async function runAllMigrations(driver) {
  console.log("=== Migration 001: Add Semantic Relationships ===");
  const m001 = await runMigration001(driver, { dryRun: false });
  console.log(`✅ Updated ${m001.entitiesUpdated} entities`);

  console.log("\n=== Migration 002: Deduplicate Entities ===");
  const m002 = await runMigration002(driver, { dryRun: false });
  console.log(`✅ Merged ${m002.entitiesMerged} entities`);

  console.log("\n=== Migration 003: Backfill Relationships ===");
  const m003 = await runMigration003(driver, {
    dryRun: false,
    batchSize: 10,
  });
  console.log(`✅ Created ${m003.relationshipsStored} relationships`);

  return { m001, m002, m003 };
}
```

## Dry Run Mode

All migrations support `dryRun: true` to preview changes:

```typescript
const preview = await runMigration001(driver, { dryRun: true });
console.log(`Would update ${preview.entitiesUpdated} entities`);
```

## Error Handling

- Migrations are designed to be idempotent where possible
- Errors are collected and returned in `result.errors`
- Partial failures don't rollback completed work
- Check `result.success` for overall status

## Performance Considerations

- **001:** Fast (< 1s for 10k entities)
- **002:** Medium (depends on duplicate count)
- **003:** Slow (LLM calls, ~1-2s per episode)

For large datasets, run 003 with smaller `batchSize` and resume if interrupted.

## Environment Variables

Migration 003 requires:

- `CODE_WEAVER_URL` - LLM API base URL
- `CODE_WEAVER_API_KEY` - LLM API key

Or uses defaults from config.
