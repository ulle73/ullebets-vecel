/**
 * Skew validator: vilka lag/stat/period/scope överpresterar sina linjer.
 * Läser alla unibet-backtest (DB + disk) och grupperar i oddsintervall.
 * För varje bucket listar vi lag/stat/period/scope med högst träffprocent.
 */

import fs from 'fs/promises';
import path from 'path';
import clientPromise from '../lib/mongo.js';

// ==================== KONFIG ====================
const BACKTESTS_DIR = process.env.BACKTESTS_DIR || "C:\\Users\\ryd\\OneDrive\\Skrivbord\\FRONTEND\\bet365\\UNIBET\\unibet-backtests";
const MIN_SAMPLE = 5;

// Oddsintervall med namn = intervallet
const ODDS_BUCKETS = [
  { label: '1.01-1.50', min: 1.01, max: 1.50 },
  { label: '1.51-1.80', min: 1.51, max: 1.80 },
  { label: '1.81-2.20', min: 1.81, max: 2.20 }, // even-ish
  { label: '2.21-3.00', min: 2.21, max: 3.00 },
  { label: '3.01-5.00', min: 3.01, max: 5.00 },
  { label: '5.01-10.00', min: 5.01, max: 10.00 },
  { label: '10.01+', min: 10.01, max: Infinity },
];

// Stat och scope att inkludera
const PROPS = ['totalShots', 'shotsOnGoal', 'cornerKicks', 'offsides', 'fouls', 'yellowCards'];
const SCOPES = ['home', 'away'];

// ==================== HJÄLPARE ====================

function getBucketLabel(odds) {
  if (!Number.isFinite(odds) || odds <= 0) return null;
  for (const bucket of ODDS_BUCKETS) {
    if (odds >= bucket.min && odds <= bucket.max) return bucket.label;
  }
  return null;
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
      } else if (entry.name.endsWith('.json')) {
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
      const txt = await fs.readFile(file, 'utf-8');
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

function initAgg(bucket, stat, period, scope, team) {
  return {
    bucket,
    stat,
    period,
    scope,
    team,
    wins: 0,
    total: 0, // lines
    matches: new Set(),
    sumOdds: 0,
    sumImplied: 0,
  };
}

// ==================== HUVUDLOGIK ====================

async function main() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 Skew odds-buckets: vilka lag/stat/period/scope träffar sina spel oftast`);
  console.log(`${'='.repeat(80)}\n`);

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || 'app');

  // Hämta från DB
  const dbDocs = await db.collection('unibet-backtest').find({
    'lines.actual': { $ne: null }
  }).toArray();
  console.log(`🗄️  Loaded ${dbDocs.length} backtests from MongoDB`);

  // Hämta från disk
  const diskDocs = await loadBacktestsFromDisk(BACKTESTS_DIR);
  console.log(`💾 Loaded ${diskDocs.length} backtests from disk (${BACKTESTS_DIR})`);

  const allDocs = [...dbDocs, ...diskDocs];
  console.log(`📦 Total backtests: ${allDocs.length}\n`);

  // Aggregat: bucket -> stat -> period -> scope -> team -> agg
  const buckets = new Map();

  for (const doc of allDocs) {
    if (!Array.isArray(doc.lines)) continue;

    for (const line of doc.lines) {
      if (line.actual == null) continue;
      if (!PROPS.includes(line.statKey)) continue;
      if (!SCOPES.includes(line.scope)) continue;

      const odds = Number(line.odds);
      const bucketLabel = getBucketLabel(odds);
      if (!bucketLabel) continue;

      const condition = normalizeCondition(line.condition);
      if (!condition) continue;

      const deviation = line.actual - line.line;
      if (Math.abs(deviation) < 1e-9) continue; // push, hoppa

      const period = line.period || 'ALL';
      let teamName = null;
      if (line.scope === 'home') {
        teamName = line.homeTeam || doc.homeTeam;
      } else if (line.scope === 'away') {
        teamName = line.awayTeam || doc.awayTeam;
      }
      if (!teamName) continue;

      // Vinst i den spelade riktningen
      const isOver = condition === 'over';
      const win = isOver ? deviation > 0 : deviation < 0;
      const matchKey = doc.matchId || doc.eventId || doc.slug || `${doc.homeTeam}-${doc.awayTeam}-${doc.matchDate || doc.date || ''}`;

      // Hämta/bygg agg
      if (!buckets.has(bucketLabel)) buckets.set(bucketLabel, new Map());
      const statMap = buckets.get(bucketLabel);
      if (!statMap.has(line.statKey)) statMap.set(line.statKey, new Map());
      const periodMap = statMap.get(line.statKey);
      if (!periodMap.has(period)) periodMap.set(period, new Map());
      const scopeMap = periodMap.get(period);
      if (!scopeMap.has(line.scope)) scopeMap.set(line.scope, new Map());
      const teamMap = scopeMap.get(line.scope);
      if (!teamMap.has(teamName)) teamMap.set(teamName, initAgg(bucketLabel, line.statKey, period, line.scope, teamName));

      const agg = teamMap.get(teamName);
      agg.total += 1;
      agg.matches.add(matchKey);
      if (win) agg.wins += 1;
      if (Number.isFinite(odds)) {
        agg.sumOdds += odds;
        agg.sumImplied += 1 / odds;
      }
    }
  }

  // Bygg lista för utskrift
  for (const bucket of ODDS_BUCKETS) {
    const label = bucket.label;
    const statMap = buckets.get(label);
    if (!statMap) continue;

    const rows = [];
    for (const [statKey, periodMap] of statMap.entries()) {
      for (const [period, scopeMap] of periodMap.entries()) {
        for (const [scope, teamMap] of scopeMap.entries()) {
          for (const [, agg] of teamMap.entries()) {
            if (agg.total < MIN_SAMPLE) continue;
            const winPct = (agg.wins / agg.total) * 100;
            const avgOdds = agg.sumOdds / agg.total;
            const avgImplied = (agg.sumImplied / agg.total) * 100;
            rows.push({
              team: agg.team,
              stat: statKey,
              period,
              scope,
              bucket: label,
              winPct,
              total: agg.total,
              matches: agg.matches.size,
              wins: agg.wins,
              avgOdds,
              avgImplied,
            });
          }
        }
      }
    }

    if (rows.length === 0) continue;
    rows.sort((a, b) => b.winPct - a.winPct || b.total - a.total);

    console.log(`\n${'='.repeat(120)}`);
    console.log(`🎯 Bucket ${label} – Topplista (min ${MIN_SAMPLE} bets, sorterat på Hit%)`);
    console.log(`${'='.repeat(120)}`);
    console.log('Team                     | Stat           | Per  | Scope | N lines | N matches | Win%  | AvgOdds | Imp%');
    console.log('-'.repeat(120));

    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const r = rows[i];
      const line = [
        r.team.padEnd(23),
        r.stat.padEnd(14),
        String(r.period).padEnd(4),
        r.scope.padEnd(5),
        String(r.total).padStart(7),
        String(r.matches).padStart(10),
        r.winPct.toFixed(1).padStart(6),
        (r.avgOdds ?? 0).toFixed(2).padStart(8),
        (r.avgImplied ?? 0).toFixed(1).padStart(6)
      ].join(' | ');
      console.log(line);
    }
  }

  console.log('\n✅ Klar');
  await client.close();
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
