#!/usr/bin/env node
/**
 * Fix Entity Types Script - Simple Version
 * 
 * Uses coder_deep LLM to re-categorize "Unknown" entities in Neo4j
 * Handles duplicates by updating to match existing type
 */

import neo4j from "neo4j-driver";

const NEO4J_URL = process.env.NEO4J_URL || "bolt://neo4j-memory:7687";
const NEO4J_USER = process.env.NEO4J_USERNAME || "neo4j";
const NEO4J_PASS = process.env.NEO4J_PASSWORD || "poc-password-123";
const CODE_WEAVER_URL = process.env.CODE_WEAVER_URL || "https://llm.code-weaver.co.uk/v1";
const CODE_WEAVER_KEY = process.env.CODE_WEAVER_API_KEY || "sk-local";

// Valid entity types (ordered by preference)
const TYPE_PRIORITY = [
  "Person",
  "Organization", 
  "Technology",
  "Project",
  "Product",
  "Location",
  "Event",
  "Role",
  "Concept",
  "Unknown"
];

/**
 * Use coder_deep to categorize an entity
 */
async function categorizeEntity(entityName) {
  try {
    const response = await fetch(`${CODE_WEAVER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CODE_WEAVER_KEY}`,
      },
      body: JSON.stringify({
        model: "coder_deep",
        messages: [
          {
            role: "system",
            content: `Categorize the entity into one of these types: ${TYPE_PRIORITY.join(", ")}. 
Return ONLY the type name, nothing else. Be precise:
- Person: Names of people (Steve, Ken, etc.)
- Organization: Companies, teams (Dataweb, OpenClaw)
- Technology: Tools, languages, frameworks (Node.js, SQLite, Docker)
- Project: Named projects (AURA, Super-Agent)
- Product: Commercial products
- Location: Places
- Event: Named events
- Role: Job titles, roles (assistant, developer)
- Concept: Abstract ideas, processes`,
          },
          {
            role: "user",
            content: `Entity: "${entityName}"`,
          },
        ],
        temperature: 0.0,
        max_tokens: 20,
      }),
    });

    if (!response.ok) {
      console.error(`HTTP ${response.status} for "${entityName}"`);
      return null;
    }

    const data = await response.json();
    const result = data.choices[0]?.message?.content?.trim() || "Unknown";
    
    // Validate the result
    const normalizedType = TYPE_PRIORITY.find(t => 
      t.toLowerCase() === result.toLowerCase()
    );
    
    return normalizedType || "Unknown";
    
  } catch (error) {
    console.error(`Error categorizing "${entityName}":`, error.message);
    return null;
  }
}

/**
 * Main function to fix entity types
 */
async function fixEntityTypes() {
  console.log("=== Fixing Entity Types with coder_deep ===\n");
  
  const driver = neo4j.driver(NEO4J_URL, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));
  const session = driver.session();
  
  try {
    // Get all Unknown entities
    const result = await session.run(
      `MATCH (e:Entity {type: "Unknown"}) 
       RETURN e.name AS name, id(e) AS entityId
       ORDER BY e.name`
    );
    
    const unknownEntities = result.records;
    console.log(`Found ${unknownEntities.length} Unknown entities to categorize\n`);
    
    let updated = 0;
    let matched = 0;
    let failed = 0;
    
    for (let i = 0; i < unknownEntities.length; i++) {
      const record = unknownEntities[i];
      const name = record.get("name");
      const entityId = record.get("entityId");
      
      process.stdout.write(`[${i + 1}/${unknownEntities.length}] "${name}"... `);
      
      // Check if there's already a non-Unknown entity with this name
      const existingResult = await session.run(
        `MATCH (e:Entity {name: $name}) 
         WHERE e.type <> "Unknown" 
         RETURN e.type AS existingType
         LIMIT 1`,
        { name }
      );
      
      if (existingResult.records.length > 0) {
        // Use the existing type
        const existingType = existingResult.records[0].get("existingType");
        try {
          await session.run(
            `MATCH (e:Entity) WHERE id(e) = $entityId SET e.type = $existingType`,
            { entityId, existingType }
          );
          console.log(`→ Matched existing: ${existingType}`);
          matched++;
        } catch (err) {
          console.log(`→ Failed: ${err.message}`);
          failed++;
        }
        continue;
      }
      
      // Get new type from LLM
      const newType = await categorizeEntity(name);
      
      if (newType && newType !== "Unknown") {
        try {
          await session.run(
            `MATCH (e:Entity) WHERE id(e) = $entityId SET e.type = $newType`,
            { entityId, newType }
          );
          console.log(`→ Updated to: ${newType}`);
          updated++;
        } catch (err) {
          console.log(`→ Failed: ${err.message}`);
          failed++;
        }
      } else {
        console.log(`→ Kept as: Unknown`);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }
    
    console.log(`\n=== Complete ===`);
    console.log(`Updated with new type: ${updated} entities`);
    console.log(`Matched existing type: ${matched} entities`);
    console.log(`Failed: ${failed} entities`);
    
    // Show final count
    const finalResult = await session.run(
      'MATCH (e:Entity {type: "Unknown"}) RETURN count(e) AS count'
    );
    console.log(`\nRemaining Unknown entities: ${finalResult.records[0].get("count")}`);
    
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await session.close();
    await driver.close();
  }
}

fixEntityTypes().catch(console.error);
