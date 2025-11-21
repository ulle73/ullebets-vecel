

// UNIBET/update-backtests.js
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// --------------------------- Setup ---------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backtestsDir = path.join(__dirname, "unibet-backtests");

// Enda katalogen för teamstats (din begäran)
const TEAMSTATS_DIR = path.join(__dirname, "teamstats");

// ------------------------- Konstanter -------------------------------
const STAT_KEY_MAP = {
  totalShots: "totalShotsOnGoal",
  shotsOnGoal: "shotsOnGoal",
  cornerKicks: "cornerKicks",
  yellowCards: "yellowCards",
  throwIns: "throwIns",
  freeKicks: "freeKicks",
};

// ---------------------- Unicode/slug helpers -----------------------
// Normalisera ALLA unicode-mellanslag till vanliga spaces
function normalizeSpaces(str) {
  return str.normalize("NFKC").replace(/\p{Zs}+/gu, " ");
}

// Slug utan punkt: "1. FC Heidenheim" -> "1_fc_heidenheim"
function slugNoDot(str) {
  return normalizeSpaces(str).toLowerCase().replace(/\s+/g, "_").replace(/\./g, "");
}

// Slug med punkt: "1. FC Heidenheim" -> "1._fc_heidenheim"
function slugWithDot(str) {
  const s = normalizeSpaces(str).toLowerCase().replace(/\s+/g, "_");
  // säkerställ punkt efter ledande siffra, om den saknas
  return s.replace(/^(\d)_/, "$1._");
}

// Kanoniskt namn: ignorera punkter, case, spaces, underscores, NBSP
function canonicalName(s) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.\u00a0\u202f\s_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ---------------------- I/O helpers --------------------------------
async function readJsonIfExists(p) {
  try {
    const txt = await fs.readFile(p, "utf-8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function dirExists(p) {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

// Försök läsa exakt fil i vår enda katalog
async function tryRead(relFileName) {
  if (!(await dirExists(TEAMSTATS_DIR))) return { json: null, fullpath: null };
  const full = path.join(TEAMSTATS_DIR, relFileName);
  const js = await readJsonIfExists(full);
  if (js) {
    console.log("[getMatchStats] OK exakt:", full);
    return { json: js, fullpath: full };
  }
  return { json: null, fullpath: null };
}

// Fallback: skanna katalog och jämför kanoniskt namn
async function scanForCanonical(relName) {
  if (!(await dirExists(TEAMSTATS_DIR))) return { json: null, fullpath: null };
  const targetCanon = canonicalName(relName);
  const files = await fs.readdir(TEAMSTATS_DIR);
  const hit = files.find((f) => canonicalName(f) === targetCanon);
  if (hit) {
    const p = path.join(TEAMSTATS_DIR, hit);
    const js = await readJsonIfExists(p);
    if (js) {
      console.log("[getMatchStats] Fallback hit (canonical):", p);
      return { json: js, fullpath: p };
    }
  }
  return { json: null, fullpath: null };
}

// ------------------- Domain: läsa teamstats -------------------------
async function getMatchStats(team, venue) {
  // Prova med och utan punkt
  const slugA = slugNoDot(team);   // "1_fc_heidenheim"
  const slugB = slugWithDot(team); // "1._fc_heidenheim"

  const relA = `${slugA}_${venue}_match_stats.json`;
  const relB = `${slugB}_${venue}_match_stats.json`;

  console.log("[getMatchStats] Provar:", relA, "|", relB);
  console.log("[getMatchStats] Teamstats-katalog:", TEAMSTATS_DIR);

  // 1) Exakt
  let res = await tryRead(relA);
  if (res.json) return res.json.full || [];

  res = await tryRead(relB);
  if (res.json) return res.json.full || [];

  // 2) Canonical fallback
  res = await scanForCanonical(relA);
  if (res.json) return res.json.full || [];

  res = await scanForCanonical(relB);
  if (res.json) return res.json.full || [];

  console.warn("[getMatchStats] Saknar fil (exakt + fallback):", relA, "||", relB);
  return [];
}

// -------------------- Statistik-extraktion (tolerant) --------------
// Tål båda formaten du visade:
// 1) matchDetails: [ { period, groups: [...] }, ... ]
// 2) matchDetails: { statistics: [ { period, groups: [...] }, ... ] }
function getStatisticsBlocks(match) {
  if (!match) return [];

  // 2) Objekt med .statistics
  if (match.matchDetails && Array.isArray(match.matchDetails.statistics)) {
    return match.matchDetails.statistics;
  }

  // 1) Array direkt i matchDetails
  if (Array.isArray(match.matchDetails)) {
    // Elements kan redan ha { period, groups }, annars plocka in nested fält
    return match.matchDetails
      .map((x) => {
        if (x && typeof x === "object") {
          if (x.period && x.groups) return x;
          if (Array.isArray(x.statistics)) return x.statistics; // fallback
        }
        return null;
      })
      .flat()
      .filter(Boolean);
  }

  // Andra vanliga varianter
  if (Array.isArray(match.statistics)) return match.statistics;
  if (Array.isArray(match.matchStatistics)) return match.matchStatistics;
  if (Array.isArray(match.stats)) return match.stats;

  // Ibland som objekt { ALL: {...}, "1ST": {...}, ... }
  const obj =
    match.matchDetails?.statistics ||
    match.statistics ||
    match.matchStatistics ||
    match.stats ||
    null;

  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    return Object.entries(obj).map(([period, data]) => ({
      period,
      groups: data?.groups || data || [],
    }));
  }

  return [];
}

function normPeriod(p) {
  if (!p) return "ALL";
  const x = String(p).toUpperCase();
  if (x.includes("1ST")) return "1ST";
  if (x.includes("2ND")) return "2ND";
  if (x.includes("ALL") || x === "FULL" || x === "FT" || x.includes("MATCH")) return "ALL";
  return x;
}

function readSideValue(item, side) {
  const cand = [
    side === "home" ? "homeValue" : "awayValue",
    side, // "home" | "away"
    side === "home" ? "home_team" : "away_team",
    side === "home" ? "homeTeam" : "awayTeam",
    side === "home" ? "home_val" : "away_val",
    "value", // ibland total
  ];
  for (const k of cand) {
    if (item[k] != null) {
      const v = item[k];
      const n = typeof v === "string" ? Number(v.replace(",", ".").replace("%", "")) : Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function keysEqualLoosely(a, b) {
  const A = String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const B = String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (A === B) return true;
  // corners vs cornerKicks
  if (["corners", "cornerkicks"].includes(A) && ["corners", "cornerkicks"].includes(B)) return true;
  return false;
}

function extractStat(match, key, period, side) {
  const blocks = getStatisticsBlocks(match);
  if (!blocks.length) return null;

  const want = normPeriod(period);
  // 1) Försök exakt period
  let periodData = blocks.find((b) => normPeriod(b.period) === want);
  // 2) Fallback till ALL
  if (!periodData) periodData = blocks.find((b) => normPeriod(b.period) === "ALL");
  if (!periodData) periodData = blocks[0]; // sista utväg

  const groups = Array.isArray(periodData.groups) ? periodData.groups : [];
  for (const g of groups) {
    const items = Array.isArray(g.statisticsItems)
      ? g.statisticsItems
      : Array.isArray(g.items)
      ? g.items
      : Array.isArray(g.stats)
      ? g.stats
      : [];
    for (const it of items) {
      const k = (it.key || it.name || it.stat || "").toString();
      if (!k) continue;
      if (keysEqualLoosely(k, key)) {
        return readSideValue(it, side);
      }
    }
  }
  return null;
}

// --------------------- Hjälpfunktioner ------------------------------
function unslug(str) {
  // Endast för visning av matchkatalogernas slugs (home-away-date)
  return str.replace(/_/g, " ");
}

function parseMatchDir(dirName) {
  // Förväntat: <homeSlug>-<awaySlug>-YYYY-MM-DD
  const m = dirName.match(/^(.+)-(.+)-(\d{4}-\d{2}-\d{2})$/);
  if (!m) {
    throw new Error(
      `Felaktigt katalognamn: ${dirName} (förväntar home-away-YYYY-MM-DD)`
    );
  }
  return { homeSlug: m[1], awaySlug: m[2], matchDate: m[3] };
}

// ---------------------- Annotering ---------------------------------
async function annotateFile(filePath) {
  console.log("\n--- Bearbetar:", filePath, "---");

  const matchDir = path.basename(path.dirname(filePath));
  const { homeSlug, awaySlug, matchDate } = parseMatchDir(matchDir);
  const homeTeam = unslug(homeSlug);
  const awayTeam = unslug(awaySlug);
  console.log("Match:", homeTeam, "vs", awayTeam, "på", matchDate);

  const fileDataRaw = JSON.parse(await fs.readFile(filePath, "utf-8"));
  const fileData = Array.isArray(fileDataRaw)
    ? { url: null, lines: fileDataRaw }
    : fileDataRaw;

  const lines = fileData.lines || [];
  console.log("Antal linor:", lines.length);

  // Läs hem- och bortamatcher
  const homeMatches = await getMatchStats(homeTeam, "home");
  console.log("Hemmatcher funna:", homeMatches.length);

  const match = homeMatches.find(
    (m) =>
      m.awayTeamName?.toLowerCase() === awayTeam.toLowerCase() &&
      m.date === matchDate
  );

  if (!match) {
    console.log(
      "Ingen matchstatistik hittad – matchen är troligen inte spelad eller namnet matchar inte exakt."
    );
    return;
  }

  const awayMatches = await getMatchStats(awayTeam, "away");
  const matchAway = awayMatches.find((m) => m.matchId === match.matchId);

  // ---------- DEBUG: vilka perioder/keys finns? ----------
  const dbgHome = getStatisticsBlocks(match).map((b) => ({
    period: b.period,
    keys: (b.groups || []).flatMap((g) =>
      (g.statisticsItems || g.items || g.stats || []).map(
        (it) => it.key || it.name || it.stat
      )
    ),
  }));
  const dbgAway = getStatisticsBlocks(matchAway).map((b) => ({
    period: b.period,
    keys: (b.groups || []).flatMap((g) =>
      (g.statisticsItems || g.items || g.stats || []).map(
        (it) => it.key || it.name || it.stat
      )
    ),
  }));
  console.log("[DEBUG] HOME periods/keys:", dbgHome);
  console.log("[DEBUG] AWAY periods/keys:", dbgAway);

  // Bearbeta bets
  const misses = [];
  for (const bet of lines) {
    const statKey = STAT_KEY_MAP[bet.statKey] || bet.statKey;
    const over = bet.condition === "över" || bet.condition === "over";

    let actual = null;

    if (bet.scope === "total") {
      const homeVal = extractStat(match, statKey, bet.period, "home");
      const awayVal = extractStat(matchAway, statKey, bet.period, "away");

      if (homeVal == null || awayVal == null) {
        misses.push({ scope: "total", statKey, period: bet.period, homeVal, awayVal });
        bet.actual = null;
        bet.win = null;
        continue;
      }
      actual = homeVal + awayVal;

    } else if (bet.scope === "home") {
      const homeVal = extractStat(match, statKey, bet.period, "home");
      if (homeVal == null) {
        misses.push({ scope: "home", statKey, period: bet.period, homeVal: null });
        bet.actual = null;
        bet.win = null;
        continue;
      }
      actual = homeVal;

    } else if (bet.scope === "away") {
      const awayVal = extractStat(matchAway, statKey, bet.period, "away");
      if (awayVal == null) {
        misses.push({ scope: "away", statKey, period: bet.period, awayVal: null });
        bet.actual = null;
        bet.win = null;
        continue;
      }
      actual = awayVal;

    } else {
      console.log(`[WARN] Okänt scope: ${bet.scope}`);
      bet.actual = null;
      bet.win = null;
      continue;
    }

    bet.actual = actual;
    bet.win = over ? actual > bet.line : actual < bet.line;

    console.log(
      `Lina ${bet.statKey} ${bet.scope} ${bet.period}: line=${bet.line}, actual=${bet.actual}, win=${bet.win}`
    );
  }

  fileData.lines = lines;
  await fs.writeFile(filePath, JSON.stringify(fileData, null, 2));
  console.log("Uppdaterad fil:", filePath);

  // --------- DEBUG I SLUTET (sammanfattning) ---------
  if (misses.length) {
    console.log(
      `[DEBUG SUMMARY] Missade stats (${misses.length}):`,
      misses.slice(0, 50)
    );
  } else {
    console.log("[DEBUG SUMMARY] Inga missade statsnycklar för denna fil.");
  }
}

// ---------------------- Filinsamling -------------------------------
async function getJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const res = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getJsonFiles(res)));
    } else if (entry.name.endsWith(".json")) {
      files.push(res);
    }
  }
  return files;
}

// ------------------------- Main ------------------------------------
async function main() {
  console.log("Katalog:", backtestsDir);
  console.log("[debug] TEAMSTATS_DIR:", TEAMSTATS_DIR);
  const files = await getJsonFiles(backtestsDir);
  console.log("Filer funna:", files.length);
  for (const f of files) {
    await annotateFile(f);
  }
}

main().catch((err) => console.error("Failed to update backtests:", err));
