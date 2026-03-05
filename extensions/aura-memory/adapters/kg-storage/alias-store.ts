/**
 * Alias Store
 * Manages entity aliases for pronoun resolution
 */

import { createLogger } from "../../shared/debug-logger.js";
import type {
  Neo4jDriver,
  UpdateAliasesParams,
  AliasResult,
  KGStorageConfig,
  KGStorageDependencies,
  EntityLookupResult,
} from "./types.js";

/**
 * Alias store for Neo4j
 */
export class AliasStore {
  private driver: Neo4jDriver;
  private config: Required<KGStorageConfig>;
  private deps: KGStorageDependencies;
  private logger = createLogger("AliasStore");

  constructor(deps: KGStorageDependencies, config: KGStorageConfig = {}) {
    this.driver = deps.driver;
    this.deps = deps;
    this.config = {
      database: "neo4j",
      debug: false,
      ...config,
    };
  }

  /**
   * Update entity aliases
   * @param params - Alias update parameters
   * @returns Update result
   */
  async updateAliases(params: UpdateAliasesParams): Promise<AliasResult> {
    const correlationId = params.correlationId || `alias-${Date.now()}`;

    this.logger.start("updateAliases", {
      entityName: params.entityName,
      entityType: params.entityType,
      aliasCount: params.aliases.length,
      correlationId,
    });

    // Normalize aliases (lowercase, unique)
    const normalizedAliases = [...new Set(params.aliases.map((a) => a.toLowerCase()))];

    const session = this.driver.session({ database: this.config.database });

    try {
      this.logger.progress("merging-entity", { normalizedAliases });

      // Merge entity and update aliases
      const result = await session.run(
        `
        MERGE (e:Entity {name: $entityName})
        ON CREATE SET 
          e.type = $entityType,
          e.createdAt = datetime(),
          e.mentionCount = 1,
          e.aliases = $aliases
        ON MATCH SET 
          e.mentionCount = coalesce(e.mentionCount, 0) + 1,
          e.lastSeen = datetime(),
          e.aliases = coalesce(e.aliases, []) + [a IN $aliases WHERE NOT a IN coalesce(e.aliases, [])]
        
        RETURN 
          e.name as name,
          e.type as type,
          e.aliases as aliases,
          e.createdAt as createdAt
        `,
        {
          entityName: params.entityName,
          entityType: params.entityType,
          aliases: normalizedAliases,
        },
      );

      const record = result.records[0];
      const isNewEntity = !!record?.get("createdAt");
      const currentAliases = (record?.get("aliases") as string[]) || normalizedAliases;

      this.logger.success({
        entityName: record?.get("name"),
        isNewEntity,
        aliasCount: currentAliases.length,
      });

      // Audit log
      if (this.deps.auditLog) {
        await this.deps.auditLog({
          operation: "update_aliases",
          correlationId,
          metadata: {
            entityName: params.entityName,
            isNewEntity,
            aliasCount: normalizedAliases.length,
          },
        });
      }

      return {
        success: true,
        entityName: params.entityName,
        aliases: currentAliases,
        isNewEntity,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        entityName: params.entityName,
        aliases: normalizedAliases,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        entityName: params.entityName,
        aliases: normalizedAliases,
        isNewEntity: false,
      };
    } finally {
      await session.close();
      this.logger.progress("session-closed");
    }
  }

  /**
   * Look up entity by name or alias
   * @param name - Name or alias to look up
   * @returns Lookup result
   */
  async lookupEntity(name: string): Promise<EntityLookupResult> {
    this.logger.start("lookupEntity", { name });

    const session = this.driver.session({ database: this.config.database });

    try {
      // Try exact match first
      const exactResult = await session.run(
        `
        MATCH (e:Entity {name: $name})
        RETURN e.name as name, e.type as type, e.aliases as aliases
        `,
        { name },
      );

      if (exactResult.records.length > 0) {
        const record = exactResult.records[0];
        this.logger.success({ method: "exact", entity: record.get("name") });
        return {
          found: true,
          entityName: record.get("name") as string,
          entityType: record.get("type") as string,
          aliases: record.get("aliases") as string[],
          resolutionMethod: "exact",
        };
      }

      // Try alias match
      const aliasResult = await session.run(
        `
        MATCH (e:Entity)
        WHERE $name IN e.aliases
        RETURN e.name as name, e.type as type, e.aliases as aliases
        LIMIT 1
        `,
        { name: name.toLowerCase() },
      );

      if (aliasResult.records.length > 0) {
        const record = aliasResult.records[0];
        this.logger.success({ method: "alias", entity: record.get("name") });
        return {
          found: true,
          entityName: record.get("name") as string,
          entityType: record.get("type") as string,
          aliases: record.get("aliases") as string[],
          resolutionMethod: "alias",
        };
      }

      // Try case-insensitive match
      const caseResult = await session.run(
        `
        MATCH (e:Entity)
        WHERE toLower(e.name) = toLower($name)
        RETURN e.name as name, e.type as type, e.aliases as aliases
        LIMIT 1
        `,
        { name },
      );

      if (caseResult.records.length > 0) {
        const record = caseResult.records[0];
        this.logger.success({ method: "case_insensitive", entity: record.get("name") });
        return {
          found: true,
          entityName: record.get("name") as string,
          entityType: record.get("type") as string,
          aliases: record.get("aliases") as string[],
          resolutionMethod: "case_insensitive",
        };
      }

      this.logger.success({ method: "not_found" });
      return { found: false };
    } catch (error) {
      this.logger.error(error as Error, { name });
      return { found: false };
    } finally {
      await session.close();
    }
  }

  /**
   * Resolve multiple potential entity references
   * @param names - Array of names/aliases to resolve
   * @returns Map of input names to resolved entities
   */
  async resolveEntities(names: string[]): Promise<Map<string, EntityLookupResult>> {
    this.logger.start("resolveEntities", { count: names.length });

    const results = new Map<string, EntityLookupResult>();

    for (const name of names) {
      const result = await this.lookupEntity(name);
      results.set(name, result);
    }

    const foundCount = Array.from(results.values()).filter((r) => r.found).length;
    this.logger.success({ total: names.length, found: foundCount });

    return results;
  }

  /**
   * Get all aliases for an entity
   * @param entityName - Entity name
   * @returns Array of aliases or null if not found
   */
  async getAliases(entityName: string): Promise<string[] | null> {
    const session = this.driver.session({ database: this.config.database });

    try {
      const result = await session.run(
        `
        MATCH (e:Entity {name: $entityName})
        RETURN e.aliases as aliases
        `,
        { entityName },
      );

      if (result.records.length === 0) {
        return null;
      }

      return result.records[0].get("aliases") as string[];
    } finally {
      await session.close();
    }
  }

  /**
   * Add pronoun aliases for user entity
   * @param userEntityName - User's entity name (e.g., "Steve")
   * @param entityType - Entity type (default: "Person")
   * @returns Update result
   */
  async addUserPronounAliases(
    userEntityName: string,
    entityType: string = "Person",
  ): Promise<AliasResult> {
    const pronounAliases = ["me", "i", "myself", "my", "user"];

    return this.updateAliases({
      entityName: userEntityName,
      entityType,
      aliases: pronounAliases,
    });
  }
}

/**
 * Create alias store
 * @param deps - Dependencies
 * @param config - Configuration
 * @returns Alias store instance
 */
export function createAliasStore(
  deps: KGStorageDependencies,
  config?: KGStorageConfig,
): AliasStore {
  return new AliasStore(deps, config);
}
