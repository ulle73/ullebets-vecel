// import clientPromise from '../lib/mongo.js';
// import fs from 'fs/promises';
// import path from 'path';

// const BACKTESTS_DIR = process.env.BACKTESTS_DIR || "C:\\Users\\ryd\\OneDrive\\Skrivbord\\FRONTEND\\bet365\\UNIBET\\unibet-backtests";

// /**
//  * Validate skew inputs by listing every used match/line for a team + stat + scope + period.
//  *
//  * Usage:
//  *   node scripts/scew-validate.js --team="Hellas Verona" --stat=cornerKicks --scope=away --period=ALL
//  * Defaults:
//  *   team="Sunderland", stat="cornerKicks", scope="total", period="ALL"
//  */

// function parseArgs() {
//   const args = {
//     team: 'Sunderland',
//     stat: 'cornerKicks',
//     scope: 'total',
//     period: 'ALL',
//     periodWildcard: false, // when true, ALL acts as wildcard
//     oddsMin: null,
//     oddsMax: null,
//     condition: null, // over|under
//     includeDisk: false,
//   };

//   for (const arg of process.argv.slice(2)) {
//     if (arg.startsWith('--team=')) args.team = arg.split('=')[1];
//     if (arg.startsWith('--stat=')) args.stat = arg.split('=')[1];
//     if (arg.startsWith('--scope=')) args.scope = arg.split('=')[1];
//     if (arg.startsWith('--period=')) args.period = arg.split('=')[1];
//     if (arg === '--period-wildcard') args.periodWildcard = true;
//     if (arg.startsWith('--odds-min=')) args.oddsMin = Number(arg.split('=')[1]);
//     if (arg.startsWith('--odds-max=')) args.oddsMax = Number(arg.split('=')[1]);
//     if (arg.startsWith('--condition=')) args.condition = arg.split('=')[1].toLowerCase();
//     if (arg === '--include-disk') args.includeDisk = true;
//   }

//   args.scope = args.scope.toLowerCase();
//   if (!['home', 'away', 'total'].includes(args.scope)) {
//     throw new Error(`Invalid scope "${args.scope}". Use home|away|total.`);
//   }

//   return args;
// }

// function fmtNum(value, digits = 2) {
//   if (value == null || Number.isNaN(value)) return 'n/a';
//   return Number(value).toFixed(digits);
// }

// function normalizeCondition(condition) {
//   if (!condition) return null;
//   const c = String(condition).toLowerCase();
//   if (c.includes('över') || c === 'over') return 'over';
//   if (c.includes('under')) return 'under';
//   return null;
// }

// async function collectFiles(dir) {
//   try {
//     const entries = await fs.readdir(dir, { withFileTypes: true });
//     const files = [];
//     for (const entry of entries) {
//       const full = path.join(dir, entry.name);
//       if (entry.isDirectory()) {
//         files.push(...(await collectFiles(full)));
//       } else if (entry.name.endsWith(".json")) {
//         files.push(full);
//       }
//     }
//     return files;
//   } catch (err) {
//     console.warn(`⚠️  Could not read disk directory ${dir}: ${err.message}`);
//     return [];
//   }
// }

// async function loadBacktestsFromDisk(dir) {
//   const files = await collectFiles(dir);
//   const docs = [];

//   for (const file of files) {
//     try {
//       const txt = await fs.readFile(file, "utf-8");
//       const parsed = JSON.parse(txt);
//       const lines = Array.isArray(parsed) ? parsed : parsed.lines || [];
//       docs.push({
//         ...parsed,
//         lines,
//         source: 'disk',
//       });
//     } catch {
//       continue;
//     }
//   }
//   return docs;
// }

// async function main() {
//   const { team, stat, scope, period, periodWildcard, oddsMin, oddsMax, condition, includeDisk } = parseArgs();

//   console.log(`\n🎯 Validate lines for team="${team}", stat="${stat}", scope="${scope}", period="${period}"${periodWildcard ? " (ALL = wildcard)" : " (exact period match)"}${oddsMin != null ? `, odds>=${oddsMin}` : ''}${oddsMax != null ? `, odds<=${oddsMax}` : ''}${condition ? `, condition=${condition}` : ''}${includeDisk ? ", +disk" : ""}`);

//   const client = await clientPromise;
//   const db = client.db(process.env.MONGODB_DB || 'app');

//   // Find teamprofiles for context (not required for listing)
//   const profiles = await db.collection('teamprofiles').find({
//     'meta.lagnamn': team
//   }).toArray();
//   console.log(`Teamprofiles found: ${profiles.length} (${profiles.map(p => p.meta.matchType).join(', ') || 'none'})`);

//   // Build match filter based on scope
//   const matchFilter = {};
//   if (scope === 'home') {
//     matchFilter.homeTeam = team;
//   } else if (scope === 'away') {
//     matchFilter.awayTeam = team;
//   } else {
//     matchFilter.$or = [{ homeTeam: team }, { awayTeam: team }];
//   }

//   const cursor = db.collection('unibet-backtest').find(matchFilter);
//   const docs = await cursor.toArray();

//   if (includeDisk) {
//     const diskDocs = await loadBacktestsFromDisk(BACKTESTS_DIR);
//     docs.push(...diskDocs.filter(d => {
//       return (scope === 'home' && d.homeTeam === team) ||
//              (scope === 'away' && d.awayTeam === team) ||
//              (scope === 'total' && (d.homeTeam === team || d.awayTeam === team));
//     }));
//   }

//   const rows = [];
//   for (const doc of docs) {
//     if (!Array.isArray(doc.lines)) continue;

//     for (const line of doc.lines) {
//       if (line.statKey !== stat) continue;
//       if (line.scope !== scope && scope !== 'total') continue;

//       const linePeriod = line.period || 'ALL';
//       const periodMatch = periodWildcard
//         ? (period === 'ALL' ? true : linePeriod === period)
//         : linePeriod === period;
//       if (!periodMatch) continue;
//       if (line.actual == null) continue;

//       if (oddsMin != null && (!Number.isFinite(line.odds) || line.odds < oddsMin)) continue;
//       if (oddsMax != null && (!Number.isFinite(line.odds) || line.odds > oddsMax)) continue;

//       const cond = normalizeCondition(line.condition);
//       if (condition && cond !== condition) continue;

//       const deviation = line.actual - line.line;
//       const implied = Number.isFinite(line.odds) ? (100 / line.odds) : null;

//       rows.push({
//         matchDate: doc.matchDate || doc.date || doc.metadata?.matchDate || 'n/a',
//         homeTeam: doc.homeTeam,
//         awayTeam: doc.awayTeam,
//         condition: line.condition,
//         line: line.line,
//         actual: line.actual,
//         deviation,
//         odds: line.odds,
//         implied,
//         period: linePeriod,
//         scope: line.scope,
//         betKey: line.betKey,
//         slug: doc.slug,
//         eventId: doc.eventId || doc.metadata?.eventId,
//       });
//     }
//   }

//   rows.sort((a, b) => String(a.matchDate).localeCompare(String(b.matchDate)));

//   console.log(`\nFound ${rows.length} matching lines in ${includeDisk ? 'unibet-backtest + disk' : 'unibet-backtest'}`);
//   console.log('Date       | Match                         | Cond | Line  | Actual | Dev   | Odds | Imp%  | Period | Scope | BetKey');
//   console.log('-'.repeat(120));
//   for (const r of rows) {
//     const matchLabel = `${r.homeTeam} vs ${r.awayTeam}`.padEnd(28);
//     const date = String(r.matchDate).padEnd(10);
//     const cond = String(r.condition || '').padEnd(4);
//     const lineStr = fmtNum(r.line, 2).padStart(5);
//     const actStr = fmtNum(r.actual, 1).padStart(6);
//     const devStr = fmtNum(r.deviation, 2).padStart(6);
//     const oddsStr = fmtNum(r.odds, 2).padStart(5);
//     const impStr = r.implied != null ? fmtNum(r.implied, 1).padStart(6) : '  n/a';
//     const periodStr = String(r.period).padEnd(5);
//     const scopeStr = String(r.scope).padEnd(5);

//     console.log(`${date} | ${matchLabel} | ${cond} | ${lineStr} | ${actStr} | ${devStr} | ${oddsStr} | ${impStr} | ${periodStr} | ${scopeStr} | ${r.betKey || ''}`);
//   }

//   console.log('\n🔎 Use this list to cross-check deviations (actual - line), odds, and direction per match.');

//   await client.close();
// }

// main().catch(err => {
//   console.error('❌ Validation failed:', err);
//   process.exit(1);
// });


import fs from "fs/promises";
import path from "path";
import clientPromise from "../lib/mongo.js";

// ================= ARG PARSING =================

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return null;
  return arg.split("=").slice(1).join("=");
}

const TARGET_TEAM = getArg("team");
const TARGET_SCOPE = getArg("scope");
const TARGET_STAT = getArg("statKey");
const TARGET_PERIOD = getArg("period"); // optional: ALL | 1ST | 2ND
const DEDUPE = getArg("dedupe"); // optional: "true"|"false" (default true)

if (!TARGET_TEAM || !TARGET_SCOPE || !TARGET_STAT) {
  console.error(
    "❌ Missing args.\nUsage:\n" +
      "node scripts/scew-validate.js " +
      '--team="Barcelona" --scope="home" --statKey="cornerKicks" --period="ALL"\n\n' +
      "Optional:\n" +
      '--dedupe="true" (default true)'
  );
  process.exit(1);
}

// ================= CONFIG =================

const BACKTESTS_DIR =
  process.env.BACKTESTS_DIR ||
  "C:\\Users\\ryd\\OneDrive\\Skrivbord\\FRONTEND\\bet365\\UNIBET\\unibet-backtests";

const MIN_ODDS = Number(process.env.MARKET_BIAS_MIN_ODDS || 1.8);
const MAX_ODDS = Number(process.env.MARKET_BIAS_MAX_ODDS || 2.2);

// ================= HELPERS =================

function normalizeCondition(c) {
  if (!c) return null;
  const s = String(c).toLowerCase();
  if (s.includes("över") || s === "over") return "over";
  if (s.includes("under") || s === "under") return "under";
  return null;
}

function getActual(line) {
  const v = line?.actual ?? line?.evDetails?.actual;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getMatchKey(doc) {
  return doc.matchId || doc.eventId || doc.slug;
}

function getTeamNameForScope(scope, doc) {
  if (scope === "home") return doc.homeTeam;
  if (scope === "away") return doc.awayTeam;
  return null;
}

function selectMainLineOverThenUnder(candidates) {
  // 1) Prefer OVER in odds window
  const overInWindow = candidates
    .filter(
      (c) => c.side === "over" && c.odds >= MIN_ODDS && c.odds <= MAX_ODDS
    )
    .sort((a, b) => Math.abs(a.odds - 2.0) - Math.abs(b.odds - 2.0))[0];

  if (overInWindow) return { main: overInWindow, pickedFrom: "over_window" };

  // 2) Fallback: UNDER in odds window
  const underInWindow = candidates
    .filter(
      (c) => c.side === "under" && c.odds >= MIN_ODDS && c.odds <= MAX_ODDS
    )
    .sort((a, b) => Math.abs(a.odds - 2.0) - Math.abs(b.odds - 2.0))[0];

  if (underInWindow) return { main: underInWindow, pickedFrom: "under_window" };

  // 3) Optional last fallback: closest to 2.0 regardless (kept for debugging)
  const anyClosest = candidates
    .slice()
    .sort((a, b) => Math.abs(a.odds - 2.0) - Math.abs(b.odds - 2.0))[0];

  return anyClosest
    ? { main: anyClosest, pickedFrom: "fallback_any" }
    : { main: null, pickedFrom: null };
}

function parseBool(v, defaultValue = true) {
  if (v == null) return defaultValue;
  const s = String(v).toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return defaultValue;
}

function strIncludes(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase().includes(String(b).toLowerCase());
}

// ================= DISK LOADER =================

async function collectJsonFiles(dir) {
  const out = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await collectJsonFiles(full)));
      else if (e.isFile() && e.name.toLowerCase().endsWith(".json"))
        out.push(full);
    }
  } catch {}
  return out;
}

async function loadFromDisk(dir) {
  const files = await collectJsonFiles(dir);
  const docs = [];

  for (const file of files) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw);

      // Support:
      // 1) { lines:[...] }
      // 2) [...] (treat as one doc with lines)
      // 3) [ {lines:[...]}, ... ] (array of docs)
      if (Array.isArray(parsed)) {
        if (
          parsed.length &&
          parsed[0] &&
          typeof parsed[0] === "object" &&
          Array.isArray(parsed[0].lines)
        ) {
          parsed.forEach((d) => docs.push(d));
        } else {
          docs.push({ lines: parsed, source: file });
        }
      } else if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.lines)
      ) {
        docs.push(parsed);
      }
    } catch {}
  }
  return docs;
}

// ================= MAIN =================

async function main() {
  const shouldDedupe = parseBool(DEDUPE, true);

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");

  const mongoDocs = await db
    .collection("unibet-backtest")
    .find({ "lines.actual": { $ne: null } })
    .toArray();

  const diskDocs = await loadFromDisk(BACKTESTS_DIR);

  const allDocs = [...mongoDocs, ...diskDocs];

  console.log(`📦 Loaded ${allDocs.length} total backtests\n`);

  const seen = new Set();
  let matchesFound = 0;

  for (const doc of allDocs) {
    if (!Array.isArray(doc.lines)) continue;

    const matchKey =
      getMatchKey(doc) ||
      `${doc.homeTeam || ""}-${doc.awayTeam || ""}-${doc.matchDate || ""}`;
    if (shouldDedupe) {
      if (seen.has(matchKey)) continue;
      seen.add(matchKey);
    }

    const candidates = [];

    const expectedTeamName = getTeamNameForScope(TARGET_SCOPE, doc);
    // This is the *team that should match* when user says --team=... and scope home/away.
    // e.g. scope=home => doc.homeTeam should match TARGET_TEAM.
    if (!expectedTeamName || !strIncludes(expectedTeamName, TARGET_TEAM))
      continue;

    for (const line of doc.lines) {
      if (line.statKey !== TARGET_STAT) continue;
      if (line.scope !== TARGET_SCOPE) continue;

      const period = line.period || "ALL";
      if (TARGET_PERIOD && period !== TARGET_PERIOD) continue;

      const side = normalizeCondition(line.condition);
      if (side !== "over" && side !== "under") continue;

      const actual = getActual(line);
      if (actual == null) continue;

      const odds = Number(line.odds);
      const lineNum = Number(line.line);
      if (!Number.isFinite(odds) || !Number.isFinite(lineNum)) continue;

      // Keep betKey for sanity/debug (optional)
      candidates.push({
        side,
        period,
        line: lineNum,
        odds,
        actual,
        betKey: line.betKey || null,
      });
    }

    if (candidates.length === 0) continue;

    matchesFound++;

    const { main, pickedFrom } = selectMainLineOverThenUnder(candidates);

    console.log("────────────────────────────────────────────");
    console.log(`🏟️  ${doc.homeTeam} vs ${doc.awayTeam}`);
    console.log(`📅  ${doc.matchDate || "unknown date"}`);
    console.log(
      `📊  ${TARGET_STAT} | scope=${TARGET_SCOPE}` +
        (TARGET_PERIOD
          ? ` | period=${TARGET_PERIOD}`
          : " | period=ALL/1ST/2ND (mixed)")
    );
    console.log(
      `🎯 Main selection rule: OVER window [${MIN_ODDS}-${MAX_ODDS}] else UNDER window, else closest-to-2 fallback`
    );
    console.log(
      `👉 Picked: ${
        main
          ? `${main.side.toUpperCase()} line ${main.line} @ ${main.odds.toFixed(
              2
            )}`
          : "NONE"
      } (${pickedFrom})`
    );
    console.log("");

    for (const c of candidates.sort((a, b) =>
      (a.period + a.line + a.odds).localeCompare(b.period + b.line + b.odds)
    )) {
      const isMain =
        main &&
        c.side === main.side &&
        c.line === main.line &&
        c.odds === main.odds &&
        c.period === main.period;

      const hit = c.side === "over" ? c.actual > c.line : c.actual < c.line;

      const inWindow = c.odds >= MIN_ODDS && c.odds <= MAX_ODDS ? "✅" : "  ";

      console.log(
        `${isMain ? "👉 MAIN " : "     "}period ${c.period.padEnd(
          3
        )} | ${c.side.padEnd(5)} |` +
          ` line ${c.line.toFixed(1).padStart(4)} | odds ${c.odds
            .toFixed(2)
            .padStart(4)} ${inWindow} |` +
          ` actual ${String(c.actual).padStart(2)} | ${
            hit ? "HIT ✅" : "MISS ❌"
          }`
      );
    }

    console.log("");
  }

  console.log(`\n✅ Matches found: ${matchesFound}`);
  if (!TARGET_PERIOD) {
    console.log(
      `ℹ️ Tip: add --period="ALL" (or 1ST/2ND) to avoid mixing periods in output.`
    );
  }
  if (shouldDedupe) {
    console.log(
      `ℹ️ Dedupe is ON. Disable with --dedupe="false" if you want to see duplicates/snapshots.`
    );
  }
}

main().catch((err) => {
  console.error("❌ Debug failed:", err);
  process.exit(1);
});
