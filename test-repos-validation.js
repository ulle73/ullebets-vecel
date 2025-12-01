/**
 * Validation tests for Phase 2 repositories
 * Tests fixtures.js, unibet.js, and snapshots.js
 */

// Test fixtures repo
import { getMatchesForDate, getMatchById, getMatchesByIds } from './lib/repos/fixtures.js';
// Test unibet repo
import { buildEventOddsUrl, buildListViewUrl } from './lib/repos/unibet.js';
// Test snapshots repo
import { writeSnapshot, readSnapshots, readLatestSnapshot } from './lib/repos/snapshots.js';

console.log("\n🧪 Testing Phase 2 Repositories...\n");

let totalTests = 0;
let passedTests = 0;

// ===== FIXTURES REPO TESTS =====
console.log("📁 Testing fixtures.js repo:");

// Test 1: URL builder functions
console.log("\n1. Testing getMatchesForDate (basic smoke test):");
try {
  const matches = await getMatchesForDate("2024-11-28");
  if (Array.isArray(matches)) {
    console.log(`✅ getMatchesForDate returns array (${matches.length} matches)`);
    passedTests++;
  } else {
    console.error("❌ getMatchesForDate did not return an array");
  }
  totalTests++;
} catch (error) {
  console.error(`❌ getMatchesForDate error: ${error.message}`);
  totalTests++;
}

// Test 2: getMatchById with null should return null
console.log("\n2. Testing getMatchById with invalid ID:");
try {
  const result = await getMatchById(null);
  if (result === null) {
    console.log("✅ getMatchById(null) returns null");
    passedTests++;
  } else {
    console.error("❌ getMatchById(null) should return null");
  }
  totalTests++;
} catch (error) {
  console.error(`❌ getMatchById error: ${error.message}`);
  totalTests++;
}

// Test 3: getMatchesByIds with empty array
console.log("\n3. Testing getMatchesByIds with empty array:");
try {
  const results = await getMatchesByIds([]);
  if (Array.isArray(results) && results.length === 0) {
    console.log("✅ getMatchesByIds([]) returns empty array");
    passedTests++;
  } else {
    console.error("❌ getMatchesByIds([]) should return empty array");
  }
  totalTests++;
} catch (error) {
  console.error(`❌ getMatchesByIds error: ${error.message}`);
  totalTests++;
}

// ===== UNIBET REPO TESTS =====
console.log("\n📡 Testing unibet.js repo:");

// Test 4: buildEventOddsUrl generates correct format
console.log("\n4. Testing buildEventOddsUrl:");
try {
  const url = buildEventOddsUrl(1234567);
  const expectedParts = [
    "kambicdn.com",
    "1234567.json",
    "lang=sv_SE",
    "market=SE",
    "client_id=2",
    "channel_id=3",
    "includeParticipants=true"
  ];
  
  const allPartsPresent = expectedParts.every(part => url.includes(part));
  
  if (allPartsPresent) {
    console.log(`✅ buildEventOddsUrl generates correct URL`);
    console.log(`   Sample: ${url.substring(0, 80)}...`);
    passedTests++;
  } else {
    console.error(`❌ buildEventOddsUrl missing expected parts`);
    console.error(`   URL: ${url}`);
  }
  totalTests++;
} catch (error) {
  console.error(`❌ buildEventOddsUrl error: ${error.message}`);
  totalTests++;
}

// Test 5: buildListViewUrl generates correct format
console.log("\n5. Testing buildListViewUrl:");
try {
  const baseUrl = "https://www.unibet.se/betting/sports/filter/football/england/premier_league/all/matches";
  const url = buildListViewUrl(baseUrl);
  
  const expectedParams = [
    "lang=sv_SE",
    "market=SE",
    "client_id=2",
    "channel_id=1",
    "useCombined=true"
  ];
  
  const allParamsPresent = expectedParams.every(param => url.includes(param));
  
  if (allParamsPresent) {
    console.log(`✅ buildListViewUrl generates correct URL`);
    passedTests++;
  } else {
    console.error(`❌ buildListViewUrl missing expected parameters`);
  }
  totalTests++;
} catch (error) {
  console.error(`❌ buildListViewUrl error: ${error.message}`);
  totalTests++;
}

// ===== SNAPSHOTS REPO TESTS =====
console.log("\n💾 Testing snapshots.js repo:");

// Test 6: writeSnapshot validates required fields
console.log("\n6. Testing writeSnapshot validation:");
let validationTests = 0;
let validationPassed = 0;

try {
  await writeSnapshot({});
  console.error("❌ writeSnapshot should throw without ID");
} catch (error) {
  if (error.message.includes("ID is required")) {
    console.log("✅ writeSnapshot validates ID requirement");
    validationPassed++;
  }
  validationTests++;
}

try {
  await writeSnapshot({ id: "test" });
  console.error("❌ writeSnapshot should throw without type");
} catch (error) {
  if (error.message.includes("type is required")) {
    console.log("✅ writeSnapshot validates type requirement");
    validationPassed++;
  }
  validationTests++;
}

try {
  await writeSnapshot({ id: "test", type: "backtest" });
  console.error("❌ writeSnapshot should throw without date");
} catch (error) {
  if (error.message.includes("date is required")) {
    console.log("✅ writeSnapshot validates date requirement");
    validationPassed++;
  }
  validationTests++;
}

try {
  await writeSnapshot({ id: "test", type: "backtest", date: "2024-11-28" });
  console.error("❌ writeSnapshot should throw without lines");
} catch (error) {
  if (error.message.includes("Lines must be an array")) {
    console.log("✅ writeSnapshot validates lines requirement");
    validationPassed++;
  }
  validationTests++;
}

if (validationPassed === validationTests) {
  passedTests++;
}
totalTests++;

// Test 7: readSnapshots with invalid params returns empty array
console.log("\n7. Testing readSnapshots with invalid params:");
try {
  const result = await readSnapshots(null, null);
  if (Array.isArray(result) && result.length === 0) {
    console.log("✅ readSnapshots(null, null) returns empty array");
    passedTests++;
  } else {
    console.error("❌ readSnapshots should return empty array for invalid params");
  }
  totalTests++;
} catch (error) {
  console.error(`❌ readSnapshots error: ${error.message}`);
  totalTests++;
}

// Test 8: readLatestSnapshot with invalid params returns null
console.log("\n8. Testing readLatestSnapshot with invalid ID:");
try {
  const result = await readLatestSnapshot("unibet-backtest", "nonexistent-id-12345");
  if (result === null) {
    console.log("✅ readLatestSnapshot returns null for nonexistent ID");
    passedTests++;
  } else {
    console.error("❌ readLatestSnapshot should return null for invalid ID");
  }
  totalTests++;
} catch (error) {
  console.error(`❌ readLatestSnapshot error: ${error.message}`);
  totalTests++;
}

// ===== SUMMARY =====
console.log("\n" + "=".repeat(50));
console.log(`\n🎯 OVERALL: ${passedTests}/${totalTests} tests passed\n`);

if (passedTests === totalTests) {
  console.log("✅ ALL PHASE 2 REPO TESTS PASSED!\n");
  console.log("Phase 2 repositories are ready for use.\n");
  process.exit(0);
} else {
  console.error(`❌ ${totalTests - passedTests} tests failed.\n`);
  process.exit(1);
}
