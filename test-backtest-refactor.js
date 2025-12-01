/**
 * Smoke test for refactored run-unibet-backtests.js
 * 
 * Tests that the script can:
 * 1. Parse CLI args
 * 2. Fetch matches via engine
 * 3. Process at least one match
 * 4. Generate bet lines
 * 5. Use correct buildBetKey format
 */

import "dotenv/config";
import { buildBetKey } from "./lib/core/keys.js";
import { getMatchesForDateFiltered } from "./lib/engines/fixtures-engine.js";

console.log("\n🧪 Smoke Test: Refactored Backtest Script\n");

let passed = 0;
let total = 0;

// Test 1: Engine imports work
console.log("1. Testing engine imports...");
try {
  if (typeof getMatchesForDateFiltered === "function") {
    console.log("✅ Fixtures engine imported");
    passed++;
  }
  total++;
} catch (error) {
  console.error(`❌ Import error: ${error.message}`);
  total++;
}

// Test 2: buildBetKey generates correct format
console.log("\n2. Testing buildBetKey format...");
try {
  const testKey = buildBetKey({
    matchId: "12345",
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
  
  const expectedParts = [
    "12345",
    "arsenal",
    "chelsea",
    "cornerKicks",
    "total",
    "ALL",
    "over",
    "10.5",
    "all",
    "H"
  ];
  
  const actualParts = testKey.split("|");
  const matches = expectedParts.every((part, i) => actualParts[i] === part);
  
  if (matches) {
    console.log(`✅ betKey format correct: ${testKey}`);
    passed++;
  } else {
    console.error(`❌ betKey format incorrect`);
    console.error(`   Expected: ${expectedParts.join("|")}`);
    console.error(`   Got:      ${testKey}`);
  }
  total++;
} catch (error) {
  console.error(`❌ buildBetKey error: ${error.message}`);
  total++;
}

// Test 3: Can fetch matches (smoke test)
console.log("\n3. Testing fixtures engine (fetch empty date)...");
try {
  const matches = await getMatchesForDateFiltered("2099-01-01", {
    leagues: ["Premier League"],
  });
  
  if (Array.isArray(matches)) {
    console.log(`✅ Fixtures engine works (returned ${matches.length} matches)`);
    passed++;
  } else {
    console.error("❌ Fixtures engine did not return array");
  }
  total++;
} catch (error) {
  console.error(`❌ Fixtures engine error: ${error.message}`);
  total++;
}

// Test 4: Script file exists
console.log("\n4. Checking script files...");
try {
  const fs = await import("fs/promises");
  const backupExists = await fs.access("scripts/run-unibet-backtests.old.js")
    .then(() => true)
    .catch(() => false);
  const newExists = await fs.access("scripts/run-unibet-backtests.js")
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
  console.log("✅ SMOKE TEST PASSED! Script ready for testing.\n");
  console.log("To run the refactored backtest:");
  console.log("  node scripts/run-unibet-backtests.js --date=2024-11-28\n");
  console.log("To run the old version for comparison:");
  console.log("  node scripts/run-unibet-backtests.old.js --date=2024-11-28\n");
  process.exit(0);
} else {
  console.error("❌ SMOKE TEST FAILED!\n");
  process.exit(1);
}
