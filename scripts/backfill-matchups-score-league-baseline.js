/**
 * Backfill forecast.leagueBaseline into existing matchups-score documents.
 * - Fetches matchups-score docs (all, or a specific --date=YYYY-MM-DD or range YYYY-MM-DD-YYYY-MM-DD)
 * - Rebuilds league baseline per match/stat/period/scope via teamprofiles + computeForecastBundle
 * - Writes only the new forecast.leagueBaseline field back; leaves all other fields unchanged
 */

import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { computeForecastBundle, SCOPE_HOME, SCOPE_AWAY, SCOPE_TOTAL } from "../lib/statForecast/formulas.js";
import { STAT_CONFIG } from "../lib/statForecast/statConfig.js";
import { normalizeMatch } from "../lib/core/matchups.js";
import { getMatchesForDate } from "../lib/repos/fixtures.js";

dotenv.config({ path: ".env.local" });

const DB_NAME = process.env.MONGODB_DB || "app";
const SCORE_COL = "matchups-score";
const TEAMPROFILE_COLLECTION = "teamprofiles";
const FORECAST_SCOPE_MAP = { total: SCOPE_TOTAL, home: SCOPE_HOME, away: SCOPE_AWAY };

const PERIODS = [
  { value: "ALL", label: "Hela matchen" },
  { value: "1ST", label: "Första halvlek" },
  { value: "2ND", label: "Andra halvlek" },
];

const STATS_FOR_VIEW = [
  { key: "shotsOnGoal", label: "Skott på mål" },
  { key: "totalShotsOnGoal", label: "Totala skott" },
  { key: "cornerKicks", label: "Hörnor" },
  { key: "fouls", label: "Fouls" },
  { key: "yellowCards", label: "Gula kort" },
  { key: "throwIns", label: "Inkast" },
  { key: "offsides", label: "Offsides" },
  { key: "totalTackle", label: "Tacklingar" },
  { key: "freeKicks", label: "Frisparkar" },
];

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseDateArg() {
  const arg = process.argv.find((v) => v.startsWith("--date="));
  if (!arg) return null;
  const raw = arg.split("=", 2)[1].trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return [raw];
  if (/^\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y1, m1, d1, y2, m2, d2] = raw.split("-").map(Number);
    const start = new Date(Date.UTC(y1, m1 - 1, d1));
    const end = new Date(Date.UTC(y2, m2 - 1, d2));
    const out = [];
    for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
      out.push(dt.toISOString().slice(0, 10));
    }
    return out;
  }
  throw new Error("Date must be YYYY-MM-DD or YYYY-MM-DD-YYYY-MM-DD");
}

function buildCaseInsensitiveEquals(value) {
  if (!value) return null;
  return { $regex: `^${escapeRegex(String(value))}$`, $options: "i" };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripDbProfile(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

function profileMatchesRequest(profile, params) {
  if (!profile) return false;
  const matchType = (params.matchType ?? "").toLowerCase();
  if (profile.meta?.matchType !== matchType) return false;
  const reqLeagueId = toNum(params.leagueId);
  const reqTeamId = toNum(params.teamId);
  if (reqLeagueId != null && toNum(profile.meta?.ligaId) !== reqLeagueId) return false;
  if (reqTeamId != null && toNum(profile.meta?.lagId) !== reqTeamId) return false;
  return true;
}

function buildMatchupCacheKey(params) {
  return [
    toNum(params.leagueId) ?? params.leagueName ?? "",
    toNum(params.teamId) ?? params.teamName ?? "",
    (params.matchType ?? "").toLowerCase(),
  ].join("|");
}

async function fetchProfileFromDb(collection, params) {
  const matchType = (params.matchType ?? "").toLowerCase();
  const leagueNumeric = toNum(params.leagueId);
  const teamNumeric = toNum(params.teamId);
  const requestParams = { ...params };

  if (leagueNumeric != null && teamNumeric != null) {
    const docById = await collection.findOne({
      $or: [
        { _id: `${leagueNumeric}:${teamNumeric}:${matchType}` },
        {
          "meta.ligaId": leagueNumeric,
          "meta.lagId": teamNumeric,
          "meta.matchType": matchType,
        },
      ],
    });
    if (docById && profileMatchesRequest(docById, requestParams)) {
      return stripDbProfile(docById);
    }
  }

  if (params.leagueName || params.teamName) {
    const leagueMatcher = buildCaseInsensitiveEquals(params.leagueName);
    const teamMatcher = buildCaseInsensitiveEquals(params.teamName);
    const query = { "meta.matchType": matchType };
    if (leagueNumeric != null) {
      query["meta.ligaId"] = leagueNumeric;
    } else if (leagueMatcher) {
      query.leagueName = leagueMatcher;
    }
    if (teamNumeric != null) {
      query["meta.lagId"] = teamNumeric;
    } else if (teamMatcher) {
      query["meta.lagnamn"] = teamMatcher;
    }
    const docByName = await collection.findOne(query);
    if (docByName && profileMatchesRequest(docByName, requestParams)) {
      return stripDbProfile(docByName);
    }
  }

  return null;
}

async function buildPairs(matches, client) {
  const pairs = [];
  const cache = new Map();
  const missingMatches = [];
  const profileCol = client.db(DB_NAME).collection(TEAMPROFILE_COLLECTION);

  for (const match of matches) {
    const leagueName = match.leagueName ?? match.raw?.leagueName ?? null;
    const homeParams = {
      leagueId: match.leagueId,
      leagueName,
      teamId: match.homeTeamId,
      teamName: match.homeTeamName,
      matchType: "home",
    };
    const awayParams = {
      leagueId: match.leagueId,
      leagueName,
      teamId: match.awayTeamId,
      teamName: match.awayTeamName,
      matchType: "away",
    };
    const homeKey = buildMatchupCacheKey(homeParams);
    const awayKey = buildMatchupCacheKey(awayParams);
    let homeProfile = cache.get(homeKey);
    let awayProfile = cache.get(awayKey);
    if (homeProfile === undefined) {
      homeProfile = await fetchProfileFromDb(profileCol, homeParams);
      cache.set(homeKey, homeProfile);
    }
    if (awayProfile === undefined) {
      awayProfile = await fetchProfileFromDb(profileCol, awayParams);
      cache.set(awayKey, awayProfile);
    }
    if (!homeProfile || !awayProfile) {
      missingMatches.push({
        matchId: match.matchId,
        hasHome: !!homeProfile,
        hasAway: !!awayProfile,
      });
      continue;
    }

    const hId = toNum(homeProfile?.meta?.ligaId) ?? toNum(match.leagueId);
    const aId = toNum(awayProfile?.meta?.ligaId) ?? toNum(match.leagueId);
    const sameId = hId && aId ? hId === aId : true;
    const hName = homeProfile?.meta?.leagueName ?? leagueName;
    const aName = awayProfile?.meta?.leagueName ?? leagueName;
    const sameName = hName && aName ? hName === aName : true;
    if (!sameId || !sameName) {
      continue;
    }

    pairs.push({
      matchId: match.matchId,
      leagueId: hId ?? aId ?? match.leagueId ?? null,
      leagueName: hName ?? aName ?? leagueName,
      home: { name: homeParams.teamName, profile: homeProfile },
      away: { name: awayParams.teamName, profile: awayProfile },
    });
  }
  return { pairs, missingMatches };
}

function buildLeagueBaselineMap(pairs) {
  const map = new Map(); // key -> leagueBaseline

  for (const p of pairs) {
    for (const { key: statKey } of STATS_FOR_VIEW) {
      for (const { value: periodKey } of PERIODS) {
        const forecastBundle = computeForecastBundle({
          statKey,
          period: periodKey,
          homeProfile: p.home.profile,
          awayProfile: p.away.profile,
          config: STAT_CONFIG,
        });
        for (const [scope, bundleScope] of Object.entries(FORECAST_SCOPE_MAP)) {
          const leagueBaseline =
            forecastBundle?.baseline?.league?.perScope?.[bundleScope] ?? null;
          if (leagueBaseline == null) continue;
          const key = buildRowKey(p.matchId, statKey, periodKey, scope);
          map.set(key, leagueBaseline);
        }
      }
    }
  }
  return map;
}

function buildRowKey(matchId, statKey, period, scope) {
  return [String(matchId), statKey, period, scope].join(":");
}

function patchEntries(arr = [], lbMap) {
  let changed = 0;
  const next = arr.map((row) => {
    const key = buildRowKey(row.matchId ?? row.match, row.statKey ?? row.statLabel, row.period, row.scope);
    const lb = lbMap.get(key);
    if (lb == null) return row;
    const prev = row?.forecast?.leagueBaseline;
    if (prev === lb) return row;
    changed += 1;
    return {
      ...row,
      forecast: {
        ...row.forecast,
        leagueBaseline: lb,
      },
    };
  });
  return { rows: next, changed };
}

async function processDate(client, date) {
  const scoreCol = client.db(DB_NAME).collection(SCORE_COL);
  const doc = await scoreCol.findOne({ _id: date });
  if (!doc?.data) {
    console.log(`⏭️  Skipping ${date} (no data in ${SCORE_COL})`);
    return;
  }

  const matches = await getMatchesForDate(date);
  const normalized = matches.map((m) => normalizeMatch(m)).filter(Boolean);
  const { pairs, missingMatches } = await buildPairs(normalized, client);
  const lbMap = buildLeagueBaselineMap(pairs);

  const topOver = Array.isArray(doc.data?.top50?.over) ? doc.data.top50.over : [];
  const topUnder = Array.isArray(doc.data?.top50?.under) ? doc.data.top50.under : [];
  const rowsOver = Array.isArray(doc.data?.rows?.over) ? doc.data.rows.over : [];
  const rowsUnder = Array.isArray(doc.data?.rows?.under) ? doc.data.rows.under : [];

  const overRes = patchEntries(topOver, lbMap);
  const underRes = patchEntries(topUnder, lbMap);
  const rowsOverRes = patchEntries(rowsOver, lbMap);
  const rowsUnderRes = patchEntries(rowsUnder, lbMap);
  const totalChanged = overRes.changed + underRes.changed + rowsOverRes.changed + rowsUnderRes.changed;

  if (!totalChanged) {
    console.log(`✅ ${date} already has leagueBaseline (no changes)`);
    return;
  }

  const set = {};
  if (topOver.length) set["data.top50.over"] = overRes.rows;
  if (topUnder.length) set["data.top50.under"] = underRes.rows;
  if (rowsOver.length) set["data.rows.over"] = rowsOverRes.rows;
  if (rowsUnder.length) set["data.rows.under"] = rowsUnderRes.rows;

  await scoreCol.updateOne({ _id: date }, { $set: set });
  console.log(
    `🆕 ${date}: patched leagueBaseline on ${totalChanged} rows (missingMatches=${missingMatches.length})`
  );
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI saknas i .env.local");
  const client = new MongoClient(uri);
  await client.connect();

  try {
    let dates = parseDateArg();
    if (!dates) {
      const allDocs = await client.db(DB_NAME).collection(SCORE_COL).find({}, { projection: { _id: 1 } }).toArray();
      dates = allDocs.map((d) => d._id).filter(Boolean).sort();
    }

    for (const date of dates) {
      await processDate(client, date);
    }
  } finally {
    await client.close(true);
  }
}

main().catch((err) => {
  console.error("Fatal:", err?.stack || err);
  process.exit(1);
});
