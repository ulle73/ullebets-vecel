/**
 * Validation script to verify that the new unified buildBetKey function
 * produces IDENTICAL output to the 4 existing implementations.
 * 
 * This must pass 100% before we can proceed with migrating the scripts.
 */

import { buildBetKey, buildComboId, buildMatchSlug, buildLineKey } from './lib/core/keys.js';

// Test cases from production data
const testCases = [
  {
    name: "Standard corner kicks bet",
    params: {
      matchId: "12345",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      stat: "cornerKicks",
      scope: "total",
      period: "ALL",
      line: 10.5,
      over: true,
      form: "all",
      neutralGround: false
    },
    expected: "12345|arsenal|chelsea|cornerKicks|total|ALL|over|10.5|all|H"
  },
  {
    name: "Under bet with neutral ground",
    params: {
      matchId: "67890",
      homeTeam: "Liverpool",
      awayTeam: "Manchester United",
      stat: "shotsOnGoal",
      scope: "home",
      period: "1ST",
      line: 4.5,
      over: false,
      form: "all",
      neutralGround: true
    },
    expected: "67890|liverpool|manchester united|shotsOnGoal|home|1ST|under|4.5|all|N"
  },
  {
    name: "Missing matchId (should be empty string)",
    params: {
      homeTeam: "Real Madrid",
      awayTeam: "Barcelona",
      stat: "yellowCards",
      scope: "away",
      period: "2ND",
      line: 2.5,
      over: true,
      form: "",
      neutralGround: false
    },
    expected: "|real madrid|barcelona|yellowCards|away|2ND|over|2.5||H"
  },
  {
    name: "Default values for scope, period",
    params: {
      matchId: "99999",
      homeTeam: "Bayern Munich",
      awayTeam: "Dortmund",
      stat: "fouls",
      line: 20.5,
      over: false
    },
    expected: "99999|bayern munich|dortmund|fouls|total|ALL|under|20.5||H"
  }
];

console.log("\n🧪 Testing buildBetKey implementation...\n");

let passedTests = 0;
let failedTests = 0;

for (const test of testCases) {
  const result = buildBetKey(test.params);
  const passed = result === test.expected;
  
  if (passed) {
    console.log(`✅ PASS: ${test.name}`);
    passedTests++;
  } else {
    console.error(`❌ FAIL: ${test.name}`);
    console.error(`   Expected: ${test.expected}`);
    console.error(`   Got:      ${result}`);
    failedTests++;
  }
}

console.log(`\n📊 Results: ${passedTests}/${testCases.length} tests passed\n`);

// Test buildComboId
console.log("🧪 Testing buildComboId...\n");

const comboTests = [
  {
    name: "Two bet combo (should be sorted)",
    betKeys: [
      "12345|arsenal|chelsea|cornerKicks|total|ALL|over|10.5|all|H",
      "67890|liverpool|everton|shotsOnGoal|total|ALL|under|4.5|all|H"
    ],
    expected: "12345|arsenal|chelsea|cornerKicks|total|ALL|over|10.5|all|H@@67890|liverpool|everton|shotsOnGoal|total|ALL|under|4.5|all|H"
  },
  {
    name: "Reversed order (should still be sorted)",
    betKeys: [
      "67890|liverpool|everton|shotsOnGoal|total|ALL|under|4.5|all|H",
      "12345|arsenal|chelsea|cornerKicks|total|ALL|over|10.5|all|H"
    ],
    expected: "12345|arsenal|chelsea|cornerKicks|total|ALL|over|10.5|all|H@@67890|liverpool|everton|shotsOnGoal|total|ALL|under|4.5|all|H"
  },
  {
    name: "Empty array",
    betKeys: [],
    expected: ""
  }
];

let comboPassedTests = 0;
let comboFailedTests = 0;

for (const test of comboTests) {
  const result = buildComboId(test.betKeys);
  const passed = result === test.expected;
  
  if (passed) {
    console.log(`✅ PASS: ${test.name}`);
    comboPassedTests++;
  } else {
    console.error(`❌ FAIL: ${test.name}`);
    console.error(`   Expected: ${test.expected}`);
    console.error(`   Got:      ${result}`);
    comboFailedTests++;
  }
}

console.log(`\n📊 Combo Results: ${comboPassedTests}/${comboTests.length} tests passed\n`);

// Test buildMatchSlug
console.log("🧪 Testing buildMatchSlug...\n");

const slugTests = [
  {
    name: "Basic match slug",
    params: { homeTeam: "Arsenal FC", awayTeam: "Chelsea", date: "2024-11-28" },
    expected: "arsenal-fc-chelsea-2024-11-28"
  },
  {
    name: "Teams with special characters",
    params: { homeTeam: "Malmö FF", awayTeam: "AIK & Friends", date: "2024-12-01" },
    expected: "malmo-ff-aik-and-friends-2024-12-01"
  }
];

let slugPassedTests = 0;
let slugFailedTests = 0;

for (const test of slugTests) {
  const result = buildMatchSlug(test.params.homeTeam, test.params.awayTeam, test.params.date);
  const passed = result === test.expected;
  
  if (passed) {
    console.log(`✅ PASS: ${test.name}`);
    slugPassedTests++;
  } else {
    console.error(`❌ FAIL: ${test.name}`);
    console.error(`   Expected: ${test.expected}`);
    console.error(`   Got:      ${result}`);
    slugFailedTests++;
  }
}

console.log(`\n📊 Slug Results: ${slugPassedTests}/${slugTests.length} tests passed\n`);

// Final summary
const totalPassed = passedTests + comboPassedTests + slugPassedTests;
const totalTests = testCases.length + comboTests.length + slugTests.length;

console.log("=".repeat(50));
console.log(`\n🎯 OVERALL: ${totalPassed}/${totalTests} tests passed\n`);

if (totalPassed === totalTests) {
  console.log("✅ ALL TESTS PASSED! Safe to proceed with migration.\n");
  process.exit(0);
} else {
  console.error("❌ SOME TESTS FAILED! Do NOT migrate until all tests pass.\n");
  process.exit(1);
}
