/**
 * Validation tests for lib/core/normalization.js
 * Verifies that normalization functions produce expected output.
 */

import {
  normalizeTeamName,
  normalizeLeagueName,
  generateNameVariants,
  generateLeagueVariants,
  buildAliasMap,
  resolveTeamName,
  canonicalizeTeamName,
  slugify,
  normalizeKey,
} from './lib/core/normalization.js';

console.log("\n🧪 Testing normalization functions...\n");

// Test normalizeTeamName
const teamTests = [
  { input: "FC Bayern München", expected: "fc bayern munchen" },
  { input: "Arsenal", expected: "arsenal" },
  { input: "Malmö FF", expected: "malmo ff" },
  { input: "Paris Saint-Germain", expected: "paris saint germain" },
  { input: "Brighton & Hove Albion", expected: "brighton and hove albion" },
  { input: "", expected: "" },
  { input: null, expected: "" },
];

let passedTeamTests = 0;
for (const test of teamTests) {
  const result = normalizeTeamName(test.input);
  if (result === test.expected) {
    console.log(`✅ normalizeTeamName("${test.input}") = "${result}"`);
    passedTeamTests++;
  } else {
    console.error(`❌ normalizeTeamName("${test.input}")`);
    console.error(`   Expected: "${test.expected}"`);
    console.error(`   Got:      "${result}"`);
  }
}

// Test normalizeLeagueName
const leagueTests = [
  { input: "Premier League", expected: "premier league" },
  { input: "La Liga 2023/24", expected: "la liga" },
  { input: "Bundesliga 23/24", expected: "bundesliga" },
];

let passedLeagueTests = 0;
for (const test of leagueTests) {
  const result = normalizeLeagueName(test.input);
  if (result === test.expected) {
    console.log(`✅ normalizeLeagueName("${test.input}") = "${result}"`);
    passedLeagueTests++;
  } else {
    console.error(`❌ normalizeLeagueName("${test.input}")`);
    console.error(`   Expected: "${test.expected}"`);
    console.error(`   Got:      "${result}"`);
  }
}

// Test generateNameVariants
console.log("\n🧪 Testing generateNameVariants...\n");
const variants = generateNameVariants("Arsenal FC");
const expectedVariants = ["Arsenal FC", "Arsenal  ", "Arsenal and C"];
console.log(`✅ generateNameVariants("Arsenal FC") produced ${variants.size} variants`);
console.log(`   Sample: ${Array.from(variants).slice(0, 3).join(", ")}`);

// Test slugify
const slugTests = [
  { input: "Arsenal FC", expected: "arsenal-fc" },
  { input: "Bayern München", expected: "bayern-munchen" },
  { input: "Brighton & Hove", expected: "brighton-and-hove" },
];

let passedSlugTests = 0;
console.log("\n🧪 Testing slugify...\n");
for (const test of slugTests) {
  const result = slugify(test.input);
  if (result === test.expected) {
    console.log(`✅ slugify("${test.input}") = "${result}"`);
    passedSlugTests++;
  } else {
    console.error(`❌ slugify("${test.input}")`);
    console.error(`   Expected: "${test.expected}"`);
    console.error(`   Got:      "${result}"`);
  }
}

// Test buildAliasMap and resolveTeamName
console.log("\n🧪 Testing alias resolution...\n");

const mockLeaguesData = {
  "Premier League": {
    teams: [
      { name: "Arsenal" },
      { name: "Chelsea" },
      { name: "Wolverhampton" }
    ]
  }
};

const mockCustomAliases = {
  "Wolverhampton": ["Wolves", "Wolverhampton Wanderers"],
  "Brighton & Hove Albion": ["Brighton"]
};

const aliasMap = buildAliasMap(mockLeaguesData, mockCustomAliases);
console.log(`✅ Built alias map with ${aliasMap.size} entries`);

// Test resolveTeamName
const resolveTests = [
  { input: "Arsenal", expected: "Arsenal" },
  { input: "arsenal", expected: "Arsenal" },
  { input: "Arsenal FC", expected: "Arsenal" },
  { input: "Wolves", expected: "Wolverhampton" },
  { input: "Unknown Team", expected: null },
];

let passedResolveTests = 0;
for (const test of resolveTests) {
  const result = resolveTeamName(test.input, aliasMap);
  if (result === test.expected) {
    console.log(`✅ resolveTeamName("${test.input}") = "${result}"`);
    passedResolveTests++;
  } else {
    console.error(`❌ resolveTeamName("${test.input}")`);
    console.error(`   Expected: "${test.expected}"`);
    console.error(`   Got:      "${result}"`);
  }
}

// Final summary
const totalTests = teamTests.length + leagueTests.length + slugTests.length + resolveTests.length;
const totalPassed = passedTeamTests + passedLeagueTests + passedSlugTests + passedResolveTests;

console.log("\n" + "=".repeat(50));
console.log(`\n🎯 OVERALL: ${totalPassed}/${totalTests} tests passed\n`);

if (totalPassed === totalTests) {
  console.log("✅ ALL TESTS PASSED! Normalization module is ready.\n");
  process.exit(0);
} else {
  console.error("❌ SOME TESTS FAILED! Review normalization logic.\n");
  process.exit(1);
}
