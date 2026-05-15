import fs from "fs/promises";
import path from "path";
import { fetchMatchStatistics } from "../rapidApi/match-statistics.js";
import { findTeamstatsMatchSelections } from "./teamstatsLookup.js";
import {
  buildMatchFromStatisticsPayload,
  buildMatchupOutcome,
} from "./matchupsOutcome.js";

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

function countResolvedOutcomes(rows = []) {
  return rows.reduce((sum, row) => sum + (row?.outcome ? 1 : 0), 0);
}

export function expandDateRange(maybeRange) {
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

function parseRapidApiKeys() {
  return (process.env.RAPIDAPI_KEYS || process.env.RAPIDAPI_KEY || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function buildRapidContext(logger = console) {
  return {
    rapidApiKeys: parseRapidApiKeys(),
    rapidApiState: { index: 0, calls: 0 },
    page: null,
    logger,
    apiCallStats: {
      rapid: { success: 0, failure: 0 },
      sofascore: { success: 0, failure: 0 },
    },
  };
}

async function loadMatchStatisticsFallback(matchId, rapidContext, cache, logger = console) {
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
    logger.warn?.(`[enrich] RapidAPI stats fallback failed for ${matchId}: ${error?.message || error}`);
    cache.set(cacheKey, null);
    return null;
  }
}

async function enrichTop50(db, top50, rapidContext, logger = console) {
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
      logger.warn?.(`[enrich] teamstats missing for match ${row.matchId}`);
    }
    let outcome = buildMatchupOutcome(teamstatsMatch, row);

    if (!outcome) {
      const fallbackMatch = await loadMatchStatisticsFallback(
        row.matchId,
        rapidContext,
        rapidStatsCache,
        logger
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

async function maybePersistSnapshotFile(dir, date, payload, persistFiles) {
  if (!persistFiles) return;
  await ensureDir(dir);
  await fs.writeFile(
    path.join(dir, `${date}.json`),
    JSON.stringify(payload, null, 2)
  );
}

export async function enrichMatchupsForDate(db, date, rapidContext, options = {}) {
  const { persistFiles = true, logger = console } = options;
  const scoreDoc = await db
    .collection("matchups-score")
    .findOne({ _id: date }, { projection: { data: 1 } });

  if (!scoreDoc?.data) {
    logger.warn?.(
      `[enrich] no matchups-score.data for ${date} — skipping score update`
    );
  }

  const leagueDoc = await db
    .collection("matchups-league-avg")
    .findOne({ _id: date }, { projection: { data: 1 } });

  if (!leagueDoc?.data) {
    logger.warn?.(
      `[enrich] no matchups-league-avg.data for ${date} — skipping league avg update`
    );
  }

  const result = {
    date,
    score: { updated: false, resolvedRows: 0, totalRows: 0 },
    leagueAvg: { updated: false, resolvedRows: 0, totalRows: 0 },
  };

  if (scoreDoc?.data) {
    const newTop50 = await enrichTop50(db, scoreDoc.data.top50, rapidContext, logger);
    const updatedAt = new Date();

    await db.collection("matchups-score").updateOne(
      { _id: date },
      {
        $set: {
          "data.top50.over": newTop50.over,
          "data.top50.under": newTop50.under,
          "data.updatedAt": updatedAt,
        },
      }
    );
    logger.log?.(`[enrich] updated matchups-score for ${date}`);

    await maybePersistSnapshotFile(
      SCORE_DIR,
      date,
      {
        ...scoreDoc.data,
        top50: newTop50,
        updatedAt: updatedAt.toISOString(),
      },
      persistFiles
    );

    result.score = {
      updated: true,
      resolvedRows: countResolvedOutcomes(newTop50.over) + countResolvedOutcomes(newTop50.under),
      totalRows: (newTop50.over?.length || 0) + (newTop50.under?.length || 0),
    };
  }

  if (leagueDoc?.data) {
    const newTop50 = await enrichTop50(db, leagueDoc.data.top50, rapidContext, logger);
    const updatedAt = new Date();

    await db.collection("matchups-league-avg").updateOne(
      { _id: date },
      {
        $set: {
          "data.top50.over": newTop50.over,
          "data.top50.under": newTop50.under,
          "data.updatedAt": updatedAt,
        },
      }
    );
    logger.log?.(`[enrich] updated matchups-league-avg for ${date}`);

    await maybePersistSnapshotFile(
      LEAGUE_DIR,
      date,
      {
        ...leagueDoc.data,
        top50: newTop50,
        updatedAt: updatedAt.toISOString(),
      },
      persistFiles
    );

    result.leagueAvg = {
      updated: true,
      resolvedRows: countResolvedOutcomes(newTop50.over) + countResolvedOutcomes(newTop50.under),
      totalRows: (newTop50.over?.length || 0) + (newTop50.under?.length || 0),
    };
  }

  return result;
}

