// // scripts/fetch-and-import-fixtures.js
// // Hämtar fixtures för ett datum → sparar JSON → importerar direkt till Mongo (collection: "match-for-date")

// import fs from "fs/promises";
// import { existsSync } from "fs";
// import path from "path";
// import puppeteer from "puppeteer";
// import { fileURLToPath } from "url";
// import { clientPromise } from "../lib/db.js";
// import { fetchScheduledMatches } from "../rapidApi/scheduled-matches.js";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// // ---------- helpers ----------
// const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// const ymdUTC = (d) => {
//   const y = d.getUTCFullYear();
//   const m = String(d.getUTCMonth() + 1).padStart(2, "0");
//   const day = String(d.getUTCDate()).padStart(2, "0");
//   return `${y}-${m}-${day}`;
// };

// const parseYmdStrict = (s) => {
//   if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
//   const [y, m, d] = s.split("-").map(Number);
//   const dt = new Date(Date.UTC(y, m - 1, d));
//   return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d ? dt : null;
// };

// const toNumber = (v) => {
//   const n = Number(v);
//   return Number.isFinite(n) ? n : null;
// };

// function buildCategoryPlan(leaguesJson) {
//   // Map<categoryId, Set<leagueId>>
//   const map = new Map();
//   for (const [, info] of Object.entries(leaguesJson || {})) {
//     const catId = toNumber(info?.categoryId);
//     const leagueId = toNumber(info?.leagueId) ?? toNumber(info?.uniqueTournamentId);
//     if (catId === null || leagueId === null) continue;
//     if (!map.has(catId)) map.set(catId, new Set());
//     map.get(catId).add(leagueId);
//   }
//   return Array.from(map.entries()).sort((a, b) => a[0] - b[0]); // [[categoryId, Set(leagueIds)]...]
// }

// function extractEventLeagueId(e) {
//   // Samma defensiva logik som i dina rapidApi-filer
//   const cands = [
//     e?.tournament?.uniqueTournament?.id,
//     e?.uniqueTournament?.id,
//     e?.tournament?.id,
//     e?.event?.tournament?.uniqueTournament?.id,
//     e?.event?.tournament?.id,
//   ];
//   for (const c of cands) {
//     const n = toNumber(c);
//     if (n !== null) return n;
//   }
//   return null;
// }

// function formatSourceWithKey(source, apiKey) {
//   return apiKey ? `${source} [${apiKey.slice(0, 6)}…]` : source;
// }

// // ---------- main ----------
// async function main() {
//   const args = process.argv.slice(2);
//   const dateArg = args[0]; // "YYYY-MM-DD" (valfritt)
//   const targetDate = dateArg ? parseYmdStrict(dateArg) : new Date(); // default: idag (UTC)
//   if (!targetDate) {
//     console.error("❌ Ogiltigt datum. Använd YYYY-MM-DD.");
//     process.exit(1);
//   }
//   const dateStr = ymdUTC(targetDate);

//   // Läs ligor/lag (från projektroten – exakt som du önskade)
//   const leaguesPath = path.resolve(process.cwd(),"data", "leagues-and-teams.json");
//   if (!existsSync(leaguesPath)) {
//     console.error("❌ Hittar inte leagues-and-teams.json i projektroten.");
//     process.exit(1);
//   }
//   const leagues = JSON.parse(await fs.readFile(leaguesPath, "utf-8"));
//   const categoryPlan = buildCategoryPlan(leagues); // [[categoryId, Set(leagueIds)]...]

//   // RapidAPI keys (samma upplägg)
//   const rapidApiKeys = (process.env.RAPIDAPI_KEYS || process.env.RAPIDAPI_KEY || "")
//     .split(",")
//     .map((s) => s.trim())
//     .filter(Boolean);
//   const rapidApiState = { index: 0, failures: 0 };

//   // Puppeteer för cookies/UA (som i dina scripts)
//   const browser = await puppeteer.launch({ headless: "new" });
//   const page = await browser.newPage();
//   await page.setUserAgent(
//     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
//   );
//   await page.goto("https://www.sofascore.com/", { waitUntil: "domcontentloaded" });
//   await sleep(500);

//   const context = {
//     rapidApiKeys,
//     rapidApiState,
//     page,
//     apiCallStats: {},
//     logger: console,
//   };

//   const aggregatedSources = new Map(); // categoryId -> {source, apiKey}
//   const allMatches = [];
//   let totalCalls = 0;

//   // Samma beslut: om inga kategorier finns i JSON → tillåt global endpoint
//   const includeGlobalEndpoint = categoryPlan.length === 0;

//   if (categoryPlan.length === 0) {
//     console.log(`ℹ️ Hämtar matcher för ${dateStr} med global endpoint (inga kategorier i JSON).`);
//     const scheduled = await fetchScheduledMatches(dateStr, context, {
//       categoryId: 1,
//       includeGlobalEndpoint,
//     });
//     totalCalls += scheduled?.calls || 0;

//     const arr = Array.isArray(scheduled?.matches) ? scheduled.matches : [];
//     console.log(`✅ Global: ${arr.length} matcher (källa: ${formatSourceWithKey(scheduled?.source || "okänd", scheduled?.apiKey || null)})`);

//     const allowedLeagueIds = new Set(
//       Object.values(leagues)
//         .map((x) => toNumber(x?.leagueId) ?? toNumber(x?.uniqueTournamentId))
//         .filter((x) => x !== null)
//     );
//     const filtered = allowedLeagueIds.size
//       ? arr.filter((e) => allowedLeagueIds.has(extractEventLeagueId(e)))
//       : arr;

//     allMatches.push(...filtered);
//     aggregatedSources.set("global", { source: scheduled?.source || null, apiKey: scheduled?.apiKey || null });
//   } else {
//     console.log(`📅 ${dateStr} – kategorier: ${categoryPlan.map(([c]) => c).join(", ")}`);
//     for (const [categoryId, leagueSet] of categoryPlan) {
//       const leagueList = Array.from(leagueSet).join(", ");
//       console.log(`ℹ️ categoryId ${categoryId} (ligor: ${leagueList})`);

//       const scheduled = await fetchScheduledMatches(dateStr, context, {
//         categoryId,
//         includeGlobalEndpoint, // samma policy
//       });
//       totalCalls += scheduled?.calls || 0;

//       const arr = Array.isArray(scheduled?.matches) ? scheduled.matches : [];
//       console.log(
//         `✅  categoryId ${categoryId}: ${arr.length} matcher (källa: ${formatSourceWithKey(
//           scheduled?.source || "okänd",
//           scheduled?.apiKey || null
//         )})`
//       );

//       aggregatedSources.set(categoryId, { source: scheduled?.source || null, apiKey: scheduled?.apiKey || null });

//       const filtered = arr.filter((e) => leagueSet.has(extractEventLeagueId(e)));
//       allMatches.push(...filtered);
//     }
//   }

//   await browser.close();

//   console.log(`🎯 Återstår efter filter: ${allMatches.length} matcher.`);
//   console.log(`📦 Sparar JSON-dump …`);

//   const outDir = path.resolve(process.cwd(), "matches-for-date");
//   await fs.mkdir(outDir, { recursive: true });
//   const outPath = path.join(outDir, `fixtures-${dateStr}.json`);

//   const sources = Array.from(aggregatedSources.entries()).map(([k, v]) => ({
//     categoryId: k,
//     source: v.source,
//     apiKey: v.apiKey,
//   }));

//   const payload = {
//     date: dateStr,
//     savedAt: new Date().toISOString(),
//     calls: totalCalls,
//     sources,
//     matches: allMatches, // exakt "matches"
//   };

//   await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf-8");
//   console.log(`✅ Sparat: ${outPath}`);
//   console.log(`ℹ️ Totala API-anrop: ${totalCalls}`);

//   // ===== AUTOMATISK IMPORT TILL DB =====
//   console.log("🗄  Importerar i databasen …");
//   const DB = process.env.MONGODB_DB || "app";
//   const COL = "match-for-date"; // <-- enligt önskemål
//   const client = await clientPromise;
//   const col = client.db(DB).collection(COL);

//   const doc = {
//     date: payload.date,
//     savedAt: payload.savedAt,
//     calls: payload.calls,
//     sources: payload.sources,
//     matches: Array.isArray(payload.matches) ? payload.matches : [],
//   };

//   await col.updateOne(
//     { _id: String(payload.date) },
//     { $push: { full: { $each: [doc], $position: 0 } } },
//     { upsert: true }
//   );

//   // Hjälp-index
//   await col.createIndex({ _id: 1 });
//   await col.createIndex({ "full.0.date": 1 });
//   await col.createIndex({ "full.0.matches.id": 1 });

//   console.log(`✅ Import klart: ${DB}.${COL} (_id=${payload.date})`);
//   await client.close(true);
// }

// main().catch((e) => {
//   console.error("❌ fetch-and-import-fixtures error:", e);
//   process.exit(1);
// });


// scripts/fetch-and-import-fixtures.js
// Hämtar fixtures för ett datum → sparar JSON → importerar direkt till Mongo (collection: "match-for-date")

import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { clientPromise } from "../lib/db.js";
import { fetchScheduledMatches } from "../rapidApi/scheduled-matches.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ymdUTC = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const parseYmdStrict = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d ? dt : null;
};

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function buildCategoryPlan(leaguesJson) {
  // Map<categoryId, Set<leagueId>>
  const map = new Map();
  for (const [, info] of Object.entries(leaguesJson || {})) {
    const catId = toNumber(info?.categoryId);
    const leagueId = toNumber(info?.leagueId) ?? toNumber(info?.uniqueTournamentId);
    if (catId === null || leagueId === null) continue;
    if (!map.has(catId)) map.set(catId, new Set());
    map.get(catId).add(leagueId);
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]); // [[categoryId, Set(leagueIds)]...]
}

function extractEventLeagueId(e) {
  // Samma defensiva logik som i dina rapidApi-filer
  const cands = [
    e?.tournament?.uniqueTournament?.id,
    e?.uniqueTournament?.id,
    e?.tournament?.id,
    e?.event?.tournament?.uniqueTournament?.id,
    e?.event?.tournament?.id,
  ];
  for (const c of cands) {
    const n = toNumber(c);
    if (n !== null) return n;
  }
  return null;
}

function formatSourceWithKey(source, apiKey) {
  return apiKey ? `${source} [${String(apiKey).slice(0, 6)}…]` : source || "okänd";
}

// summera apiCallStats till { ok, fail } och även per-källa
function sumStats(stats = {}) {
  let ok = 0, fail = 0;
  const perSource = new Map(); // source -> { ok, fail }
  for (const [src, obj] of Object.entries(stats)) {
    const o = Number(obj?.ok || 0);
    const f = Number(obj?.fail || 0);
    ok += o; fail += f;
    perSource.set(src, { ok: o, fail: f });
  }
  return { ok, fail, perSource };
}

function diffStats(prev, next) {
  const ok = Math.max(0, (next.ok || 0) - (prev.ok || 0));
  const fail = Math.max(0, (next.fail || 0) - (prev.fail || 0));
  // grov källa: välj den källa som ökade mest i ok+fail
  let by = "n/a";
  let bestDelta = -1;
  for (const [src, cur] of next.perSource.entries()) {
    const p = prev.perSource.get(src) || { ok: 0, fail: 0 };
    const delta = (cur.ok - p.ok) + (cur.fail - p.fail);
    if (delta > bestDelta) { bestDelta = delta; by = src; }
  }
  return { ok, fail, by };
}

// ---------- main ----------
async function main() {
  const args = process.argv.slice(2);
  const dateArg = args[0]; // "YYYY-MM-DD" (valfritt)
  const targetDate = dateArg ? parseYmdStrict(dateArg) : new Date(); // default: idag (UTC)
  if (!targetDate) {
    console.error("❌ Ogiltigt datum. Använd YYYY-MM-DD.");
    process.exit(1);
  }
  const dateStr = ymdUTC(targetDate);

  // Läs ligor/lag
  const leaguesPath = path.resolve(process.cwd(), "data", "leagues-and-teams.json");
  if (!existsSync(leaguesPath)) {
    console.error("❌ Hittar inte data/leagues-and-teams.json.");
    process.exit(1);
  }
  const leagues = JSON.parse(await fs.readFile(leaguesPath, "utf-8"));
  const categoryPlan = buildCategoryPlan(leagues); // [[categoryId, Set(leagueIds)]...]

  // RapidAPI keys
  const rapidApiKeys = (process.env.RAPIDAPI_KEYS || process.env.RAPIDAPI_KEY || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const rapidApiState = { index: 0, failures: 0 };

  // Puppeteer (cookies/UA)
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
  );
  await page.goto("https://www.sofascore.com/", { waitUntil: "domcontentloaded" });
  await sleep(500);

  const context = {
    rapidApiKeys,
    rapidApiState,
    page,
    apiCallStats: {}, // för att mäta ok/fail per källa
    logger: console,
  };

  const aggregatedSources = new Map(); // categoryId|global -> {source, apiKey}
  const allMatches = [];
  let totalCalls = 0;

  const fetchReports = []; // för detalj-loggning

  // Om inga kategorier finns i JSON → tillåt global endpoint
  const includeGlobalEndpoint = categoryPlan.length === 0;

  const beforeAll = sumStats(context.apiCallStats);

  if (categoryPlan.length === 0) {
    console.log(`ℹ️ Hämtar matcher för ${dateStr} med global endpoint (inga kategorier i JSON).`);

    const prev = sumStats(context.apiCallStats);
    const scheduled = await fetchScheduledMatches(dateStr, context, {
      categoryId: 1,
      includeGlobalEndpoint,
    });
    const next = sumStats(context.apiCallStats);
    const delta = diffStats(prev, next);

    totalCalls += scheduled?.calls || 0;
    const arr = Array.isArray(scheduled?.matches) ? scheduled.matches : [];

    const allowedLeagueIds = new Set(
      Object.values(leagues)
        .map((x) => toNumber(x?.leagueId) ?? toNumber(x?.uniqueTournamentId))
        .filter((x) => x !== null)
    );
    const filtered = allowedLeagueIds.size
      ? arr.filter((e) => allowedLeagueIds.has(extractEventLeagueId(e)))
      : arr;

    allMatches.push(...filtered);
    aggregatedSources.set("global", { source: scheduled?.source || delta.by || "okänd", apiKey: scheduled?.apiKey || null });

    const srcLabel = formatSourceWithKey(scheduled?.source || delta.by, scheduled?.apiKey);
    console.log(`✅ Global: matches=${filtered.length}, calls=${scheduled?.calls ?? 0}, ok=${delta.ok}, fail=${delta.fail}, via=${srcLabel}`);
    fetchReports.push({ label: "global", matches: filtered.length, calls: scheduled?.calls ?? 0, ok: delta.ok, fail: delta.fail, via: srcLabel });
  } else {
    console.log(`📅 ${dateStr} – kategorier: ${categoryPlan.map(([c]) => c).join(", ")}`);
    for (const [categoryId, leagueSet] of categoryPlan) {
      const prev = sumStats(context.apiCallStats);
      const scheduled = await fetchScheduledMatches(dateStr, context, {
        categoryId,
        includeGlobalEndpoint,
      });
      const next = sumStats(context.apiCallStats);
      const delta = diffStats(prev, next);

      totalCalls += scheduled?.calls || 0;
      const arr = Array.isArray(scheduled?.matches) ? scheduled.matches : [];

      const filtered = arr.filter((e) => leagueSet.has(extractEventLeagueId(e)));
      allMatches.push(...filtered);
      aggregatedSources.set(String(categoryId), { source: scheduled?.source || delta.by || "okänd", apiKey: scheduled?.apiKey || null });

      const srcLabel = formatSourceWithKey(scheduled?.source || delta.by, scheduled?.apiKey);
      console.log(
        `✅ categoryId=${categoryId}: matches=${filtered.length}, calls=${scheduled?.calls ?? 0}, ok=${delta.ok}, fail=${delta.fail}, via=${srcLabel}`
      );
      fetchReports.push({ label: `cat:${categoryId}`, matches: filtered.length, calls: scheduled?.calls ?? 0, ok: delta.ok, fail: delta.fail, via: srcLabel });
    }
  }

  await browser.close();

  const afterAll = sumStats(context.apiCallStats);
  const totalOk = afterAll.ok - beforeAll.ok;
  const totalFail = afterAll.fail - beforeAll.fail;

  console.log("—".repeat(72));
  console.log(`🎯 Totalt efter filter: ${allMatches.length} matcher.`);
  console.log(`📦 Sparar JSON …`);

  const outDir = path.resolve(process.cwd(), "matches-for-date");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `fixtures-${dateStr}.json`);

  const sources = Array.from(aggregatedSources.entries()).map(([k, v]) => ({
    categoryId: k,
    source: v.source,
    apiKey: v.apiKey,
  }));

  const payload = {
    date: dateStr,
    savedAt: new Date().toISOString(),
    calls: totalCalls,
    successes: totalOk,
    failures: totalFail,
    sources,
    matches: allMatches, // exakt "matches"
  };

  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`✅ Sparat: ${outPath}`);
  console.log("—".repeat(72));
  console.log("📊 Sammanfattning per fetch:");
  for (const r of fetchReports) {
    console.log(
      `  • ${r.label.padEnd(10)} matches=${String(r.matches).padStart(4)}  calls=${String(r.calls).padStart(3)}  ok=${String(r.ok).padStart(3)}  fail=${String(r.fail).padStart(3)}  via=${r.via}`
    );
  }
  console.log("—".repeat(72));
  console.log(`Σ calls=${totalCalls}  ok=${totalOk}  fail=${totalFail}`);

  // ===== AUTOMATISK IMPORT TILL DB =====
  console.log("🗄  Importerar i databasen …");
  const DB = process.env.MONGODB_DB || "app";
  const COL = "match-for-date"; // önskat namn
  const client = await clientPromise;
  const col = client.db(DB).collection(COL);

  const doc = {
    date: payload.date,
    savedAt: payload.savedAt,
    calls: payload.calls,
    successes: payload.successes,
    failures: payload.failures,
    sources: payload.sources,
    matches: Array.isArray(payload.matches) ? payload.matches : [],
  };

  await col.updateOne(
    { _id: String(payload.date) },
    { $push: { full: { $each: [doc], $position: 0 } } },
    { upsert: true }
  );

  // Hjälp-index
  await col.createIndex({ _id: 1 });
  await col.createIndex({ "full.0.date": 1 });
  await col.createIndex({ "full.0.matches.id": 1 });

  console.log(`✅ Import klart: ${DB}.${COL} (_id=${payload.date})`);
  await client.close(true);
}

main().catch((e) => {
  console.error("❌ fetch-and-import-fixtures error:", e);
  process.exit(1);
});