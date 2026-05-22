#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import crypto from "node:crypto";

import { clientPromise } from "../lib/db.js";
import { runMongoWithRetry } from "../lib/mongoUtils.js";
import { getMatchesForDate } from "../lib/repos/fixtures.js";
import { normalizeMatch } from "../lib/core/matchups.js";
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

const RESULTS_DIR = path.join(process.cwd(), "data", "matchups");
const SCORE_DIR = path.join(RESULTS_DIR, "matchup-score");
const DB_NAME = process.env.MONGODB_DB || "app";
const TEAMPROFILE_COLLECTION = "teamprofiles";
const FORECAST_SCOPE_MAP = { total: SCOPE_TOTAL, home: SCOPE_HOME, away: SCOPE_AWAY };

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
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
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
  return toNum(p?.rank ?? p?.Rank);
}

function readValue(profile, type, statKey, period) {
  const node = profile?.statistics?.[type]?.[statKey];
  const p = node && getPeriodNode(node, period);
  return toNum(p?.value ?? p?.Value);
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

function leagueSizeFromMeta(profile) {
  return (
    toNum(profile?.meta?.leagueTeamCount) ??
    toNum(profile?.meta?.leagueSize) ??
    toNum(profile?.meta?.teamsInLeague) ??
    null
  );
}

function normalizePairScore(avgPair, leagueMax, mode) {
  const L = toNum(leagueMax) ?? 20;
  const min = 2;
  const max = 2 * L;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const s = clamp(avgPair, min, max);
  let raw;
  if (mode === "over") raw = (max - s) / (max - min);
  else raw = (s - min) / (max - min);
  return Math.round(raw * 1000) / 10;
}

function adjustSinglePairForComparison(pairSum, leagueMax) {
  if (!Number.isFinite(pairSum)) return null;
  const L = toNum(leagueMax) ?? 20;
  const mean = L + 1;
  const adjusted = mean + (pairSum - mean) / Math.SQRT2;
  const min = 2;
  const max = 2 * L;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  return clamp(adjusted, min, max);
}

function badgeForAvgPair(avgPair, leagueMax, mode) {
  const L = toNum(leagueMax) ?? 20;
  const min = 2;
  const max = 2 * L;
  if (mode === "over") {
    if (avgPair === 2) return { label: "Perfekt", tone: "perfect" };
    if (avgPair <= 3) return { label: "Nästan", tone: "almost" };
    if (avgPair <= 5) return { label: "Stark", tone: "strong" };
    return null;
  }
  if (avgPair === max) return { label: "Perfekt", tone: "perfect" };
  if (avgPair >= max - 1) return { label: "Nästan", tone: "almost" };
  if (avgPair >= max - 3) return { label: "Stark", tone: "strong" };
  return null;
}

function pick(value, paths, fallback = null) {
  for (const p of paths) {
    const result = p
      .split(".")
      .reduce((acc, key) => (acc == null ? acc : acc[key]), value);
    if (result != null) return result;
  }
  return fallback;
}

function toPositiveInt(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function toScoreValue(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = toScoreValue(item);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  if (typeof value === "object") {
    const keys = [
      "current",
      "display",
      "total",
      "normaltime",
      "normalTime",
      "regular",
      "fullTime",
      "ft",
      "value",
      "main",
      "score",
    ];
    for (const key of keys) {
      if (!(key in value)) continue;
      const resolved = toScoreValue(value[key]);
      if (resolved !== null) return resolved;
    }
  }
  return null;
}


// ---- Range additions (minimala) ----
function resolveDateArg() {
  const args = process.argv.slice(2);
  const explicit = args.find((arg) => arg.startsWith("--date="));
  const raw = explicit ? explicit.split("=", 2)[1] : args[0];
  if (raw) {
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    if (/^\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed; // range
    throw new Error("Date must be YYYY-MM-DD or YYYY-MM-DD-YYYY-MM-DD");
  }
  return new Date().toISOString().slice(0, 10);
}

function expandDateRange(maybeRange) {
  if (!/^\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}$/.test(maybeRange))
    return [maybeRange];
  const [y1, m1, d1, y2, m2, d2] = maybeRange.split(/[-]/).map(Number);
  const start = new Date(Date.UTC(y1, m1 - 1, d1));
  const end = new Date(Date.UTC(y2, m2 - 1, d2));
  const out = [];
  for (
    let dt = new Date(start);
    dt <= end;
    dt.setUTCDate(dt.getUTCDate() + 1)
  ) {
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}
// ------------------------------------

function buildMatchupCacheKey(params) {
  const leaguePart = params.leagueId ?? params.leagueName ?? "";
  const teamPart = params.teamId ?? params.teamName ?? "";
  const typePart = (params.matchType ?? "").toLowerCase();
  return `${leaguePart}|${teamPart}|${typePart}`;
}

function normalizeComparableName(value) {
  if (value == null) return null;
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stringEquals(expected, actual) {
  const lhs = normalizeComparableName(expected);
  const rhs = normalizeComparableName(actual);
  if (lhs && rhs) return lhs === rhs;
  if (lhs) return false;
  return true;
}

function parsePositiveInt(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function buildIdentifier(leagueId, teamId, matchType) {
  const league = parsePositiveInt(leagueId);
  const team = parsePositiveInt(teamId);
  const type = (matchType ?? "").toLowerCase();
  if (league == null || team == null || !type) return null;
  return `${league}:${team}:${type}`;
}

function stripDbProfile(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

function profileMatchesRequest(doc, params) {
  if (!doc) return false;
  const meta = doc.meta ?? {};
  const { leagueId, teamId, leagueName, teamName, matchType } = params;
  if (matchType) {
    if (typeof meta.matchType !== "string") return false;
    if (meta.matchType.toLowerCase() !== matchType.toLowerCase()) return false;
  }
  const actualTeamId = parsePositiveInt(
    meta.lagId ?? meta.teamId ?? doc.teamId
  );
  const expectedTeamId = parsePositiveInt(teamId);
  if (expectedTeamId != null) {
    if (actualTeamId == null || actualTeamId !== expectedTeamId) return false;
  } else if (
    !stringEquals(
      teamName,
      meta.lagnamn ?? meta.teamName ?? doc.teamName ?? doc.team
    )
  ) {
    return false;
  }
  const actualLeagueId = parsePositiveInt(
    meta.ligaId ?? meta.leagueId ?? doc.leagueId
  );
  const expectedLeagueId = parsePositiveInt(leagueId);
  if (expectedLeagueId != null) {
    if (actualLeagueId == null || actualLeagueId !== expectedLeagueId)
      return false;
  } else if (
    !stringEquals(
      leagueName,
      meta.leagueName ?? meta.league ?? doc.leagueName ?? doc.league
    )
  ) {
    return false;
  }
  return true;
}

function escapeForRegex(value) {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}

function buildCaseInsensitiveEquals(value) {
  if (!value) return null;
  return { $regex: `^${escapeForRegex(value)}$`, $options: "i" };
}

async function fetchProfileFromDb(client, params) {
  const collection = client.db(DB_NAME).collection(TEAMPROFILE_COLLECTION);
  const leagueNumeric = parsePositiveInt(params.leagueId);
  const teamNumeric = parsePositiveInt(params.teamId);
  const requestParams = { ...params };
  const matchType = (params.matchType ?? "").toLowerCase();

  if (leagueNumeric != null && teamNumeric != null) {
    const identifier = buildIdentifier(leagueNumeric, teamNumeric, matchType);
    if (identifier) {
      const doc = await runMongoWithRetry("matchups profile by id", () =>
        collection.findOne({ _id: identifier })
      );
      if (doc && profileMatchesRequest(doc, requestParams)) {
        return stripDbProfile(doc);
      }
    }
    const docByMeta = await runMongoWithRetry("matchups profile by meta", () =>
      collection.findOne({
        "meta.ligaId": leagueNumeric,
        "meta.lagId": teamNumeric,
        "meta.matchType": matchType,
      })
    );
    if (docByMeta && profileMatchesRequest(docByMeta, requestParams)) {
      return stripDbProfile(docByMeta);
    }
  }

  if (params.leagueName || params.teamName) {
    const leagueMatcher =
      leagueNumeric != null
        ? leagueNumeric
        : buildCaseInsensitiveEquals(params.leagueName);
    const teamMatcher =
      teamNumeric != null
        ? teamNumeric
        : buildCaseInsensitiveEquals(params.teamName);
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
    const docByName = await runMongoWithRetry("matchups profile by name", () =>
      collection.findOne(query)
    );
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
      home: {
        id: match.homeTeamId,
        name: homeProfile?.meta?.lagnamn ?? match.homeTeamName ?? "Hemma",
        profile: homeProfile,
      },
      away: {
        id: match.awayTeamId,
        name: awayProfile?.meta?.lagnamn ?? match.awayTeamName ?? "Borta",
        profile: awayProfile,
      },
    });
  }
  return { pairs, normalizedCount: matches.length, missingMatches };
}

function buildLeagueSizeMap(pairs) {
  const map = new Map();
  for (const pair of pairs) {
    const key = String(pair.leagueId ?? pair.leagueName ?? "");
    const homeSize = leagueSizeFromMeta(pair.home.profile);
    const awaySize = leagueSizeFromMeta(pair.away.profile);
    const best = homeSize ?? awaySize ?? null;
    if (best) {
      map.set(key, best);
    }
  }
  return map;
}

function buildScoreSnapshot(pairs, leagueSizeMap, limit = 200) {
  const overEntries = [];
  const underEntries = [];

  for (const p of pairs) {
    const leagueKey = String(p.leagueId ?? p.leagueName ?? "");
    const leagueMax = toNum(leagueSizeMap.get(leagueKey)) ?? 20;

    for (const { key: statKey, label: statLabel } of STATS_FOR_VIEW) {
      for (const { value: periodKey } of PERIODS) {
        const hf = readRank(p.home.profile, "for", statKey, periodKey);
        const ha = readRank(p.home.profile, "against", statKey, periodKey);
        const af = readRank(p.away.profile, "for", statKey, periodKey);
        const aa = readRank(p.away.profile, "against", statKey, periodKey);
        if (![hf, ha, af, aa].every(Number.isFinite)) continue;

        const sumHome = hf + aa;
        const sumAway = af + ha;
        const avgPair = (sumHome + sumAway) / 2;
        const forecastBundle = computeForecastBundle({
          statKey,
          period: periodKey,
          homeProfile: p.home.profile,
          awayProfile: p.away.profile,
          config: STAT_CONFIG,
        });

        const attachLeagueAvg = (entry, scope) => {
          const bundleScope = FORECAST_SCOPE_MAP[scope];
          const leagueBaseline =
            forecastBundle?.baseline?.league?.perScope?.[bundleScope] ?? null;
          if (leagueBaseline == null) return entry;
          return {
            ...entry,
            forecast: {
              ...entry.forecast,
              leagueBaseline,
            },
          };
        };

        const matchLabel = `${p.home.name} vs ${p.away.name}`;
        const baseEntry = {
          match: matchLabel,
          league: p.leagueName,
          leagueId: p.leagueId,
          matchId: p.matchId,
          homeTeamId: p.home.id,
          awayTeamId: p.away.id,
          statKey,
          statLabel,
          period: periodKey,
          homeBehaviour: p.home.profile?.behaviour 
            ? { for: p.home.profile.behaviour.for ?? null, against: p.home.profile.behaviour.against ?? null }
            : null,
          awayBehaviour: p.away.profile?.behaviour 
            ? { for: p.away.profile.behaviour.for ?? null, against: p.away.profile.behaviour.against ?? null }
            : null,
        };
        const scewHome = selectScew(p.home.profile, statKey, periodKey);
        const scewAway = selectScew(p.away.profile, statKey, periodKey);
        const scewTotal = (() => {
          const cand = [scewHome, scewAway].filter(Boolean);
          if (!cand.length) return null;
          cand.sort((a, b) => Math.abs((b?.scewScore ?? b?.score ?? 0)) - Math.abs((a?.scewScore ?? a?.score ?? 0)));
          return cand[0];
        })();

        const pushEntry = (direction, scope, scoreValue) => {
          const rounded = roundScore(scoreValue);
          if (rounded == null) return;
          const scew =
            scope === "home" ? scewHome :
            scope === "away" ? scewAway :
            scewTotal;
          const marketBias =
            scope === "home"
              ? readMarketBias(p.home.profile, statKey, periodKey)
              : scope === "away"
              ? readMarketBias(p.away.profile, statKey, periodKey)
              : {
                  home: readMarketBias(p.home.profile, statKey, periodKey),
                  away: readMarketBias(p.away.profile, statKey, periodKey),
                };
          const entry = attachLeagueAvg(
            {
              ...baseEntry,
              scope,
              condition: direction,
              score: rounded,
              marketBias,
              ...(scew
                ? {
                    scewScore: scew.scewScore ?? scew.score ?? null,
                    scewDirection: scew.direction ?? null,
                    scewFactor: scew.factor ?? null,
                    scewBucket: scew.bucket ?? null,
                  }
                : {}),
            },
            scope
          );
          if (direction === "over") {
            overEntries.push(entry);
          } else {
            underEntries.push(entry);
          }
        };

        const pushScoresForScope = (scope, basisValue) => {
          const scoreBasis =
            scope === "total"
              ? basisValue
              : adjustSinglePairForComparison(basisValue, leagueMax);
          if (!Number.isFinite(scoreBasis)) return;
          const overScore = normalizePairScore(scoreBasis, leagueMax, "over");
          const underScore = normalizePairScore(scoreBasis, leagueMax, "under");
          pushEntry("over", scope, overScore);
          pushEntry("under", scope, underScore);
        };

        pushScoresForScope("total", avgPair);
        pushScoresForScope("home", sumHome);
        pushScoresForScope("away", sumAway);
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

async function main() {
  const dateArg = resolveDateArg();
  const dates = expandDateRange(dateArg);
  const client = await clientPromise;

  try {
    for (const targetDate of dates) {
      console.log(`[matchups] Building snapshots for ${targetDate}`);
      const matches = await getMatchesForDate(targetDate);
      const normalizedMatches = matches.map(normalizeMatch).filter(Boolean);
      const { pairs, normalizedCount, missingMatches } = await buildPairs(
        normalizedMatches,
        client
      );
      const leagueSizeMap = buildLeagueSizeMap(pairs);
      const generatedAt = new Date().toISOString();
      const scoreData = buildScoreSnapshot(pairs, leagueSizeMap);
      const scoreSnapshot = {
        date: targetDate,
        generatedAt,
        stats: {
          normalizedMatches: normalizedCount,
          pairs: pairs.length,
          missingMatches,
          ...scoreData.stats,
        },
        top50: scoreData.top50,
      };
      await ensureDir(SCORE_DIR);
      const scorePath = path.join(SCORE_DIR, `${targetDate}.json`);
      await writeSnapshot(scorePath, scoreSnapshot);
      const doc = {
        _id: targetDate,
        date: targetDate,
        generatedAt,
        files: {
          score: path.relative(process.cwd(), scorePath),
        },
        data: scoreSnapshot,
      };
      const db = client.db(DB_NAME);
      await runMongoWithRetry("matchups score upsert", () =>
        db
          .collection("matchups-score")
          .updateOne({ _id: targetDate }, { $set: doc }, { upsert: true })
      );
      console.log(
        `[matchups] Persisted data (${pairs.length} pairs, ${scoreSnapshot.stats.normalizedMatches} matches).`
      );
    }
  } finally {
    await client.close(true);
  }
}

main().catch((error) => {
  console.error("[matchups] Skipped because", error);
  process.exitCode = 1;
});
