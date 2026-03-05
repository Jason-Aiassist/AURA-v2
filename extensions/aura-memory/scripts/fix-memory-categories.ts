#!/usr/bin/env node
/**
 * Fix Memory Categories Script
 *
 * Post-processes existing memories to recategorize preferences/likes as "User"
 * instead of "General".
 */

import Database from "better-sqlite3";

const DB_PATH =
  process.env.DB_PATH ||
  "/home/kraythorne/.openclaw/super-agent-config/state/aura/tiered-memory.sqlite";

// Keywords that indicate personal preferences (should be User category)
const USER_INDICATORS = [
  "likes",
  "loves",
  "enjoys",
  "prefers",
  "favorite",
  "favourite",
  "hates",
  "dislikes",
  "wants",
  "needs",
  "goals",
  "hobbies",
  "interests",
  "passionate about",
  "keen on",
  "fan of",
  "into",
];

function shouldBeUserCategory(content: string): boolean {
  const lowerContent = content.toLowerCase();
  return USER_INDICATORS.some((indicator) => lowerContent.includes(indicator));
}

async function fixMemoryCategories() {
  console.log("=== Fixing Memory Categories ===\n");

  const db = new Database(DB_PATH);

  try {
    // Find General memories that should be User
    const generalMemories = db
      .prepare("SELECT id, content, category FROM hot_memories WHERE category = 'General'")
      .all() as Array<{ id: string; content: string; category: string }>;

    console.log(`Found ${generalMemories.length} General memories to check`);

    let fixedCount = 0;
    const toFix: Array<{ id: string; content: string }> = [];

    for (const memory of generalMemories) {
      if (shouldBeUserCategory(memory.content)) {
        toFix.push(memory);
      }
    }

    console.log(`\nFound ${toFix.length} memories to recategorize:\n`);

    // Update categories
    const updateStmt = db.prepare("UPDATE hot_memories SET category = 'User' WHERE id = ?");

    for (const memory of toFix) {
      console.log(`  [${memory.id.substring(0, 20)}...] ${memory.content.substring(0, 60)}...`);
      updateStmt.run(memory.id);
      fixedCount++;
    }

    console.log(`\n✅ Fixed ${fixedCount} memories (General → User)`);

    // Show category distribution after fix
    const distribution = db
      .prepare("SELECT category, COUNT(*) as count FROM hot_memories GROUP BY category")
      .all();

    console.log("\nCategory distribution after fix:");
    for (const row of distribution) {
      console.log(`  ${row.category}: ${row.count}`);
    }
  } catch (error) {
    console.error("Error fixing categories:", error);
    process.exit(1);
  } finally {
    db.close();
  }
}

fixMemoryCategories();
