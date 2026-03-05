/**
 * Quick test for empty entity array handling
 * Run this to verify the ?? vs empty array fix
 */

// Simulating the OLD behavior (bug)
function oldBehavior(entities: string[] | undefined): string[] {
  const searchEntities = entities ?? ["fallback", "entity"];
  return searchEntities;
}

// Simulating the NEW behavior (fix)
function newBehavior(entities: string[] | undefined): string[] {
  const searchEntities = entities && entities.length > 0 ? entities : ["fallback", "entity"];
  return searchEntities;
}

// Test cases
const testCases = [
  { input: undefined, description: "undefined" },
  { input: null as unknown as undefined, description: "null" },
  { input: [], description: "empty array []" },
  { input: ["aura", "neo4j"], description: "populated array" },
];

console.log("Testing entity fallback behavior:\n");

for (const { input, description } of testCases) {
  const oldResult = oldBehavior(input);
  const newResult = newBehavior(input);

  console.log(`Input: ${description}`);
  console.log(`  OLD (?? operator):        ${JSON.stringify(oldResult)}`);
  console.log(`  NEW (length check):       ${JSON.stringify(newResult)}`);
  console.log(`  Fix needed: ${oldResult.length === 0 && newResult.length > 0 ? "YES ⚠️" : "No"}`);
  console.log("");
}

console.log("\nKey insight: ?? only falls back for null/undefined, NOT empty arrays!");
console.log("If QueryAnalyzer returns [] (which is truthy), the OLD code uses it directly.");
console.log("The NEW code checks length > 0, so empty arrays trigger fallback extraction.");
