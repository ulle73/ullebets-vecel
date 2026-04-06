// lib/repos/fixtures.js
if (process.env.NEXT_RUNTIME) {
  await import("server-only");
}

import { clientPromise } from "../db.js";
import { performance } from "node:perf_hooks";

const DB = process.env.MONGODB_DB || "app";
const COL = "match-for-date";
const LOG = process.env.LOG_FIXTURES !== "0";
const tag = "[repo:fixtures]";
const t0 = () => performance.now();
const dt = (t) => `${(performance.now() - t).toFixed(1)}ms`;
const log = (...args) => {
  if (LOG) console.log(tag, ...args);
};

// Important: keep local JSON fallback disabled in production so Vercel does not
// trace the entire fixtures directory into serverless functions.
const FILE_FALLBACK =
  process.env.NODE_ENV !== "production" &&
  process.env.READ_FIXTURES_FILE_FALLBACK !== "0";

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

const getValueByPath = (root, pathArr) =>
  pathArr.reduce((acc, key) => (acc == null ? acc : acc[key]), root);

const extractMatchId = (match) => {
  for (const pathArr of MATCH_ID_PATHS) {
    const value = getValueByPath(match, pathArr);
    if (value == null) continue;
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
};

async function readFallbackFile(dateStr, startedAt) {
  if (!FILE_FALLBACK) return [];

  try {
    const [{ access, readFile }, path] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);

    const filePath = path.resolve(process.cwd(), "fixtures", `fixtures-${dateStr}.json`);
    await access(filePath);
    const json = JSON.parse(await readFile(filePath, "utf8"));
    const matches = Array.isArray(json?.matches) ? json.matches : [];

    log("getMatchesForDate:fileFallback", {
      date: dateStr,
      count: matches.length,
      file: filePath,
      dur: dt(startedAt),
    });

    return matches;
  } catch (error) {
    log("getMatchesForDate:fileFallbackError", {
      date: dateStr,
      err: String(error),
      dur: dt(startedAt),
    });
    return [];
  }
}

export async function getMatchesForDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) {
    throw new Error("getMatchesForDate: date måste vara på formen YYYY-MM-DD");
  }

  const startedAt = t0();
  log("getMatchesForDate:start", { date: dateStr });

  try {
    const client = await clientPromise;
    const col = client.db(DB).collection(COL);
    const doc = await col.findOne(
      { _id: String(dateStr) },
      { projection: { _id: 1, full: { $slice: 1 } } }
    );

    const matches = doc?.full?.[0]?.matches;
    const arr = Array.isArray(matches) ? matches : [];
    log("getMatchesForDate:db", { date: dateStr, count: arr.length, dur: dt(startedAt) });

    if (arr.length || !FILE_FALLBACK) {
      return arr;
    }
  } catch (error) {
    log("getMatchesForDate:dbError", { date: dateStr, err: String(error), dur: dt(startedAt) });
    if (!FILE_FALLBACK) {
      return [];
    }
  }

  return readFallbackFile(dateStr, startedAt);
}

export async function getMatchById(matchId, options = {}) {
  if (!matchId) return null;

  const { dayRange = 7 } = options;
  const startedAt = t0();

  try {
    const today = new Date();
    for (let i = -dayRange; i <= dayRange; i += 1) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      const matches = await getMatchesForDate(dateStr);
      const found = matches.find((match) => {
        const foundId = extractMatchId(match);
        return foundId && String(foundId) === String(matchId);
      });

      if (found) {
        log("getMatchById:found", { matchId: String(matchId), date: dateStr, dur: dt(startedAt) });
        return found;
      }
    }
  } catch (error) {
    console.error(`${tag} getMatchById(${matchId}) error:`, error.message);
  }

  log("getMatchById:miss", { matchId: String(matchId), dur: dt(startedAt) });
  return null;
}

export async function getMatchesByIds(matchIds, options = {}) {
  if (!Array.isArray(matchIds) || !matchIds.length) return [];

  const { dayRange = 7 } = options;
  const startedAt = t0();
  const remaining = new Set(matchIds.map((id) => String(id)));
  const results = [];

  try {
    const today = new Date();
    for (let i = -dayRange; i <= dayRange; i += 1) {
      if (!remaining.size) break;
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      const matches = await getMatchesForDate(dateStr);

      for (const match of matches) {
        const foundId = extractMatchId(match);
        if (!foundId || !remaining.has(String(foundId))) continue;
        results.push(match);
        remaining.delete(String(foundId));
      }
    }
  } catch (error) {
    console.error(`${tag} getMatchesByIds error:`, error.message);
    return [];
  }

  log("getMatchesByIds:done", {
    requested: matchIds.length,
    found: results.length,
    missing: remaining.size,
    dur: dt(startedAt),
  });

  return results;
}
