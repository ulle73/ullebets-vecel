/**
 * Correct AI User Combos
 *
 * Finds documents in ai-generated-bets with source="ai-user" and lines.actual == null,
 * fetches actual stats from teamstats collection, and marks each line with:
 * - actual: number (aggregated according to statKey/scope/period)
 * - win: boolean (true if bet won, false if lost, null if not found)
 *
 * This reuses the stat extraction logic from correct-unibet-backtest.js
 */

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// Stat key mapping (reused)
const STAT_KEY_MAP = {
  totalShots: "totalShotsOnGoal",
  shotsOnGoal: "shotsOnGoal",
  cornerKicks: "cornerKicks",
  yellowCards: "yellowCards",
  throwIns: "throwIns",
  freeKicks: "freeKicks",
  fouls: "fouls",
  offsides: "offsides",
  goalKicks: "goalKicks",
};

function normPeriod(p) {
  if (!p) return "ALL";
  const x = String(p).toUpperCase();
  if (x.includes("1ST")) return "1ST";
  if (x.includes("2ND")) return "2ND";
  if (x.includes("ALL") || x === "FULL" || x === "FT" || x.includes("MATCH")) return "ALL";
  return x;
}

function getStatisticsBlocks(match) {
  if (!match) return [];
  if (match.matchDetails && Array.isArray(match.matchDetails.statistics)) {
    return match.matchDetails.statistics;
  }
  if (Array.isArray(match.matchDetails)) {
    return match.matchDetails
      .map((x) => {
        if (x && typeof x === "object") {
          if (x.period && x.groups) return x;
          if (Array.isArray(x.statistics)) return x.statistics;
        }
        return null;
      })
      .flat()
      .filter(Boolean);
  }
  if (Array.isArray(match.statistics)) return match.statistics;
  if (Array.isArray(match.matchStatistics)) return match.matchStatistics;
  if (Array.isArray(match.stats)) return match.stats;

  const obj =
    match.matchDetails?.statistics ||
    match.statistics ||
    match.matchStatistics ||
    match.stats ||
    null;

  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    return Object.entries(obj).map(([period, data]) => ({
      period,
      groups: data?.groups || data || [],
    }));
  }

  return [];
}

function readSideValue(item, side) {
  const cand = [
    side === "home" ? "homeValue" : "awayValue",
    side,
    side === "home" ? "home_team" : "away_team",
    side === "home" ? "homeTeam" : "awayTeam",
    side === "home" ? "home_val" : "away_val",
    "value",
  ];
  for (const k of cand) {
    if (item[k] != null) {
      const v = item[k];
      const n = typeof v === "string" ? Number(v.replace(",", ".").replace("%", "")) : Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function keysEqualLoosely(a, b) {
  const A = String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const B = String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (A === B) return true;
  if (["corners", "cornerkicks"].includes(A) && ["corners", "cornerkicks"].includes(B)) return true;
  return false;
}

function extractStat(match, key, period, side) {
  const blocks = getStatisticsBlocks(match);
  if (!blocks.length) return 0;

  const want = normPeriod(period);
  let periodData = blocks.find((b) => normPeriod(b.period) === want);
  if (!periodData) periodData = blocks.find((b) => normPeriod(b.period) === "ALL");
  if (!periodData) periodData = blocks[0];

  const groups = Array.isArray(periodData.groups) ? periodData.groups : [];
  for (const g of groups) {
    const items = Array.isArray(g.statisticsItems)
      ? g.statisticsItems
      : Array.isArray(g.items)
      ? g.items
      : Array.isArray(g.stats)
      ? g.stats
      : [];
    for (const it of items) {
      const k = (it.key || it.name || it.stat || "").toString();
      if (!k) continue;
      if (keysEqualLoosely(k, key)) {
        const val = readSideValue(it, side);
        if (val != null) return val;
      }
    }
  }
  return 0;
}

function resolveStatKey(statKey) {
  if (!statKey) return null;
  if (STAT_KEY_MAP[statKey]) return STAT_KEY_MAP[statKey];
  return statKey;
}

function toDateString(input) {
  if (input == null) return null;
  // If numeric (seconds or ms)
  const num = Number(input);
  if (Number.isFinite(num)) {
    const ms = num > 2e10 ? num : num * 1000; // guess seconds if small
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  // If string date
  if (typeof input === "string") {
    const d = new Date(input);
    if (!Number.isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  return null;
}

async function findMatchInTeamstats(teamstatsCol, { homeTeam, awayTeam, matchDate, fallbackDate, matchId }) {
  // 1) Try direct matchId lookup on home role only (fast path)
  if (matchId) {
    const matchIdStr = String(matchId);
    const matchIdNum = Number(matchId);
    const matchIdCandidates = [matchIdStr, Number.isFinite(matchIdNum) ? matchIdNum : null].filter(
      (v) => v !== null
    );

    const homeDoc = await teamstatsCol.findOne({
      "_importMeta.teamRole": "home",
      "full.matchId": { $in: matchIdCandidates },
    });

    if (homeDoc?.full) {
      const homeMatch =
        homeDoc.full.find((m) => matchIdCandidates.some((id) => String(m.matchId) === String(id))) ||
        null;
      if (homeMatch) {
        return { homeMatch, awayMatch: null };
      }
    }

    // 2) Fallback: check away role with matchId
    const awayDoc = await teamstatsCol.findOne({
      "_importMeta.teamRole": "away",
      "full.matchId": { $in: matchIdCandidates },
    });
    if (awayDoc?.full) {
      const awayMatch =
        awayDoc.full.find((m) => matchIdCandidates.some((id) => String(m.matchId) === String(id))) ||
        null;
      if (awayMatch) {
        return { homeMatch: null, awayMatch };
      }
    }
  }

  // 3) Fallback: date + team names (first home role, then away role)
  const dateStr = toDateString(matchDate) || toDateString(fallbackDate);
  if (!dateStr) {
    return { homeMatch: null, awayMatch: null, reason: "no_date" };
  }

  const homeStats = await teamstatsCol.findOne({
    "_importMeta.teamName": { $regex: new RegExp(`^${homeTeam}$`, "i") },
    "_importMeta.teamRole": "home",
  });

  if (homeStats?.full) {
    const homeMatch = homeStats.full.find((m) => {
      const mDate = toDateString(m.date || m.matchDate);
      if (!mDate) return false;
      const isCorrectDate = mDate === dateStr;
      const isCorrectOpponent = m.awayTeamName?.toLowerCase() === awayTeam.toLowerCase();
      return isCorrectDate && isCorrectOpponent;
    });

    if (homeMatch) {
      return { homeMatch, awayMatch: null };
    }
  }

  const awayStats = await teamstatsCol.findOne({
    "_importMeta.teamName": { $regex: new RegExp(`^${awayTeam}$`, "i") },
    "_importMeta.teamRole": "away",
  });

  if (awayStats?.full) {
    const awayMatch = awayStats.full.find((m) => {
      const mDate = toDateString(m.date || m.matchDate);
      if (!mDate) return false;
      const isCorrectDate = mDate === dateStr;
      const isCorrectOpponent = m.homeTeamName?.toLowerCase() === homeTeam.toLowerCase();
      return isCorrectDate && isCorrectOpponent;
    });

    if (awayMatch) {
      return { homeMatch: null, awayMatch };
    }
  }

  console.warn(
    `[Correct AI Combos] No match found in teamstats for ${homeTeam} vs ${awayTeam} on ${dateStr} (matchId=${matchId ?? "n/a"})`
  );

  return { homeMatch: null, awayMatch: null };
}

function settleActualValue({ homeVal, awayVal, scope }) {
  if (scope === "home") return homeVal;
  if (scope === "away") return awayVal;
  const sum = (homeVal ?? 0) + (awayVal ?? 0);
  return Number.isFinite(sum) ? sum : null;
}

function computeOutcome(actual, direction, line) {
  if (actual == null || line == null) return null;
  if (direction === "over") return actual > line;
  if (direction === "under") return actual < line;
  return null;
}

async function correctComboLine(line, teamstatsCol, matchDate) {
  const statKey = resolveStatKey(line.statKey);
  if (!statKey) return { actual: null, win: null };

  const { homeMatch, awayMatch } = await findMatchInTeamstats(teamstatsCol, {
    homeTeam: line.homeTeamName,
    awayTeam: line.awayTeamName,
    matchDate,
    fallbackDate: line.matchStart,
    matchId: line.matchId,
  });

  const refMatch = homeMatch || awayMatch;
  if (!refMatch) {
    return { actual: null, win: null };
  }

  const side = line.scope === "home" ? "home" : line.scope === "away" ? "away" : null;

  const homeVal = extractStat(homeMatch, statKey, line.period, "home");
  const awayVal = extractStat(awayMatch || homeMatch, statKey, line.period, "away");

  const actual = settleActualValue({ homeVal, awayVal, scope: line.scope });
  const win = computeOutcome(actual, line.direction, line.line);

  return { actual, win };
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "app");

  const betsCol = db.collection("ai-generated-bets");
  const teamstatsCol = db.collection("teamstats");

  // Fetch documents with lines.actual null
  const docs = await betsCol
    .find({
      source: "ai-user",
      "lines.actual": { $in: [null, undefined] },
    })
    .toArray();

  console.log(`Found ${docs.length} ai-user combo docs to correct`);

  let updatedCount = 0;
  let processed = 0;
  let lineFound = 0;
  let lineMissed = 0;
  const t0 = Date.now();

  for (const doc of docs) {
    const matchDate = doc.date || null;
    const newLines = [];

    for (const line of doc.lines || []) {
      const { actual, win } = await correctComboLine(line, teamstatsCol, matchDate);
      newLines.push({ ...line, actual, win });
      if (actual == null || win == null) {
        lineMissed += 1;
      } else {
        lineFound += 1;
      }
    }

    await betsCol.updateOne(
      { _id: doc._id },
      { $set: { lines: newLines } }
    );
    updatedCount += 1;
    processed += 1;
    if (processed % 20 === 0) {
      console.log(`Processed ${processed}/${docs.length} documents...`);
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Updated ${updatedCount} documents in ai-generated-bets`);
  console.log(`Lines with actual+win set: ${lineFound}, missed: ${lineMissed}, time: ${dt}s`);
  await client.close();
}

run().catch((err) => {
  console.error("Fatal error in correct-ai-user-combos:", err);
  process.exit(1);
});
