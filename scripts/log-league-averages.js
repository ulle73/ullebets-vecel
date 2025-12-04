/**
 * Hjälpskript: loggar ligasnitt (per liga och matchtyp) för utvalda statkeys och perioder,
 * beräknat som ovägt medel av lagprofilerna i data/teamprofiles.
 *
 * Kör:
 *   node scripts/log-league-averages.js
 *
 * Output:
 *   Per liga och matchtyp (home/away) skrivs for/against-snitt per statKey och period (ALL, 1ST, 2ND).
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEAMPROFILES_DIR = path.join(process.cwd(), "data", "teamprofiles");
const TEAMSTATS_DIR = path.join(process.cwd(), "data", "teamstats");

const STAT_KEYS = [
  "totalShotsOnGoal",
  "shotsOnGoal",
  "fouls",
  "freeKicks",
  "cornerKicks",
  "offsides",
  "totalTackle",
  "yellowCards",
  "throwIns",
];

const PERIODS = ["ALL", "1ST", "2ND"];

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function collectFilesRecursive(dir, filterFn) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursive(full, filterFn)));
    } else if (entry.isFile() && filterFn(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

async function collectProfileFiles() {
  return collectFilesRecursive(TEAMPROFILES_DIR, (name) =>
    name.toLowerCase().endsWith(".json")
  );
}

async function collectTeamstatsFiles() {
  return collectFilesRecursive(TEAMSTATS_DIR, (name) =>
    name.toLowerCase().endsWith(".json")
  );
}

function isHomeFile(name) {
  return /_home_match_stats\.json$/i.test(name);
}
function isAwayFile(name) {
  return /_away_match_stats\.json$/i.test(name);
}

async function loadProfiles() {
  const files = await collectProfileFiles();
  const groups = new Map(); // key => { leagueLabel, matchType, profiles: [] }
  const teamMeta = new Map(); // teamId -> { leagueKey, leagueLabel }

  for (const file of files) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const json = JSON.parse(raw);
      const matchType = json?.meta?.matchType ?? "unknown";
      const leagueId = json?.meta?.ligaId ?? null;
      const leagueName =
        json?.meta?.leagueName ?? path.basename(path.dirname(file)) ?? "liga";
      const leagueKey = String(leagueId ?? leagueName ?? path.dirname(file));
      const key = `${leagueKey}::${matchType}`;
      const label = leagueId != null ? `${leagueName ?? "Liga"} (${leagueId})` : leagueName;
      if (!groups.has(key)) {
        groups.set(key, { leagueLabel: label, matchType, profiles: [] });
      }
      groups.get(key).profiles.push(json);

      const teamId = json?.meta?.lagId;
      if (teamId != null && !teamMeta.has(String(teamId))) {
        teamMeta.set(String(teamId), { leagueKey, leagueLabel: label });
      }
    } catch (err) {
      console.warn(`⚠️  Skippade ${file}: ${err.message}`);
    }
  }

  return { groups, teamMeta };
}

function average(values) {
  if (!values.length) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function extractStatFromMatch(match, statKey, period) {
  const stats = match?.matchDetails?.statistics;
  if (!Array.isArray(stats)) return null;
  const wantedPeriod = period || "ALL";
  const keyLower = String(statKey).toLowerCase();

  for (const node of stats) {
    const nodePeriod = node?.period ?? "ALL";
    if (nodePeriod !== wantedPeriod) continue;
    for (const group of node?.groups ?? []) {
      for (const item of group?.statisticsItems ?? []) {
        const itemKey = String(item?.key ?? "").toLowerCase();
        if (itemKey !== keyLower) continue;
        const home = toFiniteNumber(item.homeValue ?? item.home);
        const away = toFiniteNumber(item.awayValue ?? item.away);
        return { home, away };
      }
    }
  }
  return null;
}

function ensureAgg(map, key, leagueLabel, matchType, statKey, period) {
  if (!map.has(key)) {
    map.set(key, {
      leagueLabel,
      matchType,
      matches: 0,
      uniqueMatches: new Set(),
      for: {},
      against: {},
      total: {},
    });
  }
  const entry = map.get(key);
  if (!entry.for[statKey]) entry.for[statKey] = {};
  if (!entry.against[statKey]) entry.against[statKey] = {};
  if (!entry.total[statKey]) entry.total[statKey] = {};
  if (!entry.for[statKey][period]) entry.for[statKey][period] = [];
  if (!entry.against[statKey][period]) entry.against[statKey][period] = [];
  if (!entry.total[statKey][period]) entry.total[statKey][period] = [];
  return entry;
}

function collapseAgg(map) {
  const out = new Map();
  for (const [key, entry] of map.entries()) {
    const next = {
      leagueLabel: entry.leagueLabel,
      matchType: entry.matchType,
      matches: entry.matches,
      uniqueMatchCount: entry.uniqueMatches.size,
      for: {},
      against: {},
      total: {},
    };
    for (const statKey of Object.keys(entry.for)) {
      next.for[statKey] = {};
      for (const period of Object.keys(entry.for[statKey])) {
        next.for[statKey][period] = average(entry.for[statKey][period]);
      }
    }
    for (const statKey of Object.keys(entry.against)) {
      next.against[statKey] = {};
      for (const period of Object.keys(entry.against[statKey])) {
        next.against[statKey][period] = average(entry.against[statKey][period]);
      }
    }
    for (const statKey of Object.keys(entry.total)) {
      next.total[statKey] = {};
      for (const period of Object.keys(entry.total[statKey])) {
        next.total[statKey][period] = average(entry.total[statKey][period]);
      }
    }
    out.set(key, next);
  }
  return out;
}

function computeLeagueAverageForGroup(profiles, statGroup) {
  const result = {};
  for (const statKey of STAT_KEYS) {
    result[statKey] = {};
    for (const period of PERIODS) {
      const values = [];
      for (const profile of profiles) {
        const val =
          profile?.statistics?.[statGroup]?.[statKey]?.[period]?.value ??
          profile?.statistics?.[statGroup]?.[statKey]?.[period]?.Value ??
          null;
        const num = toFiniteNumber(val);
        if (num != null) values.push(num);
      }
      result[statKey][period] = average(values);
    }
  }
  return result;
}

async function computeTeamstatsAverages(teamMeta) {
  const files = await collectTeamstatsFiles();
  const agg = new Map(); // key => temp arrays

  for (const file of files) {
    const role = isHomeFile(file) ? "home" : isAwayFile(file) ? "away" : null;
    if (!role) continue;

    try {
      const raw = await fs.readFile(file, "utf-8");
      const json = JSON.parse(raw);
      const matches = Array.isArray(json?.full) ? json.full : [];
      if (!matches.length) continue;

      const sample = matches[0] ?? {};
      const teamId =
        role === "home"
          ? sample?.homeTeamId ?? sample?.homeTeam?.id
          : sample?.awayTeamId ?? sample?.awayTeam?.id;
      if (teamId == null) continue;

      const meta = teamMeta.get(String(teamId));
      if (!meta) continue;
      const leagueKey = meta.leagueKey;
      const leagueLabel = meta.leagueLabel;
      const key = `${leagueKey}::${role}`;

      for (const match of matches) {
        const matchId = match?.matchId ?? match?.id;
        const matchKey = matchId != null ? String(matchId) : null;
        let added = false;
        for (const statKey of STAT_KEYS) {
          for (const period of PERIODS) {
            const sv = extractStatFromMatch(match, statKey, period);
            if (!sv) continue;
            const entry = ensureAgg(agg, key, leagueLabel, role, statKey, period);
            const forVal = role === "home" ? sv.home : sv.away;
            const agVal = role === "home" ? sv.away : sv.home;
            const totalVal =
              Number.isFinite(sv.home) || Number.isFinite(sv.away)
                ? (sv.home ?? 0) + (sv.away ?? 0)
                : null;
            if (Number.isFinite(forVal)) entry.for[statKey][period].push(forVal);
            if (Number.isFinite(agVal)) entry.against[statKey][period].push(agVal);
            if (Number.isFinite(totalVal)) entry.total[statKey][period].push(totalVal);
            added = true;
          }
        }
        if (added) {
          const entry = agg.get(key);
          entry.matches += 1;
          if (matchKey) entry.uniqueMatches.add(matchKey);
        }
      }
    } catch (err) {
      console.warn(`⚠️  Skippade teamstats ${file}: ${err.message}`);
    }
  }

  return collapseAgg(agg);
}

async function main() {
  const { groups, teamMeta } = await loadProfiles();
  if (!groups.size) {
    console.log(`Hittade inga profiler i ${TEAMPROFILES_DIR}`);
    return;
  }

  const profileAverages = new Map();
  for (const [key, entry] of groups.entries()) {
    profileAverages.set(key, {
      leagueLabel: entry.leagueLabel,
      matchType: entry.matchType,
      for: computeLeagueAverageForGroup(entry.profiles, "for"),
      against: computeLeagueAverageForGroup(entry.profiles, "against"),
      count: entry.profiles.length,
    });
  }

  const teamstatsAverages = await computeTeamstatsAverages(teamMeta);

  const allKeys = new Set([
    ...profileAverages.keys(),
    ...teamstatsAverages.keys(),
  ]);

  for (const key of Array.from(allKeys).sort()) {
    const profileEntry = profileAverages.get(key);
    const teamstatsEntry = teamstatsAverages.get(key);
    const leagueLabel =
      profileEntry?.leagueLabel ??
      teamstatsEntry?.leagueLabel ??
      key.split("::")[0];
    const matchType = profileEntry?.matchType ?? teamstatsEntry?.matchType ?? "unknown";

    console.log("────────────────────────────────────────────────────────");
    const matchCount = teamstatsEntry?.matches ?? 0;
    const uniqueMatchCount = teamstatsEntry?.uniqueMatchCount ?? matchCount;

    console.log(
      `Liga: ${leagueLabel} · matchType: ${matchType} · profiler: ${profileEntry?.count ?? 0
      } · teamstats-matcher: ${matchCount} (unika: ${uniqueMatchCount})`
    );

    for (const statKey of STAT_KEYS) {
      const lineParts = [];
      const fmt = (v) =>
        v == null ? "–" : Number.isInteger(v) ? v.toString() : v.toFixed(2);

      const pFor = profileEntry?.for?.[statKey] ?? {};
      const pAgainst = profileEntry?.against?.[statKey] ?? {};
      const tFor = teamstatsEntry?.for?.[statKey] ?? {};
      const tAgainst = teamstatsEntry?.against?.[statKey] ?? {};
      const tTotal = teamstatsEntry?.total?.[statKey] ?? {};

      for (const period of PERIODS) {
        const profileStr = `prof for ${fmt(pFor[period])} | ag ${fmt(
          pAgainst[period]
        )}`;
        const teamstatsStr = `ts for ${fmt(tFor[period])} | ag ${fmt(
          tAgainst[period]
        )} | tot ${fmt(tTotal[period])}`;
        lineParts.push(`${period}: ${profileStr}  ||  ${teamstatsStr}`);
      }

      console.log(`• ${statKey}: ${lineParts.join("  ·  ")}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err?.stack || err);
  process.exit(1);
});
