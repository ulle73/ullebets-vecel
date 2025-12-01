/**
 * Validation tests for enhanced lib/utils/date.js
 */

import {
  coerceDate,
  formatDateInZone,
  isSameDay,
  ymdUTC,
  addDaysUTC,
  parseYmdStrict,
  todaySE,
  tomorrowSE,
} from './lib/utils/date.js';

console.log("\n🧪 Testing date utility functions...\n");

// Test coerceDate
const coerceTests = [
  { name: "Date object", input: new Date("2024-11-28T10:30:00Z"), shouldBeValid: true },
  { name: "Timestamp (ms)", input: 1701170400000, shouldBeValid: true },
  { name: "Timestamp (seconds)", input: 1701170400, shouldBeValid: true },
  { name: "ISO string", input: "2024-11-28T10:30:00Z", shouldBeValid: true },
  { name: "Numeric string (ms)", input: "1701170400000", shouldBeValid: true },
  { name: "Empty string", input: "", shouldBeValid: false },
  { name: "Null", input: null, shouldBeValid: false },
];

let passedCoerce = 0;
console.log("Testing coerceDate:");
for (const test of coerceTests) {
  const result = coerceDate(test.input);
  const isValid = result instanceof Date && !isNaN(result.getTime());
  
  if (isValid === test.shouldBeValid) {
    console.log(`✅ coerceDate(${test.name}): ${isValid ? 'Valid Date' : 'null'}`);
    passedCoerce++;
  } else {
    console.error(`❌ coerceDate(${test.name})`);
    console.error(`   Expected: ${test.shouldBeValid ? 'Valid' : 'null'}`);
    console.error(`   Got: ${result}`);
  }
}

// Test formatDateInZone
console.log("\n Testing formatDateInZone:");
const date1 = new Date("2024-11-28T23:00:00Z"); // 00:00 next day in Stockholm (UTC+1)
const formatted1 = formatDateInZone(date1, "Europe/Stockholm");
const formatted2 = formatDateInZone(date1, "UTC");

console.log(`✅ formatDateInZone in Stockholm: ${formatted1}`);
console.log(`✅ formatDateInZone in UTC: ${formatted2}`);

const formatMatches = formatted1 === "2024-11-29" && formatted2 === "2024-11-28";
const passedFormat = formatMatches ? 2 : 0;

if (formatMatches) {
  console.log("✅ Timezone handling correct");
} else {
  console.error("❌ Timezone handling failed");
}

// Test isSameDay
console.log("\nTesting isSameDay:");
const sameDay1 = new Date("2024-11-28T00:00:00Z");
const sameDay2 = new Date("2024-11-28T23:00:00Z");
const diffDay = new Date("2024-11-29T00:00:00Z");

const test1 = isSameDay(sameDay1, sameDay2, "UTC");
const test2 = !isSameDay(sameDay1, diffDay, "UTC");

let passedSameDay = 0;
if (test1) {
  console.log("✅ isSameDay: Same day in UTC - PASS");
  passedSameDay++;
} else {
  console.error("❌ isSameDay: Same day in UTC - FAIL");
}

if (test2) {
  console.log("✅ isSameDay: Different days - PASS");
  passedSameDay++;
} else {
  console.error("❌ isSameDay: Different days - FAIL");
}

// Test ymdUTC
console.log("\nTesting ymdUTC:");
const dateUTC = new Date("2024-11-28T10:30:00Z");
const ymd = ymdUTC(dateUTC);
const passedYMD = ymd === "2024-11-28" ? 1 : 0;

if (ymd === "2024-11-28") {
  console.log(`✅ ymdUTC: ${ymd}`);
} else {
  console.error(`❌ ymdUTC: Expected "2024-11-28", got "${ymd}"`);
}

// Test addDaysUTC
console.log("\nTesting addDaysUTC:");
const baseDate = new Date("2024-11-28T00:00:00Z");
const plus1 = addDaysUTC(baseDate, 1);
const minus1 = addDaysUTC(baseDate, -1);

const plus1Result = ymdUTC(plus1);
const minus1Result = ymdUTC(minus1);

let passedAddDays = 0;
if (plus1Result === "2024-11-29") {
  console.log(`✅ addDaysUTC(+1): ${plus1Result}`);
  passedAddDays++;
} else {
  console.error(`❌ addDaysUTC(+1): Expected "2024-11-29", got "${plus1Result}"`);
}

if (minus1Result === "2024-11-27") {
  console.log(`✅ addDaysUTC(-1): ${minus1Result}`);
  passedAddDays++;
} else {
  console.error(`❌ addDaysUTC(-1): Expected "2024-11-27", got "${minus1Result}"`);
}

// Test parseYmdStrict
console.log("\nTesting parseYmdStrict:");
const strictTests = [
  { input: "2024-11-28", shouldBeValid: true, expected: "2024-11-28" },
  { input: "2024-02-30", shouldBeValid: false }, // Invalid date
  { input: "2024-11-8", shouldBeValid: false }, // Wrong format
  { input: "2024/11/28", shouldBeValid: false }, // Wrong separator
  { input: "", shouldBeValid: false },
];

let passedStrict = 0;
for (const test of strictTests) {
  const result = parseYmdStrict(test.input);
  const isValid = result !== null;
  
  if (isValid === test.shouldBeValid) {
    if (isValid && test.expected) {
      const resultYmd = ymdUTC(result);
      if (resultYmd === test.expected) {
        console.log(`✅ parseYmdStrict("${test.input}"): ${resultYmd}`);
        passedStrict++;
      } else {
        console.error(`❌ parseYmdStrict("${test.input}"): Expected ${test.expected}, got ${resultYmd}`);
      }
    } else {
      console.log(`✅ parseYmdStrict("${test.input}"): ${isValid ? 'Valid' : 'null'}`);
      passedStrict++;
    }
  } else {
    console.error(`❌ parseYmdStrict("${test.input}")`);
    console.error(`   Expected: ${test.shouldBeValid ? 'Valid' : 'null'}`);
    console.error(`   Got: ${result}`);
  }
}

// Test existing functions still work
console.log("\nTesting existing functions:");
let passedExisting = 0;

try {
  const today = todaySE();
  if (/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    console.log(`✅ todaySE(): ${today}`);
    passedExisting++;
  }
} catch (e) {
  console.error(`❌ todaySE() failed: ${e.message}`);
}

try {
  const tomorrow = tomorrowSE();
  if (/^\d{4}-\d{2}-\d{2}$/.test(tomorrow)) {
    console.log(`✅ tomorrowSE(): ${tomorrow}`);
    passedExisting++;
  }
} catch (e) {
  console.error(`❌ tomorrowSE() failed: ${e.message}`);
}

// Final summary
const totalTests = coerceTests.length + 2 + 2 + 1 + 2 + strictTests.length + 2;
const totalPassed = passedCoerce + passedFormat + passedSameDay + passedYMD + passedAddDays + passedStrict + passedExisting;

console.log("\n" + "=".repeat(50));
console.log(`\n🎯 OVERALL: ${totalPassed}/${totalTests} tests passed\n`);

if (totalPassed === totalTests) {
  console.log("✅ ALL TESTS PASSED! Date utilities are ready.\n");
  process.exit(0);
} else {
  console.error("❌ SOME TESTS FAILED! Review date logic.\n");
  process.exit(1);
}
