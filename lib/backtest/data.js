// import clientPromise from "../mongo";
// import { createCache } from "./cache";
// import { logServerBacktestStep } from "./logger";

// const DAY_IN_MS = 24 * 60 * 60 * 1000;
// const TEAM_MATCH_CACHE = createCache({ ttlMs: DAY_IN_MS });
// const TEAM_PROFILE_CACHE = createCache({ ttlMs: DAY_IN_MS });
// const LEAGUES_CACHE = createCache({ ttlMs: DAY_IN_MS });

// function normalizeTeamName(name) {
//   return String(name || "")
//     .toLowerCase()
//     .normalize("NFD")
//     .replace(/[\u0300-\u036f]/g, "")
//     .replace(/\s+/g, " ")
//     .trim();
// }

// function slugifyTeamName(name) {
//   return normalizeTeamName(name).replace(/[^a-z0-9]+/g, "_");
// }

// function resolveTeamStatsCacheKey(teamName, matchType) {
//   return `team:${slugifyTeamName(teamName)}:${matchType}`;
// }

// async function queryTeamStatsDocument(filter, teamName, matchType) {
//   const client = await clientPromise;
//   const db = client.db(process.env.MONGODB_DB || "app");
//   const col = db.collection("teamstats");

//   logServerBacktestStep("Databasen söker efter teamstats-dokument.", {
//     filter,
//     teamName,
//     matchType,
//   });

//   const doc = await col
//     .find(filter)
//     .sort({ "_importMeta.importedAt": -1, "full.0.timestamp": -1 })
//     .limit(1)
//     .next();

//   if (doc) {
//     logServerBacktestStep("Teamstats hittades i databasen.", {
//       teamName,
//       matchType,
//       sourceFile: doc?._importMeta?.sourceFile,
//       matchCount: Array.isArray(doc?.full) ? doc.full.length : 0,
//     });
//   } else {
//     logServerBacktestStep("Teamstats saknas i databasen.", { teamName, matchType });
//   }

//   return doc;
// }

// // export async function fetchTeamMatches(teamName, matchType = "home") {
// //   if (!teamName) return [];
// //   const cacheKey = resolveTeamStatsCacheKey(teamName, matchType);
// //   const cached = TEAM_MATCH_CACHE.get(cacheKey);
// //   if (cached) {
// //     logServerBacktestStep("Matcher hämtades från cacheminnet.", {
// //       teamName,
// //       matchType,
// //       count: cached.length,
// //     });
// //     return cached;
// //   }

// //   const filterCandidates = [
// //     { "_importMeta.sourceFile": `${slugifyTeamName(teamName)}_${matchType}_match_stats.json` },
// //     matchType === "home"
// //       ? { "full.0.homeTeamName": teamName }
// //       : { "full.0.awayTeamName": teamName },
// //   ];

// //   let doc = null;
// //   for (const filter of filterCandidates) {
// //     doc = await queryTeamStatsDocument(filter, teamName, matchType);
// //     if (doc) break;
// //   }

// //   const matches = Array.isArray(doc?.full) ? doc.full : [];
// //   TEAM_MATCH_CACHE.set(cacheKey, matches);
// //   logServerBacktestStep("Matcher hämtas från databasen och cachas.", {
// //     teamName,
// //     matchType,
// //     count: matches.length,
// //   });
// //   return matches;
// // }


// export async function fetchTeamMatches(
//   teamName,
//   matchType = "home",
//   options = {}
// ) {
//   const { limit } = options;
//   if (!teamName) return [];

//   const cacheKey = `team:${teamName}|${matchType}|limit:${limit ?? "all"}`;
//   const cached = TEAM_MATCH_CACHE.get(cacheKey);
//   if (cached) {
//     logServerBacktestStep("Matcher hämtades från cacheminnet.", {
//       teamName,
//       matchType,
//       count: cached.length,
//       limit: limit ?? "all",
//     });
//     return cached;
//   }

//   const client = await clientPromise;
//   const db = client.db(process.env.MONGODB_DB || "app");
//   const col = db.collection("teamstats");

//   // Primär matchning: exakt metadata (det du sparar i import-scriptet)
//   const primaryFilter = {
//     "_importMeta.teamName": teamName,
//     "_importMeta.teamRole": matchType,
//   };

//   // Fallback: om primär inte finns, använd första posten i full.*TeamName
//   const fallbackFilter =
//     matchType === "home"
//       ? { "full.0.homeTeamName": teamName }
//       : { "full.0.awayTeamName": teamName };

//   let doc =
//     (await col
//       .find(primaryFilter, { projection: { full: 1, _importMeta: 1 } })
//       .sort({ "_importMeta.importedAt": -1 })
//       .limit(1)
//       .next()) ||
//     (await col
//       .find(fallbackFilter, { projection: { full: 1, _importMeta: 1 } })
//       .sort({ "_importMeta.importedAt": -1 })
//       .limit(1)
//       .next());

//   const all = Array.isArray(doc?.full) ? doc.full : [];
//   const matches = Number.isFinite(limit)
//     ? all.slice(0, Math.max(0, limit))
//     : all;

//   TEAM_MATCH_CACHE.set(cacheKey, matches);
//   logServerBacktestStep("Matcher hämtas från databasen och cachas.", {
//     teamName,
//     matchType,
//     count: matches.length,
//     sourceFile: doc?._importMeta?.sourceFile,
//   });

//   return matches;
// }


// function buildProfileCacheKey(teamName, matchType) {
//   return `profile:${slugifyTeamName(teamName)}:${matchType}`;
// }

// function buildProfileRegex(teamName) {
//   const escaped = String(teamName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//   return new RegExp(`^${escaped}$`, "i");
// }

// async function queryTeamProfile(teamName, matchType) {
//   const client = await clientPromise;
//   const db = client.db(process.env.MONGODB_DB || "app");
//   const col = db.collection("teamprofiles");

//   const filter = {
//     "meta.matchType": matchType,
//     "meta.lagnamn": buildProfileRegex(teamName),
//   };

//   logServerBacktestStep("Databasen söker efter lagprofil.", {
//     teamName,
//     matchType,
//     filter,
//   });

//   const doc = await col.findOne(filter, { projection: { _id: 0 } });

//   if (doc) {
//     logServerBacktestStep("Lagprofil hittades i databasen.", {
//       teamName,
//       matchType,
//       ligaId: doc?.meta?.ligaId,
//       lagId: doc?.meta?.lagId,
//     });
//   } else {
//     logServerBacktestStep("Lagprofil saknas i databasen.", { teamName, matchType });
//   }

//   return doc;
// }

// export async function fetchTeamProfile(teamName, matchType) {
//   if (!teamName || !matchType) return null;
//   const cacheKey = buildProfileCacheKey(teamName, matchType);
//   const cached = TEAM_PROFILE_CACHE.get(cacheKey);
//   if (cached) {
//     logServerBacktestStep("Lagprofil hämtades från cacheminnet.", {
//       teamName,
//       matchType,
//     });
//     return cached;
//   }

//   const doc = await queryTeamProfile(teamName, matchType);
//   TEAM_PROFILE_CACHE.set(cacheKey, doc);
//   return doc;
// }

// export async function fetchTeamProfilesBundle(teamName) {
//   const [homeProfile, awayProfile] = await Promise.all([
//     fetchTeamProfile(teamName, "home"),
//     fetchTeamProfile(teamName, "away"),
//   ]);
//   return { home: homeProfile, away: awayProfile };
// }

// export async function loadLeagueRankings() {
//   logServerBacktestStep(
//     "Begäran om ligatabeller omdirigeras eftersom lagprofiler används istället."
//   );
//   return [];
// }

// export async function fetchLeaguesAndTeams() {
//   const cached = LEAGUES_CACHE.get("leagues");
//   if (cached) {
//     logServerBacktestStep("Ligadata hämtades från cache.");
//     return cached;
//   }

//   const client = await clientPromise;
//   const db = client.db(process.env.MONGODB_DB || "app");
//   const col = db.collection("leagues-and-teams");

//   const docs = await col
//     .find({}, { projection: { _id: 0 } })
//     .toArray();

//   const combined = {};
//   for (const doc of docs) {
//     if (!doc || typeof doc !== "object") continue;
//     for (const [key, value] of Object.entries(doc)) {
//       if (!key || key === "_id") continue;
//       combined[key] = value;
//     }
//   }

//   LEAGUES_CACHE.set("leagues", combined);
//   logServerBacktestStep("Ligadata hämtades från databasen och cachas.", {
//     leagues: Object.keys(combined).length,
//   });
//   return combined;
// }

import fs from "node:fs/promises";
import path from "node:path";

import clientPromise from "../mongo.js";
import { createCache } from "./cache.js";
import { logServerBacktestStep } from "./logger.js";

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

// ⚠️ slugify borttagen

function resolveTeamStatsCacheKey(teamName, matchType, limit) {
  // använd original teamName; inkludera limit i nyckeln så cachar inte fel
  return `team:${teamName}|role:${matchType}|limit:${limit ?? "all"}`;
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
    .find(filter, { projection: { full: 1, _importMeta: 1 } })
    .sort({ "_importMeta.importedAt": -1 })
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
    logServerBacktestStep("Teamstats saknas i databasen.", {
      teamName,
      matchType,
    });
  }

  return doc;
}

export async function fetchTeamMatches(
  teamName,
  matchType = "home",
  options = {}
) {
  const { limit } = options;
  if (!teamName) return [];

  const cacheKey = resolveTeamStatsCacheKey(teamName, matchType, limit);
  const cached = TEAM_MATCH_CACHE.get(cacheKey);
  if (cached) {
    logServerBacktestStep("Matcher hämtades från cacheminnet.", {
      teamName,
      matchType,
      count: cached.length,
      limit: limit ?? "all",
    });
    return cached;
  }

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const col = db.collection("teamstats");

  // Primär: matcha exakt på metadata från importen
  const primaryFilter = {
    "_importMeta.teamName": { $regex: `^${teamName}$`, $options: "i" },
    "_importMeta.teamRole": matchType 
  };

  // Fallback: om primär saknas, titta på första posten i full.*TeamName
  const fallbackFilter =
    matchType === "home"
      ? { "full.0.homeTeamName": { $regex: `^${teamName}$`, $options: "i" } }
      : { "full.0.awayTeamName": { $regex: `^${teamName}$`, $options: "i" } };

  let doc =
    (await queryTeamStatsDocument(primaryFilter, teamName, matchType)) ||
    (await queryTeamStatsDocument(fallbackFilter, teamName, matchType));

  const all = Array.isArray(doc?.full) ? doc.full : [];
  const matches = Number.isFinite(limit)
    ? all.slice(0, Math.max(0, limit))
    : all;

  TEAM_MATCH_CACHE.set(cacheKey, matches);
  logServerBacktestStep("Matcher hämtas från databasen och cachas.", {
    teamName,
    matchType,
    count: matches.length,
    sourceFile: doc?._importMeta?.sourceFile,
  });

  return matches;
}

function buildProfileCacheKey(teamName, matchType) {
  // slugify borttagen – använd originalnamn
  return `profile:${teamName}|${matchType}`;
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
    logServerBacktestStep("Lagprofil saknas i databasen.", {
      teamName,
      matchType,
    });
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

let leagueRankingPromise = null;
const DEFAULT_LEAGUE_RANKING_URL =
  "https://bettingmodel-backend.onrender.com/league_ranking.json";

const SHOULD_LOG_LEAGUE_RANKING = process.env.LOG_LEAGUE_RANKING === "1";

async function readLocalLeagueRanking() {
  const filePath = path.join(process.cwd(), "data", "league_ranking.json");
  try {
    const txt = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(txt);
    if (Array.isArray(data)) {
      if (SHOULD_LOG_LEAGUE_RANKING) {
        logServerBacktestStep("Läste league_ranking.json lokalt.", {
          entries: data.length,
        });
      }
      return data;
    }
  } catch (err) {
    if (SHOULD_LOG_LEAGUE_RANKING) {
      logServerBacktestStep("Kunde inte läsa lokal league_ranking.json.", {
        error: err?.message,
      });
    }
  }
  return null;
}

async function fetchLeagueRankingFromUrl(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json().catch(() => null);
    if (Array.isArray(data)) {
      if (SHOULD_LOG_LEAGUE_RANKING) {
        logServerBacktestStep("Hämtade league_ranking via nätverk.", {
          url,
          entries: data.length,
        });
      }
      return data;
    }
  } catch (err) {
    if (SHOULD_LOG_LEAGUE_RANKING) {
      logServerBacktestStep("Nätverksfel för league_ranking.json.", {
        url,
        error: err?.message,
      });
    }
  }
  return null;
}

export async function loadLeagueRankings() {
  if (!leagueRankingPromise) {
    leagueRankingPromise = (async () => {
      const local = await readLocalLeagueRanking();
      if (local) return local;

      const urls = [];
      if (process.env.LEAGUE_RANKING_URL) {
        urls.push(process.env.LEAGUE_RANKING_URL);
      }
      if (process.env.BACKEND_BASE_URL) {
        urls.push(
          `${process.env.BACKEND_BASE_URL.replace(/\/$/, "")}/league_ranking.json`
        );
      }
      urls.push(DEFAULT_LEAGUE_RANKING_URL);

      for (const url of urls) {
        const data = await fetchLeagueRankingFromUrl(url);
        if (data) return data;
      }

      if (SHOULD_LOG_LEAGUE_RANKING) {
        logServerBacktestStep(
          "league_ranking.json saknas – fortsätter utan ligasnitt.",
          {}
        );
      }
      return [];
    })();
  }
  return leagueRankingPromise;
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

  const docs = await col.find({}, { projection: { _id: 0 } }).toArray();

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
