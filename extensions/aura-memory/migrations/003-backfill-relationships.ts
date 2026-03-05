/**
 * Migration 003: Backfill Semantic Relationships
 *
 * Extracts semantic relationships from existing episode content
 * using the SemanticExtractor and creates typed relationships in Neo4j.
 */

import neo4j from "neo4j-driver";
import type { Neo4jDriver } from "../adapters/kg-storage/types.js";
import { SemanticExtractor } from "../extraction/semantic/extractor.js";
import { getValidRelationshipsForDomain } from "../graph/ontology/validators.js";
import { createLogger } from "../shared/debug-logger.js";

const logger = createLogger("Migration-003");

export interface Migration003Config {
  dryRun?: boolean;
  batchSize?: number;
  maxEpisodes?: number;
  skipIfRelationshipsExist?: boolean;
}

export interface Migration003Result {
  success: boolean;
  episodesProcessed: number;
  relationshipsExtracted: number;
  relationshipsStored: number;
  entitiesCreated: number;
  errors: string[];
  progress: {
    currentBatch: number;
    totalBatches: number;
    percentComplete: number;
  };
}

/**
 * Migration 003: Backfill Semantic Relationships
 *
 * Processes existing episodes and extracts semantic relationships
 * from their content using the LLM-based SemanticExtractor.
 */
export async function runMigration003(
  driver: Neo4jDriver,
  config: Migration003Config = {},
): Promise<Migration003Result> {
  const {
    dryRun = false,
    batchSize = 10,
    maxEpisodes = 0, // 0 = all episodes
    skipIfRelationshipsExist = true,
  } = config;

  logger.start("runMigration003", { dryRun, batchSize, maxEpisodes });

  const result: Migration003Result = {
    success: false,
    episodesProcessed: 0,
    relationshipsExtracted: 0,
    relationshipsStored: 0,
    entitiesCreated: 0,
    errors: [],
    progress: {
      currentBatch: 0,
      totalBatches: 0,
      percentComplete: 0,
    },
  };

  const session = driver.session();

  try {
    // Step 1: Count total episodes to process
    logger.progress("step1", { message: "Counting episodes" });

    const countQuery = skipIfRelationshipsExist
      ? `MATCH (e:Episode) 
         WHERE NOT (e)-[:HAS_RELATIONSHIP]->() 
         RETURN count(e) as total, count(e.id) as withId`
      : `MATCH (e:Episode) RETURN count(e) as total, count(e.id) as withId`;

    const countResult = await session.run(countQuery);
    const totalEpisodes = countResult.records[0]?.get("total")?.toNumber() || 0;
    const episodesToProcess =
      maxEpisodes > 0 ? Math.min(totalEpisodes, maxEpisodes) : totalEpisodes;

    result.progress.totalBatches = Math.ceil(episodesToProcess / batchSize);

    logger.success({
      totalEpisodes,
      episodesToProcess,
      batches: result.progress.totalBatches,
    });

    if (episodesToProcess === 0) {
      logger.progress("complete", { message: "No episodes to process" });
      result.success = true;
      return result;
    }

    // Step 2: Process episodes in batches
    logger.progress("step2", { message: "Processing episodes" });

    let processed = 0;
    let hasMore = true;
    let skip = 0;

    // Initialize semantic extractor with LLM client
    const baseUrl = process.env.CODE_WEAVER_URL || "https://llm.code-weaver.co.uk/v1";
    const apiKey = process.env.CODE_WEAVER_API_KEY || "sk-local";

    const llmClient = {
      complete: async (params: { prompt: string; maxTokens: number; temperature: number }) => {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "coder_deep",
            messages: [{ role: "user", content: params.prompt }],
            max_tokens: params.maxTokens,
            temperature: params.temperature,
          }),
        });

        if (!response.ok) {
          throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return {
          content: data.choices[0]?.message?.content || "",
          tokensUsed: {
            input: data.usage?.prompt_tokens || 0,
            output: data.usage?.completion_tokens || 0,
          },
        };
      },
    };

    const extractor = new SemanticExtractor({
      llm: llmClient,
      maxTokens: 2000,
      temperature: 0.3,
    });

    while (hasMore && processed < episodesToProcess) {
      result.progress.currentBatch++;

      // Fetch batch of episodes (use elementId as fallback for null ids)
      const fetchQuery = skipIfRelationshipsExist
        ? `MATCH (e:Episode) 
           WHERE NOT (e)-[:HAS_RELATIONSHIP]->()
           RETURN elementId(e) as episodeId, e.id as originalId, e.content as content, e.timestamp as timestamp
           ORDER BY e.timestamp DESC
           SKIP $skip LIMIT $limit`
        : `MATCH (e:Episode)
           RETURN elementId(e) as episodeId, e.id as originalId, e.content as content, e.timestamp as timestamp
           ORDER BY e.timestamp DESC
           SKIP $skip LIMIT $limit`;

      const batchResult = await session.run(fetchQuery, {
        skip: neo4j.int(skip),
        limit: neo4j.int(batchSize),
      });

      if (batchResult.records.length === 0) {
        hasMore = false;
        break;
      }

      // Process each episode in batch
      for (const record of batchResult.records) {
        const episodeElementId = record.get("episodeId");
        const content = record.get("content");

        if (!content || content.trim().length === 0) {
          continue;
        }

        try {
          if (dryRun) {
            // Just count what would be processed
            result.episodesProcessed++;
            continue;
          }

          // Extract semantic relationships
          const extractionResult = await extractor.extract({
            messages: [
              {
                id: episodeElementId || `ep-${Date.now()}`,
                role: "user",
                content: content,
                timestamp: Date.now(),
              },
            ],
          });

          if (extractionResult.success && extractionResult.relationships.length > 0) {
            result.relationshipsExtracted += extractionResult.relationships.length;

            // Store extracted relationships in Neo4j
            for (const rel of extractionResult.relationships) {
              try {
                // Create or merge entities
                await session.run(
                  `
                  MERGE (from:Entity {name: $fromName})
                  ON CREATE SET
                    from.type = $fromType,
                    from.aliases = [],
                    from.createdAt = datetime()

                  MERGE (to:Entity {name: $toName})
                  ON CREATE SET
                    to.type = $toType,
                    to.aliases = [],
                    to.createdAt = datetime()

                  MERGE (from)-[r:${rel.type}]->(to)
                  ON CREATE SET
                    r.confidence = $confidence,
                    r.fact = $fact,
                    r.extractedAt = datetime(),
                    r.sourceEpisodeId = $episodeId
                `,
                  {
                    fromName: rel.from,
                    fromType: rel.fromType || "Unknown",
                    toName: rel.to,
                    toType: rel.toType || "Unknown",
                    confidence: rel.confidence,
                    fact: rel.fact || null,
                    episodeId: episodeElementId,
                  },
                );

                result.relationshipsStored++;
              } catch (relError) {
                logger.error(relError as Error, {
                  episodeElementId,
                  relationship: rel,
                });
              }
            }

            // Mark episode as processed using elementId
            await session.run(
              `
              MATCH (e:Episode)
              WHERE elementId(e) = $episodeElementId
              CREATE (e)-[:HAS_RELATIONSHIP {processedAt: datetime()}]->(:Processing)
            `,
              { episodeElementId },
            );
          }

          result.episodesProcessed++;
        } catch (error) {
          logger.error(error as Error, { episodeElementId });
          result.errors.push(`Episode ${episodeElementId}: ${(error as Error).message}`);
        }
      }

      // Update progress
      processed += batchResult.records.length;
      skip += batchSize;
      result.progress.percentComplete = Math.round((processed / episodesToProcess) * 100);

      logger.progress("batch-complete", {
        batch: result.progress.currentBatch,
        processed,
        total: episodesToProcess,
        percent: result.progress.percentComplete,
      });

      // Check if we've reached max episodes
      if (maxEpisodes > 0 && processed >= maxEpisodes) {
        hasMore = false;
      }
    }

    result.success =
      result.errors.length === 0 || result.errors.length < result.episodesProcessed * 0.1; // Allow up to 10% error rate

    logger.success({
      episodesProcessed: result.episodesProcessed,
      relationshipsExtracted: result.relationshipsExtracted,
      relationshipsStored: result.relationshipsStored,
      errors: result.errors.length,
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
 * Check migration status - how many episodes need processing
 */
export async function checkMigration003Status(driver: Neo4jDriver): Promise<{
  totalEpisodes: number;
  processedEpisodes: number;
  pendingEpisodes: number;
  percentComplete: number;
}> {
  logger.start("checkMigration003Status");

  const session = driver.session();

  try {
    const result = await session.run(`
      MATCH (e:Episode)
      OPTIONAL MATCH (e)-[:HAS_RELATIONSHIP]->(p)
      WITH e, count(p) as hasProcessing
      RETURN 
        count(e) as total,
        count(CASE WHEN hasProcessing > 0 THEN 1 END) as processed
    `);

    const total = result.records[0]?.get("total")?.toNumber() || 0;
    const processed = result.records[0]?.get("processed")?.toNumber() || 0;

    logger.success({ total, processed, pending: total - processed });

    return {
      totalEpisodes: total,
      processedEpisodes: processed,
      pendingEpisodes: total - processed,
      percentComplete: total > 0 ? Math.round((processed / total) * 100) : 100,
    };
  } finally {
    await session.close();
  }
}
