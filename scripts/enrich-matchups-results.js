
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import fs from "fs/promises";
import path from "path";
import { fetchMatchStatistics } from "../rapidApi/match-statistics.js";
import { findTeamstatsMatchSelections } from "../lib/teamstatsLookup.js";
import {
  buildMatchFromStatisticsPayload,
  buildMatchupOutcome,
} from "../lib/matchupsOutcome.js";

dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB ?? "app";

const RESULTS_DIR = path.join(process.cwd(), "data", "matchups");
const SCORE_DIR = path.join(RESULTS_DIR, "matchup-score");
const LEAGUE_DIR = path.join(RESULTS_DIR, "matchup-league-avg");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function buildKey(row) {
  return `${row.matchId}:${row.statKey}:${row.period}:${row.scope}:${row.condition}`;
}

function annotateRows(rows, map) {
  return rows?.map((row) => {
    const key = buildKey(row);
    const enriched = map.get(key);
    return enriched ? { ...row, outcome: enriched.outcome } : row;
  });
}

function resolveDateArg() {
  const arg = process.argv.find((value) => value.startsWith("--date="));
  if (arg) return arg.split("=", 2)[1];
  return new Date().toISOString().slice(0, 10);
}

function parseRapidApiKeys() {
  return (process.env.RAPIDAPI_KEYS || process.env.RAPIDAPI_KEY || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildRapidContext() {
  return {
    rapidApiKeys: parseRapidApiKeys(),
    rapidApiState: { index: 0, calls: 0 },
    page: null,
    logger: console,
    apiCallStats: {
      rapid: { success: 0, failure: 0 },
      sofascore: { success: 0, failure: 0 },
    },
  };
}

async function loadMatchStatisticsFallback(matchId, rapidContext, cache) {
  if (!rapidContext?.rapidApiKeys?.length) return null;

  const cacheKey = String(matchId);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  try {
    const statsResult = await fetchMatchStatistics(matchId, rapidContext);
    const match = buildMatchFromStatisticsPayload(statsResult?.statistics);
    cache.set(cacheKey, match);
    return match;
  } catch (error) {
    console.warn(`[enrich] RapidAPI stats fallback failed for ${matchId}: ${error?.message || error}`);
    cache.set(cacheKey, null);
    return null;
  }
}

async function enrichTop50(db, top50, rapidContext) {
  const rows = [...(top50?.over ?? []), ...(top50?.under ?? [])];
  const outcomeMap = new Map();
  const rapidStatsCache = new Map();
  const missingTeamstatsWarned = new Set();
  const uniqueMatchIds = [...new Set(rows.map((row) => row?.matchId).filter(Boolean).map(String))];
  const teamstatsMatches = await findTeamstatsMatchSelections(db, uniqueMatchIds, {
    collectionName: "teamstats",
  });

  for (const row of rows) {
    const teamstatsMatch = teamstatsMatches.get(String(row.matchId))?.match || null;
    if (!teamstatsMatch && !missingTeamstatsWarned.has(String(row.matchId))) {
      missingTeamstatsWarned.add(String(row.matchId));
      console.warn(`[enrich] teamstats missing for match ${row.matchId}`);
    }
    let outcome = buildMatchupOutcome(teamstatsMatch, row);

    if (!outcome) {
      const fallbackMatch = await loadMatchStatisticsFallback(
        row.matchId,
        rapidContext,
        rapidStatsCache
      );
      outcome = buildMatchupOutcome(fallbackMatch, row, { requireFinished: false });
    }

    outcomeMap.set(buildKey(row), { outcome });
  }

  return {
    over: annotateRows(top50?.over ?? [], outcomeMap),
    under: annotateRows(top50?.under ?? [], outcomeMap),
  };
}

async function enrichMatchupsForDate(db, client, date, rapidContext) {
  const scoreDoc = await db
    .collection("matchups-score")
    .findOne({ _id: date }, { projection: { data: 1 } });

  if (!scoreDoc?.data) {
    console.warn(
      `[enrich] no matchups-score.data for ${date} — skipping score update`
    );
  }

  const leagueDoc = await db
    .collection("matchups-league-avg")
    .findOne({ _id: date }, { projection: { data: 1 } });

  if (!leagueDoc?.data) {
    console.warn(
      `[enrich] no matchups-league-avg.data for ${date} — skipping league avg update`
    );
  }

  if (scoreDoc?.data) {
    const newTop50 = await enrichTop50(db, scoreDoc.data.top50, rapidContext);

    await db.collection("matchups-score").updateOne(
      { _id: date },
      {
        $set: {
          "data.top50.over": newTop50.over,
          "data.top50.under": newTop50.under,
          "data.updatedAt": new Date(),
        },
      }
    );
    console.log(`[enrich] updated matchups-score for ${date}`);

    const scoreFilePayload = {
      ...scoreDoc.data,
      top50: newTop50,
      updatedAt: new Date().toISOString(),
    };
    await ensureDir(SCORE_DIR);
    await fs.writeFile(
      path.join(SCORE_DIR, `${date}.json`),
      JSON.stringify(scoreFilePayload, null, 2)
    );
  }

  if (leagueDoc?.data) {
    const newTop50 = await enrichTop50(db, leagueDoc.data.top50, rapidContext);

    await db.collection("matchups-league-avg").updateOne(
      { _id: date },
      {
        $set: {
          "data.top50.over": newTop50.over,
          "data.top50.under": newTop50.under,
          "data.updatedAt": new Date(),
        },
      }
    );
    console.log(`[enrich] updated matchups-league-avg for ${date}`);

    const leagueFilePayload = {
      ...leagueDoc.data,
      top50: newTop50,
      updatedAt: new Date().toISOString(),
    };
    await ensureDir(LEAGUE_DIR);
    await fs.writeFile(
      path.join(LEAGUE_DIR, `${date}.json`),
      JSON.stringify(leagueFilePayload, null, 2)
    );
  }
}

async function main() {
  if (!MONGODB_URI) throw new Error("MONGODB_URI missing");

  const dateArg = resolveDateArg();
  const dates = expandDateRange(dateArg);
  const rapidContext = buildRapidContext();

  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    for (const date of dates) {
      await enrichMatchupsForDate(db, client, date, rapidContext);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("enrich-matchups-results failed:", error);
  process.exit(1);
});

// --- NYTT: hjälpare för att expandera ett datumspann (YYYY-MM-DD-YYYY-MM-DD) ---
function expandDateRange(maybeRange) {
  const re = /^\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}$/;
  if (!re.test(maybeRange)) return [maybeRange];
  const [y1, m1, d1, y2, m2, d2] = maybeRange.split("-").map(Number);
  const start = new Date(Date.UTC(y1, m1 - 1, d1));
  const end = new Date(Date.UTC(y2, m2 - 1, d2));
  const out = [];
  for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}
// ------------------------------------------------------------------------------
