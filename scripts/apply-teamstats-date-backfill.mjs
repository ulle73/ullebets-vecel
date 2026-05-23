import fs from "fs";

const filePath = "scripts/update-teams-v2.js";
let source = fs.readFileSync(filePath, "utf8");

const replaceOnce = (needle, replacement, label) => {
  const count = source.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 match, got ${count}`);
  }
  source = source.replace(needle, replacement);
};

replaceOnce(
`// --- NYTT: --backfill som ren boolean-flagga (utan siffra) ---
const backfill = optionArgs.includes("--backfill");
`,
`// --- NYTT: --backfill som ren boolean-flagga (utan siffra) ---
const backfill = optionArgs.includes("--backfill");

const readOptionValue = (name) => {
  const prefix = `${name}=`;
  const match = optionArgs.find((arg) => arg.startsWith(prefix));
  if (!match) return null;
  const value = match.slice(prefix.length).trim();
  return value || null;
};

// Tvingat datumspann for yesterday-laget, t.ex.
// node scripts/update-teams-v2.js --yesterday --from-date=2026-04-22 --to-date=2026-05-22
const forcedFromDateInput = readOptionValue("--from-date");
const forcedToDateInput = readOptionValue("--to-date");
`,
  "add forced date CLI options"
);

replaceOnce(
`    const yesterdayDate = addDaysUTC(startOfTodayUTC, -1);

    if (effectiveLastRunDate && effectiveLastRunDate >= startOfTodayUTC) {
      console.log("✅ Inget att göra. Senaste körningen var redan idag.");
      await writeLastRunInfo({
        runDate: runDateStr,
        processedDates: [],
        previousHistory: history,
      });
      if (dbClient) {
        await writeLastRunToDb(dbClient, runDateStr);
      }
      return;
    }

    const startDate = effectiveLastRunDate ?? yesterdayDate;
    const endDate = yesterdayDate;

    if (startDate > endDate) {
`,
`    const yesterdayDate = addDaysUTC(startOfTodayUTC, -1);

    const forcedStartDate = forcedFromDateInput
      ? parseYmdStrict(forcedFromDateInput)
      : null;
    const forcedEndDate = forcedToDateInput
      ? parseYmdStrict(forcedToDateInput)
      : null;
    const hasForcedDateRange = Boolean(forcedFromDateInput || forcedToDateInput);

    if (forcedFromDateInput && !forcedStartDate) {
      console.error(`❌ Ogiltigt --from-date: ${forcedFromDateInput}`);
      return;
    }

    if (forcedToDateInput && !forcedEndDate) {
      console.error(`❌ Ogiltigt --to-date: ${forcedToDateInput}`);
      return;
    }

    if (
      !hasForcedDateRange &&
      effectiveLastRunDate &&
      effectiveLastRunDate >= startOfTodayUTC
    ) {
      console.log("✅ Inget att göra. Senaste körningen var redan idag.");
      await writeLastRunInfo({
        runDate: runDateStr,
        processedDates: [],
        previousHistory: history,
      });
      if (dbClient) {
        await writeLastRunToDb(dbClient, runDateStr);
      }
      return;
    }

    const startDate = forcedStartDate ?? effectiveLastRunDate ?? yesterdayDate;
    const endDate = forcedEndDate ?? yesterdayDate;

    if (hasForcedDateRange) {
      console.log(
        `🔁 Tvingat datumspann: ${ymdUTC(startDate)} → ${ymdUTC(endDate)}.`
      );
    }

    if (startDate > endDate) {
`,
  "add forced date range logic"
);

fs.writeFileSync(filePath, source, "utf8");
console.log(`Patched ${filePath}`);
