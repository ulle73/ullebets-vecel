import clientPromise from '../lib/mongo.js';
import fs from 'fs/promises';
import path from 'path';

const BACKTESTS_DIR = process.env.BACKTESTS_DIR || "C:\\Users\\ryd\\OneDrive\\Skrivbord\\FRONTEND\\bet365\\UNIBET\\unibet-backtests";

/**
 * Validate skew inputs by listing every used match/line for a team + stat + scope + period.
 *
 * Usage:
 *   node scripts/scew-validate.js --team="Hellas Verona" --stat=cornerKicks --scope=away --period=ALL
 * Defaults:
 *   team="Sunderland", stat="cornerKicks", scope="total", period="ALL"
 */

function parseArgs() {
  const args = {
    team: 'Sunderland',
    stat: 'cornerKicks',
    scope: 'total',
    period: 'ALL',
    periodWildcard: false, // when true, ALL acts as wildcard
    oddsMin: null,
    oddsMax: null,
    condition: null, // over|under
    includeDisk: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--team=')) args.team = arg.split('=')[1];
    if (arg.startsWith('--stat=')) args.stat = arg.split('=')[1];
    if (arg.startsWith('--scope=')) args.scope = arg.split('=')[1];
    if (arg.startsWith('--period=')) args.period = arg.split('=')[1];
    if (arg === '--period-wildcard') args.periodWildcard = true;
    if (arg.startsWith('--odds-min=')) args.oddsMin = Number(arg.split('=')[1]);
    if (arg.startsWith('--odds-max=')) args.oddsMax = Number(arg.split('=')[1]);
    if (arg.startsWith('--condition=')) args.condition = arg.split('=')[1].toLowerCase();
    if (arg === '--include-disk') args.includeDisk = true;
  }

  args.scope = args.scope.toLowerCase();
  if (!['home', 'away', 'total'].includes(args.scope)) {
    throw new Error(`Invalid scope "${args.scope}". Use home|away|total.`);
  }

  return args;
}

function fmtNum(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return Number(value).toFixed(digits);
}

function normalizeCondition(condition) {
  if (!condition) return null;
  const c = String(condition).toLowerCase();
  if (c.includes('över') || c === 'over') return 'over';
  if (c.includes('under')) return 'under';
  return null;
}

async function collectFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await collectFiles(full)));
      } else if (entry.name.endsWith(".json")) {
        files.push(full);
      }
    }
    return files;
  } catch (err) {
    console.warn(`⚠️  Could not read disk directory ${dir}: ${err.message}`);
    return [];
  }
}

async function loadBacktestsFromDisk(dir) {
  const files = await collectFiles(dir);
  const docs = [];

  for (const file of files) {
    try {
      const txt = await fs.readFile(file, "utf-8");
      const parsed = JSON.parse(txt);
      const lines = Array.isArray(parsed) ? parsed : parsed.lines || [];
      docs.push({
        ...parsed,
        lines,
        source: 'disk',
      });
    } catch {
      continue;
    }
  }
  return docs;
}

async function main() {
  const { team, stat, scope, period, periodWildcard, oddsMin, oddsMax, condition, includeDisk } = parseArgs();

  console.log(`\n🎯 Validate lines for team="${team}", stat="${stat}", scope="${scope}", period="${period}"${periodWildcard ? " (ALL = wildcard)" : " (exact period match)"}${oddsMin != null ? `, odds>=${oddsMin}` : ''}${oddsMax != null ? `, odds<=${oddsMax}` : ''}${condition ? `, condition=${condition}` : ''}${includeDisk ? ", +disk" : ""}`);

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || 'app');

  // Find teamprofiles for context (not required for listing)
  const profiles = await db.collection('teamprofiles').find({
    'meta.lagnamn': team
  }).toArray();
  console.log(`Teamprofiles found: ${profiles.length} (${profiles.map(p => p.meta.matchType).join(', ') || 'none'})`);

  // Build match filter based on scope
  const matchFilter = {};
  if (scope === 'home') {
    matchFilter.homeTeam = team;
  } else if (scope === 'away') {
    matchFilter.awayTeam = team;
  } else {
    matchFilter.$or = [{ homeTeam: team }, { awayTeam: team }];
  }

  const cursor = db.collection('unibet-backtest').find(matchFilter);
  const docs = await cursor.toArray();

  if (includeDisk) {
    const diskDocs = await loadBacktestsFromDisk(BACKTESTS_DIR);
    docs.push(...diskDocs.filter(d => {
      return (scope === 'home' && d.homeTeam === team) ||
             (scope === 'away' && d.awayTeam === team) ||
             (scope === 'total' && (d.homeTeam === team || d.awayTeam === team));
    }));
  }

  const rows = [];
  for (const doc of docs) {
    if (!Array.isArray(doc.lines)) continue;

    for (const line of doc.lines) {
      if (line.statKey !== stat) continue;
      if (line.scope !== scope && scope !== 'total') continue;

      const linePeriod = line.period || 'ALL';
      const periodMatch = periodWildcard
        ? (period === 'ALL' ? true : linePeriod === period)
        : linePeriod === period;
      if (!periodMatch) continue;
      if (line.actual == null) continue;

      if (oddsMin != null && (!Number.isFinite(line.odds) || line.odds < oddsMin)) continue;
      if (oddsMax != null && (!Number.isFinite(line.odds) || line.odds > oddsMax)) continue;

      const cond = normalizeCondition(line.condition);
      if (condition && cond !== condition) continue;

      const deviation = line.actual - line.line;
      const implied = Number.isFinite(line.odds) ? (100 / line.odds) : null;

      rows.push({
        matchDate: doc.matchDate || doc.date || doc.metadata?.matchDate || 'n/a',
        homeTeam: doc.homeTeam,
        awayTeam: doc.awayTeam,
        condition: line.condition,
        line: line.line,
        actual: line.actual,
        deviation,
        odds: line.odds,
        implied,
        period: linePeriod,
        scope: line.scope,
        betKey: line.betKey,
        slug: doc.slug,
        eventId: doc.eventId || doc.metadata?.eventId,
      });
    }
  }

  rows.sort((a, b) => String(a.matchDate).localeCompare(String(b.matchDate)));

  console.log(`\nFound ${rows.length} matching lines in ${includeDisk ? 'unibet-backtest + disk' : 'unibet-backtest'}`);
  console.log('Date       | Match                         | Cond | Line  | Actual | Dev   | Odds | Imp%  | Period | Scope | BetKey');
  console.log('-'.repeat(120));
  for (const r of rows) {
    const matchLabel = `${r.homeTeam} vs ${r.awayTeam}`.padEnd(28);
    const date = String(r.matchDate).padEnd(10);
    const cond = String(r.condition || '').padEnd(4);
    const lineStr = fmtNum(r.line, 2).padStart(5);
    const actStr = fmtNum(r.actual, 1).padStart(6);
    const devStr = fmtNum(r.deviation, 2).padStart(6);
    const oddsStr = fmtNum(r.odds, 2).padStart(5);
    const impStr = r.implied != null ? fmtNum(r.implied, 1).padStart(6) : '  n/a';
    const periodStr = String(r.period).padEnd(5);
    const scopeStr = String(r.scope).padEnd(5);

    console.log(`${date} | ${matchLabel} | ${cond} | ${lineStr} | ${actStr} | ${devStr} | ${oddsStr} | ${impStr} | ${periodStr} | ${scopeStr} | ${r.betKey || ''}`);
  }

  console.log('\n🔎 Use this list to cross-check deviations (actual - line), odds, and direction per match.');

  await client.close();
}

main().catch(err => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
