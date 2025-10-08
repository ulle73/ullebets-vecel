import clientPromise from "../mongo";
import { createCache } from "./cache";
import { logServerBacktestStep } from "./logger";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const TEAM_MATCH_CACHE = createCache({ ttlMs: DAY_IN_MS });
const TEAM_PROFILE_CACHE = createCache({ ttlMs: DAY_IN_MS });
const LEAGUES_CACHE = createCache({ ttlMs: DAY_IN_MS });

function normalizeTeamName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyTeamName(name) {
  return normalizeTeamName(name).replace(/[^a-z0-9]+/g, "_");
}

function resolveTeamStatsCacheKey(teamName, matchType) {
  return `team:${slugifyTeamName(teamName)}:${matchType}`;
}

async function queryTeamStatsDocument(filter, teamName, matchType) {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const col = db.collection("teamstats");

  logServerBacktestStep("Databasen söker efter teamstats-dokument.", {
    filter,
    teamName,
    matchType,
  });

  const doc = await col
    .find(filter)
    .sort({ "_importMeta.importedAt": -1, "full.0.timestamp": -1 })
    .limit(1)
    .next();

  if (doc) {
    logServerBacktestStep("Teamstats hittades i databasen.", {
      teamName,
      matchType,
      sourceFile: doc?._importMeta?.sourceFile,
      matchCount: Array.isArray(doc?.full) ? doc.full.length : 0,
    });
  } else {
    logServerBacktestStep("Teamstats saknas i databasen.", { teamName, matchType });
  }

  return doc;
}

export async function fetchTeamMatches(teamName, matchType = "home") {
  if (!teamName) return [];
  const cacheKey = resolveTeamStatsCacheKey(teamName, matchType);
  const cached = TEAM_MATCH_CACHE.get(cacheKey);
  if (cached) {
    logServerBacktestStep("Matcher hämtades från cacheminnet.", {
      teamName,
      matchType,
      count: cached.length,
    });
    return cached;
  }

  const filterCandidates = [
    { "_importMeta.sourceFile": `${slugifyTeamName(teamName)}_${matchType}_match_stats.json` },
    matchType === "home"
      ? { "full.0.homeTeamName": teamName }
      : { "full.0.awayTeamName": teamName },
  ];

  let doc = null;
  for (const filter of filterCandidates) {
    doc = await queryTeamStatsDocument(filter, teamName, matchType);
    if (doc) break;
  }

  const matches = Array.isArray(doc?.full) ? doc.full : [];
  TEAM_MATCH_CACHE.set(cacheKey, matches);
  logServerBacktestStep("Matcher hämtas från databasen och cachas.", {
    teamName,
    matchType,
    count: matches.length,
  });
  return matches;
}

function buildProfileCacheKey(teamName, matchType) {
  return `profile:${slugifyTeamName(teamName)}:${matchType}`;
}

function buildProfileRegex(teamName) {
  const escaped = String(teamName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`, "i");
}

async function queryTeamProfile(teamName, matchType) {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const col = db.collection("teamprofiles");

  const filter = {
    "meta.matchType": matchType,
    "meta.lagnamn": buildProfileRegex(teamName),
  };

  logServerBacktestStep("Databasen söker efter lagprofil.", {
    teamName,
    matchType,
    filter,
  });

  const doc = await col.findOne(filter, { projection: { _id: 0 } });

  if (doc) {
    logServerBacktestStep("Lagprofil hittades i databasen.", {
      teamName,
      matchType,
      ligaId: doc?.meta?.ligaId,
      lagId: doc?.meta?.lagId,
    });
  } else {
    logServerBacktestStep("Lagprofil saknas i databasen.", { teamName, matchType });
  }

  return doc;
}

export async function fetchTeamProfile(teamName, matchType) {
  if (!teamName || !matchType) return null;
  const cacheKey = buildProfileCacheKey(teamName, matchType);
  const cached = TEAM_PROFILE_CACHE.get(cacheKey);
  if (cached) {
    logServerBacktestStep("Lagprofil hämtades från cacheminnet.", {
      teamName,
      matchType,
    });
    return cached;
  }

  const doc = await queryTeamProfile(teamName, matchType);
  TEAM_PROFILE_CACHE.set(cacheKey, doc);
  return doc;
}

export async function fetchTeamProfilesBundle(teamName) {
  const [homeProfile, awayProfile] = await Promise.all([
    fetchTeamProfile(teamName, "home"),
    fetchTeamProfile(teamName, "away"),
  ]);
  return { home: homeProfile, away: awayProfile };
}

export async function loadLeagueRankings() {
  logServerBacktestStep(
    "Begäran om ligatabeller omdirigeras eftersom lagprofiler används istället."
  );
  return [];
}

export async function fetchLeaguesAndTeams() {
  const cached = LEAGUES_CACHE.get("leagues");
  if (cached) {
    logServerBacktestStep("Ligadata hämtades från cache.");
    return cached;
  }

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const col = db.collection("leagues-and-teams");

  const docs = await col
    .find({}, { projection: { _id: 0 } })
    .toArray();

  const combined = {};
  for (const doc of docs) {
    if (!doc || typeof doc !== "object") continue;
    for (const [key, value] of Object.entries(doc)) {
      if (!key || key === "_id") continue;
      combined[key] = value;
    }
  }

  LEAGUES_CACHE.set("leagues", combined);
  logServerBacktestStep("Ligadata hämtades från databasen och cachas.", {
    leagues: Object.keys(combined).length,
  });
  return combined;
}
