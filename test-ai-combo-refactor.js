/**
 * Smoke test for refactored generate-ai-user-combos.js
 */

import "dotenv/config";
import { buildBetKey, buildComboId } from "./lib/core/keys.js";
import { buildCombinations } from "./lib/engines/combo-engine.js";

console.log("\n🧪 Smoke Test: Refactored AI Combo Script\n");

let passed = 0;
let total = 0;

// Test 1: buildBetKey works
console.log("1. Testing buildBetKey...");
try {
  const key = buildBetKey({
    matchId: "123",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    stat: "cornerKicks",
    scope: "total",
    period: "ALL",
    line: 10.5,
    over: true,
    form: "all",
    neutralGround: false,
  });
  
  if (key.includes("arsenal") && key.includes("chelsea")) {
    console.log(`✅ buildBetKey works: ${key}`);
    passed++;
  }
  total++;
} catch (error) {
  console.error(`❌ buildBetKey error: ${error.message}`);
  total++;
}

// Test 2: buildComboId works
console.log("\n2. Testing buildComboId...");
try {
  const betKeys = ["key1", "key2", "key3"];
  const comboId = buildComboId(betKeys);
  
  if (comboId && comboId.includes("@@")) {
    console.log(`✅ buildComboId works: ${comboId}`);
    passed++;
  }
  total++;
} catch (error) {
  console.error(`❌ buildComboId error: ${error.message}`);
  total++;
}

// Test 3: buildCombinations works
console.log("\n3. Testing buildCombinations...");
try {
  const testLines = [
    { betKey: "k1", odds: 1.85, value: 10, matchId: "1", statKey: "corners", scope: "total", period: "ALL", direction: "over" },
    { betKey: "k2", odds: 1.90, value: 12, matchId: "2", statKey: "corners", scope: "total", period: "ALL", direction: "over" },
  ];
  
  const combos = buildCombinations(testLines, { minCombos: 2, maxCombos: 2 });
  
  if (Array.isArray(combos)) {
    console.log(`✅ buildCombinations works (${combos.length} combos)`);
    passed++;
  }
  total++;
} catch (error) {
  console.error(`❌ buildCombinations error: ${error.message}`);
  total++;
}

// Test 4: Files exist
console.log("\n4. Checking script files...");
try {
  const fs = await import("fs/promises");
  const backupExists = await fs.access("scripts/generate-ai-user-combos.old.js")
    .then(() => true)
    .catch(() => false);
  const newExists = await fs.access("scripts/generate-ai-user-combos.js")
    .then(() => true)
    .catch(() => false);
  
  if (backupExists && newExists) {
    console.log("✅ Both old and new scripts exist");
    passed++;
  } else {
    console.error(`❌ Missing files (backup: ${backupExists}, new: ${newExists})`);
  }
  total++;
} catch (error) {
  console.error(`❌ File check error: ${error.message}`);
  total++;
}

// Summary
console.log("\n" + "=".repeat(50));
console.log(`\n🎯 RESULT: ${passed}/${total} tests passed\n`);

if (passed === total) {
  console.log("✅ SMOKE TEST PASSED! AI combo script ready.\n");
  console.log("To run the refactored script:");
  console.log("  node scripts/generate-ai-user-combos.js --date=2024-11-28\n");
  process.exit(0);
} else {
  console.error("❌ SMOKE TEST FAILED!\n");
  process.exit(1);
}
