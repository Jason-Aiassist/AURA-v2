/**
 * Migration 001: Add Semantic Relationships
 *
 * Adds aliases array to existing entities and creates indexes
 * for semantic relationship queries.
 */

import type { Neo4jDriver } from "../adapters/kg-storage/types.js";
import { createLogger } from "../shared/debug-logger.js";

const logger = createLogger("Migration-001");

export interface Migration001Config {
  dryRun?: boolean;
  batchSize?: number;
}

export interface Migration001Result {
  success: boolean;
  entitiesUpdated: number;
  relationshipsCreated: number;
  errors: string[];
}

/**
 * Migration 001: Add Semantic Relationships
 *
 * Changes:
 * 1. Add aliases: string[] property to all Entity nodes (default: [])
 * 2. Add extractedAt: datetime property to relationships
 * 3. Create indexes for efficient querying
 */
export async function runMigration001(
  driver: Neo4jDriver,
  config: Migration001Config = {},
): Promise<Migration001Result> {
  const { dryRun = false, batchSize = 100 } = config;

  logger.start("runMigration001", { dryRun, batchSize });

  const result: Migration001Result = {
    success: false,
    entitiesUpdated: 0,
    relationshipsCreated: 0,
    errors: [],
  };

  const session = driver.session();

  try {
    // Step 1: Add aliases property to entities that don't have it
    logger.progress("step1", { message: "Adding aliases property to entities" });

    if (!dryRun) {
      const aliasesResult = await session.run(`
        MATCH (e:Entity)
        WHERE e.aliases IS NULL
        SET e.aliases = []
        RETURN count(e) as updated
      `);

      result.entitiesUpdated = aliasesResult.records[0]?.get("updated")?.toNumber() || 0;
      logger.success({ entitiesUpdated: result.entitiesUpdated });
    } else {
      const countResult = await session.run(`
        MATCH (e:Entity)
        WHERE e.aliases IS NULL
        RETURN count(e) as wouldUpdate
      `);
      result.entitiesUpdated = countResult.records[0]?.get("wouldUpdate")?.toNumber() || 0;
      logger.progress("dry-run", { entitiesWouldUpdate: result.entitiesUpdated });
    }

    // Step 2: Create indexes for efficient querying
    logger.progress("step2", { message: "Creating indexes" });

    if (!dryRun) {
      try {
        // Index for entity name lookups
        await session.run(`
          CREATE INDEX entity_name_index IF NOT EXISTS
          FOR (e:Entity) ON (e.name)
        `);

        // Index for alias lookups (if supported)
        await session.run(`
          CREATE INDEX entity_aliases_index IF NOT EXISTS
          FOR (e:Entity) ON (e.aliases)
        `);

        logger.success({ indexesCreated: 2 });
      } catch (error) {
        logger.error(error as Error, { phase: "create-indexes" });
        result.errors.push(`Index creation failed: ${(error as Error).message}`);
      }
    }

    // Step 3: Verify migration
    logger.progress("step3", { message: "Verifying migration" });

    const verifyResult = await session.run(`
      MATCH (e:Entity)
      RETURN 
        count(e) as totalEntities,
        count(CASE WHEN e.aliases IS NOT NULL THEN 1 END) as withAliases
    `);

    const total = verifyResult.records[0]?.get("totalEntities")?.toNumber() || 0;
    const withAliases = verifyResult.records[0]?.get("withAliases")?.toNumber() || 0;

    logger.success({
      totalEntities: total,
      withAliases,
      migrationComplete: total === withAliases,
    });

    result.success = result.errors.length === 0;
  } catch (error) {
    logger.error(error as Error);
    result.errors.push((error as Error).message);
  } finally {
    await session.close();
  }

  logger.success({
    success: result.success,
    entitiesUpdated: result.entitiesUpdated,
    errors: result.errors.length,
  });

  return result;
}

/**
 * Rollback migration 001
 * Removes aliases property from entities
 */
export async function rollbackMigration001(
  driver: Neo4jDriver,
  dryRun = false,
): Promise<{ success: boolean; entitiesAffected: number }> {
  logger.start("rollbackMigration001", { dryRun });

  const session = driver.session();

  try {
    if (!dryRun) {
      const result = await session.run(`
        MATCH (e:Entity)
        REMOVE e.aliases
        RETURN count(e) as affected
      `);

      const affected = result.records[0]?.get("affected")?.toNumber() || 0;
      logger.success({ entitiesAffected: affected });
      return { success: true, entitiesAffected: affected };
    } else {
      const result = await session.run(`
        MATCH (e:Entity)
        WHERE e.aliases IS NOT NULL
        RETURN count(e) as wouldAffect
      `);

      const wouldAffect = result.records[0]?.get("wouldAffect")?.toNumber() || 0;
      logger.progress("dry-run", { wouldAffect });
      return { success: true, entitiesAffected: wouldAffect };
    }
  } catch (error) {
    logger.error(error as Error);
    return { success: false, entitiesAffected: 0 };
  } finally {
    await session.close();
  }
}
