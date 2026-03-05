/**
 * Concrete Knowledge Graph Adapter - Neo4j backed entity relationships
 */

import neo4j, { Driver, Session } from "neo4j-driver";
import type { MemoryCategory } from "../categories/types.js";
import type { Logger } from "../types.js";
import type { KnowledgeGraphInterface } from "./types.js";

export interface ConcreteKnowledgeGraphConfig {
  uri: string;
  username: string;
  password: string;
  database?: string;
}

export class ConcreteKnowledgeGraphAdapter implements KnowledgeGraphInterface {
  private driver: Driver;
  private config: ConcreteKnowledgeGraphConfig;
  private log: Logger;

  constructor(config: ConcreteKnowledgeGraphConfig, log: Logger) {
    this.config = config;
    this.log = log;

    // Initialize Neo4j driver
    this.driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));

    this.initSchema();
  }

  private async initSchema(): Promise<void> {
    const session = this.driver.session({ database: this.config.database || "neo4j" });

    try {
      // Create constraints and indexes
      await session.run(`
        CREATE CONSTRAINT entity_name_type IF NOT EXISTS
        FOR (e:Entity) REQUIRE (e.name, e.type) IS UNIQUE
      `);

      await session.run(`
        CREATE CONSTRAINT episode_uuid IF NOT EXISTS
        FOR (ep:Episode) REQUIRE ep.uuid IS UNIQUE
      `);

      await session.run(`
        CREATE INDEX entity_type_idx IF NOT EXISTS
        FOR (e:Entity) ON (e.type)
      `);

      await session.run(`
        CREATE INDEX episode_timestamp_idx IF NOT EXISTS
        FOR (ep:Episode) ON (ep.timestamp)
      `);

      this.log.info("Knowledge Graph schema initialized");
    } catch (error) {
      this.log.warn(
        "Schema initialization warning (constraints may already exist)",
        error as Error,
      );
    } finally {
      await session.close();
    }
  }

  async createEpisode(params: {
    memoryId: string;
    content: string;
    timestamp: number;
    category: MemoryCategory;
  }): Promise<{ uuid: string }> {
    const uuid = this.generateUuid();
    const session = this.driver.session({ database: this.config.database || "neo4j" });

    try {
      // Extract entities from content (simple NER)
      const entities = await this.extractEntities(params.content);

      await session.run(
        `
        CREATE (ep:Episode {
          uuid: $uuid,
          memoryId: $memoryId,
          content: $content,
          timestamp: $timestamp,
          category: $category,
          createdAt: datetime()
        })
        RETURN ep
      `,
        {
          uuid,
          memoryId: params.memoryId,
          content: params.content.substring(0, 1000), // Limit content size
          timestamp: params.timestamp,
          category: params.category,
        },
      );

      // Link entities to episode
      if (entities.length > 0) {
        await this.linkEntities({ episodeUuid: uuid, entities });
      }

      this.log.info("Episode created in Knowledge Graph", {
        uuid,
        memoryId: params.memoryId,
        entityCount: entities.length,
      });

      return { uuid };
    } finally {
      await session.close();
    }
  }

  async linkEntities(params: {
    episodeUuid: string;
    entities: Array<{ type: string; name: string; aliases?: string[] }>;
  }): Promise<void> {
    const session = this.driver.session({ database: this.config.database || "neo4j" });

    try {
      for (const entity of params.entities) {
        // Build aliases array: include lowercase name + any provided aliases
        const aliases = [entity.name.toLowerCase()];
        if (entity.aliases && entity.aliases.length > 0) {
          // Add provided aliases (lowercased), avoiding duplicates
          for (const alias of entity.aliases) {
            const lowerAlias = alias.toLowerCase();
            if (!aliases.includes(lowerAlias)) {
              aliases.push(lowerAlias);
            }
          }
        }

        // Merge entity (create if not exists) with aliases
        await session.run(
          `
          MERGE (e:Entity { name: $name, type: $type })
          ON CREATE SET e.createdAt = datetime(), e.mentionCount = 1, e.aliases = $aliases
          ON MATCH SET e.mentionCount = e.mentionCount + 1, e.lastSeen = datetime(),
                       e.aliases = coalesce(e.aliases, []) + [alias IN $aliases WHERE NOT alias IN coalesce(e.aliases, [])]
          WITH e
          MATCH (ep:Episode { uuid: $episodeUuid })
          MERGE (e)-[r:MENTIONED_IN]->(ep)
          ON CREATE SET r.firstMention = datetime()
          SET r.lastMention = datetime()
        `,
          {
            name: entity.name,
            type: entity.type,
            episodeUuid: params.episodeUuid,
            aliases: aliases,
          },
        );
      }
    } finally {
      await session.close();
    }
  }

  async searchRelated(params: {
    entityNames: string[];
    limit: number;
  }): Promise<Array<{ memoryId: string; relevance: number; content: string }>> {
    const session = this.driver.session({ database: this.config.database || "neo4j" });

    try {
      // Neo4j requires explicit integer - use int() from neo4j-driver
      const limitValue = require("neo4j-driver").int(Math.floor(params.limit));
      // Convert entity names to lowercase for case-insensitive matching
      const entityNamesLower = params.entityNames.map((e) => e.toLowerCase());

      // UPDATED: Also check entity aliases for matches (e.g., "me", "I" match "User" entity)
      // Use UNWIND to check both name and aliases
      const result = await session.run(
        `
        UNWIND $entityNamesLower AS searchTerm
        MATCH (e:Entity)-[:MENTIONED_IN]->(ep:Episode)
        WHERE toLower(e.name) = searchTerm
           OR (e.aliases IS NOT NULL AND searchTerm IN [alias IN e.aliases | toLower(alias)])
        WITH ep, count(DISTINCT e) as sharedEntities, collect(DISTINCT e.name) as matchedEntities
        ORDER BY sharedEntities DESC, ep.timestamp DESC
        LIMIT $limit
        RETURN ep.memoryId as memoryId, ep.content as content, sharedEntities as relevance, matchedEntities
      `,
        {
          entityNamesLower: entityNamesLower,
          limit: limitValue,
        },
      );

      return result.records.map((record) => ({
        memoryId: record.get("memoryId"),
        relevance: record.get("relevance").toNumber(),
        content: record.get("content") || "",
      }));
    } finally {
      await session.close();
    }
  }

  private async extractEntities(
    content: string,
  ): Promise<Array<{ type: string; name: string; confidence: number; aliases?: string[] }>> {
    // Simple entity extraction based on patterns
    // In production, this would use NER (Named Entity Recognition)
    const entities: Array<{ type: string; name: string; confidence: number; aliases?: string[] }> =
      [];

    // Person pattern (capitalized words)
    const personPattern = /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g;
    const persons = content.match(personPattern) || [];
    persons.forEach((name) => {
      if (name.length > 2 && !["The", "And", "For", "With"].includes(name)) {
        // For "Steve" (the user), add aliases for pronoun matching
        const aliases =
          name.toLowerCase() === "steve" ? ["steve", "user", "me", "i", "myself", "my"] : undefined;
        entities.push({ type: "Person", name, confidence: 0.7, aliases });
      }
    });

    // Project/Technology pattern (quoted or specific keywords)
    const projectPattern = /\b(AURA|OpenClaw|Neo4j|Docker|Kubernetes|GitHub)\b/gi;
    const projects = content.match(projectPattern) || [];
    projects.forEach((name) => {
      // Add lowercase alias for case-insensitive matching
      entities.push({
        type: "Project/Technology",
        name,
        confidence: 0.9,
        aliases: [name.toLowerCase()],
      });
    });

    // Date pattern
    const datePattern = /\b\d{4}-\d{2}-\d{2}\b/g;
    const dates = content.match(datePattern) || [];
    dates.forEach((name) => {
      entities.push({ type: "Date", name, confidence: 0.8 });
    });

    // Remove duplicates
    const unique = new Map<
      string,
      { type: string; name: string; confidence: number; aliases?: string[] }
    >();
    entities.forEach((e) => {
      const key = `${e.type}:${e.name}`;
      if (!unique.has(key) || unique.get(key)!.confidence < e.confidence) {
        unique.set(key, e);
      }
    });

    return Array.from(unique.values());
  }

  private generateUuid(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  async verifyConnection(): Promise<boolean> {
    const session = this.driver.session();
    try {
      await session.run("RETURN 1 as test");
      return true;
    } catch (error) {
      this.log.error("Neo4j connection verification failed", error as Error);
      return false;
    } finally {
      await session.close();
    }
  }

  /**
   * Get the Neo4j driver for graph traversal operations
   */
  getDriver(): Driver {
    return this.driver;
  }
}

export function createConcreteKnowledgeGraph(log: Logger): ConcreteKnowledgeGraphAdapter {
  const config: ConcreteKnowledgeGraphConfig = {
    uri: process.env.NEO4J_URL || "bolt://neo4j-memory:7687",
    username: process.env.NEO4J_USERNAME || "neo4j",
    password: process.env.NEO4J_PASSWORD || "poc-password-123",
    database: "neo4j",
  };

  return new ConcreteKnowledgeGraphAdapter(config, log);
}
