import {
  runMigration001,
  runMigration002,
  runMigration003,
  checkMigration003Status,
} from "/app/extensions/aura-memory/migrations/index.js";
import neo4j from "neo4j-driver";

const uri = "bolt://neo4j-memory:7687";
const user = "neo4j";
const password = "poc-password-123";

console.log("=== AURA Memory Migrations ===");
console.log(`Connecting to: ${uri}`);

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

async function runAll() {
  try {
    // Migration 001
    console.log("\n--- Migration 001: Add Semantic Relationships ---");
    const m001 = await runMigration001(driver, { dryRun: false });
    console.log(`✅ Updated ${m001.entitiesUpdated} entities`);
    if (m001.errors.length > 0) console.log(`⚠️ Errors: ${m001.errors.length}`);

    // Migration 002
    console.log("\n--- Migration 002: Deduplicate Entities ---");
    const m002 = await runMigration002(driver, { dryRun: false });
    console.log(`✅ Merged ${m002.entitiesMerged} entities into ${m002.groupsFound} groups`);
    console.log(`✅ Transferred ${m002.relationshipsTransferred} relationships`);
    if (m002.errors.length > 0) console.log(`⚠️ Errors: ${m002.errors.length}`);

    // Migration 003
    console.log("\n--- Migration 003: Backfill Relationships ---");
    const status = await checkMigration003Status(driver);
    console.log(
      `📊 Status: ${status.pendingEpisodes} episodes pending (${status.percentComplete}% complete)`,
    );

    if (status.pendingEpisodes > 0) {
      const m003 = await runMigration003(driver, {
        dryRun: false,
        batchSize: 5,
        maxEpisodes: 50, // Process max 50 for now
      });
      console.log(`✅ Processed ${m003.episodesProcessed} episodes`);
      console.log(`✅ Created ${m003.relationshipsStored} relationships`);
      if (m003.errors.length > 0) console.log(`⚠️ Errors: ${m003.errors.length}`);
    }

    console.log("\n=== All Migrations Complete ===");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await driver.close();
  }
}

runAll();
