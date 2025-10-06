import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { clientPromise } from "../lib/db.js";
import { fetchScheduledMatches } from "../rapidApi/scheduled-matches.js";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ymdUTC = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const parseYmdStrict = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
    ? dt
    : null;
};

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function buildCategoryPlan(leaguesJson) {
  // Map<categoryId, Set<leagueId>>
  const map = new Map();
  for (const [, info] of Object.entries(leaguesJson || {})) {
    const catId = toNumber(info?.categoryId);
    const leagueId =
      toNumber(info?.leagueId) ?? toNumber(info?.uniqueTournamentId);
    if (catId === null || leagueId === null) continue;
    if (!map.has(catId)) map.set(catId, new Set());
    map.get(catId).add(leagueId);
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]); // [[categoryId, Set(leagueIds)]...]
}

function extractEventLeagueId(e) {
  const cands = [
    e?.tournament?.uniqueTournament?.id,
    e?.uniqueTournament?.id,
    e?.tournament?.id,
    e?.event?.tournament?.uniqueTournament?.id,
    e?.event?.tournament?.id,
  ];
  for (const c of cands) {
    const n = toNumber(c);
    if (n !== null) return n;
  }
  return null;
}

function formatSourceWithKey(source, apiKey) {
  return apiKey
    ? `${source} [${String(apiKey).slice(0, 6)}…]`
    : source || "okänd";
}

// summera apiCallStats till { ok, fail } och även per-källa
function sumStats(stats = {}) {
  let ok = 0,
    fail = 0;
  const perSource = new Map();
  for (const [src, obj] of Object.entries(stats)) {
    const o = Number(obj?.ok || 0);
    const f = Number(obj?.fail || 0);
    ok += o;
    fail += f;
    perSource.set(src, { ok: o, fail: f });
  }
  return { ok, fail, perSource };
}

function diffStats(prev, next) {
  const ok = Math.max(0, (next.ok || 0) - (prev.ok || 0));
  const fail = Math.max(0, (next.fail || 0) - (prev.fail || 0));
  let by = "n/a";
  let bestDelta = -1;
  for (const [src, cur] of next.perSource.entries()) {
    const p = prev.perSource.get(src) || { ok: 0, fail: 0 };
    const delta = cur.ok - p.ok + (cur.fail - p.fail);
    if (delta > bestDelta) {
      bestDelta = delta;
      by = src;
    }
  }
  return { ok, fail, by };
}

// — match-dagfilter (UTC) —
const getEventTs = (e) =>
  Number(
    e?.startTimestamp ??
      e?.event?.startTimestamp ??
      e?.timestamp ??
      e?.kickoffTime ??
      0
  ) || 0;

const ymdUTCFromTs = (ts) => {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// kör samma script för ett specifikt datum (child process)
async function runSelfForDate(dateStr) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, dateStr], {
      stdio: "inherit",
    });
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Child exited with code ${code} for ${dateStr}`))
    );
    child.on("error", reject);
  });
}

// ---------- main ----------
async function main() {
  const args = process.argv.slice(2);
  const dateArg = args[0]; // "YYYY-MM-DD" eller "YYYY-MM-DD-YYYY-MM-DD"

  // Intervallstöd
  if (dateArg && /^\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    const startStr = dateArg.slice(0, 10);
    const endStr = dateArg.slice(11);
    const start = parseYmdStrict(startStr);
    const end = parseYmdStrict(endStr);
    if (!start || !end || start > end) {
      console.error(
        "❌ Ogiltigt intervall. Använd YYYY-MM-DD-YYYY-MM-DD (start ≤ slut)."
      );
      process.exit(1);
    }
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const s = ymdUTC(d);
      console.log(
        `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      );
      console.log(`▶ Kör datum: ${s}`);
      await runSelfForDate(s);
    }
    return;
  }

  const targetDate = dateArg ? parseYmdStrict(dateArg) : new Date(); // default: idag (UTC)
  if (!targetDate) {
    console.error("❌ Ogiltigt datum. Använd YYYY-MM-DD.");
    process.exit(1);
  }
  const dateStr = ymdUTC(targetDate);

  // Läs ligor/lag
  const leaguesPath = path.resolve(
    process.cwd(),
    "data",
    "leagues-and-teams.json"
  );
  if (!existsSync(leaguesPath)) {
    console.error("❌ Hittar inte data/leagues-and-teams.json.");
    process.exit(1);
  }
  const leagues = JSON.parse(await fs.readFile(leaguesPath, "utf-8"));
  const categoryPlan = buildCategoryPlan(leagues);

  // RapidAPI keys
  const rapidApiKeys = (
    process.env.RAPIDAPI_KEYS ||
    process.env.RAPIDAPI_KEY ||
    ""
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const rapidApiState = { index: 0, failures: 0 };

  // Puppeteer (cookies/UA)
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
  );
  await page.goto("https://www.sofascore.com/", {
    waitUntil: "domcontentloaded",
  });
  await sleep(500);

  const context = {
    rapidApiKeys,
    rapidApiState,
    page,
    apiCallStats: {},
    logger: console,
  };

  const aggregatedSources = new Map();
  const allMatches = [];
  let totalCalls = 0;

  const fetchReports = [];
  const includeGlobalEndpoint = categoryPlan.length === 0;

  const beforeAll = sumStats(context.apiCallStats);

  if (categoryPlan.length === 0) {
    console.log(
      `ℹ️ Hämtar matcher för ${dateStr} med global endpoint (inga kategorier i JSON).`
    );
    const prev = sumStats(context.apiCallStats);
    const scheduled = await fetchScheduledMatches(dateStr, context, {
      categoryId: 1,
      includeGlobalEndpoint,
    });
    const next = sumStats(context.apiCallStats);
    const delta = diffStats(prev, next);

    totalCalls += scheduled?.calls || 0;
    const arr = Array.isArray(scheduled?.matches) ? scheduled.matches : [];

    const allowedLeagueIds = new Set(
      Object.values(leagues)
        .map((x) => toNumber(x?.leagueId) ?? toNumber(x?.uniqueTournamentId))
        .filter((x) => x !== null)
    );
    const filtered = allowedLeagueIds.size
      ? arr.filter((e) => allowedLeagueIds.has(extractEventLeagueId(e)))
      : arr;

    allMatches.push(...filtered);
    aggregatedSources.set("global", {
      source: scheduled?.source || delta.by || "okänd",
      apiKey: scheduled?.apiKey || null,
    });

    const srcLabel = formatSourceWithKey(
      scheduled?.source || delta.by,
      scheduled?.apiKey
    );
    console.log(
      `✅ Global: matches=${filtered.length}, calls=${
        scheduled?.calls ?? 0
      }, ok=${delta.ok}, fail=${delta.fail}, via=${srcLabel}`
    );
    fetchReports.push({
      label: "global",
      matches: filtered.length,
      calls: scheduled?.calls ?? 0,
      ok: delta.ok,
      fail: delta.fail,
      via: srcLabel,
    });
  } else {
    console.log(
      `📅 ${dateStr} – kategorier: ${categoryPlan.map(([c]) => c).join(", ")}`
    );
    for (const [categoryId, leagueSet] of categoryPlan) {
      const prev = sumStats(context.apiCallStats);
      const scheduled = await fetchScheduledMatches(dateStr, context, {
        categoryId,
        includeGlobalEndpoint,
      });
      const next = sumStats(context.apiCallStats);
      const delta = diffStats(prev, next);

      totalCalls += scheduled?.calls || 0;
      const arr = Array.isArray(scheduled?.matches) ? scheduled.matches : [];
      const filtered = arr.filter((e) =>
        leagueSet.has(extractEventLeagueId(e))
      );

      allMatches.push(...filtered);
      aggregatedSources.set(String(categoryId), {
        source: scheduled?.source || delta.by || "okänd",
        apiKey: scheduled?.apiKey || null,
      });

      const srcLabel = formatSourceWithKey(
        scheduled?.source || delta.by,
        scheduled?.apiKey
      );
      console.log(
        `✅ categoryId=${categoryId}: matches=${filtered.length}, calls=${
          scheduled?.calls ?? 0
        }, ok=${delta.ok}, fail=${delta.fail}, via=${srcLabel}`
      );
      fetchReports.push({
        label: `cat:${categoryId}`,
        matches: filtered.length,
        calls: scheduled?.calls ?? 0,
        ok: delta.ok,
        fail: delta.fail,
        via: srcLabel,
      });
    }
  }

  // Stäng puppeteer tidigt och säkert
  await browser.close();

  // Summering av API-anrop (MÅSTE innan payload)
  const afterAll = sumStats(context.apiCallStats);
  const totalOk = Math.max(0, (afterAll.ok || 0) - (beforeAll.ok || 0));
  const totalFail = Math.max(0, (afterAll.fail || 0) - (beforeAll.fail || 0));

  // Endagsfilter på UTC-datum: spara bara exakt den dagen
  const dayMatches = allMatches.filter((e) => {
    const ts = getEventTs(e);
    return ts && ymdUTCFromTs(ts) === dateStr;
  });
  const dropped = allMatches.length - dayMatches.length;

  console.log("—".repeat(72));
  console.log(
    `🎯 Totalt efter filter: ${dayMatches.length} matcher (slängde ${dropped} utanför ${dateStr} UTC).`
  );
  console.log(`📦 Sparar JSON …`);

  const outDir = path.resolve(process.cwd(), "matches-for-date");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `fixtures-${dateStr}.json`);

  const sources = Array.from(aggregatedSources.entries()).map(([k, v]) => ({
    categoryId: k,
    source: v.source,
    apiKey: v.apiKey,
  }));

  const payload = {
    date: dateStr,
    savedAt: new Date().toISOString(),
    calls: totalCalls,
    successes: totalOk,
    failures: totalFail,
    sources,
    matches: dayMatches, // endast rätt dag
  };

  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`✅ Sparat: ${outPath}`);
  console.log("—".repeat(72));
  console.log("📊 Sammanfattning per fetch:");
  for (const r of fetchReports) {
    console.log(
      `  • ${r.label.padEnd(10)} matches=${String(r.matches).padStart(
        4
      )}  calls=${String(r.calls).padStart(3)}  ok=${String(r.ok).padStart(
        3
      )}  fail=${String(r.fail).padStart(3)}  via=${r.via}`
    );
  }
  console.log("—".repeat(72));
  console.log(`Σ calls=${totalCalls}  ok=${totalOk}  fail=${totalFail}`);

  // ===== AUTOMATISK IMPORT TILL DB =====
  console.log("🗄  Importerar i databasen …");
  const DB = process.env.MONGODB_DB || "app";
  const COL = "match-for-date";
  const client = await clientPromise;
  const col = client.db(DB).collection(COL);

  const doc = {
    date: payload.date,
    savedAt: payload.savedAt,
    calls: payload.calls,
    successes: payload.successes,
    failures: payload.failures,
    sources: payload.sources,
    matches: Array.isArray(payload.matches) ? payload.matches : [],
  };

  await col.updateOne(
    { _id: String(payload.date) },
    { $push: { full: { $each: [doc], $position: 0 } } },
    { upsert: true }
  );

  // Logga alla matcher som sparades
  try {
    const toLocal = (ts) =>
      ts
        ? new Date(ts * 1000).toLocaleString("sv-SE", {
            timeZone: "Europe/Stockholm",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—";

    const lines = (payload.matches || []).map((m) => {
      const id = m?.id ?? m?.event?.id ?? "n/a";
      const league = m?.tournament?.name ?? m?.event?.tournament?.name ?? "—";
      const home = m?.homeTeam?.name ?? m?.event?.homeTeam?.name ?? "—";
      const away = m?.awayTeam?.name ?? m?.event?.awayTeam?.name ?? "—";
      const ts = getEventTs(m);
      return `  • ${league}: ${home} vs ${away} (id=${id}) @ ${toLocal(ts)}`;
    });

    console.log("🧾 Matcher sparade i DB:");
    if (lines.length) lines.forEach((l) => console.log(l));
    else console.log("  (inga matcher)");
  } catch (e) {
    console.warn("⚠️ Kunde inte logga sparade matcher:", e?.message || e);
  }

  // Hjälp-index
  await col.createIndex({ _id: 1 });
  await col.createIndex({ "full.0.date": 1 });
  await col.createIndex({ "full.0.matches.id": 1 });

  console.log(`✅ Import klart: ${DB}.${COL} (_id=${payload.date})`);
  await client.close(true);
}

// (valfri debug) – se vilka handles som lever efteråt
setTimeout(() => {
  const hs = process._getActiveHandles();
  console.log(
    "🧵 Active handles:",
    hs.map((h) => h && h.constructor && h.constructor.name)
  );
}, 500);

main().catch((e) => {
  console.error("❌ fetch-and-import-fixtures error:", e);
  process.exit(1);
});
