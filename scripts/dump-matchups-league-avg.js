
import fs from "fs/promises";
import path from "path";
import crypto from "node:crypto";

import { clientPromise } from "../lib/db.js";
import { getMatchesForDate } from "../lib/repos/fixtures.js";
import {
  computeForecastBundle,
  SCOPE_AWAY,
  SCOPE_HOME,
  SCOPE_TOTAL,
} from "../lib/statForecast/formulas.js";
import { STAT_CONFIG } from "../lib/statForecast/statConfig.js";

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

const FORECAST_SCOPE_MAP = {
  total: SCOPE_TOTAL,
  home: SCOPE_HOME,
  away: SCOPE_AWAY,
};

const RESULTS_DIR = path.join(process.cwd(), "data", "matchups");
const DIR_PATH = path.join(RESULTS_DIR, "matchup-league-avg");

const STAT_ALIASES = new Map([
  ["totalshotsongoal", "totalShotsOnGoal"],
  ["total_shots_on_goal", "totalShotsOnGoal"],
  ["totalshots_on_goal", "totalShotsOnGoal"],
  ["totalshots", "totalShotsOnGoal"],
  ["total_shots", "totalShotsOnGoal"],
  ["totalshotsontarget", "totalShotsOnGoal"],
  ["total_shots_on_target", "totalShotsOnGoal"],
]);

function normalizeStatKeyForScew(statKey) {
  if (!statKey) return null;
  const raw = String(statKey).trim();
  const alias = STAT_ALIASES.get(raw.toLowerCase());
  return alias || raw;
}

function selectScew(profile, statKey, period) {
  if (!profile || !statKey || !period) return null;
  const primary = normalizeStatKeyForScew(statKey);
  const roots = [];
  if (profile.statistics?.for?.[statKey]?.[period]) roots.push(profile.statistics.for[statKey][period]);
  if (primary && primary !== statKey && profile.statistics?.for?.[primary]?.[period]) {
    roots.push(profile.statistics.for[primary][period]);
  }
  for (const root of roots) {
    if (root?.scew) {
      const hasSignal =
        root.scew.direction != null ||
        root.scew.factor != null ||
        (Number.isFinite(root.scew.scewScore) && root.scew.scewScore !== 0);
      if (hasSignal) {
        return root.scew;
      }
    }
  }
  return null;
}

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION_NAME = "matchups-league-avg";
const TEAMPROFILE_COLLECTION = "teamprofiles";

function ensureDir(target) {
  return fs.mkdir(target, { recursive: true });
}

function roundScore(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function sortAndLimit(entries, limit) {
  return entries
    .slice()
    .sort(
      (a, b) =>
        (b.sortKey ?? b.score ?? -Infinity) - (a.sortKey ?? a.score ?? -Infinity)
    )
    .slice(0, limit);
}

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getPeriodNode(metricNode, period) {
  if (!metricNode || typeof metricNode !== "object") return null;
  return metricNode[period] ?? metricNode.ALL ?? null;
}

function readRank(profile, type, statKey, period) {
  const node = profile?.statistics?.[type]?.[statKey];
  const p = node && getPeriodNode(node, period);
  const val = p?.rank ?? p?.Rank ?? null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function readMarketBias(profile, statKey, period) {
  if (!profile || !statKey || !period) return null;
  const primary = normalizeStatKeyForScew(statKey);
  const candidates = [];
  const node = profile.statistics?.for?.[statKey];
  const aliasNode =
    primary && primary !== statKey ? profile.statistics?.for?.[primary] : null;
  if (node) candidates.push(node);
  if (aliasNode) candidates.push(aliasNode);
  for (const cand of candidates) {
    const p = getPeriodNode(cand, period);
    if (p?.marketBias) return p.marketBias;
  }
  return null;
}

function normalizeMatch(item) {
  if (!item) return null;
  const id = String(
    (item.id ??
      item.matchId ??
      item.event?.id ??
      item.event?.matchId ??
      crypto.randomUUID?.() ??
      Math.random().toString(36).slice(2))
  );

  const leagueId = toNum(
    item.tournament?.uniqueTournament?.id ??
      item.uniqueTournament?.id ??
      item.tournament?.id ??
      item.event?.tournament?.uniqueTournament?.id ??
      item.event?.tournament?.id
  );

  const leagueName =
    item.tournament?.name ??
    item.event?.tournament?.name ??
    item.league?.name ??
    "Unknown";

  const homeTeamId = toNum(
    item.homeTeam?.id ?? item.event?.homeTeam?.id ?? item.home?.id ?? item.teams?.home?.id
  );
  const awayTeamId = toNum(
    item.awayTeam?.id ?? item.event?.awayTeam?.id ?? item.away?.id ?? item.teams?.away?.id
  );

  const homeTeamName =
    item.homeTeam?.name ??
    item.event?.homeTeam?.name ??
    item.home?.name ??
    item.teams?.home?.name ??
    "—";
  const awayTeamName =
    item.awayTeam?.name ??
    item.event?.awayTeam?.name ??
    item.away?.name ??
    item.teams?.away?.name ??
    "—";

  const timestamp = Number(
    item.startTimestamp ??
      item.event?.startTimestamp ??
      item.timestamp ??
      item.kickoffTime ??
      null
  );
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : null;

  return {
    id,
    matchId: id,
    leagueId,
    leagueName,
    homeTeamId,
    awayTeamId,
    homeTeamName,
    awayTeamName,
    timestamp: safeTimestamp,
    raw: item,
  };
}

function parsePositiveInt(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : null;
}

async function fetchProfileFromDb(client, params) {
  const collection = client.db(DB_NAME).collection(TEAMPROFILE_COLLECTION);
  const leagueNumeric = parsePositiveInt(params.leagueId);
  const teamNumeric = parsePositiveInt(params.teamId);
  const requestParams = { ...params };
  const matchType = (params.matchType ?? "").toLowerCase();

  if (leagueNumeric != null && teamNumeric != null) {
    const doc = await collection.findOne({
      $or: [
        { _id: `${leagueNumeric}:${teamNumeric}:${matchType}` },
        {
          "meta.ligaId": leagueNumeric,
          "meta.lagId": teamNumeric,
          "meta.matchType": matchType,
        },
      ],
    });
    if (doc) {
      return doc;
    }
  }

  if (params.leagueName || params.teamName) {
    const query = {
      "meta.matchType": matchType,
      $or: [],
    };
    if (!query.$or.length) delete query.$or;
    if (params.leagueName) {
      query.$or?.push({ leagueName: { $regex: `^${params.leagueName}$`, $options: "i" } });
    }
    if (params.teamName) {
      query.$or?.push({ "meta.teamName": { $regex: `^${params.teamName}$`, $options: "i" } });
    }
    if (query.$or?.length) {
      const doc = await collection.findOne(query);
      if (doc) {
        return doc;
      }
    }
  }

  return null;
}

async function buildPairs(matches, client) {
  const pairs = [];
  const cache = new Map();
  const missingMatches = [];
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
    const homeKey = `${homeParams.leagueId}|${homeParams.teamId}|${homeParams.matchType}`;
    const awayKey = `${awayParams.leagueId}|${awayParams.teamId}|${awayParams.matchType}`;
    let homeProfile = cache.get(homeKey);
    let awayProfile = cache.get(awayKey);
    if (homeProfile === undefined) {
      homeProfile = await fetchProfileFromDb(client, homeParams);
      cache.set(homeKey, homeProfile);
    }
    if (awayProfile === undefined) {
      awayProfile = await fetchProfileFromDb(client, awayParams);
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

    pairs.push({
      matchId: match.matchId,
      leagueId: match.leagueId,
      leagueName,
      home: {
        name: homeProfile?.meta?.lagnamn ?? match.homeTeamName ?? "Hemma",
        profile: homeProfile,
      },
      away: {
        name: awayProfile?.meta?.lagnamn ?? match.awayTeamName ?? "Borta",
        profile: awayProfile,
      },
    });
  }
  return { pairs, normalizedCount: matches.length, missingMatches };
}

function getScopeLabel(scope, pair) {
  if (scope === "total") return "Totalt";
  if (scope === "home") return `Hemmalaget – ${pair.home.name}`;
  if (scope === "away") return `Bortalaget – ${pair.away.name}`;
  return scope;
}

function buildLeagueAvgSnapshot(pairs, limit = 200) {
  const overEntries = [];
  const underEntries = [];

  for (const pair of pairs) {
    for (const { key: statKey, label: statLabel } of STATS_FOR_VIEW) {
      for (const { value: periodKey } of PERIODS) {
        const hf = readRank(pair.home.profile, "for", statKey, periodKey);
        const ha = readRank(pair.home.profile, "against", statKey, periodKey);
        const af = readRank(pair.away.profile, "for", statKey, periodKey);
        const aa = readRank(pair.away.profile, "against", statKey, periodKey);
        if (![hf, ha, af, aa].every(Number.isFinite)) continue;

        const forecastBundle = computeForecastBundle({
          statKey,
          period: periodKey,
          homeProfile: pair.home.profile,
          awayProfile: pair.away.profile,
          config: STAT_CONFIG,
        });

        for (const [scopeKey, bundleScope] of Object.entries(FORECAST_SCOPE_MAP)) {
          const normalized = forecastBundle?.normalized?.[bundleScope];
          if (!Number.isFinite(normalized)) continue;

          const homeScew = selectScew(pair.home.profile, statKey, periodKey);
          const awayScew = selectScew(pair.away.profile, statKey, periodKey);
          const scopeProfile =
            scopeKey === "home" ? pair.home.profile :
            scopeKey === "away" ? pair.away.profile :
            null;
          const scew =
            scopeKey === "home" ? homeScew :
            scopeKey === "away" ? awayScew :
            (() => {
              const cand = [homeScew, awayScew].filter(Boolean);
              if (!cand.length) return null;
              cand.sort((a, b) => Math.abs((b?.scewScore ?? b?.score ?? 0)) - Math.abs((a?.scewScore ?? a?.score ?? 0)));
              return cand[0];
            })();

          const scopeLabel = getScopeLabel(scopeKey, pair);
          const baseEntry = {
            match: `${pair.home.name} vs ${pair.away.name}`,
            league: pair.leagueName,
            leagueId: pair.leagueId,
            matchId: pair.matchId,
            statKey,
            statLabel,
            period: periodKey,
            scope: scopeKey,
            scopeLabel,
            condition: "ratio",
            score: roundScore(normalized),
            marketBias:
              scopeKey === "home"
                ? readMarketBias(pair.home.profile, statKey, periodKey)
                : scopeKey === "away"
                ? readMarketBias(pair.away.profile, statKey, periodKey)
                : {
                    home: readMarketBias(pair.home.profile, statKey, periodKey),
                    away: readMarketBias(pair.away.profile, statKey, periodKey),
                  },
            homeBehaviour: pair.home.profile?.behaviour ?? null,
            awayBehaviour: pair.away.profile?.behaviour ?? null,
            forecast: {
              baseline: forecastBundle?.baseline?.perScope?.[bundleScope] ?? null,
              leagueBaseline: forecastBundle?.baseline?.league?.perScope?.[bundleScope] ?? null,
              styleModifier: forecastBundle?.styleModifier?.perScope?.[bundleScope] ?? null,
              normalized,
              driverSampleSize: forecastBundle?.styleModifier?.sampleSizes?.[bundleScope] ?? 0,
            },
            sortKey: normalized,
            ...(scew
              ? {
                  scewScore: scew.scewScore ?? scew.score ?? null,
                  scewDirection: scew.direction ?? null,
                  scewFactor: scew.factor ?? null,
                  scewBucket: scew.bucket ?? null,
                }
              : {}),
          };

          overEntries.push(baseEntry);
          underEntries.push({ ...baseEntry, sortKey: -normalized });
        }
      }
    }
  }

  return {
    top50: {
      over: sortAndLimit(overEntries, limit),
      under: sortAndLimit(underEntries, limit),
    },
    stats: {
      pairs: pairs.length,
      overCandidates: overEntries.length,
      underCandidates: underEntries.length,
    },
  };
}

async function writeSnapshot(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// ---- Range additions (minimala) ----
function resolveDateArg() {
  const explicitArg = process.argv.find((arg) => arg.startsWith("--date="));
  const raw = explicitArg ? explicitArg.split("=", 2)[1] : null;
  if (raw) {
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    if (/^\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed; // range
    throw new Error("Date must be YYYY-MM-DD or YYYY-MM-DD-YYYY-MM-DD");
  }
  return new Date().toISOString().slice(0, 10);
}

function expandDateRange(maybeRange) {
  if (!/^\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}$/.test(maybeRange)) return [maybeRange];
  const [y1,m1,d1,y2,m2,d2] = maybeRange.split(/[-]/).map(Number);
  const start = new Date(Date.UTC(y1,m1-1,d1));
  const end   = new Date(Date.UTC(y2,m2-1,d2));
  const out = [];
  for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate()+1)) {
    out.push(dt.toISOString().slice(0,10));
  }
  return out;
}
// ------------------------------------

async function main() {
  const dateArg = resolveDateArg();
  const dates = expandDateRange(dateArg);
  const client = await clientPromise;

  try {
    for (const targetDate of dates) {
      const matches = await getMatchesForDate(targetDate);
      const normalizedMatches = matches.map(normalizeMatch).filter(Boolean);
      const { pairs, normalizedCount, missingMatches } = await buildPairs(normalizedMatches, client);
      const leagueData = buildLeagueAvgSnapshot(pairs);
      const generatedAt = new Date().toISOString();
      const snapshot = {
        date: targetDate,
        generatedAt,
        stats: {
          normalizedMatches: normalizedCount,
          pairs: pairs.length,
          missingMatches,
          ...leagueData.stats,
        },
        top50: leagueData.top50,
      };
      await ensureDir(DIR_PATH);
      const filePath = path.join(DIR_PATH, `${targetDate}.json`);
      await writeSnapshot(filePath, snapshot);
      await client.db(DB_NAME).collection(COLLECTION_NAME).updateOne(
        { _id: targetDate },
        {
          $set: {
            date: targetDate,
            generatedAt,
            files: { league: path.relative(process.cwd(), filePath) },
            data: snapshot,
          },
        },
        { upsert: true }
      );
      console.log(
        `[matchups-league-avg] Persisted data (${pairs.length} pairs, ${snapshot.stats.overCandidates} forecast rows) for ${targetDate}`
      );
    }
  } finally {
    await client.close(true);
  }
}

main().catch((error) => {
  console.error("[matchups-league-avg] failed:", error);
  process.exitCode = 1;
});
