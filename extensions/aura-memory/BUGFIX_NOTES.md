# AURA Memory Bug Fix Files

This folder contains the recently modified files from the aura-memory extension for backup/rebuild purposes.

## Files Included

| File                        | Original Path                                      | Purpose                                                                                  |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ConcreteKnowledgeGraph.ts` | `extensions/aura-memory/adapters/`                 | Neo4j adapter with alias search query (BUG: aliases never stored during entity creation) |
| `stage1-knowledge-graph.ts` | `extensions/aura-memory/context/stages/`           | Stage 1 KG search with pronoun detection for "me"/"I" → maps to "steve"/"user"           |
| `three-stage-builder.ts`    | `extensions/aura-memory/context/builders/`         | Three-stage context building pipeline                                                    |
| `ContextInjector.ts`        | `extensions/aura-memory/agents/`                   | Injects retrieved context into prompts                                                   |
| `test-entity-fallback.ts`   | `extensions/aura-memory/`                          | Test utility for entity fallback                                                         |
| `stage1-entities.test.ts`   | `extensions/aura-memory/context/stages/__tests__/` | Tests for Stage 1 entity extraction                                                      |

## Known Issue

The alias searching functionality was added to `searchRelated()` in `ConcreteKnowledgeGraph.ts` but **will not work** because:

1. The Cypher query checks for `e.aliases` property
2. Entities are created in `linkEntities()` WITHOUT ever setting the `aliases` property
3. The `ExtractedEntity` type lacks an `aliases` field entirely

### The Bug (Line ~125 in ConcreteKnowledgeGraph.ts)

```cypher
WHERE toLower(e.name) = searchTerm
   OR (e.aliases IS NOT NULL AND searchTerm IN [alias IN e.aliases | toLower(alias)])
```

This query looks for aliases, but entities are created like this:

```cypher
MERGE (e:Entity { name: $name, type: $type })
ON CREATE SET e.createdAt = datetime(), e.mentionCount = 1
// NO aliases property ever set!
```

## Fix Required

To make alias searching work, you need to:

1. Add `aliases?: string[]` to `ExtractedEntity` interface in `entities/types.ts`
2. Update `linkEntities()` to store aliases when creating entities
3. Populate aliases during entity extraction (e.g., "Steve" → aliases: ["steve", "user", "me", "i"])

## Modified

Last updated: 2026-02-27 17:36 UTC
