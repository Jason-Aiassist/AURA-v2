#!/usr/bin/env node
/**
 * Neo4j to SQLite Migration Script
 * 
 * Extracts memories from Neo4j Knowledge Graph,
 * generates embeddings using local nomic-embed-text,
 * and stores in SQLite with proper indexing for hybrid search.
 * 
 * Uses code-weaver.co.uk API with coder_fast/coder_reviewer models
 * for any LLM-based processing (not Kimi).
 */

import neo4j from "neo4j-driver";
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";

// Configuration
const NEO4J_URL = process.env.NEO4J_URL || "bolt://neo4j-memory:7687";
const NEO4J_USER = process.env.NEO4J_USERNAME || "neo4j";
const NEO4J_PASS = process.env.NEO4J_PASSWORD || "poc-password-123";
const OLLAMA_URL = process.env.OLLAMA_EMBED_URL || "http://ollama-embed-gpu0:11434";
const CODE_WEAVER_URL = process.env.CODE_WEAVER_URL || "https://llm.code-weaver.co.uk/v1";
const CODE_WEAVER_KEY = process.env.CODE_WEAVER_API_KEY || "sk-local";

const DB_PATH = path.join(os.homedir(), ".openclaw", "state", "aura", "hot", "memories.db");

// Logger
function log(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`, meta);
}

/**
 * Initialize SQLite database with proper schema
 */
function initDatabase(dbPath) {
  log("INFO", "Initializing SQLite database", { path: dbPath });
  
  const db = new Database(dbPath);
  
  // Create memories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      access_count INTEGER DEFAULT 0,
      last_accessed INTEGER,
      importance REAL DEFAULT 0.5,
      confidence REAL DEFAULT 0.5,
      category TEXT DEFAULT 'General',
      encrypted INTEGER DEFAULT 0,
      entities TEXT,
      embedding BLOB
    )
  `);
  
  // Create FTS5 virtual table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content='memories',
      content_rowid='rowid'
    )
  `);
  
  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)`);
  
  // Create triggers to keep FTS index in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
    END
  `);
  
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END
  `);
  
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
    END
  `);
  
  log("INFO", "Database schema initialized");
  return db;
}

/**
 * Generate embedding using local nomic-embed-text
 */
async function generateEmbedding(text) {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nomic-embed-text",
        prompt: text,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.embedding;
  } catch (error) {
    log("ERROR", "Failed to generate embedding", { error: error.message });
    return null;
  }
}

/**
 * Extract entities from content using coder_reviewer (cheaper than coder_fast)
 */
async function extractEntities(content) {
  try {
    const response = await fetch(`${CODE_WEAVER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CODE_WEAVER_KEY}`,
      },
      body: JSON.stringify({
        model: "reviewer", // Cheaper option
        messages: [
          {
            role: "system",
            content: "Extract key entities (people, places, organizations, technologies) from the text. Return as JSON array: {\"entities\": [{\"name\": \"...\", \"type\": \"Person|Organization|Location|Technology\"}]}",
          },
          {
            role: "user",
            content: content.substring(0, 500), // Limit to save tokens
          },
        ],
        temperature: 0.0,
        max_tokens: 256,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const resultText = data.choices[0]?.message?.content || "{}";
    
    // Parse JSON from response
    try {
      const result = JSON.parse(resultText);
      return result.entities || [];
    } catch {
      return [];
    }
  } catch (error) {
    log("WARN", "Entity extraction failed, using fallback", { error: error.message });
    return [];
  }
}

/**
 * Calculate importance score using coder_reviewer
 */
async function calculateImportance(content) {
  try {
    const response = await fetch(`${CODE_WEAVER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CODE_WEAVER_KEY}`,
      },
      body: JSON.stringify({
        model: "reviewer",
        messages: [
          {
            role: "system",
            content: "Rate the importance of this memory on a scale of 0.0 to 1.0. Personal preferences, facts about the user, and key decisions are high importance (0.8-1.0). General information is lower (0.3-0.5). Return only the number.",
          },
          {
            role: "user",
            content: content.substring(0, 300),
          },
        ],
        temperature: 0.0,
        max_tokens: 10,
      }),
    });
    
    if (!response.ok) return 0.5;
    
    const data = await response.json();
    const scoreText = data.choices[0]?.message?.content || "0.5";
    const score = parseFloat(scoreText);
    
    return isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score));
  } catch (error) {
    return 0.5;
  }
}

/**
 * Migrate data from Neo4j to SQLite
 */
async function migrateData() {
  log("INFO", "Starting Neo4j to SQLite migration");
  
  // Connect to Neo4j
  const driver = neo4j.driver(NEO4J_URL, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));
  const session = driver.session();
  
  // Initialize SQLite
  const db = initDatabase(DB_PATH);
  
  // Clear existing data
  db.prepare("DELETE FROM memories").run();
  log("INFO", "Cleared existing SQLite data");
  
  // Get all episodes from Neo4j
  log("INFO", "Fetching episodes from Neo4j...");
  const result = await session.run(`
    MATCH (ep:Episode)
    RETURN ep.memoryId AS memoryId,
           ep.content AS content,
           ep.timestamp AS timestamp,
           ep.category AS category
    ORDER BY ep.timestamp DESC
  `);
  
  const episodes = result.records;
  log("INFO", `Found ${episodes.length} episodes in Neo4j`);
  
  // Prepare insert statement
  const insertStmt = db.prepare(`
    INSERT INTO memories (id, content, timestamp, access_count, importance, confidence, category, encrypted, entities, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  // Process each episode
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < episodes.length; i++) {
    const record = episodes[i];
    const memoryId = record.get("memoryId");
    const content = record.get("content");
    const timestampVal = record.get("timestamp");
    const timestamp = timestampVal?.low !== undefined ? timestampVal.low : (timestampVal || Date.now());
    const category = record.get("category") || "General";
    
    log("INFO", `Processing ${i + 1}/${episodes.length}: ${memoryId.substring(0, 30)}...`);
    
    try {
      // Generate embedding
      const embedding = await generateEmbedding(content);
      if (!embedding) {
        log("WARN", `Failed to generate embedding for ${memoryId}`);
        errorCount++;
        continue;
      }
      
      // Extract entities (optional, for metadata)
      const entities = await extractEntities(content);
      
      // Calculate importance
      const importance = await calculateImportance(content);
      
      // Determine if content is encrypted
      const isEncrypted = content && content.trim().startsWith('{"ciphertext":');
      const finalCategory = isEncrypted ? "User" : category;
      
      // Insert into SQLite
      insertStmt.run(
        memoryId,
        content,
        timestamp,
        0, // access_count
        importance,
        0.8, // confidence
        finalCategory,
        isEncrypted ? 1 : 0, // encrypted flag
        JSON.stringify(entities),
        Buffer.from(new Float32Array(embedding).buffer)
      );
      
      successCount++;
      
      // Progress log every 50 records
      if ((i + 1) % 50 === 0) {
        log("INFO", `Progress: ${i + 1}/${episodes.length} processed`);
      }
      
    } catch (error) {
      log("ERROR", `Failed to process ${memoryId}`, { error: error.message });
      errorCount++;
    }
  }
  
  // Close connections
  db.close();
  await session.close();
  await driver.close();
  
  log("INFO", "Migration complete", {
    total: episodes.length,
    success: successCount,
    errors: errorCount,
  });
}

// Run migration
migrateData().catch(err => {
  log("ERROR", "Migration failed", { error: err.message });
  process.exit(1);
});
