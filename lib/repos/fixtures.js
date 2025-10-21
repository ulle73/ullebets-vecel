
// lib/repos/fixtures.js
// Säker i Next, men körbar direkt med node (utan server-only installerat)
if (process.env.NEXT_RUNTIME) {
  await import("server-only");
}

import { clientPromise } from "../db.js";
import { performance } from "node:perf_hooks";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

// ====== Konfig ======
const DB = process.env.MONGODB_DB || "app";
const COL = "match-for-date"; // <— enligt din önskan

// Loggstyrning
const LOG = process.env.LOG_FIXTURES !== "0";
const tag = "[repo:fixtures]";
const t0 = () => performance.now();
const dt = (t) => `${(performance.now() - t).toFixed(1)}ms`;
const log = (...a) => {
  if (LOG) console.log(tag, ...a);
};

const TEAMSTATS_COL = "teamstats";
const SCORE_VALUE_KEYS = [
  "display",
  "current",
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

const MATCH_ID_PATHS = [
  ["matchId"],
  ["id"],
  ["event", "id"],
  ["event", "matchId"],
  ["match", "id"],
  ["match", "matchId"],
  ["event", "eventId"],
  ["match", "event", "id"],
  ["match", "event", "matchId"],
];

const HOME_SCORE_PATHS = [
  ["homeScore"],
  ["event", "homeScore"],
  ["score", "home"],
  ["scores", "home"],
  ["event", "score", "home"],
  ["event", "scores", "home"],
  ["result", "home"],
  ["event", "result", "home"],
];

const AWAY_SCORE_PATHS = [
  ["awayScore"],
  ["event", "awayScore"],
  ["score", "away"],
  ["scores", "away"],
  ["event", "score", "away"],
  ["event", "scores", "away"],
  ["result", "away"],
  ["event", "result", "away"],
];

const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const resolveScoreValue = (input) => {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === "string") {
    const parsed = toFiniteNumber(input);
    return parsed;
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const resolved = resolveScoreValue(item);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  if (input && typeof input === "object") {
    for (const key of SCORE_VALUE_KEYS) {
      if (!(key in input)) continue;
      const resolved = resolveScoreValue(input[key]);
      if (resolved !== null) return resolved;
    }
  }
  return null;
};

const getValueByPath = (root, pathArr) =>
  pathArr.reduce((acc, key) => (acc == null ? acc : acc[key]), root);

const extractScoreFromMatch = (match, paths) => {
  for (const pathArr of paths) {
    const value = getValueByPath(match, pathArr);
    const resolved = resolveScoreValue(value);
    if (resolved !== null) {
      return resolved;
    }
  }
  return null;
};

const matchHasScore = (match) => {
  const home = extractScoreFromMatch(match, HOME_SCORE_PATHS);
  const away = extractScoreFromMatch(match, AWAY_SCORE_PATHS);
  return home !== null && away !== null;
};

const extractMatchId = (match) => {
  for (const pathArr of MATCH_ID_PATHS) {
    const value = getValueByPath(match, pathArr);
    if (value == null) continue;
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
};

const mergeScore = (existing, nextValue) => {
  const resolved = resolveScoreValue(nextValue);
  if (resolved === null) {
    return existing;
  }
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return { ...existing, current: resolved, display: resolved };
  }
  return { current: resolved, display: resolved };
};

async function hydrateScoresFromTeamstats({
  matches,
  client,
  date,
}) {
  if (!client || !Array.isArray(matches) || !matches.length) {
    return matches;
  }

  const idsToFetch = new Set();
  const idToIndex = new Map();

  matches.forEach((match, index) => {
    if (matchHasScore(match)) {
      return;
    }
    const id = extractMatchId(match);
    if (!id) return;
    idsToFetch.add(id);
    const numeric = toFiniteNumber(id);
    if (numeric !== null) {
      idsToFetch.add(numeric);
    }
    const key = String(id);
    if (!idToIndex.has(key)) {
      idToIndex.set(key, []);
    }
    idToIndex.get(key).push(index);
  });

  if (!idsToFetch.size) {
    return matches;
  }

  const start = t0();
  const db = client.db(DB);
  const col = db.collection(TEAMSTATS_COL);

  const docs = await col
    .find({ "full.matchId": { $in: Array.from(idsToFetch) } }, {
      projection: { full: 1 },
    })
    .toArray();

  if (!docs.length) {
    return matches;
  }

  const scoreByMatchId = new Map();

  for (const doc of docs) {
    const records = Array.isArray(doc?.full) ? doc.full : [];
    for (const record of records) {
      const matchId = extractMatchId(record);
      if (!matchId) continue;
      if (scoreByMatchId.has(matchId)) continue;
      const home = resolveScoreValue(record?.homeScore);
      const away = resolveScoreValue(record?.awayScore);
      if (home === null && away === null) continue;
      scoreByMatchId.set(matchId, { home, away });
    }
  }

  if (!scoreByMatchId.size) {
    return matches;
  }

  let patchedMatches = 0;

  for (const [matchId, indexes] of idToIndex.entries()) {
    const overlay = scoreByMatchId.get(matchId);
    if (!overlay) continue;
    for (const idx of indexes) {
      const item = matches[idx];
      if (!item || typeof item !== "object") continue;

      const beforeHome = extractScoreFromMatch(item, HOME_SCORE_PATHS);
      const beforeAway = extractScoreFromMatch(item, AWAY_SCORE_PATHS);

      let updated = false;

      if (beforeHome === null && overlay.home !== null) {
        item.homeScore = mergeScore(item.homeScore, overlay.home);
        if (item.event && typeof item.event === "object") {
          item.event = {
            ...item.event,
            homeScore: mergeScore(item.event.homeScore, overlay.home),
          };
        }
        updated = true;
      }

      if (beforeAway === null && overlay.away !== null) {
        item.awayScore = mergeScore(item.awayScore, overlay.away);
        if (item.event && typeof item.event === "object") {
          item.event = {
            ...item.event,
            awayScore: mergeScore(item.event.awayScore, overlay.away),
          };
        }
        updated = true;
      }

      if (updated) {
        patchedMatches += 1;
      }
    }
  }

  if (patchedMatches) {
    log("getMatchesForDate:teamstatsOverlay", {
      date,
      patched: patchedMatches,
      dur: dt(start),
    });
  }

  return matches;
}

// DEV-fallback: läs fixtures/fixtures-YYYY-MM-DD.json om DB saknar data
const FILE_FALLBACK = process.env.READ_FIXTURES_FILE_FALLBACK !== "0";

// ====== Publika funktioner ======
/**
 * Hämtar alla matcher för ett valt datum ("YYYY-MM-DD") från collection `match-for-date`.
 * Om inget snapshot finns i DB och FILE_FALLBACK är aktivt → läser fixtures/fixtures-<date>.json.
 * Returnerar en array (kan vara tom).
 */
export async function getMatchesForDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) {
    throw new Error("getMatchesForDate: date måste vara på formen YYYY-MM-DD");
  }

  const t = t0();
  log("getMatchesForDate:start", { date: dateStr });

  // 1) Försök läsa från DB
  try {
    const client = await clientPromise;
    const col = client.db(DB).collection(COL);
    const doc = await col.findOne(
      { _id: String(dateStr) },
      { projection: { _id: 1, full: { $slice: 1 } } }
    );

    const matches = doc?.full?.[0]?.matches;
    const arr = Array.isArray(matches) ? matches : [];
    log("getMatchesForDate:db", {
      date: dateStr,
      count: arr.length,
      dur: dt(t),
    });

    if (arr.length || !FILE_FALLBACK) {
      return await hydrateScoresFromTeamstats({
        matches: arr,
        client,
        date: dateStr,
      });
    }
  } catch (err) {
    log("getMatchesForDate:dbError", { date: dateStr, err: String(err) });
    // vi provar fallback nedan om aktiverad
  }

  // 2) DEV-fallback till lokal JSON-dump (om aktiverad)
  if (FILE_FALLBACK) {
    try {
      const fp = path.resolve(
        process.cwd(),
        "fixtures",
        `fixtures-${dateStr}.json`
      );
      if (fs.existsSync(fp)) {
        const json = JSON.parse(await fsp.readFile(fp, "utf8"));
        const arr = Array.isArray(json?.matches) ? json.matches : [];
        log("getMatchesForDate:fileFallback", {
          date: dateStr,
          count: arr.length,
          file: fp,
          dur: dt(t),
        });
        if (!arr.length) {
          return arr;
        }

        let client = null;
        try {
          client = await clientPromise;
        } catch (err) {
          log("getMatchesForDate:teamstatsFallbackError", {
            date: dateStr,
            err: String(err),
          });
        }

        if (!client) {
          return arr;
        }

        return await hydrateScoresFromTeamstats({
          matches: arr,
          client,
          date: dateStr,
        });
      } else {
        log("getMatchesForDate:fileMissing", {
          file: `fixtures/fixtures-${dateStr}.json`,
        });
      }
    } catch (err) {
      log("getMatchesForDate:fileError", { date: dateStr, err: String(err) });
    }
  }

  // 3) Inget hittat
  log("getMatchesForDate:empty", { date: dateStr, dur: dt(t) });
  return [];
}

// ====== CLI TEST RUNNER ======
// Usage:
//   node lib/repos/fixtures.js 2025-10-03
const isDirect =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

const dateArg = process.argv[2];
const isValidYmd = typeof dateArg === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateArg);

if (isDirect && isValidYmd) {
  (async () => {
    try {
      const items = await getMatchesForDate(dateArg);
      console.dir(
        { date: dateArg, count: items.length, sample: items.slice(0, 5) },
        { depth: 3 }
      );
    } catch (e) {
      console.error("CLI error:", e);
      process.exitCode = 1;
    } finally {
      // stäng anslutningen så processen inte hänger vid direktkörning
      try {
        const client = await clientPromise;
        await client.close(true);
      } catch {}
    }
  })();
} else if (isDirect) {
  console.log("Usage: node lib/repos/fixtures.js YYYY-MM-DD");
  // se till att processen avslutar direkt om filen körs utan giltigt datum
  setImmediate(() => process.exit(0));
}
