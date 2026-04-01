import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { calculateWMA, normalizeTeamName } from "./utils.js";
import { loadExternalUnibetTests } from "../loadExternalUnibetTests.js";
import {
  ALL_PERIODS_NEW,
  ALL_SCOPES_NEW,
  ALL_STATS_NEW,
  DATASET_SPLITS_NEW,
  DATASETS_DIR_NEW,
  FEATURE_MODES_NEW,
  buildDatasetFileNameNew,
  buildDatasetKeyNew,
  buildFeatureNamesNew,
  buildSupportedCombosNew,
} from "./pipelineConfig-new.js";
import { buildSampleFeatureBundleNew } from "./featureBuilder-new.js";
import { createDatasetWriterNew } from "./datasetWriter-new.js";
import { toDate, toDateStr } from "../../../lib/core/date.js";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), quiet: true });

export const TRAIN_END_DATE_NEW = new Date("2025-10-15T00:00:00.000Z");
export const VAL_END_DATE_NEW = new Date("2025-11-05T00:00:00.000Z");

const EXTERNAL_BASE_NEW =
  "C:\\Users\\ryd\\OneDrive\\Skrivbord\\FRONTEND\\bet365\\UNIBET\\unibet-backtests";

const COMBO_SET_NEW = new Set(
  buildSupportedCombosNew().map(({ statKey, scope, period }) =>
    buildDatasetKeyNew(statKey, scope, period),
  ),
);

function sleepNew(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isRetryableMongoReadErrorNew(error) {
  const name = error?.name ?? "";
  if (
    name === "PoolClearedOnNetworkError" ||
    name === "MongoNetworkTimeoutError" ||
    name === "MongoServerSelectionError"
  ) {
    return true;
  }
  const labels =
    error?.errorLabelSet instanceof Set ? error.errorLabelSet : new Set();
  return (
    labels.has("PoolRequstedRetry") ||
    labels.has("PoolRequestedRetry") ||
    labels.has("ResetPool") ||
    labels.has("InterruptInUseConnections") ||
    labels.has("RetryableReadError")
  );
}

export async function runWithRetryNew(
  label,
  operation,
  { attempts = 3, baseDelayMs = 1500 } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableMongoReadErrorNew(error)) {
        throw error;
      }
      const waitMs = baseDelayMs * attempt;
      console.warn(
        `[extractTrainingData-new] ${label} failed with ${error.name ?? "Error"}; retrying in ${waitMs}ms (${attempt + 1}/${attempts})`,
      );
      await sleepNew(waitMs);
    }
  }
  throw lastError;
}

export function buildMongoClientOptionsNew() {
  return {
    retryReads: true,
    retryWrites: false,
    maxPoolSize: 2,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 45_000,
    connectTimeoutMS: 30_000,
    socketTimeoutMS: 120_000,
    heartbeatFrequencyMS: 10_000,
  };
}

export async function connectMongoClientNew(
  mongoUri,
  {
    attempts = 5,
    baseDelayMs = 2_000,
    clientFactory = (uri, options) => new MongoClient(uri, options),
  } = {},
) {
  return runWithRetryNew(
    "mongodb connect",
    async () => {
      const client = clientFactory(mongoUri, buildMongoClientOptionsNew());
      try {
        await client.connect();
        return client;
      } catch (error) {
        await client.close().catch(() => {});
        throw error;
      }
    },
    { attempts, baseDelayMs },
  );
}

export function buildPagedFilterNew(filter = {}, lastId = null) {
  if (!lastId) {
    return filter;
  }
  const pageFilter = { _id: { $gt: lastId } };
  if (!filter || !Object.keys(filter).length) {
    return pageFilter;
  }
  return { $and: [filter, pageFilter] };
}

async function loadDocsPagedNew(
  collection,
  {
    label,
    filter = {},
    projection = undefined,
    pageSize = 50,
    limit = null,
  },
) {
  const docs = [];
  let lastId = null;
  let remaining =
    Number.isInteger(limit) && limit > 0 ? Number(limit) : Number.POSITIVE_INFINITY;

  while (remaining > 0) {
    const currentPageSize = Number.isFinite(remaining)
      ? Math.min(pageSize, remaining)
      : pageSize;
    const pageFilter = buildPagedFilterNew(filter, lastId);
    const pageDocs = await runWithRetryNew(
      `${label} page load`,
      () =>
        collection
          .find(pageFilter, projection ? { projection } : {})
          .sort({ _id: 1 })
          .limit(currentPageSize)
          .toArray(),
      { attempts: 5, baseDelayMs: 2_000 },
    );
    if (!pageDocs.length) {
      break;
    }
    docs.push(...pageDocs);
    remaining -= pageDocs.length;
    lastId = pageDocs.at(-1)?._id ?? lastId;
    if (pageDocs.length < currentPageSize) {
      break;
    }
  }

  return docs;
}

export function splitNameForDateNew(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("splitNameForDateNew requires a valid Date");
  }
  if (date < TRAIN_END_DATE_NEW) return "train";
  if (date < VAL_END_DATE_NEW) return "val";
  return "test";
}

export function buildDatasetManifestNew({ datasets, featureNameMap }) {
  const combos = {};
  for (const [comboKey, perMode] of Object.entries(datasets)) {
    combos[comboKey] = {};
    for (const featureMode of FEATURE_MODES_NEW) {
      const splitCounts = {};
      let total = 0;
      for (const split of DATASET_SPLITS_NEW) {
        const count = perMode?.[featureMode]?.[split]?.length ?? 0;
        splitCounts[split] = count;
        total += count;
      }
      combos[comboKey][featureMode] = {
        ...splitCounts,
        total,
      };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    comboCount: Object.keys(combos).length,
    featureModes: Object.fromEntries(
      FEATURE_MODES_NEW.map((featureMode) => [
        featureMode,
        {
          featureCount: featureNameMap[featureMode]?.length ?? 0,
          featureNames: featureNameMap[featureMode] ?? [],
        },
      ]),
    ),
    combos,
  };
}

function toNumeric(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function createLeagueLookupNew(leaguesDocs) {
  const leaguesData = {};
  for (const doc of leaguesDocs) {
    const { _id, ...rest } = doc;
    Object.assign(leaguesData, rest);
  }
  return leaguesData;
}

function findTeamInLeaguesNew(leaguesData, teamName) {
  const normalizedTeamName = normalizeTeamName(teamName);
  for (const league of Object.values(leaguesData)) {
    const teams = Array.isArray(league?.teams) ? league.teams : [];
    for (const team of teams) {
      if (normalizeTeamName(team?.name) === normalizedTeamName) {
        return {
          optaRank: toNumeric(team?.optaRank, 100),
          optaRating: toNumeric(team?.optaRating, 80),
          leagueName: league?.leagueName ?? league?.name ?? "",
        };
      }
    }
  }
  return null;
}

async function loadTeamProfileCacheNew(collection) {
  const cache = new Map();
  const docs = await runWithRetryNew("teamprofiles cache load", () =>
    loadDocsPagedNew(collection, {
      label: "teamprofiles cache",
      projection: {
        meta: 1,
        rankFor: 1,
        rankAgainst: 1,
        firstGoal: 1,
        shotsPerMinute: 1,
        shotsPerTenMinutes: 1,
        statistics: 1,
      },
      pageSize: 50,
    }),
  );
  for (const doc of docs) {
    const name = normalizeTeamName(doc?.meta?.lagnamn);
    const matchType = doc?.meta?.matchType;
    if (name && matchType) {
      cache.set(`${name}|${matchType}`, doc);
    }
  }
  return cache;
}

async function loadTeamProfileCacheForTeamsNew(collection, teamNames) {
  const rawTargets = Array.from(teamNames ?? []).filter(Boolean);
  const normalizedTargets = new Set(
    rawTargets.map((teamName) => normalizeTeamName(teamName)).filter(Boolean),
  );
  if (!rawTargets.length) {
    return new Map();
  }

  const docs = await runWithRetryNew("teamprofiles partial cache load", () =>
    loadDocsPagedNew(collection, {
      label: "teamprofiles partial cache",
      filter: {
        $or: rawTargets.map((teamName) => ({
          "meta.lagnamn": {
            $regex: new RegExp(`^${escapeRegexNew(teamName)}$`, "i"),
          },
        })),
      },
      projection: {
        meta: 1,
        rankFor: 1,
        rankAgainst: 1,
        firstGoal: 1,
        shotsPerMinute: 1,
        shotsPerTenMinutes: 1,
        statistics: 1,
      },
      pageSize: 50,
    }),
  );

  const cache = new Map();
  for (const doc of docs) {
    const name = normalizeTeamName(doc?.meta?.lagnamn);
    const matchType = doc?.meta?.matchType;
    if (name && matchType && normalizedTargets.has(name)) {
      cache.set(`${name}|${matchType}`, doc);
    }
  }
  return cache;
}

async function loadTeamStatsCacheNew(collection) {
  const cache = new Map();
  const docs = await runWithRetryNew("teamstats cache load", () =>
    loadDocsPagedNew(collection, {
      label: "teamstats cache",
      projection: {
        _importMeta: 1,
        full: 1,
      },
      pageSize: 10,
    }),
  );
  for (const doc of docs) {
    const teamName = normalizeTeamName(doc?._importMeta?.teamName);
    const teamRole = doc?._importMeta?.teamRole;
    if (teamName && teamRole) {
      cache.set(`${teamName}|${teamRole}`, doc);
    }
  }
  return cache;
}

async function loadTeamStatsCacheForTeamsNew(collection, teamNames) {
  const rawTargets = Array.from(teamNames ?? []).filter(Boolean);
  const normalizedTargets = new Set(
    rawTargets.map((teamName) => normalizeTeamName(teamName)).filter(Boolean),
  );
  if (!rawTargets.length) {
    return new Map();
  }

  const docs = await runWithRetryNew("teamstats partial cache load", () =>
    loadDocsPagedNew(collection, {
      label: "teamstats partial cache",
      filter: {
        $or: rawTargets.map((teamName) => ({
          "_importMeta.teamName": {
            $regex: new RegExp(`^${escapeRegexNew(teamName)}$`, "i"),
          },
        })),
      },
      projection: {
        _importMeta: 1,
        full: 1,
      },
      pageSize: 10,
    }),
  );

  const cache = new Map();
  for (const doc of docs) {
    const teamName = normalizeTeamName(doc?._importMeta?.teamName);
    const teamRole = doc?._importMeta?.teamRole;
    if (teamName && teamRole && normalizedTargets.has(teamName)) {
      cache.set(`${teamName}|${teamRole}`, doc);
    }
  }
  return cache;
}

function getCachedByTeamRoleNew(cache, teamName, role) {
  if (!cache) return null;
  return cache.get(`${normalizeTeamName(teamName)}|${role}`) ?? null;
}

function escapeRegexNew(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectRelevantTeamsNew(matches, teamStatsDocs) {
  const teamNames = new Set();
  for (const match of matches ?? []) {
    if (match?.homeTeam) teamNames.add(match.homeTeam);
    if (match?.awayTeam) teamNames.add(match.awayTeam);
  }
  for (const doc of teamStatsDocs ?? []) {
    const teamName = doc?._importMeta?.teamName;
    if (teamName) teamNames.add(teamName);
    for (const match of doc?.full ?? []) {
      if (match?.homeTeamName) teamNames.add(match.homeTeamName);
      if (match?.awayTeamName) teamNames.add(match.awayTeamName);
    }
  }
  return teamNames;
}

function getStatNodeNew(profile, statKey, period, polarity = "for") {
  if (!profile) return null;
  if (polarity === "against") {
    return (
      profile?.against?.[statKey]?.[period] ??
      profile?.statistics?.against?.[statKey]?.[period] ??
      null
    );
  }
  return (
    profile?.statistics?.[statKey]?.[period] ??
    profile?.statistics?.for?.[statKey]?.[period] ??
    null
  );
}

function buildProfileSnapshotNew(profile, statKey, period) {
  const statNode = getStatNodeNew(profile, statKey, period, "for");
  const againstNode = getStatNodeNew(profile, statKey, period, "against");

  return {
    statValue: toNumeric(statNode?.value),
    statRank: toNumeric(statNode?.rank, 50),
    rankFor: toNumeric(profile?.rankFor, 50),
    rankAgainst: toNumeric(profile?.rankAgainst, 50),
    scoreFirstPct: toNumeric(profile?.firstGoal?.scoreFirstPercentage, 50),
    shotsPerMinute: {
      leading: toNumeric(profile?.shotsPerMinute?.leading),
      trailing: toNumeric(profile?.shotsPerMinute?.trailing),
      tied: toNumeric(profile?.shotsPerMinute?.tied),
    },
    shotsPerTenMinutes: toNumeric(profile?.shotsPerTenMinutes?.avg),
    extraFor: profile?.statistics?.for ?? {},
    extraAgainst: profile?.statistics?.against ?? {},
    againstValue: toNumeric(againstNode?.value),
    againstRank: toNumeric(againstNode?.rank, 50),
  };
}

function buildWmaSnapshotNew(teamStatsDoc, statKey, matchDate, period) {
  if (!teamStatsDoc?.full) {
    return {
      recent: 0,
      medium: 0,
      long: 0,
    };
  }
  return {
    recent: calculateWMA(teamStatsDoc.full, statKey, 5, matchDate, "for", period),
    medium: calculateWMA(teamStatsDoc.full, statKey, 15, matchDate, "for", period),
    long: calculateWMA(teamStatsDoc.full, statKey, 30, matchDate, "for", period),
  };
}

function buildWmaAgainstSnapshotNew(teamStatsDoc, statKey, matchDate, period) {
  if (!teamStatsDoc?.full) {
    return {
      recent: 0,
      medium: 0,
      long: 0,
    };
  }
  return {
    recent: calculateWMA(teamStatsDoc.full, statKey, 5, matchDate, "against", period),
    medium: calculateWMA(teamStatsDoc.full, statKey, 15, matchDate, "against", period),
    long: calculateWMA(teamStatsDoc.full, statKey, 30, matchDate, "against", period),
  };
}

function buildFormulaPredictionsNew(evDetails) {
  const predictions = {};
  for (const [key, value] of Object.entries(evDetails ?? {})) {
    if (typeof value === "number" && !key.startsWith("raw")) {
      predictions[key] = value;
    }
  }
  return predictions;
}

function addBundlesToDatasetsNew(datasets, bundleByMode, split) {
  for (const featureMode of FEATURE_MODES_NEW) {
    const bundle = bundleByMode[featureMode];
    if (!bundle) continue;
    const comboKey = buildDatasetKeyNew(
      bundle.metadata.statKey,
      bundle.metadata.scope,
      bundle.metadata.period,
    );
    datasets[comboKey][featureMode][split].push(bundle);
  }
}

function buildBundleByModeNew(baseContext) {
  const bundles = {};
  for (const featureMode of FEATURE_MODES_NEW) {
    bundles[featureMode] = buildSampleFeatureBundleNew(baseContext, featureMode);
  }
  return bundles;
}

function extractActualFromStatisticsNew(match, statKey, scope, period) {
  const rawStats = match?.matchDetails?.statistics;
  const sections = Array.isArray(rawStats) ? rawStats : Object.values(rawStats ?? {});
  const section = sections.find((entry) => entry?.period === period);
  if (!section?.groups) return null;

  for (const group of section.groups) {
    const item = group?.statisticsItems?.find((candidate) => candidate?.key === statKey);
    if (!item) continue;
    const homeValue = toNumeric(item.homeValue);
    const awayValue = toNumeric(item.awayValue);
    if (scope === "home") return homeValue;
    if (scope === "away") return awayValue;
    return homeValue + awayValue;
  }
  return null;
}

async function extractFromBacktestsNew({
  writer,
  matches,
  leaguesData,
  teamProfileCache,
  teamStatsCache,
}) {
  let created = 0;
  for (const match of matches) {
    const matchDateStr = toDateStr(match.matchDate || match.timestamp);
    const matchDate = toDate(matchDateStr);
    if (!matchDate) continue;

    const split = splitNameForDateNew(matchDate);
    const homeTeam = match.homeTeam;
    const awayTeam = match.awayTeam;
    if (!homeTeam || !awayTeam) continue;

    const homeOptaData = findTeamInLeaguesNew(leaguesData, homeTeam) ?? {};
    const awayOptaData = findTeamInLeaguesNew(leaguesData, awayTeam) ?? {};
    const homeProfileDoc = getCachedByTeamRoleNew(teamProfileCache, homeTeam, "home");
    const awayProfileDoc = getCachedByTeamRoleNew(teamProfileCache, awayTeam, "away");
    const homeStatsDoc = getCachedByTeamRoleNew(teamStatsCache, homeTeam, "home");
    const awayStatsDoc = getCachedByTeamRoleNew(teamStatsCache, awayTeam, "away");

    for (const line of match.lines ?? []) {
      const actual = line?.actual;
      if (!Number.isFinite(Number(actual))) continue;
      const comboKey = buildDatasetKeyNew(line.statKey, line.scope, line.period);
      if (!COMBO_SET_NEW.has(comboKey)) continue;

      const baseContext = {
        statKey: line.statKey,
        scope: line.scope,
        period: line.period,
        target: Number(actual),
        market: {
          line: line.line,
          overOdds: line.odds,
          underOdds: line.underOdds,
        },
        teams: {
          home: {
            optaRank: homeOptaData.optaRank,
            optaRating: homeOptaData.optaRating,
            wmaFor: buildWmaSnapshotNew(homeStatsDoc, line.statKey, matchDate, line.period),
            wmaAgainst: buildWmaAgainstSnapshotNew(
              homeStatsDoc,
              line.statKey,
              matchDate,
              line.period,
            ),
            profile: buildProfileSnapshotNew(homeProfileDoc, line.statKey, line.period),
          },
          away: {
            optaRank: awayOptaData.optaRank,
            optaRating: awayOptaData.optaRating,
            wmaFor: buildWmaSnapshotNew(awayStatsDoc, line.statKey, matchDate, line.period),
            wmaAgainst: buildWmaAgainstSnapshotNew(
              awayStatsDoc,
              line.statKey,
              matchDate,
              line.period,
            ),
            profile: buildProfileSnapshotNew(awayProfileDoc, line.statKey, line.period),
          },
        },
        formulaPredictions: buildFormulaPredictionsNew(line.evDetails),
        metadata: {
          matchId: String(match._id ?? `${homeTeam}-${awayTeam}-${matchDateStr}`),
          date: matchDate.toISOString(),
          homeTeam,
          awayTeam,
          source: "backtest",
          supervised: false,
          line: toNumeric(line.line),
          odds: toNumeric(line.odds),
        },
      };

      const bundles = buildBundleByModeNew(baseContext);
      for (const featureMode of FEATURE_MODES_NEW) {
        await writer.append(bundles[featureMode], split);
      }
      created += 1;
    }
  }
  return created;
}

async function extractFromTeamStatsNew({
  writer,
  teamStatsDocs,
  leaguesData,
  teamProfileCache,
  teamStatsCache,
}) {
  let created = 0;
  for (const teamDoc of teamStatsDocs) {
    const teamRole = teamDoc?._importMeta?.teamRole;
    const teamName = teamDoc?._importMeta?.teamName;
    if (teamRole !== "home" || !teamName || !Array.isArray(teamDoc?.full)) {
      continue;
    }

    for (const match of teamDoc.full) {
      const matchDate = new Date(match.date || match.matchDate || match.timestamp);
      if (Number.isNaN(matchDate.getTime())) continue;

      const homeTeam = match.homeTeamName || teamName;
      const awayTeam = match.awayTeamName;
      if (!homeTeam || !awayTeam) continue;

      const split = splitNameForDateNew(matchDate);
      const homeOptaData = findTeamInLeaguesNew(leaguesData, homeTeam) ?? {};
      const awayOptaData = findTeamInLeaguesNew(leaguesData, awayTeam) ?? {};
      const homeProfileDoc = getCachedByTeamRoleNew(teamProfileCache, homeTeam, "home");
      const awayProfileDoc = getCachedByTeamRoleNew(teamProfileCache, awayTeam, "away");
      const awayStatsDoc = getCachedByTeamRoleNew(teamStatsCache, awayTeam, "away");

      for (const statKey of ALL_STATS_NEW) {
        for (const period of ALL_PERIODS_NEW) {
          for (const scope of ALL_SCOPES_NEW) {
            const actual = extractActualFromStatisticsNew(match, statKey, scope, period);
            if (!Number.isFinite(actual)) continue;

            const baseContext = {
              statKey,
              scope,
              period,
              target: actual,
              market: {
                line: 0,
                overOdds: 0,
                underOdds: 0,
              },
              teams: {
                home: {
                  optaRank: homeOptaData.optaRank,
                  optaRating: homeOptaData.optaRating,
                  wmaFor: buildWmaSnapshotNew(teamDoc, statKey, matchDate, period),
                  wmaAgainst: buildWmaAgainstSnapshotNew(teamDoc, statKey, matchDate, period),
                  profile: buildProfileSnapshotNew(homeProfileDoc, statKey, period),
                },
                away: {
                  optaRank: awayOptaData.optaRank,
                  optaRating: awayOptaData.optaRating,
                  wmaFor: buildWmaSnapshotNew(awayStatsDoc, statKey, matchDate, period),
                  wmaAgainst: buildWmaAgainstSnapshotNew(
                    awayStatsDoc,
                    statKey,
                    matchDate,
                    period,
                  ),
                  profile: buildProfileSnapshotNew(awayProfileDoc, statKey, period),
                },
              },
              formulaPredictions: {},
              metadata: {
                matchId: String(match.id ?? `${homeTeam}-${awayTeam}-${matchDate.toISOString()}`),
                date: matchDate.toISOString(),
                homeTeam,
                awayTeam,
                source: "teamstats",
                supervised: true,
                line: 0,
                odds: 0,
              },
            };

            const bundles = buildBundleByModeNew(baseContext);
            for (const featureMode of FEATURE_MODES_NEW) {
              await writer.append(bundles[featureMode], split);
            }
            created += 1;
          }
        }
      }
    }
  }
  return created;
}

export async function extractTrainingDataNew(options = {}) {
  const {
    limitBacktests = null,
    limitTeamStats = null,
    skipSupervised = false,
    skipExternal = false,
  } = options;
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI not found in environment");
  }

  const client = await connectMongoClientNew(mongoUri);

  try {
    const db = client.db(process.env.MONGODB_DB || "app");
    const backtestCol = db.collection("unibet-backtest");
    const leaguesCol = db.collection("leages-and-teams");
    const teamprofilesCol = db.collection("teamprofiles");
    const teamstatsCol = db.collection("teamstats");

    console.log("[extractTrainingData-new] Loading source collections...");
    const leaguesDocs = await runWithRetryNew("leagues-and-teams load", () =>
      loadDocsPagedNew(leaguesCol, {
        label: "leagues-and-teams",
        pageSize: 10,
      }),
    );
    const backtestMatches = await runWithRetryNew("unibet-backtest load", () =>
      loadDocsPagedNew(backtestCol, {
        label: "unibet-backtest",
        filter: { "lines.0": { $exists: true } },
        projection: {
          _id: 1,
          homeTeam: 1,
          awayTeam: 1,
          matchDate: 1,
          timestamp: 1,
          lines: 1,
        },
        pageSize: 25,
        limit: limitBacktests,
      }),
    );
    const allTeamStats = skipSupervised
      ? []
      : await runWithRetryNew("teamstats load", () =>
          loadDocsPagedNew(teamstatsCol, {
            label: "teamstats",
            projection: {
              _importMeta: 1,
              full: 1,
            },
            pageSize: 10,
            limit: limitTeamStats,
          }),
        );

    const leaguesData = createLeagueLookupNew(leaguesDocs);
    const externalMatches = skipExternal
      ? []
      : await loadExternalUnibetTests(EXTERNAL_BASE_NEW);
    const matches = [...backtestMatches, ...externalMatches];
    const relevantTeams = collectRelevantTeamsNew(matches, skipSupervised ? [] : allTeamStats);

    const usePartialCaches =
      (Number.isInteger(limitBacktests) && limitBacktests > 0) ||
      (Number.isInteger(limitTeamStats) && limitTeamStats > 0) ||
      skipSupervised;
    const teamProfileCache = usePartialCaches
      ? await loadTeamProfileCacheForTeamsNew(teamprofilesCol, relevantTeams)
      : await loadTeamProfileCacheNew(teamprofilesCol);
    const teamStatsCache = usePartialCaches
      ? await loadTeamStatsCacheForTeamsNew(teamstatsCol, relevantTeams)
      : await loadTeamStatsCacheNew(teamstatsCol);

    console.log(
      `[extractTrainingData-new] Loaded ${matches.length} backtest/external matches, ${allTeamStats.length} teamstats docs, ` +
        `${teamProfileCache.size} profiles, ${teamStatsCache.size} teamstats cache entries`,
    );

    const featureNameMap = Object.fromEntries(
      FEATURE_MODES_NEW.map((featureMode) => [
        featureMode,
        buildFeatureNamesNew(featureMode),
      ]),
    );
    const outputDir = path.join(process.cwd(), DATASETS_DIR_NEW);
    const writer = await createDatasetWriterNew({
      outputDir,
      featureNameMap,
      flushThreshold: 250,
    });

    console.log("[extractTrainingData-new] Extracting backtest samples...");
    const backtestCount = await extractFromBacktestsNew({
      writer,
      matches,
      leaguesData,
      teamProfileCache,
      teamStatsCache,
    });
    let supervisedCount = 0;
    if (!skipSupervised) {
      console.log("[extractTrainingData-new] Extracting supervised teamstats samples...");
      supervisedCount = await extractFromTeamStatsNew({
        writer,
        teamStatsDocs: allTeamStats,
        leaguesData,
        teamProfileCache,
        teamStatsCache,
      });
    }

    console.log("[extractTrainingData-new] Writing datasets and manifest...");
    const manifest = await writer.finalize();
    manifest.sources = {
      backtestSamples: backtestCount,
      supervisedSamples: supervisedCount,
    };
    await fs.writeFile(
      path.join(outputDir, "manifest-new.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );

    return manifest;
  } finally {
    await client.close();
  }
}

export function buildExtractionOptionsFromArgsNew(args) {
  return {
    limitBacktests: args.has("--limit-backtests")
      ? Number(args.get("--limit-backtests"))
      : null,
    limitTeamStats: args.has("--limit-teamstats")
      ? Number(args.get("--limit-teamstats"))
      : null,
    skipSupervised: args.has("--skip-supervised"),
    skipExternal: args.has("--skip-external"),
  };
}

function parseArgsToMapNew(argv) {
  const args = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current.startsWith("--")) {
      if (next && !next.startsWith("--")) {
        args.set(current, next);
        index += 1;
      } else {
        args.set(current, true);
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgsToMapNew(process.argv);
  const manifest = await extractTrainingDataNew({
    ...buildExtractionOptionsFromArgsNew(args),
  });
  console.log(
    `[extractTrainingData-new] Wrote ${manifest.comboCount} combos to ${DATASETS_DIR_NEW}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[extractTrainingData-new] Failed:", error);
    process.exitCode = 1;
  });
}
