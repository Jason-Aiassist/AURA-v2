/**
 * Entity Merge Service
 *
 * Merges fragmented entities in the Knowledge Graph.
 * Consolidates: Steve, USER, user, Steve's → single "Steve" entity
 */

import { getUserName } from "../config/user-config.js";
import type { KnowledgeGraphIntegration } from "../graph/KnowledgeGraphIntegration.js";
import type { Logger } from "../types.js";

export interface EntityMergeConfig {
  canonicalEntity: string;
  aliases: string[];
  caseSensitive: boolean;
}

export interface MergeResult {
  success: boolean;
  mergedCount: number;
  relationshipsTransferred: number;
  episodesUpdated: number;
  error?: string;
}

export class EntityMergeService {
  private kg: KnowledgeGraphIntegration;
  private log?: Logger;
  private config: EntityMergeConfig;

  constructor(kg: KnowledgeGraphIntegration, config: Partial<EntityMergeConfig>, log?: Logger) {
    this.kg = kg;
    this.log = log;
    const userName = getUserName();
    this.config = {
      canonicalEntity: userName,
      aliases: ["USER", "user", `${userName}'s`, "My", "Me", "I"],
      caseSensitive: false,
      ...config,
    };
  }

  /**
   * Merge all alias entities into the canonical entity
   */
  async mergeAliases(): Promise<MergeResult> {
    this.log?.info("[EntityMerge] Starting entity merge", {
      canonical: this.config.canonicalEntity,
      aliases: this.config.aliases,
    });

    const result: MergeResult = {
      success: true,
      mergedCount: 0,
      relationshipsTransferred: 0,
      episodesUpdated: 0,
    };

    try {
      // Get the canonical entity
      const canonicalNode = await this.getOrCreateCanonicalEntity();

      // Process each alias
      for (const alias of this.config.aliases) {
        const aliasNode = await this.findEntity(alias);

        if (!aliasNode || aliasNode.name === this.config.canonicalEntity) {
          continue; // Skip if not found or already canonical
        }

        this.log?.info("[EntityMerge] Merging alias", {
          alias: aliasNode.name,
          into: this.config.canonicalEntity,
        });

        // Transfer relationships
        const relsTransferred = await this.transferRelationships(
          aliasNode.name,
          this.config.canonicalEntity,
        );
        result.relationshipsTransferred += relsTransferred;

        // Update episode mentions
        const episodesUpdated = await this.updateEpisodeMentions(
          aliasNode.name,
          this.config.canonicalEntity,
        );
        result.episodesUpdated += episodesUpdated;

        // Delete alias entity
        await this.deleteEntity(aliasNode.name);
        result.mergedCount++;

        this.log?.info("[EntityMerge] Alias merged successfully", {
          alias: aliasNode.name,
          relationships: relsTransferred,
          episodes: episodesUpdated,
        });
      }

      this.log?.info("[EntityMerge] Merge complete", result);
      return result;
    } catch (error) {
      this.log?.error("[EntityMerge] Merge failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        mergedCount: result.mergedCount,
        relationshipsTransferred: result.relationshipsTransferred,
        episodesUpdated: result.episodesUpdated,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get or create the canonical entity
   */
  private async getOrCreateCanonicalEntity(): Promise<{ name: string; type: string }> {
    const existing = await this.findEntity(this.config.canonicalEntity);
    if (existing) {
      return existing;
    }

    // Create canonical entity if not exists
    // This would use the KG's createEntity method
    return { name: this.config.canonicalEntity, type: "Person" };
  }

  /**
   * Find an entity by name
   */
  private async findEntity(name: string): Promise<{ name: string; type: string } | null> {
    try {
      // Query Neo4j for entity
      const driver = this.kg.getDriver?.();
      if (!driver) return null;

      const session = driver.session();
      const result = await session.run(
        `MATCH (e:Entity {name: $name}) RETURN e.name as name, e.entity_type as type`,
        { name: this.normalizeName(name) },
      );
      await session.close();

      if (result.records.length > 0) {
        return {
          name: result.records[0].get("name"),
          type: result.records[0].get("type") || "Unknown",
        };
      }
      return null;
    } catch (error) {
      this.log?.warn("[EntityMerge] Failed to find entity", { name, error });
      return null;
    }
  }

  /**
   * Transfer relationships from alias to canonical entity
   */
  private async transferRelationships(fromEntity: string, toEntity: string): Promise<number> {
    try {
      const driver = this.kg.getDriver?.();
      if (!driver) return 0;

      const session = driver.session();

      // Get all relationships from the alias entity
      const relsResult = await session.run(
        `MATCH (e:Entity {name: $from})-[r]->(target)
         RETURN type(r) as relType, target.name as targetName, r.observed_context as context`,
        { from: this.normalizeName(fromEntity) },
      );

      let transferred = 0;

      for (const record of relsResult.records) {
        const relType = record.get("relType");
        const targetName = record.get("targetName");
        const context = record.get("context");

        // Create relationship from canonical entity
        await session.run(
          `MATCH (canonical:Entity {name: $canonical}), (target:Entity {name: $target})
           MERGE (canonical)-[r:${relType}]->(target)
           ON CREATE SET r.observed_context = $context, r.transferred_from = $from
           RETURN r`,
          {
            canonical: this.normalizeName(toEntity),
            target: targetName,
            context: context,
            from: fromEntity,
          },
        );
        transferred++;
      }

      await session.close();
      return transferred;
    } catch (error) {
      this.log?.warn("[EntityMerge] Failed to transfer relationships", { fromEntity, error });
      return 0;
    }
  }

  /**
   * Update episode mentions to point to canonical entity
   */
  private async updateEpisodeMentions(fromEntity: string, toEntity: string): Promise<number> {
    try {
      const driver = this.kg.getDriver?.();
      if (!driver) return 0;

      const session = driver.session();

      const result = await session.run(
        `MATCH (e:Entity {name: $from})-[m:MENTIONED_IN]->(ep:Episode)
         WITH e, m, ep
         MATCH (canonical:Entity {name: $to})
         MERGE (canonical)-[newM:MENTIONED_IN]->(ep)
         ON CREATE SET newM.transferred_from = $from
         DELETE m
         RETURN count(ep) as updated`,
        {
          from: this.normalizeName(fromEntity),
          to: this.normalizeName(toEntity),
        },
      );

      const updated = result.records[0]?.get("updated") || 0;
      await session.close();
      return updated;
    } catch (error) {
      this.log?.warn("[EntityMerge] Failed to update episodes", { fromEntity, error });
      return 0;
    }
  }

  /**
   * Delete an entity node
   */
  private async deleteEntity(name: string): Promise<void> {
    try {
      const driver = this.kg.getDriver?.();
      if (!driver) return;

      const session = driver.session();
      await session.run(`MATCH (e:Entity {name: $name}) DETACH DELETE e`, {
        name: this.normalizeName(name),
      });
      await session.close();
    } catch (error) {
      this.log?.warn("[EntityMerge] Failed to delete entity", { name, error });
    }
  }

  /**
   * Normalize entity name for comparison
   */
  private normalizeName(name: string): string {
    if (this.config.caseSensitive) {
      return name;
    }
    return name.trim();
  }

  /**
   * Check if entity needs merging
   */
  async checkEntityStatus(): Promise<{
    canonical: string | null;
    aliases: string[];
    needsMerge: boolean;
  }> {
    const canonical = await this.findEntity(this.config.canonicalEntity);
    const foundAliases: string[] = [];

    for (const alias of this.config.aliases) {
      const found = await this.findEntity(alias);
      if (found && found.name !== this.config.canonicalEntity) {
        foundAliases.push(found.name);
      }
    }

    return {
      canonical: canonical?.name || null,
      aliases: foundAliases,
      needsMerge: foundAliases.length > 0,
    };
  }
}

// Factory function
export function createEntityMergeService(
  kg: KnowledgeGraphIntegration,
  config?: Partial<EntityMergeConfig>,
  log?: Logger,
): EntityMergeService {
  return new EntityMergeService(kg, config, log);
}
