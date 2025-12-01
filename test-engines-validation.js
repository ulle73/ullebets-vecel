/**
 * Validation tests for Phase 3 Engines
 * Tests unibet-engine, fixtures-engine, ev-engine, and combo-engine
 */

// Core utilities
import { buildBetKey, buildComboId } from './lib/core/keys.js';

// Engines
import {  getMatchesForDateFiltered, findMatchById } from './lib/engines/fixtures-engine.js';
import { filterLines, buildCombinations, assignComboNumbers, generateCombos } from './lib/engines/combo-engine.js';

console.log("\n🧪 Testing Phase 3 Engines...\n");

let totalTests = 0;
let passedTests = 0;

// ===== FIXTURES ENGINE TESTS =====
console.log("📁 Testing fixtures-engine.js:");

// Test 1: getMatchesForDateFiltered with empty leagues
console.log("\n1. Testing getMatchesForDateFiltered:");
try {
  const matches = await getMatchesForDateFiltered("2024-11-28", { leagues: [] });
  if (Array.isArray(matches)) {
    console.log(`✅ getMatchesForDateFiltered returns array (${matches.length} matches)`);
    passedTests++;
  } else {
    console.error("❌ getMatchesForDateFiltered should return array");
  }
  totalTests++;
} catch (error) {
  console.error(`❌ getMatchesForDateFiltered error: ${error.message}`);
  totalTests++;
}

// Test 2: findMatchById with null
console.log("\n2. Testing findMatchById:");
try {
  const result = await findMatchById(null);
  if (result === null) {
    console.log("✅ findMatchById(null) returns null");
    passedTests++;
  } else {
    console.error("❌ findMatchById(null) should return null");
  }
  totalTests++;
} catch (error) {
  console.error(`❌ findMatchById error: ${error.message}`);
  totalTests++;
}

// ===== COMBO ENGINE TESTS =====
console.log("\n🔧 Testing combo-engine.js:");

// Test 3: filterLines
console.log("\n3. Testing filterLines:");
const testLines = [
  { betKey: "key1", priority: 1, odds: 1.85, value: 10 },
  { betKey: "key2", priority: 2, odds: 1.50, value: 5 },
  { betKey: "key3", priority: 1, odds: 2.00, value: 15 },
  { betKey: "key4", priority: 3, odds: 1.90, value: 8 },
];

const filtered = filterLines(testLines, { minPriority: 1, minOdds: 1.8, minEv: 8 });
const expectedCount = 2; // key1 and key3 should pass

if (filtered.length === expectedCount) {
  console.log(`✅ filterLines returns correct count (${filtered.length})`);
  passedTests++;
} else {
  console.error(`❌ filterLines expected ${expectedCount}, got ${filtered.length}`);
}
totalTests++;

// Test 4: buildCombinations
console.log("\n4. Testing buildCombinations:");
const simpleLines = [
  { betKey: "key1", odds: 1.85, value: 10 },
  { betKey: "key2", odds: 1.90, value: 12 },
  { betKey: "key3", odds: 2.00, value: 15 },
];

const combos = buildCombinations(simpleLines, { minCombos: 2, maxCombos: 2 });
// Should generate 3 combos of size 2: (1,2), (1,3), (2,3)
const expectedCombos = 3;

if (combos.length === expectedCombos) {
  console.log(`✅ buildCombinations generates correct count (${combos.length})`);
  
  // Verify comboId is generated
  const allHaveComboId = combos.every(c => c.comboId && c.comboId.includes('@@'));
  if (allHaveComboId) {
    console.log("✅ All combos have valid comboId with '@@' separator");
    passedTests++;
  } else {
    console.error("❌ Some combos missing comboId");
  }
} else {
  console.error(`❌ buildCombinations expected ${expectedCombos}, got ${combos.length}`);
}
totalTests++;

// Test 5: assignComboNumbers
console.log("\n5. Testing assignComboNumbers:");
const unsortedCombos = [
  { comboId: "c1", avgEv: 10, totalOdds: 3.5 },
  { comboId: "c2", avgEv: 15, totalOdds: 4.0 },
  { comboId: "c3", avgEv: 12, totalOdds: 3.0 },
];

const sorted = assignComboNumbers(unsortedCombos, 'avgEv', 'desc');
const numbersCorrect = sorted[0].comboNumber === 1 && sorted[0].avgEv === 15;

if (numbersCorrect) {
  console.log("✅ assignComboNumbers sorts and assigns numbers correctly");
  console.log(`   Top combo: #${sorted[0].comboNumber} with avgEv ${sorted[0].avgEv}`);
  passedTests++;
} else {
  console.error("❌ assignComboNumbers sorting failed");
}
totalTests++;

// Test 6: generateCombos (full pipeline)
console.log("\n6. Testing generateCombos (full pipeline):");
const allLines = [
  { betKey: "key1", priority: 1, odds: 1.85, value: 10 },
  { betKey: "key2", priority: 1, odds: 1.90, value: 12 },
  { betKey: "key3", priority: 1, odds: 2.00, value: 15 },
  { betKey: "key4", priority: 2, odds: 1.50, value: 5 },
];

const result = generateCombos(
  allLines,
  { minPriority: 1, minOdds: 1.8, minEv: 9 },
  { minCombos: 2, maxCombos: 2 }
);

if (result.combos && result.stats && result.filtered) {
  console.log(`✅ generateCombos returns complete result`);
  console.log(`   Filtered: ${result.filtered.length}, Combos: ${result.combos.length}`);
  console.log(`   Stats: avgComboEv=${result.stats.avgComboEv.toFixed(1)}`);
  passedTests++;
} else {
  console.error("❌ generateCombos missing expected fields");
}
totalTests++;

// Test 7: Verify comboId format matches buildComboId
console.log("\n7. Testing comboId generation consistency:");
const betKeys = ["key1", "key2", "key3"];
const manualComboId = buildComboId(betKeys);

const testCombo = buildCombinations([
  { betKey: "key1", odds: 1.85, value: 10 },
  { betKey: "key2", odds: 1.90, value: 12 },
  { betKey: "key3", odds: 2.00, value: 15 },
], { minCombos: 3, maxCombos: 3 });

if (testCombo.length > 0) {
  const generatedComboId = testCombo[0].comboId;
  if (generatedComboId === manualComboId) {
    console.log("✅ comboId format matches buildComboId");
    console.log(`   ${generatedComboId}`);
    passedTests++;
  } else {
    console.error("❌ comboId format mismatch");
    console.error(`   Expected: ${manualComboId}`);
    console.error(`   Got:      ${generatedComboId}`);
  }
} else {
  console.error("❌ No combo generated for comboId test");
}
totalTests++;

// ===== SUMMARY =====
console.log("\n" + "=".repeat(50));
console.log(`\n🎯 OVERALL: ${passedTests}/${totalTests} tests passed\n`);

if (passedTests === totalTests) {
  console.log("✅ ALL PHASE 3 ENGINE TESTS PASSED!\n");
  console.log("Phase 3 engines are ready for use.\n");
  process.exit(0);
} else {
  console.error(`❌ ${totalTests - passedTests} tests failed.\n`);
  process.exit(1);
}
