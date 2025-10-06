
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
      return arr;
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
        return arr;
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
