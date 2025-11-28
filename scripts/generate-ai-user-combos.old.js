/**
 * AI User Combos - Refactored Engine-Driven Version
 * 
 * Generates AI combo recommendations by:
 * 1. Fetching matchups-score insights (top over/under predictions)
 * 2. Getting Unibet odds for those matches
 * 3. Calculating EV for all bets
 * 4. Building combos from +EV lines
 * 5. Saving to MongoDB
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { DateTime } from "luxon";
import { MongoClient } from "mongodb";

// Core utilities
import { buildBetKey, buildComboId } from "../lib/core/keys.js";

// Engines
import { getMatchesForDateFiltered } from "../lib/engines/fixtures-engine.js";
import { getUnibetOdds ForMatch } from "../lib/engines/unibet-engine.js";
import { calculateEvForBets, clearTeamDataCache } from "../lib/engines/ev-engine.js";
import { filterLines, buildCombinations, assignComboNumbers } from "../lib/engines/combo-engine.js";

// Shared utilities
import { getFormulaConfig } from "../lib/backtest/formulaConfig.js";

// ===== CONFIGURATION =====
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "app";
const RESULTS_COLLECTION = "ai-generated-bets";
const SOURCE = "ai-user";

const FORMULA_DEFINITIONS = {
  multiplier: { valueKey: "evPctWithMultiplier" },
  multifactor: { valueKey: "evPctMultifactor" },
  leagueAvg: { valueKey: "evPctLeagueAvg" },
  base: { valueKey: "evPct" },
  legacy: { valueKey: "legacyEvPct" },
};

const DEFAULT_RESULT_PRIORITY = ["multiplier", "multifactor", "leagueAvg", "base", "legacy"];

// ===== HELPERS =====
function todaySE() {
  return DateTime.now().setZone("Europe/Stockholm").toFormat("yyyy-MM-dd");
}

function normalizeStringId(value) {
  if (value == null) return null;
  return String(value);
}

function buildLineKey(line = {}) {
  const parts = [
    normalizeStringId(line.matchId),
    line.statKey ?? "",
    line.period ?? "ALL",
    line.scope ?? "total",
    line.direction ?? "over",
  ];
  return parts.join("|");
}

function buildLineKeyFromRow(row = {}) {
  const direction = (row.condition ?? row.direction ?? "")
    .toString()
    .toLowerCase()
    .startsWith("u")
    ? "under"
    : "over";
  return buildLineKey({
    matchId: row.matchId,
    statKey: row.statKey ?? row.statLabel,
    period: row.period,
    scope: row.scope,
    direction,
  });
}

function resolvePrimaryEv(result, statKey) {
  if (!result) return { primaryEv: null };
  const config = getFormulaConfig(statKey);
  const displayOrder = Array.isArray(config?.display) ? config.display : [];
  const priority = [...new Set([...displayOrder, ...DEFAULT_RESULT_PRIORITY])];
  
  for (const key of priority) {
    const def = FORMULA_DEFINITIONS[key];
    if (!def) continue;
    const value = result[def.valueKey];
    if (typeof value === "number") {
      return { primaryEv: value };
    }
  }
  return { primaryEv: null };
}

function makeLineId(line) {
  if (!line) return null;
  if (line.betKey) return line.betKey;
  const parts = [line.matchId, line.statKey, line.direction, line.line];
  return parts.filter(Boolean).join(":");
}

// ===== MAIN FLOW =====
async function run() {
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="));
  const dateStr = dateArg ? dateArg.replace("--date=", "") : todaySE();

  console.log(`\n╭──────────────────────────────────────────╮`);
  console.log(`│  AI USER COMBOS (Engine-Driven)         │`);
  console.log(`╰──────────────────────────────────────────╯`);
  console.log(`📅 Date: ${dateStr}`);
  console.log(`🌐 API: ${BASE_URL}\n`);

  // Step 1: Fetch matches
  const matches = await step1FetchMatches(dateStr);
const matchLookup= new Map(matches.map(m => [String(m.matchId), m]));

  // Step 2: Fetch matchups-score (AI insights)
  const matchups = await step2FetchMatchups(dateStr);

  // Step 3: Get Unibet odds for insight matches
  const bets = await step3GetUnibetOdds(dateStr, { matches, matchLookup, matchups });

  // Step 4: Calculate EV and build combos
  await step4CalculateEvAndBuildCombos(dateStr, { matchLookup, matchups, bets });

  // Cleanup
  clearTeamDataCache();
  
  console.log("\n✅ AI combo generation complete!\n");
}

run().catch((err) => {
  console.error("\n❌ Fatal error:", err);
  process.exit(1);
});

// ===== STEP 1: FETCH MATCHES =====
async function step1FetchMatches(dateStr) {
  console.log("📥 Step 1: Fetching matches...");
  
  const allMatches = await getMatchesForDateFiltered(dateStr);
  console.log(`✓ Found ${allMatches.length} matches for ${dateStr}`);
  
  // Normalize match structure
  const normalized = allMatches.map((m, idx) => {
    const id = m.matchId ?? m.id ?? m.raw?.matchId ?? m.raw?.event?.id ?? m.eventId ?? null;
    const home = m.homeTeamName ?? m.homeTeam?.name ?? m.raw?.homeTeamName ?? m.raw?.homeTeam?.name;
    const away = m.awayTeamName ?? m.awayTeam?.name ?? m.raw?.awayTeamName ?? m.raw?.awayTeam?.name;
    const league = m.leagueName ?? m.tournament?.name ?? m.league?.name ?? m.raw?.league?.name;
    const ts = m.matchDate ?? m.timestamp ?? m.startTimestamp ?? m.raw?.event?.start;
    
    if (idx < 5) {
      console.log(`  [${idx}] ${id} - ${home} vs ${away} (${league})`);
    }
    
    return {
      matchId: id ? String(id) : null,
      homeTeamName: home,
      awayTeamName: away,
      leagueName: league,
     matchDate: ts,
    };
  }).filter(m => m.matchId); // Only keep matches with valid ID

  console.log(`✓ Normalized ${normalized.length} matches with valid IDs\n`);
  return normalized;
}

// ===== STEP 2: FETCH MATCHUPS (AI INSIGHTS) =====
async function step2FetchMatchups(dateStr) {
  console.log("🧠 Step 2: Fetching AI insights (matchups-score)...");

  const res = await fetch(
    `${BASE_URL}/api/matchups-score?date=${encodeURIComponent(dateStr)}`
  );
  
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch matchups-score: ${res.status} ${text}`);
  }

  const data = await res.json();
  const overRows = data.topOverRows || data.top50?.over || [];
  const underRows = data.topUnderRows || data.top50?.under || [];
  
  const uniqueMatchIds = new Set([...overRows, ...underRows].map(r => r.matchId));
  
  console.log(`✓ Insights: ${overRows.length} over, ${underRows.length} under`);
  console.log(`✓ Unique matches in insights: ${uniqueMatchIds.size}\n`);

  return { overRows, underRows };
}

// ===== STEP 3: GET UNIBET ODDS =====
async function step3GetUnibetOdds(dateStr, { matches, matchLookup, matchups }) {
  console.log("⚽ Step 3: Getting Unibet odds for insight matches...");

  const allRows = [...(matchups.overRows || []), ...(matchups.underRows || [])];
  const seen = new Set();
  const targetMatches = [];

  // Find unique matches from insights
  for (const row of allRows) {
    const mid = row?.matchId ? String(row.matchId) : null;
    if (!mid || seen.has(mid)) continue;
    
    const match = matchLookup.get(mid);
    if (!match) {
      console.warn(`  ⚠️ Match ${mid} from insights not found in fixtures`);
      continue;
    }
    
    seen.add(mid);
    targetMatches.push(match);
  }

  console.log(`✓ Processing ${targetMatches.length} unique matches\n`);

  const allBets = [];
  let successCount = 0;
  let failureCount = 0;

  for (const match of targetMatches) {
    console.log(`  → ${match.homeTeamName} vs ${match.awayTeamName}`);

    try {
      // Use engine to get odds (follows exact mainpage flow)
      const oddsResult = await getUnibetOddsForMatch({
        homeTeam: match.homeTeamName,
        awayTeam: match.awayTeamName,
        leagueName: match.leagueName,
        timestamp: match.matchDate,
        eventId: match.matchId,
      });

      const { tuples } = oddsResult;
      console.log(`    ✓ Got ${tuples.length} tuples`);
      successCount++;

      // Build bets from tuples (over/under)
      tuples.forEach((tuple) => {
        const { statKey, scope, period, line, odds } = tuple;
        
        if (odds.over && odds.over > 1) {
          allBets.push({
            matchId: match.matchId,
            homeTeam: match.homeTeamName,
            awayTeam: match.awayTeamName,
            over: true,
            line,
            scope,
            stat: statKey,
            period,
            form: "all",
            odds: odds.over,
            neutralGround: false,
            home_importance: 5,
            away_importance: 5,
            leagueName: match.leagueName,
          });
        }
        
        if (odds.under && odds.under > 1) {
          allBets.push({
            matchId: match.matchId,
            homeTeam: match.homeTeamName,
            awayTeam: match.awayTeamName,
            over: false,
            line,
            scope,
            stat: statKey,
            period,
            form: "all",
            odds: odds.under,
            neutralGround: false,
            home_importance: 5,
            away_importance: 5,
            leagueName: match.leagueName,
          });
        }
      });
    } catch (error) {
      console.error(`    ❌ Failed: ${error.message}`);
      failureCount++;
    }
  }

  console.log(`\n✓ Odds fetched: ${successCount} succeeded, ${failureCount} failed`);
  console.log(`✓ Total bets generated: ${allBets.length}\n`);

  return allBets;
}

// ===== STEP 4: CALCULATE EV & BUILD COMBOS =====
async function step4CalculateEvAndBuildCombos(dateStr, { matchLookup, matchups, bets }) {
  console.log("🧮 Step 4: Calculating EV and building combos...");

  if (!bets || bets.length === 0) {
    console.log("ℹ️ No bets to process. Exiting.");
    return;
  }

  console.log(`  → Processing ${bets.length} bets...`);

  // Calculate EV using engine (with team data caching)
  const evResults = await calculateEvForBets(bets, { parallel: true });
  
  const successful = evResults.filter(r => r.success);
  console.log(`  ✓ EV calculated: ${successful.length}/${bets.length} succeeded`);

  // Map results and filter for +EV
  const mappedWithEv = successful.map(({ bet, result }) => {
    const { primaryEv } = resolvePrimaryEv(result, bet.stat);
    return { bet, result, primaryEv };
  });

  const positive = mappedWithEv.filter(x => typeof x.primaryEv === "number" && x.primaryEv > 0);
  console.log(`  ✓ Positive EV bets: ${positive.length}`);

  // Build priority map from matchups insights
  const allRows = [...(matchups.overRows || []), ...(matchups.underRows || [])];
  const priorityMap = {};
  const insightKeySet = new Set();
  
  allRows.forEach((row) => {
    const key = buildLineKeyFromRow(row);
    if (key) {
      insightKeySet.add(key);
      const score = Number(row.score ?? row.normalizedScore ?? row.sortKey ?? 0);
      if (Number.isFinite(score)) {
        priorityMap[key] = Math.max(priorityMap[key] ?? 0, score);
      }
    }
  });

  // Convert to lines format
  const lines = positive.map(({ bet, result, primaryEv }) => {
    const direction = bet.over ? "over" : "under";
    const match = matchLookup.get(String(bet.matchId));

    const betKey = buildBetKey({
      homeTeam: bet.homeTeam,
      awayTeam: bet.awayTeam,
      stat: bet.stat,
      scope: bet.scope,
      period: bet.period,
      line: bet.line,
      over: bet.over,
      form: bet.form,
      neutralGround: bet.neutralGround,
      matchId: bet.matchId,
    });

    return {
      betKey,
      matchId: bet.matchId,
      homeTeamName: bet.homeTeam,
      awayTeamName: bet.awayTeam,
      leagueName: match?.leagueName ?? bet.leagueName,
      statKey: bet.stat,
      scope: bet.scope ?? "total",
      period: bet.period ?? "ALL",
      direction,
      line: bet.line,
      odds: bet.odds,
      primaryEv,
      evPct: result.evPct ?? null,
      evPctMultifactor: result.evPctMultifactor ?? null,
      evPctLeagueAvg: result.evPctLeagueAvg ?? null,
      evPctWithMultiplier: result.evPctWithMultiplier ?? null,
      legacyEvPct: result.legacyEvPct ?? null,
      evPctUniversalOptimized: result.evPctUniversalOptimized ?? null,
      matchupScore: priorityMap[buildLineKey({
        matchId: bet.matchId,
        statKey: bet.stat,
        period: bet.period,
        scope: bet.scope,
        direction,
      })] ?? null,
      priority: priorityMap[buildLineKey({
        matchId: bet.matchId,
        statKey: bet.stat,
        period: bet.period,
        scope: bet.scope,
        direction,
      })] ?? 0,
      actual: null,
      win: null,
    };
  });

  // Filter to only lines that match insights
  const insightLines = lines.filter(line => {
    const key = buildLineKey(line);
    return line.matchId && insightKeySet.has(key);
  });

  console.log(`  ✓ Insight-matched lines: ${insightLines.length}`);

  // Build combos using engine
  console.log("\n  → Building combos...");
  
  const singles = buildCombinations(insightLines, {
    minCombos: 1,
    maxCombos: 1,
    maxTotal: 100,
  });
  
  const doubles = buildCombinations(insightLines, {
    minCombos: 2,
    maxCombos: 2,
    maxTotal: 50,
  });
  
  const triples = buildCombinations(insightLines, {
    minCombos: 3,
    maxCombos: 3,
    maxTotal: 50,
  });

  // Assign combo numbers
  const numberedSingles = assignComboNumbers(singles, 'avgEv').map((c, idx) => ({ ...c, legs: 1, comboNumber: idx + 1 }));
  const numberedDoubles = assignComboNumbers(doubles, 'avgEv').map((c, idx) => ({ ...c, legs: 2, comboNumber: idx + 1 }));
  const numberedTriples = assignComboNumbers(triples, 'avgEv').map((c, idx) => ({ ...c, legs: 3, comboNumber: idx + 1 }));

  const allCombos = [...numberedSingles, ...numberedDoubles, ...numberedTriples];

  console.log(`  ✓ Singles: ${numberedSingles.length}`);
  console.log(`  ✓ Doubles: ${numberedDoubles.length}`);
  console.log(`  ✓ Triples: ${numberedTriples.length}`);
  console.log(`  ✓ Total combos: ${allCombos.length}`);

  if (allCombos.length === 0) {
    console.log("\nℹ️ No combos to save.");
    return;
  }

  // Prepare documents for MongoDB
  const docs = allCombos.map(combo => ({
    ...combo,
    date: dateStr,
    generatedAt: new Date(),
    source: SOURCE,
    lines: combo.lines.map(l => ({
      betKey: l.betKey ?? makeLineId(l),
      matchId: l.matchId,
      homeTeamName: l.homeTeamName,
      awayTeamName: l.awayTeamName,
      leagueName: l.leagueName,
      statKey: l.statKey,
      scope: l.scope,
      direction: l.direction,
      period: l.period,
      line: l.line,
      odds: l.odds,
      primaryEv: l.primaryEv,
      evPct: l.evPct,
      evPctMultifactor: l.evPctMultifactor,
      evPctLeagueAvg: l.evPctLeagueAvg,
      evPctWithMultiplier: l.evPctWithMultiplier,
      legacyEvPct: l.legacyEvPct,
      evPctUniversalOptimized: l.evPctUniversalOptimized,
      matchupScore: l.matchupScore,
      actual: l.actual ?? null,
      win: l.win ?? null,
    })),
  }));

  // Save to MongoDB
  if (!MONGODB_URI) {
    console.log("\n⚠️ No MONGODB_URI, skipping DB save.");
    console.log("Preview first combo:", docs[0]);
    return;
  }

  console.log(`\n💾 Saving ${docs.length} combos to MongoDB...`);
  
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  
  try {
    const db = client.db(DB_NAME);
    await db.collection(RESULTS_COLLECTION).insertMany(docs);
    console.log(`✓ Saved to collection: ${RESULTS_COLLECTION}`);
  } finally {
    await client.close();
  }
}
