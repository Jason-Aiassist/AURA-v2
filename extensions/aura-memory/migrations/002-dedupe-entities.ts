/**
 * Migration 002: Deduplicate Entities
 *
 * Merges duplicate entities (e.g., "Steve", "user", "User" → single "User" entity)
 * and combines their aliases, mention counts, and relationships.
 */

import type { Neo4jDriver } from "../adapters/kg-storage/types.js";
import { createLogger } from "../shared/debug-logger.js";

const logger = createLogger("Migration-002");

export interface Migration002Config {
  dryRun?: boolean;
  similarityThreshold?: number;
  canonicalNames?: Record<string, string>;
}

export interface DuplicateGroup {
  canonicalName: string;
  duplicates: string[];
  entityType: string;
}

export interface Migration002Result {
  success: boolean;
  groupsFound: number;
  entitiesMerged: number;
  relationshipsTransferred: number;
  aliasesCombined: number;
  errors: string[];
}

/**
 * Default canonical name mappings
 * Maps common variations to canonical names
 */
const DEFAULT_CANONICAL_NAMES: Record<string, string> = {
  // User variations
  steve: "User",
  user: "User",
  me: "User",
  i: "User",
  myself: "User",

  // Assistant variations
  aura: "Aura",
  you: "Aura",
  assistant: "Aura",

  // Common tech
  neo4j: "Neo4j",
  sqlite: "SQLite",
  ollama: "Ollama",
};

/**
 * Migration 002: Deduplicate Entities
 *
 * Finds entities with similar names and merges them into a single canonical entity.
 * Combines aliases, sums mention counts, and transfers all relationships.
 */
export async function runMigration002(
  driver: Neo4jDriver,
  config: Migration002Config = {},
): Promise<Migration002Result> {
  const { dryRun = false, canonicalNames = DEFAULT_CANONICAL_NAMES } = config;

  logger.start("runMigration002", {
    dryRun,
    canonicalNamesCount: Object.keys(canonicalNames).length,
  });

  const result: Migration002Result = {
    success: false,
    groupsFound: 0,
    entitiesMerged: 0,
    relationshipsTransferred: 0,
    aliasesCombined: 0,
    errors: [],
  };

  const session = driver.session();

  try {
    // Step 1: Find duplicate groups based on canonical name mappings
    logger.progress("step1", { message: "Finding duplicate entity groups" });

    const duplicateGroups: DuplicateGroup[] = [];

    for (const [variant, canonical] of Object.entries(canonicalNames)) {
      const findResult = await session.run(
        `
        MATCH (e:Entity)
        WHERE toLower(e.name) = toLower($variant)
        RETURN e.name as name, e.type as type
      `,
        { variant },
      );

      if (findResult.records.length > 0) {
        const existingGroup = duplicateGroups.find((g) => g.canonicalName === canonical);
        if (existingGroup) {
          existingGroup.duplicates.push(...findResult.records.map((r) => r.get("name")));
        } else {
          duplicateGroups.push({
            canonicalName: canonical,
            duplicates: findResult.records.map((r) => r.get("name")),
            entityType: findResult.records[0]?.get("type") || "Unknown",
          });
        }
      }
    }

    result.groupsFound = duplicateGroups.length;
    logger.success({ groupsFound: result.groupsFound });

    // Step 2: Merge each duplicate group
    logger.progress("step2", { message: "Merging duplicate entities" });

    for (const group of duplicateGroups) {
      try {
        if (dryRun) {
          // Just count what would be affected
          const countResult = await session.run(
            `
            MATCH (e:Entity)
            WHERE e.name IN $names
            RETURN count(e) as wouldMerge
          `,
            { names: [...group.duplicates, group.canonicalName] },
          );

          result.entitiesMerged += countResult.records[0]?.get("wouldMerge")?.toNumber() || 0;
          continue;
        }

        // Create or get canonical entity
        await session.run(
          `
          MERGE (canonical:Entity {name: $canonicalName})
          ON CREATE SET 
            canonical.type = $entityType,
            canonical.aliases = [],
            canonical.mentionCount = 0,
            canonical.createdAt = datetime()
        `,
          {
            canonicalName: group.canonicalName,
            entityType: group.entityType,
          },
        );

        // Collect all aliases from duplicates
        const aliasesResult = await session.run(
          `
          MATCH (e:Entity)
          WHERE e.name IN $names AND e.name <> $canonicalName
          UNWIND e.aliases as alias
          WITH collect(DISTINCT alias) + collect(DISTINCT e.name) as allAliases
          RETURN [a IN allAliases WHERE a <> $canonicalName] as combinedAliases
        `,
          { names: group.duplicates, canonicalName: group.canonicalName },
        );

        const combinedAliases = aliasesResult.records[0]?.get("combinedAliases") || [];

        // Update canonical entity with combined aliases
        await session.run(
          `
          MATCH (canonical:Entity {name: $canonicalName})
          SET canonical.aliases = $aliases
        `,
          {
            canonicalName: group.canonicalName,
            aliases: [...new Set([...group.duplicates, ...combinedAliases])],
          },
        );

        result.aliasesCombined += combinedAliases.length;

        // Transfer MENTIONED_IN relationships
        const relResult = await session.run(
          `
          MATCH (dup:Entity)-[r:MENTIONED_IN]->(episode:Episode)
          WHERE dup.name IN $names AND dup.name <> $canonicalName
          WITH dup, r, episode
          MATCH (canonical:Entity {name: $canonicalName})
          MERGE (canonical)-[newR:MENTIONED_IN]->(episode)
          ON CREATE SET newR = r
          RETURN count(r) as transferred
        `,
          { names: group.duplicates, canonicalName: group.canonicalName },
        );

        result.relationshipsTransferred +=
          relResult.records[0]?.get("transferred")?.toNumber() || 0;

        // Delete duplicate entities
        const deleteResult = await session.run(
          `
          MATCH (dup:Entity)
          WHERE dup.name IN $names AND dup.name <> $canonicalName
          WITH dup, count(dup) as deleted
          DETACH DELETE dup
          RETURN deleted
        `,
          { names: group.duplicates, canonicalName: group.canonicalName },
        );

        result.entitiesMerged += deleteResult.records.length;
      } catch (error) {
        logger.error(error as Error, { group: group.canonicalName });
        result.errors.push(`Failed to merge ${group.canonicalName}: ${(error as Error).message}`);
      }
    }

    result.success = result.errors.length === 0;

    logger.success({
      groupsFound: result.groupsFound,
      entitiesMerged: result.entitiesMerged,
      relationshipsTransferred: result.relationshipsTransferred,
      aliasesCombined: result.aliasesCombined,
    });
  } catch (error) {
    logger.error(error as Error);
    result.errors.push((error as Error).message);
  } finally {
    await session.close();
  }

  return result;
}

/**
 * Find potential duplicates using similarity matching
 */
export async function findPotentialDuplicates(
  driver: Neo4jDriver,
  similarityThreshold = 0.8,
): Promise<Array<{ name1: string; name2: string; similarity: number }>> {
  logger.start("findPotentialDuplicates", { similarityThreshold });

  const session = driver.session();

  try {
    // Simple approach: find entities with similar lowercase names
    const result = await session.run(`
      MATCH (e1:Entity), (e2:Entity)
      WHERE e1 <> e2 
        AND toLower(e1.name) = toLower(e2.name)
        AND e1.name < e2.name
      RETURN e1.name as name1, e2.name as name2, 1.0 as similarity
    `);

    const duplicates = result.records.map((r) => ({
      name1: r.get("name1"),
      name2: r.get("name2"),
      similarity: r.get("similarity"),
    }));

    logger.success({ potentialDuplicates: duplicates.length });
    return duplicates;
  } finally {
    await session.close();
  }
}
