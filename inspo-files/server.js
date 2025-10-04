import express from "express";
import { spawn } from "child_process";
import fs from "fs/promises";
import cors from "cors";
import axios from "axios";
import { fetchUnibetOdds, fetchUnibetOddsPredictions } from "./unibet.js";
import {
  computeTeamOpponentShotBuckets,
  DEFAULT_STAT_KEYS,

  DEFAULT_PERIODS,
  DEFAULT_PERSPECTIVES,
  predictStatsForOpponent,

} from "./utils/optaOpponentBuckets.js";
import {
  getTeamLeadMetrics,
  getTeamLeadMetricsForTeams,
} from "./utils/teamLeadAnalysis.js";
import path from "path";
import { fileURLToPath } from "url";
import { statSync, existsSync, mkdirSync } from "fs";
import { v4 as uuidv4 } from "uuid"; // Importera uuid med ES-moduler
import dotenv from "dotenv";
import puppeteer from "puppeteer";

dotenv.config();


// 🔹 Omvandla import.meta.url till __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// 🔹 Path to activity log file (allow custom directory via LOG_DIR)
const logDir = process.env.LOG_DIR || __dirname;
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}
const logFilePath = path.join(logDir, "activity.json");

// 🔹 Load existing logs from file
let logs = [];
try {
  const data = await fs.readFile(logFilePath, "utf-8");
  logs = JSON.parse(data);
} catch (err) {
  if (err.code === "ENOENT") {
    await fs.writeFile(logFilePath, "[]");
  } else {
    console.error("Failed to load logs", err);
  }
}

// Helper to get a single client IP
const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  return forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress;
};

// Helper to log an action with additional details
async function logAction(section, details, req) {
  const entry = {
    timestamp: new Date().toISOString(),
    ip: getClientIp(req),
    userAgent: req.headers["user-agent"],
    section,
    details,
  };
  logs.push(entry);
  try {
    await fs.writeFile(logFilePath, JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error("Failed to write log", err);
  }
}

function verifyPassword(req, res, next) {
  const password = req.headers["x-admin-password"];
  if (password && password === process.env.ADMIN_PASSWORD) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
}

const VIP_SESSION_TTL = 12 * 60 * 60 * 1000;
const vipSessions = new Map();
const VIP_STAT_KEYS = [
  "totalShotsOnGoal",
  "shotsOnGoal",
  "cornerKicks",
  "yellowCards",
  "fouls",
  "totalTackle",
  "offsides",
  "throwIns",
  "goalKicks",
];
const VIP_ALLOWED_MATCH_COUNTS = new Set(["3", "5", "10", "all"]);
const VIP_ALLOWED_PERIODS = new Set(["ALL", "1ST", "2ND"]);
const VIP_RECENT_MATCH_LIMIT = 6;
const teamstatsDir = path.join(__dirname, "teamstats");

const safeTeamSlug = (name = "") => name.toLowerCase().replace(/\s/g, "_");

const rapidApiKeys = [
  process.env.RAPIDAPI_KEY ||
    "2421949038msh47b6bd3f6b5c077p151577jsn42ebd0d9888a",
  "d26361d6a1msh55def5349c5e57dp1eaee1jsn74e247833a6e",
  "c347347d96msh753a5e5acbca775p174d61jsn4ddb08841042",
  "bcc2fe6d26msh84d34b156ba870fp1269cejsn3c65899c262e",
  "adb090d6e6msh09b5af9b62cab53p18ec97jsnf66f393501ab",
  "9ccda5724cmsh62c63c5c9b7bbb4p1a2637jsnfbfacc616c38",
  "d71b975b3bmsh119f2182f5f36a2p132437jsnc623beefd032",
  "bcc2fe6d26msh84d34b156ba870fp1269cejsn3c65899c262e",
  "458c4dc749msh93ad163f4a8f4efp13ac33jsn776bb3a83b55",
  "87b25a4718msh550e88b539cccfep180203jsna7971b255886",
];

const matchesFetchCache = new Map();

const stockholmDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const getStockholmDateString = (date = new Date()) =>
  stockholmDateFormatter.format(date);

const normalizeTeamName = (value = "") =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// async function fetchScheduledEvents(matchDate) {
//   const apiUrl = `https://sportapi7.p.rapidapi.com/api/v1/sport/football/scheduled-events/${matchDate}`;

//   const cacheFileBase = path.join(__dirname, `matches-${matchDate}`);
//   const cacheCandidates = [
//     `${cacheFileBase}.json`,
//     cacheFileBase,
//   ];

//   for (const candidate of cacheCandidates) {
//     if (!existsSync(candidate)) {
//       continue;
//     }

//     try {
//       const cachedRaw = await fs.readFile(candidate, "utf-8");
//       const cachedData = JSON.parse(cachedRaw);

//       if (Array.isArray(cachedData) && cachedData.length) {
//         return cachedData.map((entry) => {
//           if (
//             entry &&
//             typeof entry === "object" &&
//             !Array.isArray(entry) &&
//             typeof entry.homeTeam === "string" &&
//             typeof entry.awayTeam === "string"
//           ) {
//             return {
//               id: entry.matchId,
//               matchId: entry.matchId,
//               startTimestamp: entry.startTimestamp,
//               homeTeam:
//                 typeof entry.homeTeam === "string"
//                   ? { name: entry.homeTeam }
//                   : entry.homeTeam,
//               awayTeam:
//                 typeof entry.awayTeam === "string"
//                   ? { name: entry.awayTeam }
//                   : entry.awayTeam,
//               tournament:
//                 entry.leagueId !== undefined
//                   ? { uniqueTournament: { id: entry.leagueId } }
//                   : undefined,
//             };
//           }

//           return entry;
//         });
//       }
//     } catch (error) {
//       console.warn(
//         `VIP matches: failed to read cached scheduled events from ${path.basename(
//           candidate
//         )} – ${error.message}`
//       );
//     }
//   }

//   for (const apiKey of rapidApiKeys) {
//     try {
//       const response = await axios.get(apiUrl, {
//         headers: {
//           "x-rapidapi-key": apiKey,
//           "x-rapidapi-host": "sportapi7.p.rapidapi.com",
//         },
//       });

//       if (response.status === 200) {
//         return Array.isArray(response.data?.events)
//           ? response.data.events
//           : [];
//       }
//       console.warn(
//         `VIP matches: RapidAPI key ...${apiKey.slice(-4)} returned HTTP ${response.status}`
//       );
//     } catch (error) {
//       console.warn(
//         `VIP matches: RapidAPI key ...${apiKey.slice(-4)} failed – ${error.message}`
//       );
//     }
//   }

//   console.error("VIP matches: all RapidAPI keys failed");
//   return [];
// }


// async function fetchScheduledEvents(matchDate) {
//   const apiUrl = `https://sportapi7.p.rapidapi.com/api/v1/sport/football/scheduled-events/${matchDate}`;

//   const cacheFileBase = path.join(__dirname, `matches-${matchDate}`);
//   const cacheCandidates = [`${cacheFileBase}.json`, cacheFileBase];

//   for (const candidate of cacheCandidates) {
//     if (!existsSync(candidate)) {
//       continue;
//     }

//     try {
//       const cachedRaw = await fs.readFile(candidate, "utf-8");
//       const cachedData = JSON.parse(cachedRaw);

//       if (Array.isArray(cachedData) && cachedData.length) {
//         return cachedData.map((entry) => {
//           if (
//             entry &&
//             typeof entry === "object" &&
//             !Array.isArray(entry) &&
//             typeof entry.homeTeam === "string" &&
//             typeof entry.awayTeam === "string"
//           ) {
//             return {
//               id: entry.matchId,
//               matchId: entry.matchId,
//               startTimestamp: entry.startTimestamp,
//               homeTeam:
//                 typeof entry.homeTeam === "string"
//                   ? { name: entry.homeTeam }
//                   : entry.homeTeam,
//               awayTeam:
//                 typeof entry.awayTeam === "string"
//                   ? { name: entry.awayTeam }
//                   : entry.awayTeam,
//               tournament:
//                 entry.leagueId !== undefined
//                   ? { uniqueTournament: { id: entry.leagueId } }
//                   : undefined,
//             };
//           }

//           return entry;
//         });
//       }
//     } catch (error) {
//       console.warn(
//         `VIP matches: failed to read cached scheduled events from ${path.basename(
//           candidate
//         )} – ${error.message}`
//       );
//     }
//   }

//   // RapidAPI-försök (oförändrat beteende, plus source-logg)
//   for (const apiKey of rapidApiKeys) {
//     try {
//       const response = await axios.get(apiUrl, {
//         headers: {
//           "x-rapidapi-key": apiKey,
//           "x-rapidapi-host": "sportapi7.p.rapidapi.com",
//         },
//         validateStatus: () => true,
//       });

//       if (response.status === 200) {
//         const events = Array.isArray(response.data?.events)
//           ? response.data.events
//           : [];
//         console.log(
//           `VIP matches: scheduled events hämtade via rapid (key ...${apiKey.slice(
//             -4
//           )})`
//         );
//         return events;
//       }
//       console.warn(
//         `VIP matches: RapidAPI key ...${apiKey.slice(-4)} returned HTTP ${
//           response.status
//         }`
//       );
//     } catch (error) {
//       console.warn(
//         `VIP matches: RapidAPI key ...${apiKey.slice(-4)} failed – ${
//           error.message
//         }`
//       );
//     }
//   }

//   // --- FALLBACK: SofaScore via Puppeteer, samma stil som i filen ---
//   const sofaUrl = `https://www.sofascore.com/api/v1/sport/football/scheduled-events/${matchDate}`;
//   let browser = null;
//   try {
//     browser = await puppeteer.launch({ headless: "new" });
//     const page = await browser.newPage();
//     await page.setUserAgent(
//       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
//     );
//     // Etablera session (samma approach som övriga puppeteer-anrop i filen)
//     await page.goto("https://www.sofascore.com/", {
//       waitUntil: "domcontentloaded",
//     });

//     const data = await page.evaluate(async (u) => {
//       try {
//         const r = await fetch(u, {
//           method: "GET",
//           headers: { accept: "application/json, text/plain, */*" },
//         });
//         if (!r.ok) return null; // håll samma kontrakt som browserFetch
//         return await r.json();
//       } catch {
//         return null;
//       }
//     }, sofaUrl);

//     const events = Array.isArray(data?.events) ? data.events : [];
//     if (events.length) {
//       console.log(`VIP matches: scheduled events hämtade via sofascore`);
//     } else {
//       console.warn(
//         `VIP matches: SofaScore gav tomt svar eller saknar 'events'`
//       );
//     }
//     return events;
//   } catch (err) {
//     console.error(
//       `VIP matches: SofaScore-fallback misslyckades – ${err?.message || err}`
//     );
//     return [];
//   } finally {
//     if (browser) {
//       try {
//         await browser.close();
//       } catch {}
//     }
//   }
// }


async function fetchScheduledEvents(matchDate) {
  const apiUrl = `https://sportapi7.p.rapidapi.com/api/v1/sport/football/scheduled-events/${matchDate}`;

  const cacheFileBase = path.join(__dirname, `matches-${matchDate}`);
  const cacheCandidates = [`${cacheFileBase}.json`, cacheFileBase];

  for (const candidate of cacheCandidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const cachedRaw = await fs.readFile(candidate, "utf-8");
      const cachedData = JSON.parse(cachedRaw);

      if (Array.isArray(cachedData) && cachedData.length) {
        return cachedData.map((entry) => {
          if (
            entry &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            typeof entry.homeTeam === "string" &&
            typeof entry.awayTeam === "string"
          ) {
            return {
              id: entry.matchId,
              matchId: entry.matchId,
              startTimestamp: entry.startTimestamp,
              homeTeam:
                typeof entry.homeTeam === "string"
                  ? { name: entry.homeTeam }
                  : entry.homeTeam,
              awayTeam:
                typeof entry.awayTeam === "string"
                  ? { name: entry.awayTeam }
                  : entry.awayTeam,
              tournament:
                entry.leagueId !== undefined
                  ? { uniqueTournament: { id: entry.leagueId } }
                  : undefined,
            };
          }

          return entry;
        });
      }
    } catch (error) {
      console.warn(
        `VIP matches: failed to read cached scheduled events from ${path.basename(
          candidate
        )} – ${error.message}`
      );
    }
  }

  // RapidAPI-försök (oförändrat beteende, plus source-logg)
  for (const apiKey of rapidApiKeys) {
    try {
      const response = await axios.get(apiUrl, {
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": "sportapi7.p.rapidapi.com",
        },
        validateStatus: () => true,
      });

      if (response.status === 200) {
        const events = Array.isArray(response.data?.events)
          ? response.data.events
          : [];
        console.log(
          `VIP matches: scheduled events hämtade via rapid (key ...${apiKey.slice(
            -4
          )})`
        );
        return events;
      }
      console.warn(
        `VIP matches: RapidAPI key ...${apiKey.slice(-4)} returned HTTP ${
          response.status
        }`
      );
    } catch (error) {
      console.warn(
        `VIP matches: RapidAPI key ...${apiKey.slice(-4)} failed – ${
          error.message
        }`
      );
    }
  }

  // --- NY FALLBACK 1: sport-api-real-time via RapidAPI (korrekt URL + params) ---
  {
    const categoryId = "1"; // krävs av denna endpoint
    const rtUrl =
      "https://sport-api-real-time.p.rapidapi.com/tournaments/scheduled-events";
    for (const apiKey of rapidApiKeys) {
      try {
        const response = await axios.get(rtUrl, {
          params: { categoryId, date: matchDate },
          headers: {
            "x-rapidapi-key": apiKey,
            "x-rapidapi-host": "sport-api-real-time.p.rapidapi.com",
          },
          validateStatus: () => true,
        });

        if (response.status === 200) {
          const events = Array.isArray(response.data?.events)
            ? response.data.events
            : [];
          console.log(
            `VIP matches: scheduled events hämtade via rapid(sport-api-real-time) (key ...${apiKey.slice(
              -4
            )})`
          );
          return events;
        }
        console.warn(
          `VIP matches: sport-api-real-time key ...${apiKey.slice(
            -4
          )} returned HTTP ${response.status}`
        );
      } catch (error) {
        console.warn(
          `VIP matches: sport-api-real-time key ...${apiKey.slice(
            -4
          )} failed – ${error.message}`
        );
      }
    }
  }

  // --- NY FALLBACK 2: sofascore via RapidAPI (korrekt URL + params) ---
  {
    const categoryId = "1"; // krävs av denna endpoint
    const sofaRapidUrl =
      "https://sofascore.p.rapidapi.com/tournaments/get-scheduled-events";
    for (const apiKey of rapidApiKeys) {
      try {
        const response = await axios.get(sofaRapidUrl, {
          params: { categoryId, date: matchDate },
          headers: {
            "x-rapidapi-key": apiKey,
            "x-rapidapi-host": "sofascore.p.rapidapi.com",
          },
          validateStatus: () => true,
        });

        if (response.status === 200) {
          const events = Array.isArray(response.data?.events)
            ? response.data.events
            : [];
          console.log(
            `VIP matches: scheduled events hämtade via rapid(sofascore) (key ...${apiKey.slice(
              -4
            )})`
          );
          return events;
        }
        console.warn(
          `VIP matches: rapid(sofascore) key ...${apiKey.slice(
            -4
          )} returned HTTP ${response.status}`
        );
      } catch (error) {
        console.warn(
          `VIP matches: rapid(sofascore) key ...${apiKey.slice(-4)} failed – ${
            error.message
          }`
        );
      }
    }
  }

  // --- FALLBACK: SofaScore via Puppeteer (oförändrad) ---
  const sofaUrl = `https://www.sofascore.com/api/v1/sport/football/scheduled-events/${matchDate}`;
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
    );
    await page.goto("https://www.sofascore.com/", {
      waitUntil: "domcontentloaded",
    });

    const data = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, {
          method: "GET",
          headers: { accept: "application/json, text/plain, */*" },
        });
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    }, sofaUrl);

    const events = Array.isArray(data?.events) ? data.events : [];
    if (events.length) {
      console.log(`VIP matches: scheduled events hämtade via sofascore`);
    } else {
      console.warn(
        `VIP matches: SofaScore gav tomt svar eller saknar 'events'`
      );
    }
    return events;
  } catch (err) {
    console.error(
      `VIP matches: SofaScore-fallback misslyckades – ${err?.message || err}`
    );
    return [];
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}



async function refreshMatchesForDate(matchDate) {
  if (!matchDate) {
    return [];
  }

  if (matchesFetchCache.has(matchDate)) {
    return matchesFetchCache.get(matchDate);
  }

  const fetchPromise = (async () => {
    const matchesFilePath = path.join(__dirname, `matches-${matchDate}.json`);
    const leaguesPath = path.join(__dirname, "leagues-and-teams.json");

    const leaguesDataRaw = await fs.readFile(leaguesPath, "utf-8");
    const leaguesData = JSON.parse(leaguesDataRaw);
    const allLeagueIds = Object.values(leaguesData).map((entry) => entry.leagueId);

    let matches = [];
    if (existsSync(matchesFilePath)) {
      try {
        const cached = await fs.readFile(matchesFilePath, "utf-8");
        matches = JSON.parse(cached);
      } catch (error) {
        console.warn(
          `VIP matches: failed to read cached matches for ${matchDate} – ${error.message}`
        );
      }
    }

    if (!Array.isArray(matches) || !matches.length) {
      const events = await fetchScheduledEvents(matchDate);
      if (!events.length) {
        matches = [];
      } else {
        matches = events
          .filter((event) => {
            const start = Number(event.startTimestamp) * 1000;
            const eventDate = getStockholmDateString(new Date(start));
            const leagueId =
              event.tournament?.uniqueTournament?.id ?? event.tournament?.id;
            return (
              eventDate === matchDate &&
              (leagueId ? allLeagueIds.includes(leagueId) : false)
            );
          })
          .map((event) => ({
            homeTeam: event.homeTeam?.name,
            awayTeam: event.awayTeam?.name,
            matchId: event.id,
            startTimestamp: event.startTimestamp,
            date: getStockholmDateString(new Date(event.startTimestamp * 1000)),
            leagueId: event.tournament?.uniqueTournament?.id,
          }));

        try {
          await fs.writeFile(matchesFilePath, JSON.stringify(matches, null, 4));
        } catch (error) {
          console.warn(
            `VIP matches: failed to write matches-${matchDate}.json – ${error.message}`
          );
        }
      }
    }

    const outputPath = path.join(__dirname, "allstats-teams.json");
    try {
      await fs.writeFile(outputPath, JSON.stringify(matches, null, 4));
    } catch (error) {
      console.warn(
        `VIP matches: failed to update allstats-teams.json – ${error.message}`
      );
    }

    return matches;
  })();

  matchesFetchCache.set(matchDate, fetchPromise);

  try {
    const result = await fetchPromise;
    return result;
  } catch (error) {
    matchesFetchCache.delete(matchDate);
    throw error;
  }
}

async function persistMatchLineups(matchDate, matchId, payload) {
  if (!matchDate || !matchId || !payload) {
    return;
  }

  const matchesFilePath = path.join(__dirname, `matches-${matchDate}.json`);

  if (!existsSync(matchesFilePath)) {
    return;
  }

  let matchesFromFile;
  try {
    const raw = await fs.readFile(matchesFilePath, "utf-8");
    matchesFromFile = JSON.parse(raw);
  } catch (error) {
    console.warn(
      `VIP lineups: failed to read cached matches from matches-${matchDate}.json – ${error.message}`
    );
    return;
  }

  if (!Array.isArray(matchesFromFile) || !matchesFromFile.length) {
    return;
  }

  let didUpdate = false;
  const updatedMatches = matchesFromFile.map((match) => {
    if (match.matchId !== matchId) {
      return match;
    }

    didUpdate = true;
    return {
      ...match,
      ...payload,
    };
  });

  if (!didUpdate) {
    return;
  }

  try {
    await fs.writeFile(matchesFilePath, JSON.stringify(updatedMatches, null, 4));
  } catch (error) {
    console.warn(
      `VIP lineups: failed to persist lineup data to matches-${matchDate}.json – ${error.message}`
    );
  }
}

const buildCachedLineupResponse = (match) => {
  const rawLineups =
    match && typeof match.rawLineups === "object" && match.rawLineups
      ? match.rawLineups
      : { home: null, away: null };

  const normalizedLineups =
    match && typeof match.lineups === "object" && match.lineups
      ? {
          home: match.lineups.home ?? null,
          away: match.lineups.away ?? null,
        }
      : { home: null, away: null };

  let available;
  if (typeof match?.lineupsAvailable === "boolean") {
    available = match.lineupsAvailable;
  } else {
    available = Boolean(
      normalizedLineups.home?.starters?.length ||
        normalizedLineups.away?.starters?.length
    );
  }

  const confirmed = Boolean(match?.lineupsConfirmed);
  const fetchedAt = match?.lineupsFetchedAt ?? null;

  return {
    match,
    fetchedAt,
    available,
    confirmed,
    lineupsConfirmed: confirmed,
    rawLineups,
    lineups: normalizedLineups,
  };
};

// async function fetchEventLineups(matchId) {
//   if (!matchId) {
//     throw new Error("A matchId is required to fetch lineups");
//   }

//   const lineupUrl = `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}/lineups`;
//   let lastError = null;

//   for (const apiKey of rapidApiKeys) {
//     try {
//       const response = await axios.get(lineupUrl, {
//         headers: {
//           "x-rapidapi-key": apiKey,
//           "x-rapidapi-host": "sportapi7.p.rapidapi.com",
//         },
//       });

//       if (response.status === 200) {
//         return response.data;
//       }

//       console.warn(
//         `VIP lineups: RapidAPI key ...${apiKey.slice(-4)} returned HTTP ${response.status}`
//       );
//       lastError = new Error(`Unexpected lineup response status: ${response.status}`);
//     } catch (error) {
//       lastError = error;

//       if (typeof axios.isAxiosError === "function" && axios.isAxiosError(error)) {
//         const status = error.response?.status;

//         if (status === 404 || status === 400) {
//           error.status = status;
//           throw error;
//         }

//         console.warn(
//           `VIP lineups: RapidAPI key ...${apiKey.slice(-4)} failed – ${error.message}`
//         );
//       } else {
//         console.warn(
//           `VIP lineups: RapidAPI key ...${apiKey.slice(-4)} failed – ${error.message}`
//         );
//       }
//     }
//   }

//   if (lastError) {
//     throw lastError;
//   }

//   throw new Error("VIP lineups: all RapidAPI keys failed");
// }

// async function fetchEventLineups(matchId) {
//   if (!matchId) {
//     throw new Error("A matchId is required to fetch lineups");
//   }

//   const lineupUrl = `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}/lineups`;
//   let lastError = null;

//   for (const apiKey of rapidApiKeys) {
//     try {
//       const response = await axios.get(lineupUrl, {
//         headers: {
//           "x-rapidapi-key": apiKey,
//           "x-rapidapi-host": "sportapi7.p.rapidapi.com",
//         },
//         validateStatus: () => true,
//       });

//       if (response.status === 200) {
//         console.log(
//           `VIP lineups: hämtade via rapid (key ...${apiKey.slice(-4)})`
//         );
//         return response.data;
//       }

//       console.warn(
//         `VIP lineups: RapidAPI key ...${apiKey.slice(-4)} returned HTTP ${
//           response.status
//         }`
//       );
//       lastError = new Error(
//         `Unexpected lineup response status: ${response.status}`
//       );
//     } catch (error) {
//       lastError = error;

//       if (
//         typeof axios.isAxiosError === "function" &&
//         axios.isAxiosError(error)
//       ) {
//         const status = error.response?.status;

//         if (status === 404 || status === 400) {
//           // Innan vi kastar – prova SofaScore en gång som fallback
//           try {
//             const sofaUrl = `https://www.sofascore.com/api/v1/event/${matchId}/lineups`;
//             let browser = null;
//             try {
//               browser = await puppeteer.launch({ headless: "new" });
//               const page = await browser.newPage();
//               await page.setUserAgent(
//                 "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
//               );
//               await page.goto("https://www.sofascore.com/", {
//                 waitUntil: "domcontentloaded",
//               });

//               const data = await page.evaluate(async (u) => {
//                 try {
//                   const r = await fetch(u, {
//                     headers: { accept: "application/json, text/plain, */*" },
//                   });
//                   if (!r.ok) return null;
//                   return await r.json();
//                 } catch {
//                   return null;
//                 }
//               }, sofaUrl);

//               if (data) {
//                 console.log(`VIP lineups: hämtade via sofascore (fallback)`);
//                 return data;
//               }
//             } finally {
//               if (browser) {
//                 try {
//                   await browser.close();
//                 } catch {}
//               }
//             }
//           } catch {
//             // ignore, vi kastar originalfelet nedan
//           }

//           error.status = status;
//           throw error;
//         }

//         console.warn(
//           `VIP lineups: RapidAPI key ...${apiKey.slice(-4)} failed – ${
//             error.message
//           }`
//         );
//       } else {
//         console.warn(
//           `VIP lineups: RapidAPI key ...${apiKey.slice(-4)} failed – ${
//             error.message
//           }`
//         );
//       }
//     }
//   }

//   // Alla RapidAPI-nycklar misslyckades utan 200 – prova SofaScore en gång innan vi ger upp
//   try {
//     const sofaUrl = `https://www.sofascore.com/api/v1/event/${matchId}/lineups`;
//     let browser = null;
//     try {
//       browser = await puppeteer.launch({ headless: "new" });
//       const page = await browser.newPage();
//       await page.setUserAgent(
//         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
//       );
//       await page.goto("https://www.sofascore.com/", {
//         waitUntil: "domcontentloaded",
//       });

//       const data = await page.evaluate(async (u) => {
//         try {
//           const r = await fetch(u, {
//             headers: { accept: "application/json, text/plain, */*" },
//           });
//           if (!r.ok) return null;
//           return await r.json();
//         } catch {
//           return null;
//         }
//       }, sofaUrl);

//       if (data) {
//         console.log(`VIP lineups: hämtade via sofascore (fallback)`);
//         return data;
//       } else {
//         console.warn(`VIP lineups: SofaScore gav tomt svar eller non-OK`);
//       }
//     } finally {
//       if (browser) {
//         try {
//           await browser.close();
//         } catch {}
//       }
//     }
//   } catch (e) {
//     // ignorera och kasta originalfelet nedan om det finns
//   }

//   if (lastError) {
//     throw lastError;
//   }

//   throw new Error("VIP lineups: all RapidAPI keys failed");
// }



// Kräver att axios, puppeteer och rapidApiKeys finns i scopet

async function fetchEventLineups(matchId) {
  if (!matchId) {
    throw new Error("A matchId is required to fetch lineups");
  }

  let lastError = null;

  // --- Hjälpare för att köra ett RapidAPI-försök med roterande nycklar ---
  async function tryRapidWithKeys(buildCfg, label) {
    for (const apiKey of rapidApiKeys) {
      try {
        const cfg = buildCfg(apiKey);
        const response = await axios.request({
          ...cfg,
          validateStatus: () => true,
        });

        if (response.status === 200) {
          console.log(`VIP lineups: hämtade via ${label} (key ...${apiKey.slice(-4)})`);
          return response.data;
        }

        console.warn(
          `VIP lineups: ${label} key ...${apiKey.slice(-4)} returned HTTP ${response.status}`
        );

        // Spara senaste felet för ev. uppthrow längre ned
        lastError = new Error(`${label}: Unexpected response status ${response.status}`);
      } catch (error) {
        lastError = error;
        const msg = (typeof error?.message === "string" ? error.message : String(error));
        console.warn(`VIP lineups: ${label} key ...${apiKey.slice(-4)} failed – ${msg}`);
      }
    }
    return null; // ingen nyckel lyckades
  }

  // --- 1) Primär: sportapi7 ---
  const primaryData = await tryRapidWithKeys(
    (apiKey) => ({
      method: "GET",
      url: `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}/lineups`,
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "sportapi7.p.rapidapi.com",
      },
    }),
    "rapid(sportapi7)"
  );
  if (primaryData) return primaryData;

  // --- 2) Fallback: sport-api-real-time ---
  const rtData = await tryRapidWithKeys(
    (apiKey) => ({
      method: "GET",
      url: "https://sport-api-real-time.p.rapidapi.com/matches/lineups",
      params: { matchId: String(matchId) },
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "sport-api-real-time.p.rapidapi.com",
      },
    }),
    "rapid(sport-api-real-time)"
  );
  if (rtData) return rtData;

  // --- 3) Fallback: sofascore via RapidAPI ---
  const sofaRapidData = await tryRapidWithKeys(
    (apiKey) => ({
      method: "GET",
      url: "https://sofascore.p.rapidapi.com/matches/get-lineups",
      params: { matchId: String(matchId) },
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "sofascore.p.rapidapi.com",
      },
    }),
    "rapid(sofascore)"
  );
  if (sofaRapidData) return sofaRapidData;

  // --- 4) Sista utväg: SofaScore web (puppeteer) ---
  try {
    const sofaUrl = `https://www.sofascore.com/api/v1/event/${matchId}/lineups`;
    let browser = null;
    try {
      browser = await puppeteer.launch({ headless: "new" });
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
      );
      await page.goto("https://www.sofascore.com/", { waitUntil: "domcontentloaded" });

      const data = await page.evaluate(async (u) => {
        try {
          const r = await fetch(u, {
            headers: { accept: "application/json, text/plain, */*" },
          });
          if (!r.ok) return null;
          return await r.json();
        } catch {
          return null;
        }
      }, sofaUrl);

      if (data) {
        console.log(`VIP lineups: hämtade via sofascore (fallback)`);
        return data;
      } else {
        console.warn(`VIP lineups: SofaScore gav tomt svar eller non-OK`);
      }
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }
  } catch (e) {
    // Ignorera – vi kastar nedan om vi har tidigare fel
  }

  if (lastError) throw lastError;
  throw new Error("VIP lineups: all providers failed");
}


const mapLineupPlayers = (lineupEntry = {}) => {
  const starters = [];
  const substitutes = [];

  const parseRatingCandidate = (candidate, depth = 0) => {
    if (candidate === null || candidate === undefined || depth > 3) {
      return null;
    }

    if (typeof candidate === "number") {
      return Number.isFinite(candidate)
        ? Number(candidate.toFixed(2))
        : null;
    }

    if (typeof candidate === "string") {
      const normalized = candidate.replace(/,/g, ".");
      const parsed = Number.parseFloat(normalized);
      return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
    }

    if (typeof candidate === "object") {
      const nestedKeys = [
        "avg",
        "average",
        "value",
        "rating",
        "score",
        "overall",
      ];

      for (const key of nestedKeys) {
        if (candidate && key in candidate) {
          const nested = parseRatingCandidate(candidate[key], depth + 1);
          if (nested !== null) {
            return nested;
          }
        }
      }
    }

    return null;
  };

  const applyPlayer = (entry = {}, substituteOverride = null) => {
    const playerSource =
      entry.player || entry.athlete || entry.person || entry.playerData || entry;
    const playerId =
      playerSource?.id ??
      entry.playerId ??
      entry.id ??
      playerSource?.uuid ??
      null;
    const baseName =
      playerSource?.name ||
      playerSource?.shortName ||
      playerSource?.displayName ||
      entry.playerName ||
      entry.name ||
      null;

    const isSubstitute =
      substituteOverride ??
      Boolean(
        entry.substitute ||
          entry.isSubstitute ||
          entry.bench ||
          entry.onBench ||
          entry.reserve
      );

    const ratingCandidates = [
      entry.avgRating,
      entry.averageRating,
      entry.rating,
      entry.form?.avgRating,
      entry.statistics?.avgRating,
      entry.statistics?.rating,
      playerSource?.avgRating,
      playerSource?.averageRating,
      playerSource?.rating,
      playerSource?.statistics?.rating,
    ];

    let rating = null;
    for (const candidate of ratingCandidates) {
      rating = parseRatingCandidate(candidate);
      if (rating !== null) {
        break;
      }
    }

    const mapped = {
      id: playerId,
      name: baseName,
      shortName: playerSource?.shortName ?? null,
      position:
        playerSource?.position ||
        entry.position ||
        playerSource?.primaryPosition ||
        entry.playerPosition ||
        null,
      jerseyNumber:
        entry.shirtNumber ??
        entry.number ??
        playerSource?.shirtNumber ??
        playerSource?.jerseyNumber ??
        null,
      captain: Boolean(entry.captain || entry.isCaptain),
    };

    if (rating !== null) {
      mapped.rating = rating;
      mapped.avgRating = rating;
    }

    if (isSubstitute) {
      substitutes.push(mapped);
    } else {
      starters.push(mapped);
    }
  };

  const combinedPlayers = Array.isArray(lineupEntry.players)
    ? lineupEntry.players
    : null;

  if (combinedPlayers && combinedPlayers.length) {
    for (const entry of combinedPlayers) {
      applyPlayer(entry);
    }
    return { starters, substitutes };
  }

  const startersSource =
    (Array.isArray(lineupEntry.startXI) && lineupEntry.startXI) ||
    (Array.isArray(lineupEntry.startingXI) && lineupEntry.startingXI) ||
    (Array.isArray(lineupEntry.startingLineup) && lineupEntry.startingLineup) ||
    (Array.isArray(lineupEntry.lineup) && lineupEntry.lineup) ||
    [];
  const substitutesSource =
    (Array.isArray(lineupEntry.substitutes) && lineupEntry.substitutes) ||
    (Array.isArray(lineupEntry.bench) && lineupEntry.bench) ||
    (Array.isArray(lineupEntry.reserves) && lineupEntry.reserves) ||
    (Array.isArray(lineupEntry.subs) && lineupEntry.subs) ||
    [];

  for (const entry of startersSource) {
    applyPlayer(entry, false);
  }

  for (const entry of substitutesSource) {
    applyPlayer(entry, true);
  }

  return { starters, substitutes };
};

const normalizeLineup = (lineup) => {
  if (!lineup) {
    return null;
  }

  const { starters, substitutes } = mapLineupPlayers(lineup);

  return {
    teamId: lineup.team?.id ?? lineup.teamId ?? null,
    teamName: lineup.team?.name ?? lineup.teamName ?? null,
    formation: lineup.formation ?? null,
    coach:
      lineup.coach?.name ||
      lineup.coach?.shortName ||
      lineup.coach?.fullName ||
      null,
    starters,
    substitutes,
  };
};

const extractLineupsConfirmed = (lineupsResponse, rawLineupsSource) => {
  const candidates = [
    rawLineupsSource?.confirmed,
    lineupsResponse?.confirmed,
    lineupsResponse?.data?.confirmed,
    lineupsResponse?.lineups?.confirmed,
    lineupsResponse?.data?.lineups?.confirmed,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  return null;
};

async function loadTeamMatches(teamName, venue) {
  if (!teamName || !venue) {
    return [];
  }

  const slug = safeTeamSlug(teamName);
  const filePath = path.join(
    teamstatsDir,
    `${slug}_${venue}_match_stats.json`
  );

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.full)) {
      return parsed.full
        .slice()
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }
  } catch (error) {
    console.warn(
      `VIP stats: failed to load match stats for ${teamName} (${venue})`,
      error.message
    );
  }

  return [];
}

const formatDateFromTimestamp = (timestamp) => {
  if (!timestamp) {
    return null;
  }

  const isMilliseconds = String(timestamp).length > 10;
  const ms = Number(isMilliseconds ? timestamp : timestamp * 1000);

  if (Number.isNaN(ms)) {
    return null;
  }

  return getStockholmDateString(new Date(ms));
};

const selectMatches = (matches = [], matchCount) => {
  if (!Array.isArray(matches)) {
    return [];
  }

  if (matchCount === "all") {
    return matches;
  }

  const limit = Number(matchCount);

  if (!Number.isFinite(limit) || limit <= 0) {
    return matches;
  }

  return matches.slice(0, limit);
};

const collectTeamNameCandidates = (match, side) => {
  if (!match || typeof match !== "object") {
    return [];
  }

  const prefix = side === "away" ? "away" : "home";

  const rawCandidates = [
    match[`${prefix}TeamName`],
    match[`${prefix}Team`],
    match[`${prefix}Name`],
    match[`${prefix}team`],
    match[`${prefix}teamName`],
    match[prefix],
  ];

  const values = [];

  for (const candidate of rawCandidates) {
    if (!candidate) {
      continue;
    }

    if (typeof candidate === "string") {
      values.push(candidate);
      continue;
    }

    if (typeof candidate === "object") {
      const objectCandidates = [
        candidate.name,
        candidate.teamName,
        candidate.shortName,
        candidate.displayName,
        candidate.team?.name,
        candidate.team?.shortName,
        candidate.team?.teamName,
      ];

      for (const entry of objectCandidates) {
        if (typeof entry === "string") {
          values.push(entry);
        }
      }
    }
  }

  return values.filter(Boolean);
};

const resolveTeamSide = (match, options = {}) => {
  const normalizedTarget = options.teamName
    ? normalizeTeamName(options.teamName)
    : null;

  if (normalizedTarget) {
    const homeCandidates = collectTeamNameCandidates(match, "home");
    const awayCandidates = collectTeamNameCandidates(match, "away");

    if (
      homeCandidates.some(
        (candidate) => normalizeTeamName(candidate) === normalizedTarget
      )
    ) {
      return "home";
    }

    if (
      awayCandidates.some(
        (candidate) => normalizeTeamName(candidate) === normalizedTarget
      )
    ) {
      return "away";
    }
  }

  return options.defaultSide === "away" ? "away" : "home";
};

const resolveMatchSortValue = (match) => {
  if (!match || typeof match !== "object") {
    return 0;
  }

  const { timestamp, date } = match;

  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return String(Math.trunc(timestamp)).length > 10 ? timestamp : timestamp * 1000;
  }

  if (typeof timestamp === "string" && timestamp.trim()) {
    const numeric = Number(timestamp);
    if (Number.isFinite(numeric)) {
      return String(Math.trunc(numeric)).length > 10
        ? numeric
        : numeric * 1000;
    }
  }

  if (typeof date === "string" && date.trim()) {
    const parsed = Date.parse(date);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
};

const mergeMatches = (homeMatches = [], awayMatches = []) => {
  const combined = [];
  const seen = new Set();

  for (const match of [...homeMatches, ...awayMatches]) {
    if (!match || typeof match !== "object") {
      continue;
    }

    const identifier =
      match.matchId ??
      `${match.timestamp ?? "?"}-${match.homeTeamName ?? "?"}-${
        match.awayTeamName ?? "?"
      }`;

    if (identifier && seen.has(identifier)) {
      continue;
    }

    if (identifier) {
      seen.add(identifier);
    }

    combined.push(match);
  }

  combined.sort((a, b) => resolveMatchSortValue(b) - resolveMatchSortValue(a));
  return combined;
};

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const createFreeKickBreakdown = (baseValue, opponentOffsides) => {
  if (!isFiniteNumber(opponentOffsides) || opponentOffsides === 0) {
    return null;
  }

  const normalizedBase = isFiniteNumber(baseValue) ? baseValue : 0;

  return {
    base: normalizedBase,
    opponentOffsides,
  };
};

async function loadVipTeamMatches(teamName) {
  const [homeMatches, awayMatches] = await Promise.all([
    loadTeamMatches(teamName, "home"),
    loadTeamMatches(teamName, "away"),
  ]);

  return {
    homeMatches,
    awayMatches,
    combinedMatches: mergeMatches(homeMatches, awayMatches),
  };
}

function getStatItem(match, period, statKey) {
  const statistics = match?.matchDetails?.statistics;
  if (!Array.isArray(statistics)) {
    return null;
  }

  const periodStats = statistics.find((entry) => entry.period === period);
  if (!periodStats || !Array.isArray(periodStats.groups)) {
    return null;
  }

  for (const group of periodStats.groups) {
    const items = Array.isArray(group.statisticsItems)
      ? group.statisticsItems
      : [];
    const item = items.find((stat) => stat.key === statKey);
    if (item) {
      return item;
    }
  }

  return null;
}

function getStatItemWithFallback(match, period, statKey) {
  const periodsToTry = [];

  if (period) {
    periodsToTry.push(period);
  }

  if (period !== "ALL") {
    periodsToTry.push("ALL");
  }

  for (const candidate of periodsToTry) {
    const item = getStatItem(match, candidate, statKey);
    if (item) {
      return { item, period: candidate };
    }
  }

  return { item: null, period: null };
}

const roundStatValue = (value) =>
  Number.isFinite(value) ? Number(value.toFixed(2)) : null;

function computeQuantileFromSorted(sortedValues, quantile) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    return null;
  }

  if (quantile <= 0) {
    return sortedValues[0];
  }

  if (quantile >= 1) {
    return sortedValues[sortedValues.length - 1];
  }

  const position = (sortedValues.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const weight = position - lowerIndex;
  return (
    sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight
  );
}

function computeTeamAggregates(matches, period, statKeys, perspective) {
  const options =
    perspective && typeof perspective === "object"
      ? perspective
      : { defaultSide: perspective === false ? "away" : "home" };

  const sums = Object.create(null);
  const counts = Object.create(null);
  const valuesMap = Object.create(null);

  for (const statKey of statKeys) {
    sums[statKey] = 0;
    counts[statKey] = 0;
    valuesMap[statKey] = [];
  }

  for (const match of matches) {
    const teamSide = resolveTeamSide(match, options);

    for (const statKey of statKeys) {
      const { item, period: resolvedPeriod } = getStatItemWithFallback(
        match,
        period,
        statKey
      );

      if (!item) {
        continue;
      }

      const value = teamSide === "home" ? item.homeValue : item.awayValue;
      if (!isFiniteNumber(value)) {
        continue;
      }

      let adjustedValue = value;

      if (statKey === "freeKicks") {
        const { item: offsidesItem } = getStatItemWithFallback(
          match,
          resolvedPeriod ?? period,
          "offsides"
        );

        if (offsidesItem) {
          const opponentOffsides =
            teamSide === "home"
              ? offsidesItem.awayValue
              : offsidesItem.homeValue;


          if (isFiniteNumber(opponentOffsides)) {

            adjustedValue += opponentOffsides;
          }
        }
      }

      sums[statKey] += adjustedValue;
      counts[statKey] += 1;
      valuesMap[statKey].push(adjustedValue);
    }
  }

  const averages = Object.create(null);
  const medians = Object.create(null);
  const standardDeviations = Object.create(null);
  const quartile1s = Object.create(null);
  const quartile3s = Object.create(null);

  const minimums = Object.create(null);
  const maximums = Object.create(null);


  for (const statKey of statKeys) {
    if (!counts[statKey]) {
      averages[statKey] = null;
      medians[statKey] = null;
      standardDeviations[statKey] = null;
      quartile1s[statKey] = null;
      quartile3s[statKey] = null;

      minimums[statKey] = null;
      maximums[statKey] = null;

      continue;
    }

    const values = valuesMap[statKey];
    const mean = sums[statKey] / counts[statKey];
    const sortedValues = values.slice().sort((a, b) => a - b);
    const variance =
      values.reduce((acc, current) => acc + (current - mean) ** 2, 0) /
      values.length;

    averages[statKey] = roundStatValue(mean);
    medians[statKey] = roundStatValue(
      computeQuantileFromSorted(sortedValues, 0.5)
    );
    standardDeviations[statKey] = roundStatValue(Math.sqrt(variance));
    quartile1s[statKey] = roundStatValue(
      computeQuantileFromSorted(sortedValues, 0.25)
    );
    quartile3s[statKey] = roundStatValue(
      computeQuantileFromSorted(sortedValues, 0.75)
    );

    minimums[statKey] = roundStatValue(sortedValues[0]);
    maximums[statKey] = roundStatValue(sortedValues[sortedValues.length - 1]);

  }

  return {
    averages,
    medians,
    standardDeviations,
    quartile1s,
    quartile3s,

    minimums,
    maximums,

    counts,
    matchCount: matches.length,
  };
}

function parseOddsNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d+\/\d+$/.test(trimmed)) {
      const [numerator, denominator] = trimmed
        .split("/")
        .map((part) => Number.parseFloat(part));
      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
        const decimal = numerator / denominator + 1;
        return Number(decimal.toFixed(2));
      }
    }

    const normalized = trimmed.replace(/,/g, ".");
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }

    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
  }

  return null;
}

function identifyOutcomeType(rawLabel) {
  if (rawLabel === null || rawLabel === undefined) {
    return null;
  }

  const normalized = String(rawLabel).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const sanitized = normalized.replace(/[_]/g, " ");
  const tokens = sanitized.split(/[^a-z0-9]+/).filter(Boolean);
  const tokenSet = new Set(tokens);
  const joined = tokens.join(" ");

  const hasToken = (...candidates) =>
    candidates.some((candidate) => tokenSet.has(candidate));

  if (hasToken("1", "one", "home")) {
    return "home";
  }

  if (hasToken("2", "two", "away")) {
    return "away";
  }

  if (hasToken("x", "draw", "tie", "oavgjord", "oavgjort", "kryss")) {
    return "draw";
  }

  if (
    tokens.some((token) => token.startsWith("1x2") && token.endsWith("1")) ||
    joined.includes("1x2 1")
  ) {
    return "home";
  }

  if (tokens.some((token) => token.startsWith("1x2") && token.endsWith("x"))) {
    return "draw";
  }

  if (tokens.some((token) => token.startsWith("1x2") && token.endsWith("2"))) {
    return "away";
  }

  if (
    joined.includes("home win") ||
    joined.includes("home team") ||
    joined.includes("hemmaseger") ||
    joined.includes("hemmalag") ||
    joined.includes("team 1") ||
    joined.includes("lag 1") ||
    tokenSet.has("w1")
  ) {
    return "home";
  }

  if (
    joined.includes("away win") ||
    joined.includes("away team") ||
    joined.includes("bortaseger") ||
    joined.includes("bortalag") ||
    joined.includes("team 2") ||
    joined.includes("lag 2") ||
    tokenSet.has("w2")
  ) {
    return "away";
  }

  if (tokenSet.has("w0")) {
    return "draw";
  }

  return null;
}


function extractOddsValue(value, depth = 0, metadata = null) {

  if (value === null || value === undefined || depth > 4) {
    return null;
  }

  if (typeof value === "number" || typeof value === "string") {
    return parseOddsNumber(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {

      const extracted = extractOddsValue(entry, depth + 1, metadata);

      if (extracted !== null) {
        return extracted;
      }
    }
    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const candidateKeys = [
    "decimalOdds",
    "decimal",
    "odds",
    "odd",
    "price",

    "fractionalValue",
    "initialFractionalValue",

    "value",
    "numericalOdds",
    "current",
    "closing",
    "close",
    "latest",
    "final",
    "result",
    "trueOdds",
  ];

  for (const key of candidateKeys) {
    if (key in value) {

      const extracted = extractOddsValue(value[key], depth + 1, metadata);

      if (extracted !== null) {
        return extracted;
      }
    }
  }

  for (const [key, nested] of Object.entries(value)) {
    const lower = key.toLowerCase();

    if (
      lower.includes("odd") ||
      lower.includes("price") ||
      lower.includes("fraction")
    ) {

      const extracted = extractOddsValue(nested, depth + 1, metadata);

      if (extracted !== null) {
        return extracted;
      }
    }
  }

  return null;
}


const WINNING_FLAG_KEYS = [
  "winning",
  "isWinner",
  "isWinning",
  "winner",
  "won",
  "win",
  "hasWon",
  "result",
  "status",
];

function parseWinningFlag(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (value === true) {
    return true;
  }

  if (value === false) {
    return false;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }

    if (value === 0) {
      return false;
    }

    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (["true", "winner", "won", "win", "yes", "y", "1"].includes(normalized)) {
      return true;
    }

    if (["false", "loser", "lost", "lose", "no", "n", "0"].includes(normalized)) {
      return false;
    }

    return null;
  }

  return null;
}

function updateWinnerMetadata(metadata, source, outcomeType) {
  if (!metadata || metadata.winner || !source || typeof source !== "object") {
    return;
  }

  for (const key of WINNING_FLAG_KEYS) {
    if (!(key in source)) {
      continue;
    }

    const parsed = parseWinningFlag(source[key]);
    if (parsed === true) {
      metadata.winner = outcomeType;
      return;
    }
  }
}

function mapOddsFromObject(source, metadata = null) {

  if (!source || typeof source !== "object") {
    return null;
  }

  const result = { home: null, draw: null, away: null };
  let filled = 0;

  for (const [key, value] of Object.entries(source)) {
    const outcomeType = identifyOutcomeType(key);
    if (!outcomeType) {
      continue;
    }


    updateWinnerMetadata(metadata, value, outcomeType);

    const numeric = extractOddsValue(value, 0, metadata);

    if (numeric === null) {
      continue;
    }

    if (result[outcomeType] === null) {
      result[outcomeType] = numeric;
      filled += 1;
    }
  }

  return filled >= 2 ? result : null;
}


function normalizeOddsArray(outcomes, depth = 0, metadata = null) {

  if (!Array.isArray(outcomes) || depth > 4) {
    return null;
  }

  const result = { home: null, draw: null, away: null };
  let filled = 0;

  for (const outcome of outcomes) {
    if (!outcome || typeof outcome !== "object") {
      continue;
    }

    const nestedOutcomes =
      outcome.outcomes ||
      outcome.selections ||
      outcome.options ||
      outcome.choices ||
      outcome.results ||
      outcome.bets;

    if (nestedOutcomes) {

      const nested = normalizeOddsArray(nestedOutcomes, depth + 1, metadata);

      if (nested) {
        return nested;
      }
    }

    const labelCandidates = [
      outcome.outcome,
      outcome.outcomeCode,
      outcome.result,
      outcome.selection,
      outcome.selectionName,
      outcome.name,
      outcome.label,
      outcome.type,
      outcome.title,
      outcome.code,
      outcome.key,
      outcome.side,
      outcome.participant,
      outcome.team,
    ];

    let outcomeType = null;
    for (const label of labelCandidates) {
      outcomeType = identifyOutcomeType(label);
      if (outcomeType) {
        break;
      }
    }

    if (!outcomeType) {
      continue;
    }


    updateWinnerMetadata(metadata, outcome, outcomeType);

    const numeric = extractOddsValue(outcome, 0, metadata);

    if (numeric === null) {
      continue;
    }

    if (result[outcomeType] === null) {
      result[outcomeType] = numeric;
      filled += 1;
    }
  }

  return filled >= 2 ? result : null;
}


function searchOddsContainer(
  value,
  { allowDirectMapping = false, depth = 0, metadata = null } = {}
) {

  if (value === null || value === undefined || depth > 6) {
    return null;
  }

  if (Array.isArray(value)) {

    const direct = normalizeOddsArray(value, depth + 1, metadata);

    if (direct) {
      return direct;
    }

    for (const entry of value) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const label =
        entry.marketKey ||
        entry.key ||
        entry.name ||
        entry.marketName ||
        entry.label ||
        entry.type ||
        entry.betType ||
        entry.group;

      const isLikelyMarket =
        typeof label === "string" &&
        /1x2|threeway|3way|full\s*time\s*result|fulltimeresult|match\s*result|matchresult|win.?draw.?win|moneyline/.test(
          label.toLowerCase()
        );

      if (isLikelyMarket) {
        const candidateSources = [
          entry.closingOdds,
          entry.closing,
          entry.odds?.closing,
          entry.odds?.closingOdds,
          entry.odds,
          entry.latestOdds,
          entry.currentOdds,
          entry.finalOdds,
        ];

        for (const source of candidateSources) {
          const normalized = searchOddsContainer(source, {
            allowDirectMapping: true,
            depth: depth + 1,

            metadata,

          });
          if (normalized) {
            return normalized;
          }
        }

        const outcomesSource =
          entry.outcomes ||
          entry.selections ||
          entry.options ||
          entry.choices ||
          entry.results ||
          entry.bets ||
          entry.values;

        const nestedOutcomes = searchOddsContainer(outcomesSource, {
          allowDirectMapping: true,
          depth: depth + 1,

          metadata,

        });
        if (nestedOutcomes) {
          return nestedOutcomes;
        }
      }

      const nested = searchOddsContainer(entry, {
        allowDirectMapping,
        depth: depth + 1,

        metadata,

      });
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  if (allowDirectMapping) {

    const direct = mapOddsFromObject(value, metadata);

    if (direct) {
      return direct;
    }
  }

  const prioritizedKeys = [
    "closingOdds",
    "closing_odds",
    "finalOdds",
    "final_odds",
    "odds",
    "closing",
    "close",
    "markets",
    "market",
    "marketOdds",
    "market_odds",
    "betting",
    "betoffers",
    "outcomes",
    "selections",
    "options",
    "choices",
    "results",
    "lines",
    "bets",
    "values",
  ];

  for (const key of prioritizedKeys) {
    if (key in value) {
      const nested = searchOddsContainer(value[key], {
        allowDirectMapping:
          key.includes("odds") || key === "closing" || key === "closingOdds",
        depth: depth + 1,

        metadata,

      });
      if (nested) {
        return nested;
      }
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (!nestedValue || typeof nestedValue !== "object") {
      continue;
    }

    const lowerKey = key.toLowerCase();
    const isLikelyMarket = /1x2|threeway|3way|full\s*time\s*result|fulltimeresult|match\s*result|matchresult|win.?draw.?win|moneyline/.test(
      lowerKey
    );

    if (isLikelyMarket) {
      const nested = searchOddsContainer(nestedValue, {
        allowDirectMapping: true,
        depth: depth + 1,

        metadata,

      });
      if (nested) {
        return nested;
      }
      continue;
    }

    if (
      lowerKey.includes("odds") ||
      lowerKey.includes("market") ||
      lowerKey.includes("bet") ||
      lowerKey.includes("price")
    ) {
      const nested = searchOddsContainer(nestedValue, {
        allowDirectMapping: false,
        depth: depth + 1,

        metadata,

      });
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function extractClosingOdds(match) {
  if (!match || typeof match !== "object") {
    return null;
  }

  const candidateSources = [
    match.closingOdds,
    match.closing_odds,
    match.matchOdds?.closing,
    match.matchOdds?.closingOdds,
    match.matchDetails?.closingOdds,
    match.matchDetails?.closing_odds,
    match.matchDetails?.odds?.closing,
    match.matchDetails?.odds?.closingOdds,
    match.matchDetails?.odds,
    match.matchDetails?.markets,
    match.odds?.closing,
    match.odds?.closingOdds,
    match.odds,
    match.betting,
  ];

  for (const source of candidateSources) {
    if (!source) {
      continue;
    }


    const metadata = { winner: null };
    const normalized = searchOddsContainer(source, {
      allowDirectMapping: true,
      metadata,
    });
    if (normalized) {
      return {
        values: normalized,
        winner: metadata.winner || null,
      };
    }
  }

  const metadata = { winner: null };
  const fallback = searchOddsContainer(match, {
    allowDirectMapping: false,
    metadata,
  });

  return fallback
    ? {
        values: fallback,
        winner: metadata.winner || null,
      }
    : null;
}


function buildMatchSummaries(matches, statKeys, perspective, period = "ALL") {
  const options =
    perspective && typeof perspective === "object"
      ? perspective
      : { defaultSide: perspective === false ? "away" : "home" };

  const requestedPeriod = PERIOD_IDENTIFIERS.has(period) || period === "ALL"
    ? period
    : "ALL";

  const matchLimit =
    typeof VIP_RECENT_MATCH_LIMIT === "number" && Number.isFinite(VIP_RECENT_MATCH_LIMIT)
      ? Math.max(0, VIP_RECENT_MATCH_LIMIT)
      : 0;
  const sourceMatches = Array.isArray(matches) ? matches : [];
  const recentMatches =
    matchLimit > 0 ? sourceMatches.slice(0, matchLimit) : sourceMatches;

  return recentMatches.map((match) => {
    const statValues = Object.create(null);
    const teamSide = resolveTeamSide(match, options);

    for (const statKey of statKeys) {
      const { item, period: resolvedPeriod } = getStatItemWithFallback(
        match,
        requestedPeriod,
        statKey
      );

      let teamValue = item
        ? teamSide === "home"
          ? item.homeValue
          : item.awayValue
        : null;
      let opponentValue = item
        ? teamSide === "home"
          ? item.awayValue
          : item.homeValue
        : null;
      const baseTeamValue = teamValue;
      const baseOpponentValue = opponentValue;
      let teamBreakdown = null;
      let opponentBreakdown = null;

      if (statKey === "freeKicks") {
        const { item: offsidesItem } = getStatItemWithFallback(
          match,
          resolvedPeriod ?? requestedPeriod,
          "offsides"
        );

        if (offsidesItem) {
          const opponentOffsides =
            teamSide === "home"
              ? offsidesItem.awayValue
              : offsidesItem.homeValue;
          const teamOffsides =
            teamSide === "home"
              ? offsidesItem.homeValue
              : offsidesItem.awayValue;

          if (isFiniteNumber(opponentOffsides)) {
            const baseValue = isFiniteNumber(baseTeamValue)
              ? baseTeamValue
              : 0;
            teamValue = baseValue + opponentOffsides;
          }

          if (isFiniteNumber(teamOffsides)) {
            const baseOpponent = isFiniteNumber(baseOpponentValue)
              ? baseOpponentValue
              : 0;
            opponentValue = baseOpponent + teamOffsides;
          }

          teamBreakdown = createFreeKickBreakdown(
            baseTeamValue,
            opponentOffsides
          );

          opponentBreakdown = createFreeKickBreakdown(
            baseOpponentValue,
            teamOffsides
          );
        }
      }

      if (
        statKey === "freeKicks" &&
        typeof teamValue === "number" &&
        Number.isFinite(teamValue)
      ) {
        const { item: offsidesItem } = getStatItemWithFallback(
          match,
          resolvedPeriod ?? requestedPeriod,
          "offsides"
        );

        if (offsidesItem) {
          const opponentOffsides =
            teamSide === "home"
              ? offsidesItem.awayValue
              : offsidesItem.homeValue;

          if (
            typeof opponentOffsides === "number" &&
            Number.isFinite(opponentOffsides)
          ) {
            teamValue += opponentOffsides;
          }
        }
      }

      statValues[statKey] = {
        for: isFiniteNumber(teamValue) ? teamValue : null,
        against: isFiniteNumber(opponentValue) ? opponentValue : null,
      };

      if (teamBreakdown) {
        statValues[statKey].forBreakdown = teamBreakdown;
      }

      if (opponentBreakdown) {
        statValues[statKey].againstBreakdown = opponentBreakdown;
      }
    }


    const closingOddsInfo = extractClosingOdds(match);
    const closingOdds = closingOddsInfo?.values || null;
    const result = closingOddsInfo?.winner || null;

    const opponentCandidates =
      teamSide === "home"
        ? collectTeamNameCandidates(match, "away")
        : collectTeamNameCandidates(match, "home");
    let opponentName = opponentCandidates.length
      ? opponentCandidates[0]
      : null;

    if (!opponentName) {
      opponentName =
        teamSide === "home"
          ? match.awayTeamName || match.awayTeam
          : match.homeTeamName || match.homeTeam;
    }


    return {
      matchId: match.matchId,
      date: match.date || formatDateFromTimestamp(match.timestamp),
      opponent: opponentName,

      homeTeamName: match.homeTeamName,
      awayTeamName: match.awayTeamName,

      statValues,

      closingOdds,
      result,
      venue: teamSide,

    };
  });
}

function verifyVipToken(req, res, next) {
  const token = req.headers["x-vip-token"];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const issuedAt = vipSessions.get(token);
  if (!issuedAt) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (Date.now() - issuedAt > VIP_SESSION_TTL) {
    vipSessions.delete(token);
    return res.status(401).json({ error: "Session expired" });
  }

  vipSessions.set(token, Date.now());
  req.vipToken = token;
  return next();
}

const PORT = process.env.PORT || 5000;


const unibetDir = path.join(__dirname); // pekar på bet365/unibet
app.use("/unibet", express.static(unibetDir));

const corsOptions = {
  origin: [
    "https://bettingmodel-frontend.onrender.com",
    "http://localhost:3000",
    "https://ullebets.com",
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-admin-password", "x-vip-token"],
  credentials: true, // 👈 Detta är viktigt för cookies/auth
};

app.use(cors(corsOptions));

// 👇 Hanterar preflight OPTIONS-förfrågningar korrekt
app.options("*", cors(corsOptions));

// 🔹 Basic logging of POST/PUT/PATCH/DELETE requests with body
app.use(async (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const entry = {
      timestamp: new Date().toISOString(),
      ip: getClientIp(req),
      userAgent: req.headers["user-agent"],
      method: req.method,
      url: req.originalUrl,
      body: req.body,
    };
    logs.push(entry);
    try {
      await fs.writeFile(logFilePath, JSON.stringify(logs, null, 2));
    } catch (err) {
      console.error("Failed to write log", err);
    }
  }
  next();
});

app.post("/api/vip/login", async (req, res) => {
  const { password } = req.body || {};

  if (!password) {
    return res.status(500).json({ error: "VIP access not configured" });
  }

  if (!password) {
    return res.status(400).json({ error: "Password required" });
  }

  if (password !== "r") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = uuidv4();
  vipSessions.set(token, Date.now());

  const todayInStockholm = getStockholmDateString();
  try {
    await refreshMatchesForDate(todayInStockholm);
  } catch (error) {
    console.error(
      `VIP login: failed to refresh matches for ${todayInStockholm} – ${error.message}`
    );
  }

  return res.json({ token, expiresIn: VIP_SESSION_TTL });
});

app.get("/api/vip/session", verifyVipToken, (req, res) => {
  return res.json({ valid: true, expiresIn: VIP_SESSION_TTL });
});

app.post("/api/vip/team-stats", verifyVipToken, async (req, res) => {
  const { homeTeam, awayTeam, matchCount = "5", period = "ALL" } =
    req.body || {};

  if (!homeTeam || !awayTeam) {
    return res
      .status(400)
      .json({ error: "Both homeTeam and awayTeam are required" });
  }

  let normalizedMatchCount = "5";
  if (typeof matchCount === "number") {
    const value = String(matchCount);
    if (VIP_ALLOWED_MATCH_COUNTS.has(value)) {
      normalizedMatchCount = value;
    }
  } else if (typeof matchCount === "string") {
    const lower = matchCount.toLowerCase();
    if (VIP_ALLOWED_MATCH_COUNTS.has(lower)) {
      normalizedMatchCount = lower;
    } else if (VIP_ALLOWED_MATCH_COUNTS.has(matchCount)) {
      normalizedMatchCount = matchCount;
    }
  }

  let normalizedPeriod = "ALL";
  if (typeof period === "string") {
    const upper = period.toUpperCase();
    if (VIP_ALLOWED_PERIODS.has(upper)) {
      normalizedPeriod = upper;
    }
  }

  try {
    const [homeTeamMatches, awayTeamMatches] = await Promise.all([
      loadVipTeamMatches(homeTeam),
      loadVipTeamMatches(awayTeam),
    ]);

    const selectedHomeOverall = selectMatches(
      homeTeamMatches.combinedMatches,
      normalizedMatchCount
    );
    const selectedHomeHome = selectMatches(
      homeTeamMatches.homeMatches,
      normalizedMatchCount
    );
    const selectedHomeAway = selectMatches(
      homeTeamMatches.awayMatches,
      normalizedMatchCount
    );

    const selectedAwayOverall = selectMatches(
      awayTeamMatches.combinedMatches,
      normalizedMatchCount
    );
    const selectedAwayHome = selectMatches(
      awayTeamMatches.homeMatches,
      normalizedMatchCount
    );
    const selectedAwayAway = selectMatches(
      awayTeamMatches.awayMatches,
      normalizedMatchCount
    );

    const homeAggregates = computeTeamAggregates(
      selectedHomeOverall,
      normalizedPeriod,
      VIP_STAT_KEYS,
      { teamName: homeTeam, defaultSide: "home" }
    );
    const homeHomeAggregates = computeTeamAggregates(
      selectedHomeHome,
      normalizedPeriod,
      VIP_STAT_KEYS,
      { teamName: homeTeam, defaultSide: "home" }
    );
    const homeAwayAggregates = computeTeamAggregates(
      selectedHomeAway,
      normalizedPeriod,
      VIP_STAT_KEYS,
      { teamName: homeTeam, defaultSide: "away" }
    );

    const awayAggregates = computeTeamAggregates(
      selectedAwayOverall,
      normalizedPeriod,
      VIP_STAT_KEYS,
      { teamName: awayTeam, defaultSide: "away" }
    );
    const awayHomeAggregates = computeTeamAggregates(
      selectedAwayHome,
      normalizedPeriod,
      VIP_STAT_KEYS,
      { teamName: awayTeam, defaultSide: "home" }
    );
    const awayAwayAggregates = computeTeamAggregates(
      selectedAwayAway,
      normalizedPeriod,
      VIP_STAT_KEYS,
      { teamName: awayTeam, defaultSide: "away" }
    );

    return res.json({
      stats: VIP_STAT_KEYS.map((statKey) => ({
        statKey,
        homeAverage: homeAggregates.averages[statKey],
        homeSamples: homeAggregates.counts[statKey],
        homeMedian: homeAggregates.medians[statKey],
        homeStdDev: homeAggregates.standardDeviations[statKey],
        homeQuartile1: homeAggregates.quartile1s[statKey],
        homeQuartile3: homeAggregates.quartile3s[statKey],

        homeMin: homeAggregates.minimums[statKey],
        homeMax: homeAggregates.maximums[statKey],

        homeHomeAverage: homeHomeAggregates.averages[statKey],
        homeHomeSamples: homeHomeAggregates.counts[statKey],
        homeHomeMedian: homeHomeAggregates.medians[statKey],
        homeHomeStdDev: homeHomeAggregates.standardDeviations[statKey],
        homeHomeQuartile1: homeHomeAggregates.quartile1s[statKey],
        homeHomeQuartile3: homeHomeAggregates.quartile3s[statKey],

        homeHomeMin: homeHomeAggregates.minimums[statKey],
        homeHomeMax: homeHomeAggregates.maximums[statKey],

        homeAwayAverage: homeAwayAggregates.averages[statKey],
        homeAwaySamples: homeAwayAggregates.counts[statKey],
        homeAwayMedian: homeAwayAggregates.medians[statKey],
        homeAwayStdDev: homeAwayAggregates.standardDeviations[statKey],
        homeAwayQuartile1: homeAwayAggregates.quartile1s[statKey],
        homeAwayQuartile3: homeAwayAggregates.quartile3s[statKey],

        homeAwayMin: homeAwayAggregates.minimums[statKey],
        homeAwayMax: homeAwayAggregates.maximums[statKey],

        awayAverage: awayAggregates.averages[statKey],
        awaySamples: awayAggregates.counts[statKey],
        awayMedian: awayAggregates.medians[statKey],
        awayStdDev: awayAggregates.standardDeviations[statKey],
        awayQuartile1: awayAggregates.quartile1s[statKey],
        awayQuartile3: awayAggregates.quartile3s[statKey],

        awayMin: awayAggregates.minimums[statKey],
        awayMax: awayAggregates.maximums[statKey],

        awayHomeAverage: awayHomeAggregates.averages[statKey],
        awayHomeSamples: awayHomeAggregates.counts[statKey],
        awayHomeMedian: awayHomeAggregates.medians[statKey],
        awayHomeStdDev: awayHomeAggregates.standardDeviations[statKey],
        awayHomeQuartile1: awayHomeAggregates.quartile1s[statKey],
        awayHomeQuartile3: awayHomeAggregates.quartile3s[statKey],

        awayHomeMin: awayHomeAggregates.minimums[statKey],
        awayHomeMax: awayHomeAggregates.maximums[statKey],

        awayAwayAverage: awayAwayAggregates.averages[statKey],
        awayAwaySamples: awayAwayAggregates.counts[statKey],
        awayAwayMedian: awayAwayAggregates.medians[statKey],
        awayAwayStdDev: awayAwayAggregates.standardDeviations[statKey],
        awayAwayQuartile1: awayAwayAggregates.quartile1s[statKey],
        awayAwayQuartile3: awayAwayAggregates.quartile3s[statKey],

        awayAwayMin: awayAwayAggregates.minimums[statKey],
        awayAwayMax: awayAwayAggregates.maximums[statKey],

      })),
      metadata: {
        period: normalizedPeriod,
        matchCount: normalizedMatchCount,
        homeMatchesConsidered: homeAggregates.matchCount,
        awayMatchesConsidered: awayAggregates.matchCount,
        homeHomeMatchesConsidered: homeHomeAggregates.matchCount,
        homeAwayMatchesConsidered: homeAwayAggregates.matchCount,
        awayHomeMatchesConsidered: awayHomeAggregates.matchCount,
        awayAwayMatchesConsidered: awayAwayAggregates.matchCount,
      },
      homeRecentMatches: buildMatchSummaries(
        homeTeamMatches.combinedMatches,
        VIP_STAT_KEYS,
        { teamName: homeTeam, defaultSide: "home" },
        normalizedPeriod
      ),
      awayRecentMatches: buildMatchSummaries(
        awayTeamMatches.combinedMatches,
        VIP_STAT_KEYS,
        { teamName: awayTeam, defaultSide: "away" },
        normalizedPeriod
      ),
    });
  } catch (error) {
    console.error("Failed to compute VIP team stats", error);
    return res
      .status(500)
      .json({ error: "Failed to compute VIP team statistics" });
  }
});

app.post("/api/vip/lineups", verifyVipToken, async (req, res) => {
  const { homeTeam, awayTeam, matchDate } = req.body || {};

  if (!homeTeam || !awayTeam) {
    return res
      .status(400)
      .json({ error: "Both homeTeam and awayTeam are required" });
  }

  const targetDate =
    typeof matchDate === "string" && matchDate.length
      ? matchDate
      : getStockholmDateString();

  const forceRefreshRaw = req.body?.forceRefresh;
  const forceRefresh =
    forceRefreshRaw === true ||
    forceRefreshRaw === "true" ||
    forceRefreshRaw === 1 ||
    forceRefreshRaw === "1";

  let matches;
  try {
    matches = await refreshMatchesForDate(targetDate);
  } catch (error) {
    console.error(
      `VIP lineups: failed to load matches for ${targetDate} – ${error.message}`
    );
    return res.status(500).json({ error: "Failed to load scheduled matches" });
  }

  const normalizedHome = normalizeTeamName(homeTeam);
  const normalizedAway = normalizeTeamName(awayTeam);

  let targetMatch = matches.find(
    (match) =>
      normalizeTeamName(match.homeTeam) === normalizedHome &&
      normalizeTeamName(match.awayTeam) === normalizedAway &&
      (!match.date || match.date === targetDate)
  );

  if (!targetMatch) {
    targetMatch = matches.find(
      (match) =>
        normalizeTeamName(match.homeTeam) === normalizedAway &&
        normalizeTeamName(match.awayTeam) === normalizedHome &&
        (!match.date || match.date === targetDate)
    );
  }

  if (!targetMatch) {
    return res
      .status(404)
      .json({ error: "No scheduled match found for the selected teams" });
  }

  if (!forceRefresh && targetMatch.lineupsFetchedAt) {
    return res.json(buildCachedLineupResponse(targetMatch));
  }

  try {
    const lineupsResponse = await fetchEventLineups(targetMatch.matchId);
    const rawLineupsSource =
      lineupsResponse?.lineups ||
      lineupsResponse?.data?.lineups ||
      lineupsResponse?.data ||
      lineupsResponse ||
      {};
    const rawLineups =
      rawLineupsSource && typeof rawLineupsSource === "object"
        ? rawLineupsSource
        : {};
    const homeLineup = normalizeLineup(rawLineups.home);
    const awayLineup = normalizeLineup(rawLineups.away);
    const confirmed = extractLineupsConfirmed(lineupsResponse, rawLineupsSource);

    const available = Boolean(
      homeLineup?.starters?.length || awayLineup?.starters?.length
    );
    const fetchedAt = new Date().toISOString();
    const lineupPayload = {
      rawLineups,
      lineups: {
        home: homeLineup,
        away: awayLineup,
      },
      lineupsAvailable: available,
      lineupsFetchedAt: fetchedAt,
      lineupsConfirmed: confirmed,
    };

    Object.assign(targetMatch, lineupPayload);
    await persistMatchLineups(targetDate, targetMatch.matchId, lineupPayload);

    return res.json(buildCachedLineupResponse(targetMatch));
  } catch (error) {
    if (typeof axios.isAxiosError === "function" && axios.isAxiosError(error)) {
      const status = error.status ?? error.response?.status;
      if (status === 404 || status === 400) {
        const fetchedAt = new Date().toISOString();
        const rawLineups = {
          home: null,
          away: null,
        };
        const confirmed = false;
        const lineupPayload = {
          rawLineups,
          lineups: {
            home: null,
            away: null,
          },
          lineupsAvailable: false,
          lineupsFetchedAt: fetchedAt,
          lineupsConfirmed: confirmed,
        };

        Object.assign(targetMatch, lineupPayload);
        await persistMatchLineups(targetDate, targetMatch.matchId, lineupPayload);

        return res.json(buildCachedLineupResponse(targetMatch));
      }
    }

    console.error(
      `VIP lineups: failed to load lineup for match ${targetMatch.matchId} – ${error.message}`
    );
    return res.status(502).json({ error: "Failed to fetch lineups" });
  }
});

const PERIOD_IDENTIFIERS = new Set(["1ST", "2ND"]);
const WILLIAM_IGNORED_KEYS = ["timestamp", "start_timestamp"];
const WILLIAM_FALLBACK_LEAGUE = "Övriga lag";
const WILLIAM_PERIOD_CACHE_TTL = 15 * 60 * 1000;

let williamPeriodCache = null;
let williamPeriodCacheTimestamp = 0;

function transformPeriodStats(rawStats = {}, prefixSegments = []) {
  const periods = { ALL: {}, "1ST": {}, "2ND": {} };

  for (const [rawKey, value] of Object.entries(rawStats || {})) {
    if (value === undefined || value === null) {
      continue;
    }

    const parts = rawKey.split("_");
    const prefixes = Array.isArray(prefixSegments) ? prefixSegments : [];
    const prefixLength = prefixes.length;

    if (prefixLength && parts.length <= prefixLength) {
      continue;
    }

    if (prefixLength) {
      let matchesPrefix = true;
      for (let index = 0; index < prefixLength; index += 1) {
        if (parts[index] !== prefixes[index]) {
          matchesPrefix = false;
          break;
        }
      }
      if (!matchesPrefix) {
        continue;
      }
    }

    const remainder = parts.slice(prefixLength);

    if (remainder.length < 2) {
      continue;
    }

    let period;
    let category;
    let statKeyParts;

    if (PERIOD_IDENTIFIERS.has(remainder[0])) {
      period = remainder[0];
      category = remainder[1];
      statKeyParts = remainder.slice(2);
    } else {
      period = "ALL";
      category = remainder[0];
      statKeyParts = remainder.slice(1);
    }

    if (!statKeyParts.length) {
      continue;
    }

    const statKey = statKeyParts.join("_").trim();
    if (!statKey) {
      continue;
    }

    const lowerKey = statKey.toLowerCase();
    if (WILLIAM_IGNORED_KEYS.some((ignored) => lowerKey.includes(ignored))) {
      continue;
    }

    if (!periods[period]) {
      periods[period] = {};
    }

    if (!periods[period][category]) {
      periods[period][category] = {};
    }

    periods[period][category][statKey] = value;
  }

  return periods;
}

async function loadWilliamPeriodData({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (
    !forceRefresh &&
    williamPeriodCache &&
    now - williamPeriodCacheTimestamp < WILLIAM_PERIOD_CACHE_TTL
  ) {
    return williamPeriodCache;
  }

  const [teamStatsRaw, leaguesRaw] = await Promise.all([
    fs.readFile(path.join(__dirname, "..", "team_objects_with_against.json"), "utf-8"),
    fs.readFile(path.join(__dirname, "leagues-and-teams.json"), "utf-8"),
  ]);

  const teamStats = JSON.parse(teamStatsRaw);
  const leagues = JSON.parse(leaguesRaw);

  const teamToLeague = new Map();
  const leagueMap = {};

  for (const [leagueName, leagueData] of Object.entries(leagues || {})) {
    leagueMap[leagueName] = {
      name: leagueName,
      country: leagueData?.country ?? null,
      leagueId: leagueData?.leagueId ?? null,
      imageUrl: leagueData?.imageUrl ?? null,
      teams: [],
    };

    for (const team of leagueData?.teams ?? []) {
      teamToLeague.set(team.name, { leagueName, team });
    }
  }

  if (!leagueMap[WILLIAM_FALLBACK_LEAGUE]) {
    leagueMap[WILLIAM_FALLBACK_LEAGUE] = {
      name: WILLIAM_FALLBACK_LEAGUE,
      teams: [],
    };
  }

  for (const [teamName, stats] of Object.entries(teamStats || {})) {
    const mapping = teamToLeague.get(teamName);
    const leagueName = mapping?.leagueName ?? WILLIAM_FALLBACK_LEAGUE;

    if (!leagueMap[leagueName]) {
      leagueMap[leagueName] = {
        name: leagueName,
        teams: [],
      };
    }

    leagueMap[leagueName].teams.push({
      name: teamName,
      totalGamesAnalyzed: stats?.total_games_analyzed ?? null,
      imageUrl: mapping?.team?.imageUrl ?? null,
      slug: mapping?.team?.slug ?? null,
      optaRank: mapping?.team?.optaRank ?? null,
      optaRating: mapping?.team?.optaRating ?? null,
      stats: {
        home: transformPeriodStats(stats?.home_stats, ["home"]),
        away: transformPeriodStats(stats?.away_stats, ["away"]),
        againstHome: transformPeriodStats(stats?.against_home_stats, ["against", "home"]),
        againstAway: transformPeriodStats(stats?.against_away_stats, ["against", "away"]),
      },
    });
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    leagues: leagueMap,
  };

  williamPeriodCache = payload;
  williamPeriodCacheTimestamp = now;

  return payload;
}

// function slugify(s) {
//   return s
//     .toLowerCase()
//     .normalize("NFD") // dela upp accents
//     .replace(/[\u0300-\u036f]/g, "") // ta bort accent-delar
//     .replace(/[^a-z0-9&]+/g, "_")
//     .replace(/^_|_$/g, ""); // trimma _ i början/slutet
// }

const slugify = (s) => s.toLowerCase().replace(/\s/g, "_");

const backtestsDir = path.join(__dirname, "unibet-backtests");
if (!existsSync(backtestsDir)) {
  mkdirSync(backtestsDir, { recursive: true });
}


async function collectBacktestFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const res = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectBacktestFiles(res)));
    } else if (entry.name.endsWith(".json")) {
      files.push(res);

    }
  }
  return files;
}

async function collectLatestBacktestFiles(dir) {
  const files = await collectBacktestFiles(dir);
  const latest = {};
  const matchDirPattern = /.+-.+-\d{4}-\d{2}-\d{2}$/;

  for (const file of files) {
    const parent = path.basename(path.dirname(file));
    let matchId;
    let ts;

    if (matchDirPattern.test(parent)) {
      matchId = parent;
      ts = path.basename(file, ".json");
    } else {
      matchId = path.basename(file, ".json");
      ts = ""; // top-level file has no timestamp
    }

    if (!latest[matchId] || ts > latest[matchId].ts) {
      latest[matchId] = { file, ts };
    }
  }

  return Object.values(latest).map((v) => v.file);
}

async function computeBacktestResults() {
  const files = await collectLatestBacktestFiles(backtestsDir);

  const results = [];

  for (const file of files) {
    const raw = JSON.parse(await fs.readFile(file, "utf-8"));
    const bets = Array.isArray(raw) ? raw : raw.lines || [];

    for (const bet of bets) {
      if (bet.value <= 0 || bet.win == null) continue;


      results.push({
        homeTeam: bet.homeTeam,
        awayTeam: bet.awayTeam,
        over:
          bet.condition?.toLowerCase() === "över" ||
          bet.condition?.toLowerCase() === "over",
        line: bet.line,
        stat: bet.statKey,
        odds: bet.odds,
        actual: bet.actual,
        won: bet.win,
      });
    }
  }

  return results;
}

async function computeBacktestSummary(evMin = 0, evMax = Infinity) {

  const files = await collectLatestBacktestFiles(backtestsDir);
  const summary = {};
  const overall = { total: 0, wins: 0, ev: 0 };
  for (const file of files) {
    const parent = path.basename(path.dirname(file));
    let matchMeta;
    if (parent === path.basename(backtestsDir)) {
      matchMeta = path
        .basename(file, ".json")
        .match(/(.+)-(.+)-(\d{4}-\d{2}-\d{2})$/);
    } else {
      matchMeta = parent.match(/(.+)-(.+)-(\d{4}-\d{2}-\d{2})$/);
    }

    if (!matchMeta) continue;
    const homeTeam = matchMeta[1].replace(/_/g, " ");
    const awayTeam = matchMeta[2].replace(/_/g, " ");
    const date = matchMeta[3];

    const raw = JSON.parse(await fs.readFile(file, "utf-8"));
    const bets = Array.isArray(raw) ? raw : raw.lines || [];

    for (const bet of bets) {
      if (bet.win == null) continue;
      const ev = bet.value;
      if (ev == null) continue;
      if (ev < evMin) continue;
      if (evMax !== Infinity && ev > evMax) continue;
      const stat = bet.statKey;
      const scope = bet.scope || "total";
      if (!summary[stat]) summary[stat] = {};
      if (!summary[stat][scope]) {

        summary[stat][scope] = { total: 0, wins: 0, ev: 0, matches: {} };
      }
      const s = summary[stat][scope];
      s.total++;
      overall.total++;
      if (bet.win) {
        s.wins++;
        s.ev += (bet.odds || 0) - 1;
        overall.wins++;
        overall.ev += (bet.odds || 0) - 1;
      } else {
        s.ev -= 1;
        overall.ev -= 1;
      }

      const matchId = `${homeTeam}-${awayTeam}-${date}`;
      if (!s.matches[matchId]) {
        s.matches[matchId] = {
          homeTeam,
          awayTeam,
          date,
          lines: [],
        };

      }
      const teamName =
        scope === "home"
          ? homeTeam
          : scope === "away"
          ? awayTeam
          : `${homeTeam} - ${awayTeam}`;
      s.matches[matchId].lines.push({
        team: teamName,
        period: bet.period || "ALL",
        condition: bet.condition || (bet.over ? "över" : "under"),
        line: bet.line,
        odds: bet.odds,
        expectedEv: bet.value,
        win: bet.win,
        actual: bet.actual,
        outcome: bet.win ? "win" : "loss",
      });
    }
  }

  const result = [];
  for (const [statKey, scopes] of Object.entries(summary)) {
    for (const [scope, s] of Object.entries(scopes)) {
      const matches = Object.values(s.matches)
        .sort((a, b) => b.date.localeCompare(a.date))

        .map((m) => {
          const conditionOrder = { "över": 0, over: 0, under: 1 };
          const periodRank = (p) => {
            const key = (p || "").toLowerCase();
            const num = parseInt(key, 10);
            if (!isNaN(num)) return num - 1; // 1st -> 0, 2nd -> 1, etc.
            return key === "all" || key === "match" ? 99 : 98;
          };

          const lines = m.lines
            .slice()
            .sort((a, b) => {
              const condA = a.condition?.toLowerCase() || "";
              const condB = b.condition?.toLowerCase() || "";
              const orderA = conditionOrder[condA] ?? 2;
              const orderB = conditionOrder[condB] ?? 2;
              if (orderA !== orderB) return orderA - orderB;


              const periodA = periodRank(a.period);
              const periodB = periodRank(b.period);
              if (periodA !== periodB) return periodA - periodB;


              return (a.line ?? 0) - (b.line ?? 0);
            });
          return {
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            date: m.date,
            lineCount: m.lines.length,
            lines,
          };
        });


      result.push({
        statKey,
        scope,
        total: s.total,
        hitRate: s.total ? s.wins / s.total : 0,
        actualEv: s.total ? s.ev / s.total : 0,

        matches,

      });
    }
  }
  return {
    summary: result,
    overall: {
      total: overall.total,
      wins: overall.wins,
      hitRate: overall.total ? overall.wins / overall.total : 0,
      actualEv: overall.total ? overall.ev / overall.total : 0,
    },
  };
}


// 🔥 Spara den senaste analysens resultat globalt
let latestResults = null;

app.get("/api/william/period-stats", async (req, res) => {
  try {
    const forceRefresh = ["1", "true", "yes"].includes(
      String(req.query.refresh || "").toLowerCase()
    );
    const data = await loadWilliamPeriodData({ forceRefresh });
    res.json(data);
  } catch (error) {
    console.error("❌ Failed to load William period stats", error);
    res
      .status(500)
      .json({ error: "Kunde inte läsa periodstatistik för lag." });
  }
});

app.get("/getTeams", async (req, res) => {
  try {
    const dataPath = path.join(__dirname, "leagues-and-teams.json");
    const data = await fs.readFile(dataPath, "utf-8");
    res.json(JSON.parse(data));
  } catch (err) {
    console.error("Failed to read leagues and teams", err);
    res.status(500).json({ error: "Failed to load teams" });
  }
});

app.get("/", async (req, res)=>{
  res.send("TEST")
})



// app.post("/start-analysis", async (req, res) => {
//   const { homeTeam, awayTeam, matchId } = req.body;

//   if (!homeTeam || !awayTeam) {
//     return res.status(400).json({ error: "Båda lagen måste anges" });
//   }

//   console.log(`🏆 Startar analys för ${homeTeam} vs ${awayTeam}`);

//   try {
//     console.log("🚀 Hämtar Unibet odds för matchId:", matchId);
//     await fetchUnibetOdds(matchId);
//     console.log("✅ Unibet-odds hämtade och sparade.");
//   } catch (error) {
//     console.error("❌ Fel vid hämtning av Unibet odds:", error.message);
//     return res.status(500).json({ error: "Kunde inte hämta Unibet odds." });
//   }

//     const teams1Path = path.join(__dirname, "teams-1.js");
//     const tmpTeamsPath = path.join("/tmp", "teams-selectedTeams.json");
//     const localTeamsPath = path.join(__dirname, "teams-selectedTeams.json");
//     const perfectBetPath = existsSync("/tmp")
//       ? path.join("/tmp", "teams-perfect-bet.json")
//       : path.join(__dirname, "teams-perfect-bet.json");

//   const matchedUnibetPath = path.join(__dirname, "matchedUnibetBets.json");
//   const leagueRankingPath = path.join(__dirname, "league_ranking.json");

//   try {
//     await fs.access(teams1Path);
//     console.log("✅ teams-1.js hittades och kommer att köras...");
//   } catch (error) {
//     console.error("❌ teams-1.js saknas eller är inte tillgänglig!");
//     return res.status(500).json({ error: "teams-1.js saknas!" });
//   }

//   // 🔥 Spara lagen i rätt sökväg beroende på om /tmp finns
//   const teamsData = JSON.stringify({ homeTeam, awayTeam }, null, 4);
//   let teamsSelectedPath;
//   if (existsSync("/tmp")) {
//     teamsSelectedPath = tmpTeamsPath;
//   } else {
//     teamsSelectedPath = localTeamsPath;
//   }

//   try {
//     await fs.writeFile(teamsSelectedPath, teamsData);
//     console.log(`✅ teams-selectedTeams.json sparad i ${teamsSelectedPath}`);
//   } catch (err) {
//     console.error("❌ Kunde inte spara teams-selectedTeams.json:", err.message);
//     return res.status(500).json({ error: "Kunde inte spara teams-filen." });
//   }

//   const childProcess = spawn("node", [teams1Path], { stdio: "inherit" });

//   childProcess.on("error", (err) => {
//     console.error(`❌ Fel vid start av teams-1.js: ${err.message}`);
//     return res.status(500).json({ error: "Kunde inte starta teams-1.js" });
//   });

//   childProcess.on("close", async (code) => {
//     if (code !== 0) {
//       console.error(`❌ teams-1.js avslutades med kod: ${code}`);
//       return res.status(500).json({
//         error: `Analysen misslyckades för ${homeTeam} vs ${awayTeam}`,
//       });
//     }

//     console.log("✅ teams-1.js har körts klart!");
//     console.log("⏳ Väntar 5 sekunder innan vi läser resultatfiler...");
//     await new Promise((resolve) => setTimeout(resolve, 5000));
    
//      // --- Här kopierar vi alltid senaste lokala fil till tmp innan vi läser ---
//      const localPerfect = path.join(__dirname, "teams-perfect-bet.json");
//      const tmpPerfect   = path.join("/tmp", "teams-perfect-bet.json");
//      if (existsSync(localPerfect) && existsSync("/tmp")) {
//        const freshData = await fs.readFile(localPerfect, "utf8");
//        await fs.writeFile(tmpPerfect, freshData, "utf8");
//      }
//      // ------------------------------------------------------------------------

//     try {
//       const [results, matchedBets, rankingData] = await Promise.all([
//         fs.readFile(perfectBetPath, "utf-8"),
//         fs.readFile(matchedUnibetPath, "utf-8"),
//         fs.readFile(leagueRankingPath, "utf-8"),
//       ]);

//       return res.json({
//         message: `Analysen har slutförts för ${homeTeam} vs ${awayTeam}`,
//         results: JSON.parse(results),
//         matchedUnibetBets: JSON.parse(matchedBets),
//         homeTeam,
//         awayTeam,
//         matchId,
//         leagueRanking: JSON.parse(rankingData),
//       });
//     } catch (error) {
//       console.error("❌ Fel vid inläsning av analysfiler:", error.message);
//       return res
//         .status(500)
//         .json({ error: "Kunde inte läsa in resultatfilerna." });
//     }
//   });
// });


// Expose Unibet odds fetching as a simple GET endpoint
app.get("/unibet-odds/:matchId", async (req, res) => {
  const { matchId } = req.params;
  try {
    await fetchUnibetOdds(matchId);
    const tmpPath = path.join("/tmp", "unibetOdds.json");
    const localPath = path.join(__dirname, "unibetOdds.json");
    const filePath = existsSync(tmpPath) ? tmpPath : localPath;
    const data = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(data);
    return res.json(json);
  } catch (error) {
    console.error("❌ Fel vid hämtning av Unibet odds:", error.message);
    return res.status(500).json({ error: "Kunde inte hämta Unibet odds." });
  }
});

app.post("/save-backtest", async (req, res) => {
  try {
    const { homeTeam, awayTeam, matchDate, lines, url } = req.body || {};
    if (!homeTeam || !awayTeam || !matchDate || !Array.isArray(lines)) {
      return res.status(400).json({ error: "Missing fields" });
    }
    // ensure backtests directory exists
    mkdirSync(backtestsDir, { recursive: true });
    const matchDirName = `${slugify(homeTeam)}-${slugify(awayTeam)}-${matchDate}`;
    const matchDirPath = path.join(backtestsDir, matchDirName);
    mkdirSync(matchDirPath, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${timestamp}.json`;
    const filePath = path.join(matchDirPath, fileName);
    const payload = { url, lines };
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
    return res.json({ status: "saved", file: path.join(matchDirName, fileName) });
  } catch (err) {
    console.error("Failed to save backtest", err);
    return res.status(500).json({ error: "Could not save backtest" });
  }
});

// Server-side: index.js (eller vad din serverfil heter)
app.post("/start-analysis", async (req, res) => {
  const { homeTeam, awayTeam, matchId } = req.body;

  await logAction(
    "teams",
    { homeTeam, awayTeam, matchId },
    req
  );

  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ error: "Båda lagen måste anges" });
  }

  console.log(`🏆 Startar analys för ${homeTeam} vs ${awayTeam}`);

  try {
    console.log("🚀 Hämtar Unibet odds för matchId:", matchId);
    await fetchUnibetOdds(matchId);
    console.log("✅ Unibet-odds hämtade och sparade.");
  } catch (error) {
    console.error("❌ Fel vid hämtning av Unibet odds:", error.message);
    return res.status(500).json({ error: "Kunde inte hämta Unibet odds." });
  }

  const teams1Path = path.join(__dirname, "teams-1.js");
  const tmpTeamsPath = path.join("/tmp", "teams-selectedTeams.json");
  const localTeamsPath = path.join(__dirname, "teams-selectedTeams.json");
  const perfectBetPath = existsSync("/tmp")
    ? path.join("/tmp", "teams-perfect-bet.json")
    : path.join(__dirname, "teams-perfect-bet.json");

  const matchedUnibetPath = path.join(__dirname, "matchedUnibetBets.json");
  const leagueRankingPath = path.join(__dirname, "league_ranking.json");

  try {
    await fs.access(teams1Path);
    console.log("✅ teams-1.js hittades och kommer att köras...");
  } catch (error) {
    console.error("❌ teams-1.js saknas eller är inte tillgänglig!");
    return res.status(500).json({ error: "teams-1.js saknas!" });
  }

  // 🔥 Spara lagen i rätt sökväg beroende på om /tmp finns
  const teamsData = JSON.stringify({ homeTeam, awayTeam }, null, 4);
  let teamsSelectedPath;
  if (existsSync("/tmp")) {
    teamsSelectedPath = tmpTeamsPath;
  } else {
    teamsSelectedPath = localTeamsPath;
  }

  try {
    await fs.writeFile(teamsSelectedPath, teamsData);
    console.log(`✅ teams-selectedTeams.json sparad i ${teamsSelectedPath}`);
  } catch (err) {
    console.error("❌ Kunde inte spara teams-selectedTeams.json:", err.message);
    return res.status(500).json({ error: "Kunde inte spara teams-filen." });
  }

  const childProcess = spawn("node", [teams1Path], { stdio: "inherit" });

  childProcess.on("error", (err) => {
    console.error(`❌ Fel vid start av teams-1.js: ${err.message}`);
    return res.status(500).json({ error: "Kunde inte starta teams-1.js" });
  });

  childProcess.on("close", async (code) => {
    if (code !== 0) {
      console.error(`❌ teams-1.js avslutades med kod: ${code}`);
      return res.status(500).json({
        error: `Analysen misslyckades för ${homeTeam} vs ${awayTeam}`,
      });
    }

    console.log("✅ teams-1.js har körts klart!");
    console.log("⏳ Väntar 5 sekunder innan vi läser resultatfiler...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // --- Här kopierar vi alltid senaste lokala fil till tmp innan vi läser ---
    const localPerfect = path.join(__dirname, "teams-perfect-bet.json");
    const tmpPerfect = path.join("/tmp", "teams-perfect-bet.json");
    if (existsSync(localPerfect) && existsSync("/tmp")) {
      const freshData = await fs.readFile(localPerfect, "utf8");
      // ta bort eventuell gammal tmp-fil först
      await fs.unlink(tmpPerfect).catch(() => {});
      // skriv den nya
      await fs.writeFile(tmpPerfect, freshData, "utf8");
    }
    // ------------------------------------------------------------------------

    // ------------------------------------------------------------------------

    try {
      const [results, matchedBets, rankingData] = await Promise.all([
        fs.readFile(perfectBetPath, "utf-8"),
        fs.readFile(matchedUnibetPath, "utf-8"),
        fs.readFile(leagueRankingPath, "utf-8"),
      ]);

      return res.json({
        message: `Analysen har slutförts för ${homeTeam} vs ${awayTeam}`,
        results: JSON.parse(results),
        matchedUnibetBets: JSON.parse(matchedBets),
        homeTeam,
        awayTeam,
        matchId,
        leagueRanking: JSON.parse(rankingData),
      });
    } catch (error) {
      console.error("❌ Fel vid inläsning av analysfiler:", error.message);
      return res
        .status(500)
        .json({ error: "Kunde inte läsa in resultatfilerna." });
    }
  });
});









app.post("/start-allstats-analysis", async (req, res) => {
  const { matchDate, selectedLeagues } = req.body;

  await logAction(
    "allstats",
    { matchDate, selectedLeagues },
    req
  );

  console.log("✅ Valt datum: ", req.body.matchDate);

  if (!matchDate) {
    return res.status(400).json({ error: "❌ Datum måste anges!" });
  }

  console.log(`✅ Startar Allstats-analys för datum: ${matchDate}`);
  if (selectedLeagues?.length) {
    console.log(`✅ Valda ligor: ${selectedLeagues.join(", ")}`);
  }

  // 🔥 Spara datumet i en fil
  const dateFilePath = path.join(__dirname, "selected-match-date.json");
  await fs.writeFile(dateFilePath, JSON.stringify({ matchDate }, null, 4));

  // 🔥 Fullständig sökväg till UNIBET/allstats-1.js
  const scriptPath = path.join(__dirname, "allstats-1.js");
  const args = [scriptPath, matchDate];
  if (selectedLeagues?.length) {
    args.push(selectedLeagues.join(","));
  }

  // 🔥 Kör allstats-1.js med matchDate + valda ligor
  console.log(`✅ Kör: node ${args.join(" ")}`);
  const childProcess = spawn("node", args, { stdio: "inherit" });

  childProcess.on("error", (err) => {
    console.error(`❌ Fel vid start av allstats-1.js: ${err.message}`);
    res.status(500).json({ error: "Kunde inte starta allstats-1.js" });
  });

  
  childProcess.on("close", async (code) => {
    if (code === 0) {
      console.log("✅ allstats-1.js har körts klart!");

      try {
        const resultPaths = [
          path.join("/tmp", "allstats-perfect-bet.json"),
          path.join(__dirname, "allstats-perfect-bet.json"),
        ];
        const resultPath = resultPaths.find((p) => existsSync(p));

        if (!resultPath) {
          throw new Error(
            "Hittade inte allstats-perfect-bet.json i varken /tmp eller lokalt"
          );
        }

        const results = await fs.readFile(resultPath, "utf-8");
        const parsedResults = JSON.parse(results);

        const rankingPath = path.join(__dirname, "league_ranking.json");
        const rankingData = await fs.readFile(rankingPath, "utf-8");
        const leagueRanking = JSON.parse(rankingData);

        res.json({
          message: `Allstats-analysen för ${matchDate} är klar!`,
          results: parsedResults,
          leagueRanking,
        });
      } catch (error) {
        console.error("❌ Fel vid inläsning av resultatfiler:", error.message);
        res.json({
          message: `⚠️ Allstats-analysen för ${matchDate} är klar, men inga resultat hittades.`,
        });
      }
    } else {
      console.error(`❌ allstats-1.js avslutades med kod: ${code}`);
      res.status(500).json({ error: `Analysen misslyckades för ${matchDate}` });
    }
  });

});



app.post("/players", async (req, res) => {
    const { homeTeam, awayTeam, matchId } = req.body;

    await logAction("players", { homeTeam, awayTeam, matchId }, req);

    if (!homeTeam || !awayTeam) {
        return res.status(400).json({ error: "Båda lagen måste anges" });
    }

    console.log(`🏆 Startar spelaranalys för ${homeTeam} vs ${awayTeam}`);

    // 🔥 Kontrollera om players-1.js finns innan vi kör den
    try {
        await fs.access("players-1.js");
        console.log("✅ players-1.js hittades och kommer att köras...");
    } catch (error) {
        console.error("❌ players-1.js saknas eller är inte tillgänglig!");
        return res.status(500).json({ error: "players-1.js saknas!" });
    }

    // 🔥 Spara de valda lagen i en JSON-fil
    const playersFilePath = "players-selectedPlayers.json";
    await fs.writeFile(playersFilePath, JSON.stringify({ homeTeam, awayTeam, matchId }, null, 4));

    console.log(`🚀 Försöker köra players-1.js...`);
    const childProcess = spawn("node", ["players-1.js"], { stdio: "inherit" });

    childProcess.on("error", (err) => {
        console.error(`❌ Fel vid start av players-1.js: ${err.message}`);
        return res.status(500).json({ error: "Kunde inte starta players-1.js" });
    });

    childProcess.on("close", async (code) => {
        if (code === 0) {
            console.log("✅ players-1.js har körts klart!");

            // 🔥 Vänta i 5 sekunder innan vi försöker läsa filen
            console.log("⏳ Väntar 5 sekunder innan vi försöker läsa playerstats/perfect-bet.json...");
            await new Promise(resolve => setTimeout(resolve, 5000));

            const filePath = "./playerstats/perfect-bet.json";

            // 🔥 Försök att läsa in perfect-bet.json
            try {
              let perfectBet = []
                const perfectBetData = await fs.readFile(filePath, "utf-8")
                perfectBet = JSON.parse(perfectBetData)
            
                // 🔥 Läs in matchedBets.json
                const matchedBetsPath = "./matchedBets.json";
                let matchedBets = [];
                try {
                    const matchedBetsData = await fs.readFile(matchedBetsPath, "utf-8");
                    matchedBets = JSON.parse(matchedBetsData);
                    console.log("✅ matchedBets.json har hittats!");
                } catch (error) {
                    console.warn("⚠️ matchedBets.json hittades inte eller kunde inte läsas in.");
                }
            
                // 🔥 Skicka endast matchedFouledBets och matchedBets till frontend
                return res.json({
                    message: `Spelaranalysen har slutförts för ${homeTeam} vs ${awayTeam}`,
                   perfectBet,
                    matchedBets
                });
            
            } catch (error) {
                console.error("❌ Fel vid inläsning av resultatfiler:", error.message);
                return res.status(500).json({ error: "Kunde inte läsa in resultatfilerna." });
            }
            
        } else {
            console.error(`❌ players-1.js avslutades med kod: ${code}`);
            return res.status(500).json({ error: `Spelaranalysen misslyckades för ${homeTeam} vs ${awayTeam}` });
        }
    });
});


app.get("/leagues-and-teams", async (req, res) => {
    try {
        const data = await fs.readFile("leagues-and-teams.json", "utf-8");
        const leaguesAndTeams = JSON.parse(data);
        res.json(leaguesAndTeams);
    } catch (error) {
        console.error("❌ Fel vid inläsning av leagues-and-teams.json:", error.message);
        res.status(500).json({ error: "Kunde inte läsa in ligor och lag." });
    }
});



// 🔹 Hitta den relativa sökvägen till pipeline-skriptet
const scriptPath = path.join(__dirname, './machineLearning/v3/0-pipline.py');
const predictionsFilePath = path.join(
  __dirname,
  "./machineLearning/v3/predicted_match_stats.json"
);
const oddsFilePath = path.join(__dirname, "unibetPredictOdds.json")






// 🔹 Funktion som väntar på att filen skapas
const waitForFile = async (filePath, timeout = 5000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await fs.access(filePath);
      return; // Filen finns
    } catch (err) {
      // Filen finns inte än, vänta och prova igen
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Timeout: Filen skapades inte i tid");
};



// 🔹 Hämta odds för varje match-ID **sekventiellt**
const fetchAndSaveOdds = async (matchIds) => {
  console.log("🚀 Startar hämtning av Unibet odds...");
  await fs.writeFile(oddsFilePath, JSON.stringify({}, null, 2), "utf8");
  for (const matchId of matchIds) {
    try {
      console.log(`🔄 Hämtar odds för matchId: ${matchId}`);
      await fetchUnibetOddsPredictions(matchId); // Funktion hanterar filuppdatering själv
      console.log(`✅ Odds hämtade och sparade för matchId: ${matchId}`);
    } catch (error) {
      console.error(`❌ Fel vid hämtning av odds för matchId ${matchId}:`, error.message);
    }
  }

  console.log(`✅ Alla odds hämtade och sparade i ${oddsFilePath}`);
};

// 🔹 Huvud-API för att starta hela processen
app.post("/predict", async (req, res) => {
  try {
    const { matchIds } = req.body;
    if (!matchIds || matchIds.length === 0) {
      return res.status(400).json({ error: "Inga match-IDs skickades." });
    }

    console.log("🚀 Hämtar och sparar Unibet odds för alla match-IDs...");
    await fetchAndSaveOdds(matchIds); // Uppdaterad funktion

    console.log(`🚀 Kör pipeline-skriptet: ${scriptPath}`);
    const process = spawn("python", [scriptPath]);

    let stdoutData = "";
    let stderrData = "";

    process.stdout.on("data", (data) => {
      stdoutData += data.toString();
      console.log(`📥 STDOUT: ${data}`);
    });

    process.stderr.on("data", (data) => {
      stderrData += data.toString();
      console.error(`❌ STDERR: ${data}`);
    });

    process.on("close", async (code) => {
      console.log(`✅ Pipeline avslutad med kod ${code}`);

      if (code !== 0) {
        return res.status(500).json({ message: "❌ Pipeline misslyckades!", error: stderrData });
      }

      try {
        console.log("⏳ Väntar på att predictions-filen ska skapas...");
        await waitForFile(predictionsFilePath);
    
        console.log("✅ Predictions-filen hittades!");
        await new Promise((resolve) => setTimeout(resolve, 500));
    
        console.log("🔍 Försöker läsa predictions-filen...");
        const predictionsData = await fs.readFile(predictionsFilePath, "utf8");
    
        if (!predictionsData.trim()) {
            throw new Error("Predictions-filen är tom!");
        }
    
        const predictionsJson = JSON.parse(predictionsData);
        console.log("✅ JSON-parsning för predictions lyckades!");
    
        console.log("📂 Läser in Unibet-odds...");
        const oddsData = await fs.readFile(oddsFilePath, "utf8");
    
        if (!oddsData.trim()) {
            throw new Error("Unibet-odds-filen är tom!");
        }
    
        const oddsJson = JSON.parse(oddsData);
        console.log("✅ JSON-parsning för Unibet-odds lyckades!");
    
        console.log("✅ Båda filerna skickade till frontend!");
        res.json({
            predictions: predictionsJson,
            unibetOdds: oddsJson,
        });
      } catch (err) {
        console.error(`❌ Fel vid väntan/läsning av predictions-filen: ${err.message}`);
        res.status(500).json({
          message: "❌ Predictions-filen skapades inte eller är ogiltig!",
          error: err.message,
        });
      }
    });
  } catch (err) {
    console.error(`❌ Oväntat fel: ${err.message}`);
    res.status(500).json({
      message: "❌ Oväntat fel vid körning av pipeline!",
      error: err.message,
    });
  }
});




app.get("/load-perfect-bets", async (req, res) => {
  try {
    const data = await fs.readFile("allstats-perfect-bet.json", "utf8");
    const json = JSON.parse(data);
    res.json(json);
  } catch (error) {
    console.error("❌ Kunde inte läsa perfect-bet-filen", error);
    res.status(500).json({ error: "Misslyckades att läsa eller tolka filen" });
  }
});


app.get("/load-teams-perfect", async (req, res) => {
  try {
    const data = await fs.readFile("teams-perfect-bet.json", "utf8");
    const json = JSON.parse(data);
    res.json(json);
  } catch (error) {
    console.error("❌ Kunde inte läsa perfect-bet-filen", error);
    res.status(500).json({ error: "Misslyckades att läsa eller tolka filen" });
  }
});


app.get("/get-leagues", async (req, res) => {
  const data = JSON.parse(await fs.readFile("leagues-and-teams.json", "utf-8"));
  const leagues = Object.entries(data).map(([name, leagueObj]) => ({
    name, // nyckeln blir ligans namn
    imageUrl: leagueObj.imageUrl || "https://via.placeholder.com/22",
  }));
  res.json(leagues);
});




app.get("/debug/allstats-perfect", async (req, res) => {
  try {
    const data = await fs.readFile("/tmp/allstats-perfect-bet.json", "utf8");
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});





// app.post("/expected-value", async (req, res) => {
//   console.log("========== NY REQUEST ==========");
//   console.log("[server] body mottagen:", req.body);

//   const {
//     homeTeam = "",
//     awayTeam = "",
//     over = true, // Ändrat från direction till over (boolean)
//     line,
//     scope = "total",
//     stat = "totalShots",
//     period = "ALL",
//     form = "all",
//     odds = "",
//     // neutral = false,
//   } = req.body;

//   if (!homeTeam || !awayTeam || line === undefined) {
//     console.log("[server] saknar fält – avbryter");
//     return res.status(400).json({
//       error: "Hemmalag, bortalag och lina krävs",
//       missing: [
//         !homeTeam && "homeTeam",
//         !awayTeam && "awayTeam",
//         line === undefined && "line",
//       ].filter(Boolean),
//     });
//   }

//   const scriptPath = path.join(__dirname, "backtest-raz.js");
//   console.log("[server] Sökväg till backtest-raz.js:", scriptPath);

//   if (!existsSync(scriptPath)) {
//     console.error("[server] backtest-raz.js hittades inte på:", scriptPath);
//     return res.status(500).json({
//       error: "Backtest-skriptet kunde inte hittas",
//       details: `Sökväg: ${scriptPath}`,
//     });
//   }

//   // Skapa unikt filnamn för denna körning
//   const requestId = uuidv4();
//   const resultFile = path.join(__dirname, `backtest-result-${requestId}.json`);

//   const argv = [
//     scriptPath,
//     homeTeam,
//     awayTeam,
//     over ? "över" : "under",
//     line.toString(),
//     scope,
//     stat,
//     period,
//     form,
//     // neutral ? "neutral" : "normal",
//   ];
//   if (odds) argv.push(odds.toString());
//   console.log("[server] argv  →", argv.join(" | "));

//   const child = spawn("node", argv, {
//     cwd: process.cwd(),
//     env: { ...process.env, RESULT_FILE: resultFile },
//   });

//   let out = "",
//     err = "";
//   child.stdout.on("data", (d) => {
//     process.stdout.write("[child stdout] " + d);
//     out += d;
//   });
//   child.stderr.on("data", (d) => {
//     process.stderr.write("[child stderr] " + d);
//     err += d;
//   });

//   child.on("close", async (code) => {
//     console.log("[server] child avslutades med kod", code);
//     if (code !== 0) {
//       console.log("[server] fel:", err);
//       return res.status(400).json({
//         error: "Backtest-processen misslyckades",
//         details: err || `Exit code ${code}`,
//       });
//     }

   
//     try {
//       const content = await fs.readFile(resultFile, "utf-8");
//       const data = JSON.parse(content);
//       console.log(`[server] skickar tillbaka resultat från ${resultFile}`);
//       await fs.unlink(resultFile); // Radera filen efter användning
//       return res.json(data);
//     } catch (e) {
//       console.error("[server] kunde inte läsa JSON-resultat:", e);
//       if (e.code === "ENOENT") {
//         return res.status(500).json({
//           error: "Resultatfilen kunde inte hittas",
//           details: `Sökväg: ${resultFile}, Fel: ${e.message}`,
//         });
//       } else if (e instanceof SyntaxError) {
//         return res.status(500).json({
//           error: "Resultatfilen är inte giltig JSON",
//           details: `Sökväg: ${resultFile}, Fel: ${e.message}`,
//         });
//       }
//       return res.status(500).json({
//         error: "Kunde inte läsa resultatfilen",
//         details: e.message,
//       });
//     }
//   });
// });




app.post("/expected-value", async (req, res) => {
  console.log("========== NY REQUEST ==========");
  console.log("[server] body mottagen:", req.body);

  const {
    homeTeam = "",
    awayTeam = "",
    over = true,
    line,
    scope = "total",
    stat = "totalShots",
    period = "ALL",
    form = "all",
    odds = "",
    neutralGround = false, // New parameter
  } = req.body;

  if (!homeTeam || !awayTeam || line === undefined) {
    console.log("[server] saknar fält – avbryter");
    return res.status(400).json({
      error: "Hemmalag, bortalag och lina krävs",
      missing: [
        !homeTeam && "homeTeam",
        !awayTeam && "awayTeam",
        line === undefined && "line",
      ].filter(Boolean),
    });
  }

  const scriptPath = path.join(__dirname, "backtest-raz.js");
  console.log("[server] Sökväg till backtest-raz.js:", scriptPath);

  if (!existsSync(scriptPath)) {
    console.error("[server] backtest-raz.js hittades inte på:", scriptPath);
    return res.status(500).json({
      error: "Backtest-skriptet kunde inte hittas",
      details: `Sökväg: ${scriptPath}`,
    });
  }

  const requestId = uuidv4();
  const resultFile = path.join(__dirname, `backtest-result-${requestId}.json`);

  const argv = [
    scriptPath,
    homeTeam,
    awayTeam,
    over ? "över" : "under",
    line.toString(),
    scope,
    stat,
    period,
    form,
    neutralGround.toString(), // Add neutralGround to argv
  ];
  if (odds) argv.push(odds.toString());
  console.log("[server] argv  →", argv.join(" | "));

  const child = spawn("node", argv, {
    cwd: process.cwd(),
    env: { ...process.env, RESULT_FILE: resultFile },
  });

  let out = "",
    err = "";
  child.stdout.on("data", (d) => {
    process.stdout.write("[child stdout] " + d);
    out += d;
  });
  child.stderr.on("data", (d) => {
    process.stderr.write("[child stderr] " + d);
    err += d;
  });

  child.on("close", async (code) => {
    console.log("[server] child avslutades med kod", code);
    if (code !== 0) {
      console.log("[server] fel:", err);
      return res.status(400).json({
        error: "Backtest-processen misslyckades",
        details: err || `Exit code ${code}`,
      });
    }

    try {
      const content = await fs.readFile(resultFile, "utf-8");
      const data = JSON.parse(content);
      console.log(`[server] skickar tillbaka resultat från ${resultFile}`);
      await logAction(
        "backtest",
        {
          homeTeam,
          awayTeam,
          over,
          line,
          scope,
          stat,
          period,
          form,
          odds,
          neutralGround,
          evPct: data.evPct,
          legacyEvPct: data.legacyEvPct,
        },
        req
      );
      await fs.unlink(resultFile);
      return res.json(data);
    } catch (e) {
      console.error("[server] kunde inte läsa JSON-resultat:", e);
      if (e.code === "ENOENT") {
        return res.status(500).json({
          error: "Resultatfilen kunde inte hittas",
          details: `Sökväg: ${resultFile}, Fel: ${e.message}`,
        });
      } else if (e instanceof SyntaxError) {
        return res.status(500).json({
          error: "Resultatfilen är inte giltig JSON",
          details: `Sökväg: ${resultFile}, Fel: ${e.message}`,
        });
      }
      return res.status(500).json({
        error: "Kunde inte läsa resultatfilen",
        details: e.message,
      });
    }
  });
});

app.post("/expected-value-copy", async (req, res) => {
  console.log("========== NY REQUEST ==========");
  console.log("[server] body mottagen:", req.body);

  const {
    homeTeam = "",
    awayTeam = "",
    over = true,
    line,
    scope = "total",
    stat = "totalShots",
    period = "ALL",
    form = "all",
    odds = "",
    neutralGround = false,
    home_importance = 5,
    away_importance = 5,
  } = req.body;

  if (!homeTeam || !awayTeam || line === undefined) {
    console.log("[server] saknar fält – avbryter");
    return res.status(400).json({
      error: "Hemmalag, bortalag och lina krävs",
      missing: [
        !homeTeam && "homeTeam",
        !awayTeam && "awayTeam",
        line === undefined && "line",
      ].filter(Boolean),
    });
  }

  const homeImp = parseInt(home_importance, 10);
  const awayImp = parseInt(away_importance, 10);
  if (isNaN(homeImp) || homeImp < 1 || homeImp > 10) {
    return res.status(400).json({
      error: "home_importance måste vara ett nummer mellan 1 och 10",
    });
  }
  if (isNaN(awayImp) || awayImp < 1 || awayImp > 10) {
    return res.status(400).json({
      error: "away_importance måste vara ett nummer mellan 1 och 10",
    });
  }

  const scriptPath = path.join(__dirname, "backtest-copy.js");
  console.log("[server] Sökväg till backtest-copy.js:", scriptPath);

  if (!existsSync(scriptPath)) {
    console.error("[server] backtest-copy.js hittades inte på:", scriptPath);
    return res.status(500).json({
      error: "Backtest-skriptet kunde inte hittas",
      details: `Sökväg: ${scriptPath}`,
    });
  }

  const requestId = uuidv4();
  const resultFile = path.join(__dirname, `backtest-result-${requestId}.json`);

  const argv = [
    scriptPath,
    homeTeam,
    awayTeam,
    over ? "över" : "under",
    line.toString(),
    scope,
    stat,
    period,
    form,
    neutralGround.toString(),
  ];
  if (odds) argv.push(odds.toString());
  argv.push(homeImp.toString());
  argv.push(awayImp.toString());
  console.log("[server] argv  →", argv.join(" | "));

  const child = spawn("node", argv, {
    cwd: process.cwd(),
    env: { ...process.env, RESULT_FILE: resultFile },
  });

  let out = "",
    err = "";
  child.stdout.on("data", (d) => {
    process.stdout.write("[child stdout] " + d);
    out += d;
  });
  child.stderr.on("data", (d) => {
    process.stderr.write("[child stderr] " + d);
    err += d;
  });

  child.on("close", async (code) => {
    console.log("[server] child avslutades med kod", code);
    if (code !== 0) {
      console.log("[server] fel:", err);
      return res.status(400).json({
        error: "Backtest-processen misslyckades",
        details: err || `Exit code ${code}`,
      });
    }

    try {
      const content = await fs.readFile(resultFile, "utf-8");
      const data = JSON.parse(content);
      console.log(`[server] skickar tillbaka resultat från ${resultFile}`);
      await logAction(
        "backtest copy",
        {
          homeTeam,
          awayTeam,
          over,
          line,
          scope,
          stat,
          period,
          form,
          odds,
          neutralGround,
          home_importance: homeImp,
          away_importance: awayImp,
          evPct: data.evPct,
          legacyEvPct: data.legacyEvPct,
        },
        req
      );
      await fs.unlink(resultFile);
      return res.json(data);
    } catch (e) {
      console.error("[server] kunde inte läsa JSON-resultat:", e);
      if (e.code === "ENOENT") {
        return res.status(500).json({
          error: "Resultatfilen kunde inte hittas",
          details: `Sökväg: ${resultFile}, Fel: ${e.message}`,
        });
      } else if (e instanceof SyntaxError) {
        return res.status(500).json({
          error: "Resultatfilen är inte giltig JSON",
          details: `Sökväg: ${resultFile}, Fel: ${e.message}`,
        });
      }
      return res.status(500).json({
        error: "Kunde inte läsa resultatfilen",
        details: e.message,
      });
    }
  });
});





app.post("/backtest-grok", async (req, res) => {
  console.log("========== NY REQUEST ==========");
  console.log("[server] body mottagen:", req.body);

  const {
    homeTeam = "",
    awayTeam = "",
    statKey = "",
    mode = "total",
    period = "ALL",
    numMatches = "all",
    home_importance = 5,
    away_importance = 5,
  } = req.body;

  await logAction(
    "backtest grok",
    { homeTeam, awayTeam, statKey, mode, period, numMatches, home_importance, away_importance },
    req
  );

  // Validera obligatoriska fält
  if (!homeTeam || !awayTeam || !statKey) {
    console.log("[server] saknar fält – avbryter");
    return res.status(400).json({
      error: "Hemmalag, bortalag och statistik krävs",
      missing: [
        !homeTeam && "homeTeam",
        !awayTeam && "awayTeam",
        !statKey && "statKey",
      ].filter(Boolean),
    });
  }

  // Validera mode och period
  const validModes = ["total", "home", "away"];
  const validPeriods = ["ALL", "1ST", "2ND"];
  if (!validModes.includes(mode)) {
    return res.status(400).json({
      error: `Ogiltig mode: ${mode}. Måste vara en av ${validModes.join(", ")}`,
    });
  }
  if (!validPeriods.includes(period)) {
    return res.status(400).json({
      error: `Ogiltig period: ${period}. Måste vara en av ${validPeriods.join(
        ", "
      )}`,
    });
  }

  // Validera importance-värden
  const homeImp = parseInt(home_importance, 10);
  const awayImp = parseInt(away_importance, 10);
  if (isNaN(homeImp) || homeImp < 1 || homeImp > 10) {
    return res.status(400).json({
      error: "home_importance måste vara ett nummer mellan 1 och 10",
    });
  }
  if (isNaN(awayImp) || awayImp < 1 || awayImp > 10) {
    return res.status(400).json({
      error: "away_importance måste vara ett nummer mellan 1 och 10",
    });
  }

  // Validera numMatches
  const numMatchesStr =
    numMatches === "all" ? "ALL" : parseInt(numMatches, 10).toString();
  if (
    numMatches !== "all" &&
    (isNaN(parseInt(numMatches, 10)) || parseInt(numMatches, 10) <= 0)
  ) {
    return res.status(400).json({
      error: "numMatches måste vara 'all' eller ett positivt nummer",
    });
  }

  // Sökvägar till skript
  const createProfilesScript = path.join(__dirname, "create_team_profiles.js");
  const backtestScript = path.join(__dirname, "backtest-grok.js");

  // Validera att skripten finns
  if (!existsSync(createProfilesScript)) {
    console.error(
      "[server] create_team_profiles.js hittades inte på:",
      createProfilesScript
    );
    return res.status(500).json({
      error: "Skriptet för att skapa profiler kunde inte hittas",
      details: `Sökväg: ${createProfilesScript}`,
    });
  }
  if (!existsSync(backtestScript)) {
    console.error(
      "[server] backtest-grok.js hittades inte på:",
      backtestScript
    );
    return res.status(500).json({
      error: "Backtest-skriptet kunde inte hittas",
      details: `Sökväg: ${backtestScript}`,
    });
  }

  // Kör create_team_profiles.js
  console.log("[server] Kör create_team_profiles.js för:", homeTeam, awayTeam);
  const createProfileArgs = [createProfilesScript, homeTeam, awayTeam];
  console.log("[server] create argv →", createProfileArgs.join(" | "));

  const createChild = spawn("node", createProfileArgs, {
    cwd: process.cwd(),
    env: process.env,
  });

  let createOut = "",
    createErr = "";
  createChild.stdout.on("data", (d) => {
    process.stdout.write("[create stdout] " + d);
    createOut += d;
  });
  createChild.stderr.on("data", (d) => {
    process.stderr.write("[create stderr] " + d);
    createErr += d;
  });

  // Vänta på att create_team_profiles.js avslutas
  const createExitCode = await new Promise((resolve) => {
    createChild.on("close", (code) => {
      console.log("[server] create_team_profiles.js avslutades med kod", code);
      resolve(code);
    });
  });

  if (createExitCode !== 0) {
    console.log("[server] fel vid skapande av profiler:", createErr);
    return res.status(500).json({
      error: "Misslyckades att skapa teamprofiler",
      details: createErr || `Exit code ${createExitCode}`,
    });
  }

  // Skapa unikt filnamn för backtest-resultat
  const requestId = uuidv4();
  const resultFile = path.join(__dirname, `backtest-result-${requestId}.json`);

  // Kör backtest-grok.js
  const backtestArgs = [
    backtestScript,
    homeTeam,
    awayTeam,
    statKey,
    mode,
    period,
    numMatchesStr,
    homeImp.toString(),
    awayImp.toString(),
  ];
  console.log("[server] backtest argv →", backtestArgs.join(" | "));

  const backtestChild = spawn("node", backtestArgs, {
    cwd: process.cwd(),
    env: { ...process.env, RESULT_FILE: resultFile },
  });

  let backtestOut = "",
    backtestErr = "";
  backtestChild.stdout.on("data", (d) => {
    process.stdout.write("[backtest stdout] " + d);
    backtestOut += d;
  });
  backtestChild.stderr.on("data", (d) => {
    process.stderr.write("[backtest stderr] " + d);
    backtestErr += d;
  });

  backtestChild.on("close", async (code) => {
    console.log("[server] backtest-grok.js avslutades med kod", code);
    if (code !== 0) {
      console.log("[server] fel:", backtestErr);
      return res.status(400).json({
        error: "Backtest-processen misslyckades",
        details: backtestErr || `Exit code ${code}`,
      });
    }

    // Tolka stdout för att extrahera prediktion
    const predictionMatch = backtestOut.match(/Predicted .*?: (\d+\.\d{2})/);
    const prediction = predictionMatch ? parseFloat(predictionMatch[1]) : null;

    // Försök läsa resultatfil om den finns
    let data = {};
    try {
      const content = await fs.readFile(resultFile, "utf-8");
      data = JSON.parse(content);
      console.log(`[server] läste resultat från ${resultFile}`);
      await fs.unlink(resultFile); // Radera filen
    } catch (e) {
      console.log(
        "[server] ingen resultatfil hittades eller ogiltig JSON, använder stdout"
      );
      data = { prediction };
    }

    if (!prediction) {
      return res.status(500).json({
        error: "Kunde inte extrahera prediktion från skriptet",
        details: backtestOut,
      });
    }

    console.log("[server] skickar tillbaka resultat:", { ...data, prediction });
    return res.json({ ...data, prediction });
  });
});






app.post("/backtest-ev", async (req, res) => {
  console.log("========== NY REQUEST ==========");
  console.log("[server] body mottagen:", req.body);

  const {
    homeTeam = "",
    awayTeam = "",
    over = true,
    line = 0,
    scope = "total",
    statKey = "",
    period = "ALL",
    form = "all",
    odds = null,
    home_importance = 5,
    away_importance = 5,
  } = req.body;

  // Validera obligatoriska fält
  if (!homeTeam || !awayTeam || !statKey || line <= 0) {
    console.log("[server] saknar fält – avbryter");
    return res.status(400).json({
      error: "Hemmalag, bortalag, statistik och lina krävs",
      missing: [
        !homeTeam && "homeTeam",
        !awayTeam && "awayTeam",
        !statKey && "statKey",
        line <= 0 && "line",
      ].filter(Boolean),
    });
  }

  // Validera scope, period och statKey
  const validScopes = ["total", "home", "away"];
  const validPeriods = ["ALL", "1ST", "2ND"];
  const validStats = [
    "totalShotsOnGoal",
    "shotsOnGoal",
    "cornerKicks",
    "yellowCards",
    "throwIns",
    "freeKicks",
    "fouls",
    "totalTackle",
    "offsides",
  ];
  if (!validScopes.includes(scope)) {
    return res.status(400).json({
      error: `Ogiltig scope: ${scope}. Måste vara en av ${validScopes.join(
        ", "
      )}`,
    });
  }
  if (!validPeriods.includes(period)) {
    return res.status(400).json({
      error: `Ogiltig period: ${period}. Måste vara en av ${validPeriods.join(
        ", "
      )}`,
    });
  }
  if (!validStats.includes(statKey)) {
    return res.status(400).json({
      error: `Ogiltig statKey: ${statKey}. Måste vara en av ${validStats.join(
        ", "
      )}`,
    });
  }

  // Validera importance-värden
  const homeImp = parseInt(home_importance, 10);
  const awayImp = parseInt(away_importance, 10);
  if (isNaN(homeImp) || homeImp < 1 || homeImp > 10) {
    return res.status(400).json({
      error: "home_importance måste vara ett nummer mellan 1 och 10",
    });
  }
  if (isNaN(awayImp) || awayImp < 1 || awayImp > 10) {
    return res.status(400).json({
      error: "away_importance måste vara ett nummer mellan 1 och 10",
    });
  }

  // Validera form
  const numMatches = form === "all" ? "ALL" : parseInt(form, 10).toString();
  if (
    form !== "all" &&
    (isNaN(parseInt(form, 10)) || parseInt(form, 10) <= 0)
  ) {
    return res.status(400).json({
      error: "form måste vara 'all' eller ett positivt nummer",
    });
  }

  // Validera odds
  if (odds !== null && (isNaN(odds) || odds <= 1)) {
    return res.status(400).json({
      error: "odds måste vara ett nummer större än 1 eller null",
    });
  }

  // Sökvägar till skript
  const createProfilesScript = path.join(__dirname, "create_team_profiles.js");
  const backtestScript = path.join(__dirname, "backtest-grok2.js");

  // Validera att skripten finns
  if (!existsSync(createProfilesScript)) {
    console.error(
      "[server] create_team_profiles.js hittades inte på:",
      createProfilesScript
    );
    return res.status(500).json({
      error: "Skriptet för att skapa profiler kunde inte hittas",
      details: `Sökväg: ${createProfilesScript}`,
    });
  }
  if (!existsSync(backtestScript)) {
    console.error(
      "[server] backtest-grok.js hittades inte på:",
      backtestScript
    );
    return res.status(500).json({
      error: "Backtest-skriptet kunde inte hittas",
      details: `Sökväg: ${backtestScript}`,
    });
  }

  // Kör create_team_profiles.js
  console.log("[server] Kör create_team_profiles.js för:", homeTeam, awayTeam);
  const createProfileArgs = [createProfilesScript, homeTeam, awayTeam];
  console.log("[server] create argv →", createProfileArgs.join(" | "));

  const createChild = spawn("node", createProfileArgs, {
    cwd: process.cwd(),
    env: process.env,
  });

  let createOut = "",
    createErr = "";
  createChild.stdout.on("data", (d) => {
    process.stdout.write("[create stdout] " + d);
    createOut += d;
  });
  createChild.stderr.on("data", (d) => {
    process.stderr.write("[create stderr] " + d);
    createErr += d;
  });

  const createExitCode = await new Promise((resolve) => {
    createChild.on("close", (code) => {
      console.log("[server] create_team_profiles.js avslutades med kod", code);
      resolve(code);
    });
  });

  if (createExitCode !== 0) {
    console.log("[server] fel vid skapande av profiler:", createErr);
    return res.status(500).json({
      error: "Misslyckades att skapa teamprofiler",
      details: createErr || `Exit code ${createExitCode}`,
    });
  }

  // Skapa unikt filnamn för backtest-resultat
  const requestId = uuidv4();
  const resultFile = path.join(__dirname, `backtest-result-${requestId}.json`);

  const dirStr = over ? "över" : "under";

  // Kör backtest-grok.js
  const backtestArgs = [
    backtestScript,
    homeTeam,
    awayTeam,
    statKey,
    scope,
    period,
    numMatches,
    homeImp.toString(),
    awayImp.toString(),
    dirStr,
    line.toString(),
    odds != null ? odds.toString() : "",
  ];
  console.log("[server] backtest argv →", backtestArgs.join(" | "));

  const backtestChild = spawn("node", backtestArgs, {
    cwd: process.cwd(),
    env: { ...process.env, RESULT_FILE: resultFile },
  });

  let backtestOut = "",
    backtestErr = "";
  backtestChild.stdout.on("data", (d) => {
    process.stdout.write("[backtest stdout] " + d);
    backtestOut += d;
  });
  backtestChild.stderr.on("data", (d) => {
    process.stderr.write("[backtest stderr] " + d);
    backtestErr += d;
  });

  const backtestExitCode = await new Promise((resolve) => {
    backtestChild.on("close", (code) => {
      console.log("[server] backtest-grok.js avslutades med kod", code);
      resolve(code);
    });
  });

  if (backtestExitCode !== 0) {
    console.log("[server] fel:", backtestErr);
    return res.status(400).json({
      error: "Backtest-processen misslyckades",
      details: backtestErr || `Exit code ${backtestExitCode}`,
    });
  }

  // --- Efter att backtest-grok2.js har sparat i ev-results ---
  let fileResult;
  try {
    const evDir = path.join(__dirname, "ev-results");
    const files = await fs.readdir(evDir);
    const prefix = `${slugify(homeTeam)}-vs-${slugify(awayTeam)}-${statKey}`;

    const candidates = files
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .map((f) => {
        const fullPath = path.join(evDir, f);
        const mtime = statSync(fullPath).mtime.getTime();
        return { name: f, mtime };
      });

    if (candidates.length === 0) {
      throw new Error("Ingen ev-results-fil för detta lag/statKey hittades");
    }

    // Välj den senast modifierade filen
    candidates.sort((a, b) => b.mtime - a.mtime);
    const latestFile = candidates[0].name;
    const resultPath = path.join(evDir, latestFile);

    // Läs in och skicka tillbaka precis det objekt som sparades
    const content = await fs.readFile(resultPath, "utf-8");
    fileResult = JSON.parse(content);
    console.log(`[server] läste resultat från ${resultPath}`);
  } catch (e) {
    console.error("[server] kunde inte läsa ev-results-fil:", e.message);
    return res.status(500).json({
      error: "Kunde inte läsa resultat från ev-results",
      details: e.message,
    });
  }

  // Skicka tillbaka filens innehåll direkt
  console.log("[server] skickar tillbaka resultat:", fileResult);
  return res.json(fileResult);
});




app.get("/league_ranking.json", async (req, res) => {
  try {
    const filePath = path.join(__dirname, "league_ranking.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const json = JSON.parse(raw);
    res.json(json);
  } catch (err) {
    console.error("❌ Kunde inte läsa league_ranking.json:", err);
    res.status(500).json({ error: "Misslyckades att läsa rankingen." });
  }
});

// Fetch backtest results and update activity log with win/loss
app.get("/api/backtest-results", async (req, res) => {
  try {
    const data = await computeBacktestResults();
    res.json(data);
  } catch (err) {
    console.error("Failed to compute backtest results", err);
    res.status(500).json({ error: "Could not compute results" });
  }
});

app.get("/api/backtest-summary", async (req, res) => {
  try {
    const evMin = req.query.evMin ? Number(req.query.evMin) : 0;
    const evMax = req.query.evMax ? Number(req.query.evMax) : Infinity;
    const data = await computeBacktestSummary(evMin, evMax);
    res.json(data);
  } catch (err) {
    console.error("Failed to compute backtest summary", err);
    res.status(500).json({ error: "Could not compute backtest summary" });
  }
});

function deriveStatKeysFromResults(teamResults) {
  for (const team of teamResults) {
    const sections = [team?.stats?.rank, team?.stats?.rating];
    for (const section of sections) {
      if (!section) continue;

      for (const periodBuckets of Object.values(section)) {
        if (!periodBuckets) continue;
        for (const bucket of Object.values(periodBuckets)) {
          const keys = Object.keys(bucket?.averages?.for ?? {});
          if (keys.length > 0) {
            return keys;
          }

        }
      }
    }
  }
  return DEFAULT_STAT_KEYS;
}


function derivePerspectivesFromResults(teamResults) {
  for (const team of teamResults) {
    const sections = [team?.stats?.rank, team?.stats?.rating];
    for (const section of sections) {
      if (!section) continue;
      const perspectives = Object.keys(section);
      if (perspectives.length > 0) {
        return perspectives;
      }
    }
  }
  return [...DEFAULT_PERSPECTIVES];
}


function derivePeriodsFromResults(teamResults) {
  for (const team of teamResults) {
    const sections = [team?.stats?.rank, team?.stats?.rating];
    for (const section of sections) {
      if (!section) continue;

      for (const perspective of Object.values(section)) {
        if (!perspective || typeof perspective !== "object") continue;
        const periods = Object.keys(perspective);
        if (periods.length > 0) {
          return periods;
        }

      }
    }
  }
  return [...DEFAULT_PERIODS];
}

function deriveBucketLabels(section, periods) {
  if (!section) {
    return [];
  }

  const perspectives = Object.values(section);
  for (const perspective of perspectives) {
    if (!perspective || typeof perspective !== "object") {
      continue;
    }
    const periodOrder =
      Array.isArray(periods) && periods.length > 0
        ? periods
        : Object.keys(perspective);
    for (const period of periodOrder) {
      const bucketCollection = perspective?.[period];
      if (bucketCollection) {
        const labels = Object.keys(bucketCollection);
        if (labels.length > 0) {
          return labels;
        }

      }
    }
  }
  return [];
}


app.get("/api/opta-opponent-buckets", async (req, res) => {
  const rawTeams = req.query.team;
  const teams = Array.isArray(rawTeams)
    ? rawTeams.map((team) => String(team).trim()).filter(Boolean)
    : rawTeams
    ? [String(rawTeams).trim()].filter(Boolean)
    : [];

  if (teams.length === 0) {
    return res.status(400).json({ error: "Missing team query parameter" });
  }

  try {
    const pending = new Map();
    for (const team of teams) {
      const key = team.toLowerCase();
      if (!pending.has(key)) {
        pending.set(key, computeTeamOpponentShotBuckets(team));
      }
    }

    const results = [];
    for (const team of teams) {
      const key = team.toLowerCase();
      const data = await pending.get(key);
      results.push(data);
    }

    const metadataFromFirst = results[0]?.bucketMetadata ?? {};
    const statKeys = metadataFromFirst.statKeys ?? deriveStatKeysFromResults(results);
    const periods = metadataFromFirst.periods ?? derivePeriodsFromResults(results);
    const rankRanges = metadataFromFirst.rankRanges ?? [];
    const ratingRanges = metadataFromFirst.ratingRanges ?? [];

    const perspectives =
      metadataFromFirst.perspectives ?? derivePerspectivesFromResults(results);
    const defaultPerspective =
      metadataFromFirst.defaultPerspective ??
      perspectives[0] ??
      DEFAULT_PERSPECTIVES[0];
    const rankLabels = deriveBucketLabels(results[0]?.stats?.rank, periods);
    const ratingLabels = deriveBucketLabels(results[0]?.stats?.rating, periods);

    const perspectiveOrder = teams.map((_, index) => {
      if (index === 0) {
        return "home";
      }
      if (index === 1) {
        return "away";
      }
      return defaultPerspective;
    });


    const matchups = [];
    for (let i = 0; i < results.length; i += 1) {
      for (let j = 0; j < results.length; j += 1) {
        if (i === j) continue;
        const prediction = predictStatsForOpponent(results[i], results[j], {
          statKeys,
          periods,
          rankRanges,
          ratingRanges,

          perspectives,
          perspective: perspectiveOrder[i] ?? defaultPerspective,

        });
        if (prediction) {
          matchups.push(prediction);
        }
      }
    }

    return res.json({
      metadata: {
        statKeys,
        periods,
        rankRanges,
        ratingRanges,
        rankLabels,
        ratingLabels,
        defaultPeriod: periods[0] ?? DEFAULT_PERIODS[0],

        perspectives,
        defaultPerspective,

        totalTeams: results.length,
      },
      teams: results,
      matchups,

    });
  } catch (err) {
    if (err?.message?.includes("Could not find team data")) {
      return res.status(404).json({ error: err.message });
    }
    console.error("Failed to compute Opta opponent buckets", err);
    return res
      .status(500)
      .json({ error: "Failed to compute Opta opponent buckets" });
  }
});

app.post("/api/team-lead-analysis", async (req, res) => {
  const rawTeams = Array.isArray(req.body?.teams)
    ? req.body.teams
    : [];

  const teams = rawTeams
    .map((team) => String(team).trim())
    .filter(Boolean);

  if (teams.length === 0) {
    return res
      .status(400)
      .json({ error: "Missing teams array in request body" });
  }

  try {
    const pending = new Map();
    for (const team of teams) {
      const key = normalizeTeamName(team);
      if (!pending.has(key)) {
        pending.set(key, getTeamLeadMetrics(team));
      }
    }

    const results = [];
    const missing = [];

    for (const team of teams) {
      const key = normalizeTeamName(team);
      const metrics = await pending.get(key);
      if (metrics) {
        results.push({ requestedName: team, ...metrics });
      } else {
        missing.push(team);
      }
    }

    if (results.length === 0) {
      return res
        .status(404)
        .json({ error: "No metrics available for requested teams" });
    }

    return res.json({
      generatedAt: new Date().toISOString(),
      teams: results,
      missing,
    });
  } catch (error) {
    console.error("Failed to compute team lead analysis", error);
    return res
      .status(500)
      .json({ error: "Failed to compute team lead analysis" });
  }
});

app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password && password === process.env.ADMIN_PASSWORD) {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false });
});

// 🔹 Endpoint to fetch activity logs
app.get("/api/logs", verifyPassword, async (req, res) => {
  try {
    res.json([...logs].reverse());
  } catch (err) {
    console.error("Failed to read logs", err);
    res.status(500).json({ error: "Could not read logs" });
  }
});

// 🔹 Endpoint to fetch count of unique visitor IPs
app.get("/api/unique-visitors", verifyPassword, async (req, res) => {
  try {
    const uniqueIps = new Set(logs.map((l) => l.ip));
    res.json({ count: uniqueIps.size });
  } catch (err) {
    console.error("Failed to count unique visitors", err);
    res.status(500).json({ error: "Could not read logs" });
  }
});




// 🚀 Starta servern
app.listen(PORT, () => {
    console.log(`🚀 Servern körs på http://localhost:${PORT}`);
});
