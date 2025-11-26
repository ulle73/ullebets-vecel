/**
 * Inspect teamstats for a given team, scope, statKey, and period.
 *
 * Usage:
 *   node scripts/inspect-teamstats.js "Team Name" home|away|total statKey ALL|1ST|2ND
 *
 * Example:
 *   node scripts/inspect-teamstats.js "Getafe" total cornerKicks ALL
 *
 * Requires MONGODB_URI / MONGODB_DB in .env.local
 */

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "app";

const STAT_KEY_MAP = {
  totalShots: "totalShotsOnGoal",
  shotsOnGoal: "shotsOnGoal",
  cornerKicks: "cornerKicks",
  yellowCards: "yellowCards",
  throwIns: "throwIns",
  freeKicks: "freeKicks",
  fouls: "fouls",
  offsides: "offsides",
  goalKicks: "goalKicks",
};

function normPeriod(p) {
  if (!p) return "ALL";
  const x = String(p).toUpperCase();
  if (x.includes("1ST")) return "1ST";
  if (x.includes("2ND")) return "2ND";
  if (x.includes("ALL") || x === "FULL" || x === "FT" || x.includes("MATCH")) return "ALL";
  return x;
}

function toDateString(input) {
  if (input == null) return null;
  const num = Number(input);
  if (Number.isFinite(num)) {
    const ms = num > 2e10 ? num : num * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  if (typeof input === "string") {
    const d = new Date(input);
    if (!Number.isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  return null;
}

function getStatisticsBlocks(match) {
  if (!match) return [];
  if (match.matchDetails && Array.isArray(match.matchDetails.statistics)) {
    return match.matchDetails.statistics;
  }
  if (Array.isArray(match.matchDetails)) {
    return match.matchDetails
      .map((x) => {
        if (x && typeof x === "object") {
          if (x.period && x.groups) return x;
          if (Array.isArray(x.statistics)) return x.statistics;
        }
        return null;
      })
      .flat()
      .filter(Boolean);
  }
  if (Array.isArray(match.statistics)) return match.statistics;
  if (Array.isArray(match.matchStatistics)) return match.matchStatistics;
  if (Array.isArray(match.stats)) return match.stats;

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

function readSideValue(item, side) {
  const cand = [
    side === "home" ? "homeValue" : "awayValue",
    side,
    side === "home" ? "home_team" : "away_team",
    side === "home" ? "homeTeam" : "awayTeam",
    side === "home" ? "home_val" : "away_val",
    "value",
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
  if (["corners", "cornerkicks"].includes(A) && ["corners", "cornerkicks"].includes(B)) return true;
  return false;
}

function extractStat(match, key, period, side) {
  const blocks = getStatisticsBlocks(match);
  if (!blocks.length) return 0;

  const want = normPeriod(period);
  let periodData = blocks.find((b) => normPeriod(b.period) === want);
  if (!periodData) periodData = blocks.find((b) => normPeriod(b.period) === "ALL");
  if (!periodData) periodData = blocks[0];

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
        const val = readSideValue(it, side);
        if (val != null) return val;
      }
    }
  }
  return 0;
}

function resolveStatKey(statKey) {
  if (!statKey) return null;
  if (STAT_KEY_MAP[statKey]) return STAT_KEY_MAP[statKey];
  return statKey;
}

async function fetchTeamstatsDocs(col, teamName, roles) {
  const docs = [];
  for (const role of roles) {
    const doc = await col.findOne({
      "_importMeta.teamName": { $regex: new RegExp(`^${teamName}$`, "i") },
      "_importMeta.teamRole": role,
    });
    if (doc) docs.push({ role, doc });
  }
  return docs;
}

function collectMatches({ doc, role, statKey, period, scope }) {
  const results = [];
  const matches = doc?.full || [];
  matches.forEach((m) => {
    const dateStr = toDateString(m.date || m.matchDate);
    const homeVal = extractStat(m, statKey, period, "home");
    const awayVal = extractStat(m, statKey, period, "away");
    let value = null;
    if (scope === "home") value = homeVal;
    else if (scope === "away") value = awayVal;
    else value = (homeVal ?? 0) + (awayVal ?? 0);
    results.push({
      date: dateStr,
      role,
      home: m.homeTeamName,
      away: m.awayTeamName,
      value,
    });
  });
  return results;
}

async function run() {
  const [, , teamName, scopeArg, statKeyRaw, periodRaw] = process.argv;
  if (!teamName || !scopeArg || !statKeyRaw || !periodRaw) {
    console.error("Usage: node scripts/inspect-teamstats.js \"Team Name\" home|away|total statKey ALL|1ST|2ND");
    process.exit(1);
  }
  const scope = scopeArg.toLowerCase();
  if (!["home", "away", "total"].includes(scope)) {
    console.error("scope must be one of: home, away, total");
    process.exit(1);
  }
  const statKey = resolveStatKey(statKeyRaw);
  if (!statKey) {
    console.error("Invalid statKey");
    process.exit(1);
  }
  const period = normPeriod(periodRaw);

  if (!MONGODB_URI) {
    console.error("MONGODB_URI missing");
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    const col = db.collection("teamstats");

    const roles = scope === "home" ? ["home"] : scope === "away" ? ["away"] : ["home", "away"];
    const docs = await fetchTeamstatsDocs(col, teamName, roles);

    if (!docs.length) {
      console.log("No teamstats docs found");
      return;
    }

    let rows = [];
    docs.forEach(({ doc, role }) => {
      rows = rows.concat(collectMatches({ doc, role, statKey, period, scope }));
    });

    rows.sort((a, b) => {
      const da = a.date || "";
      const dbs = b.date || "";
      return da.localeCompare(dbs);
    });

    console.log(`Found ${rows.length} matches for ${teamName} scope=${scope} stat=${statKey} period=${period}`);
    rows.forEach((r) => {
      console.log(`${r.date || "n/a"} | ${r.home} vs ${r.away} | role=${r.role} | value=${r.value}`);
    });

    await inspectLocalTeamprofiles({ teamName, scope, statKey, period });
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

// ---- Local teamprofiles lookup ----
import fs from "fs";
import path from "path";

function normalizeName(val) {
  return String(val || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findLocalProfileFiles(teamName, scope) {
  const baseDir = path.join(process.cwd(), "data", "teamprofiles");
  if (!fs.existsSync(baseDir)) return [];
  const target = normalizeName(teamName);
  const wantScopes = scope === "total" ? ["home", "away"] : [scope];
  const files = [];

  const leagues = fs.readdirSync(baseDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const league of leagues) {
    const leagueDir = path.join(baseDir, league.name);
    const candidates = fs.readdirSync(leagueDir).filter((f) => f.endsWith(".json"));
    for (const file of candidates) {
      const lower = file.toLowerCase();
      const scopeMatch = wantScopes.some((sc) => lower.endsWith(`_${sc}.json`));
      if (!scopeMatch) continue;
      const base = lower.replace(/\.json$/, "").replace(/_(home|away)$/, "");
      if (normalizeName(base) === target) {
        files.push(path.join(leagueDir, file));
      }
    }
  }
  return files;
}

function collectLocalRows(profilePath, statKey, period, scope) {
  try {
    const raw = fs.readFileSync(profilePath, "utf-8");
    const data = JSON.parse(raw);
    const stats = data?.statistics?.for?.[statKey]?.[period];
    const hist = stats?.history;
    if (!Array.isArray(hist)) return [];
    return hist.map((h) => ({
      date: h.date || toDateString(h.timestamp) || null,
      home: scope === "away" ? h.opp : data?.meta?.lagnamn || "Team",
      away: scope === "away" ? data?.meta?.lagnamn || "Team" : h.opp,
      opp: h.opp,
      value: h.val ?? null,
      matchId: h.matchId ?? null,
      source: path.basename(profilePath),
    }));
  } catch (err) {
    console.warn(`Failed to read ${profilePath}: ${err.message}`);
    return [];
  }
}

async function inspectLocalTeamprofiles({ teamName, scope, statKey, period }) {
  const files = findLocalProfileFiles(teamName, scope);
  if (!files.length) {
    console.log("[Local teamprofiles] No local profile files found for team:", teamName);
    return;
  }

  let rows = [];
  files.forEach((file) => {
    rows = rows.concat(collectLocalRows(file, statKey, period, scope));
  });

  rows.sort((a, b) => {
    const da = a.date || "";
    const dbs = b.date || "";
    return da.localeCompare(dbs);
  });

  console.log(
    `[Local teamprofiles] Matches: ${rows.length} for ${teamName} scope=${scope} stat=${statKey} period=${period}`
  );
  rows.forEach((r) => {
    console.log(
      `${r.date || "n/a"} | ${r.home} vs ${r.away} | val=${r.value} | matchId=${r.matchId ?? "n/a"} | src=${r.source}`
    );
  });
}
