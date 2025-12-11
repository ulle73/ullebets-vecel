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
const MIN_SAMPLE = 5;      // min antal linjer per rad
const MIN_MATCHES = 3;     // min antal unika matcher per rad

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

// Stat och scope att inkludera (kanoniska nycklar)
const PROPS = ['totalShotsOnGoal', 'shotsOnGoal', 'cornerKicks', 'offsides', 'fouls', 'yellowCards'];
const SCOPES = ['home', 'away'];
const PERIODS = ['ALL', '1ST', '2ND'];
const SCEW_SCORE_SCALE = 75; // higher = slower saturation of score curve

const STAT_ALIASES = new Map([
  ['totalshotsongoal','totalShotsOnGoal'],
  ['total_shots_on_goal','totalShotsOnGoal'],
  ['totalshots_on_goal','totalShotsOnGoal'],
  ['totalshots','totalShotsOnGoal'],
  ['total_shots','totalShotsOnGoal'],
  ['totalshotsontarget','totalShotsOnGoal'],
  ['total_shots_on_target','totalShotsOnGoal'],
]);

function normalizeStatKeyName(statKey) {
  if (!statKey) return null;
  const raw = String(statKey).trim();
  const lower = raw.toLowerCase();
  const alias = STAT_ALIASES.get(lower);
  return alias || raw;
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    saveProfiles: args.includes('--save-profiles') || args.includes('-s'),
  };
}

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

function toScewScore(row, direction) {
  // Map factor (magnitude) to a bounded score [-10, 10] and inject sign for direction.
  // Arctan gives a smooth saturation so monster factors don't explode the scale.
  const factor = row?.factor ?? 0;
  const signed = (direction === 'under' ? -1 : 1) * factor;
  const normalized = (2 / Math.PI) * Math.atan(signed / SCEW_SCORE_SCALE); // [-1, 1]
  const scaled = normalized * 10; // [-10, 10]
  if (!Number.isFinite(scaled)) return 0;
  return Math.max(-10, Math.min(10, scaled));
}

// Faktor-beräkning används både för bucket-rader och overall-rader.
function scoreRow(r) {
  const base = (r.hitDiff ?? 0) * 0.5 + (r.roi ?? 0) * 0.3 + (r.relBias ?? 0) * 0.2;
  // Viktar matcher högre än lines för att minska “tur i en match”
  const matchWeight = Math.pow(Math.log1p(r.matches ?? 0), 2);
  const lineWeight = Math.log1p(r.total ?? 0) * 0.5; // dämpa lines
  return base * (matchWeight + lineWeight);
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
    directions: new Map(), // over|under -> dirAgg
  };
}

function getDirAgg(parent, direction) {
  if (!parent.directions.has(direction)) {
    parent.directions.set(direction, {
      direction,
      wins: 0,
      total: 0, // lines
      matches: new Set(),
      sumOdds: 0,
      sumImplied: 0,
      sumDev: 0,
      sumLine: 0,
      pnl: 0, // flat stake ROI
    });
  }
  return parent.directions.get(direction);
}

// ==================== HUVUDLOGIK ====================

async function main() {
  const { saveProfiles } = parseArgs();
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
  const bestOverallMap = new Map(); // key: team|scope|direction -> best row (högst factor)
  const bestStatMap = new Map(); // key: team|scope|stat|period|direction -> best row
  const bucketStatMap = new Map(); // key: team|scope|stat|period|direction -> { [bucketLabel]: row }
  const overallAggMap = new Map(); // key: team|scope|stat|period|direction -> agg över alla odds
  const teamScopes = new Set(); // key: team|scope

  for (const doc of allDocs) {
    if (!Array.isArray(doc.lines)) continue;

    for (const line of doc.lines) {
      if (line.actual == null) continue;
      const statKey = normalizeStatKeyName(line.statKey);
      if (!statKey || !PROPS.includes(statKey)) continue;
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

      const isOver = condition === 'over';
      const win = isOver ? deviation > 0 : deviation < 0;
      const matchKey = doc.matchId || doc.eventId || doc.slug || `${doc.homeTeam}-${doc.awayTeam}-${doc.matchDate || doc.date || ''}`;

      // Hämta/bygg agg
      if (!buckets.has(bucketLabel)) buckets.set(bucketLabel, new Map());
      const statMap = buckets.get(bucketLabel);
      if (!statMap.has(statKey)) statMap.set(statKey, new Map());
      const periodMap = statMap.get(statKey);
      if (!periodMap.has(period)) periodMap.set(period, new Map());
      const scopeMap = periodMap.get(period);
      if (!scopeMap.has(line.scope)) scopeMap.set(line.scope, new Map());
      const teamMap = scopeMap.get(line.scope);
      if (!teamMap.has(teamName)) teamMap.set(teamName, initAgg(bucketLabel, statKey, period, line.scope, teamName));
      const agg = teamMap.get(teamName);
      const dirAgg = getDirAgg(agg, condition);

      dirAgg.total += 1;
      dirAgg.matches.add(matchKey);
      dirAgg.sumDev += deviation;
      dirAgg.sumLine += line.line ?? 0;
      if (win) {
        dirAgg.wins += 1;
        dirAgg.pnl += (Number.isFinite(odds) ? odds - 1 : 0);
      } else {
        dirAgg.pnl -= 1;
      }
      if (Number.isFinite(odds)) {
        dirAgg.sumOdds += odds;
        dirAgg.sumImplied += 1 / odds;
      }

      // Aggregera även över alla odds (overall)
      const overallKey = `${teamName}__${line.scope}__${statKey}__${period}__${condition}`;
      if (!overallAggMap.has(overallKey)) {
        overallAggMap.set(overallKey, initAgg('ALL', statKey, period, line.scope, teamName));
      }
      const overallAgg = overallAggMap.get(overallKey);
      const overallDirAgg = getDirAgg(overallAgg, condition);
      overallDirAgg.total += 1;
      overallDirAgg.matches.add(matchKey);
      overallDirAgg.sumDev += deviation;
      overallDirAgg.sumLine += line.line ?? 0;
      if (win) {
        overallDirAgg.wins += 1;
        overallDirAgg.pnl += (Number.isFinite(odds) ? odds - 1 : 0);
      } else {
        overallDirAgg.pnl -= 1;
      }
      if (Number.isFinite(odds)) {
        overallDirAgg.sumOdds += odds;
        overallDirAgg.sumImplied += 1 / odds;
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
            for (const [, dirAgg] of agg.directions.entries()) {
              if (dirAgg.total < MIN_SAMPLE) continue;
              if (dirAgg.matches.size < MIN_MATCHES) continue;
              const winPct = (dirAgg.wins / dirAgg.total) * 100;
              const avgOdds = dirAgg.sumOdds / dirAgg.total;
              const avgImplied = dirAgg.sumImplied > 0 ? (dirAgg.sumImplied / dirAgg.total) * 100 : null;
              const hitDiff = avgImplied != null ? winPct - avgImplied : null;
              const roi = dirAgg.total > 0 ? (dirAgg.pnl / dirAgg.total) * 100 : null;
              const bias = dirAgg.total > 0 ? dirAgg.sumDev / dirAgg.total : null;
              const avgLine = dirAgg.total > 0 ? dirAgg.sumLine / dirAgg.total : null;
              const relBias = avgLine ? (bias / avgLine) * 100 : null;
              rows.push({
                team: agg.team,
                stat: statKey,
                period,
                scope,
                bucket: label,
                direction: dirAgg.direction,
                winPct,
                total: dirAgg.total,
                matches: dirAgg.matches.size,
                wins: dirAgg.wins,
                avgOdds,
                avgImplied,
                hitDiff,
                roi,
                bias,
                relBias,
              });
            }
          }
        }
      }
    }

    if (rows.length === 0) continue;
    rows.forEach(r => { r.factor = r.matches >= MIN_MATCHES ? scoreRow(r) : null; });

    const overRows = rows.filter(r => r.direction === 'over').sort((a, b) => (b.factor ?? 0) - (a.factor ?? 0) || b.winPct - a.winPct || (b.hitDiff ?? 0) - (a.hitDiff ?? 0) || b.total - a.total);
    const underRows = rows.filter(r => r.direction === 'under').sort((a, b) => (b.factor ?? 0) - (a.factor ?? 0) || b.winPct - a.winPct || (b.hitDiff ?? 0) - (a.hitDiff ?? 0) || b.total - a.total);

    const widths = {
      team: 23,
      stat: 14,
      per: 4,
      scope: 5,
      dir: 5,
      nLines: 8,
      nMatches: 10,
      win: 6,
      diff: 6,
      roi: 6,
      odds: 8,
      imp: 6,
      bias: 6,
      relBias: 7,
      factor: 8,
    };

    const header = [
      'Team'.padEnd(widths.team),
      'Stat'.padEnd(widths.stat),
      'Per'.padEnd(widths.per),
      'Scope'.padEnd(widths.scope),
      'Dir'.padEnd(widths.dir),
      'N lines'.padStart(widths.nLines),
      'N matches'.padStart(widths.nMatches),
      'Win%'.padStart(widths.win),
      'Diff'.padStart(widths.diff),
      'ROI%'.padStart(widths.roi),
      'AvgOdds'.padStart(widths.odds),
      'Imp%'.padStart(widths.imp),
      'Bias'.padStart(widths.bias),
      'RelBias%'.padStart(widths.relBias),
      'Factor'.padStart(widths.factor),
    ].join(' | ');

    const sep = '-'.repeat(header.length);

    function printTable(title, arr) {
      if (!arr.length) return;
      console.log(`\n${'='.repeat(header.length)}`);
      console.log(`🎯 Bucket ${label} – ${title} (min ${MIN_SAMPLE} lines och ${MIN_MATCHES} matcher, sorterat på Factor)`);
      console.log(`${'='.repeat(header.length)}`);
      console.log(header);
      console.log(sep);
      for (let i = 0; i < Math.min(20, arr.length); i++) {
        const r = arr[i];
        const lineStr = [
          r.team.padEnd(widths.team),
          r.stat.padEnd(widths.stat),
          String(r.period).padEnd(widths.per),
          r.scope.padEnd(widths.scope),
          r.direction.padEnd(widths.dir),
          String(r.total).padStart(widths.nLines),
          String(r.matches).padStart(widths.nMatches),
          r.winPct.toFixed(1).padStart(widths.win),
          (r.hitDiff != null ? r.hitDiff.toFixed(1) : 'n/a').padStart(widths.diff),
          (r.roi != null ? r.roi.toFixed(1) : 'n/a').padStart(widths.roi),
          (r.avgOdds ?? 0).toFixed(2).padStart(widths.odds),
          (r.avgImplied ?? 0).toFixed(1).padStart(widths.imp),
          (r.bias != null ? r.bias.toFixed(2) : 'n/a').padStart(widths.bias),
          (r.relBias != null ? r.relBias.toFixed(1) : 'n/a').padStart(widths.relBias),
          (r.factor != null ? r.factor.toFixed(1) : 'n/a').padStart(widths.factor),
        ].join(' | ');
        console.log(lineStr);

        // Uppdatera bästa per lag/scope/direction
        if (r.factor != null) {
          const dirKey = `${r.team}__${r.scope}__${r.direction}`;
          const prevDir = bestOverallMap.get(dirKey);
          if (!prevDir || (r.factor ?? -Infinity) > (prevDir.factor ?? -Infinity)) {
            bestOverallMap.set(dirKey, r);
          }
        }
        // Uppdatera bästa per lag/scope/stat/period/direction (för senare strukturell sparning)
        const statKey = `${r.team}__${r.scope}__${r.stat}__${r.period}__${r.direction}`;
        const prevStat = bestStatMap.get(statKey);
        if (!prevStat || ((r.factor ?? -Infinity) > (prevStat.factor ?? -Infinity))) {
          bestStatMap.set(statKey, r);
        }
        teamScopes.add(`${r.team}__${r.scope}`);

        // Spara per-bucket entry
        const bucketKey = `${r.team}__${r.scope}__${r.stat}__${r.period}__${r.direction}`;
        if (!bucketStatMap.has(bucketKey)) {
          bucketStatMap.set(bucketKey, {});
        }
        bucketStatMap.get(bucketKey)[r.bucket] = r;
      }
    }

    printTable('OVER', overRows);
    printTable('UNDER', underRows);
  }

  // Bygg overall-rader (alla odds) för varje stat/period/scope/team/direction
  const overallRows = new Map(); // key: team|scope|stat|period|direction -> row
  for (const [key, agg] of overallAggMap.entries()) {
    for (const [, dirAgg] of agg.directions.entries()) {
      if (dirAgg.total < MIN_SAMPLE) continue;
      if (dirAgg.matches.size < MIN_MATCHES) continue;
      const winPct = (dirAgg.wins / dirAgg.total) * 100;
      const avgOdds = dirAgg.sumOdds / dirAgg.total;
      const avgImplied = dirAgg.sumImplied > 0 ? (dirAgg.sumImplied / dirAgg.total) * 100 : null;
      const hitDiff = avgImplied != null ? winPct - avgImplied : null;
      const relBias = dirAgg.sumLine ? (dirAgg.sumDev / dirAgg.sumLine) * 100 : null;
      const bias = dirAgg.sumDev / dirAgg.total;
      const roi = (dirAgg.pnl / dirAgg.total) * 100;
      const r = {
        bucket: 'ALL',
        stat: agg.stat,
        period: agg.period,
        scope: agg.scope,
        team: agg.team,
        direction: dirAgg.direction,
        total: dirAgg.total,
        wins: dirAgg.wins,
        matches: dirAgg.matches.size,
        winPct,
        hitDiff,
        roi,
        bias,
        relBias,
        avgOdds,
        avgImplied,
        factor: null,
      };
      r.factor = scoreRow(r);
      overallRows.set(`${agg.team}__${agg.scope}__${agg.stat}__${agg.period}__${dirAgg.direction}`, r);
      const dirKey = `${agg.team}__${agg.scope}__${dirAgg.direction}`;
      const prevDir = bestOverallMap.get(dirKey);
      if (!prevDir || ((r.factor ?? -Infinity) > (prevDir.factor ?? -Infinity))) {
        bestOverallMap.set(dirKey, r);
      }
    }
  }

  if (saveProfiles && (bestOverallMap.size > 0 || bestStatMap.size > 0)) {
    console.log('\n💾 Saving scew factors to teamprofiles...');
    const db = client.db(process.env.MONGODB_DB || 'app');
    const teamprofilesCol = db.collection('teamprofiles');
    const ops = [];
    const now = new Date();

    // Helper to build neutral payload
    const neutral = {
      scewScore: 0,
      direction: null,
      factor: null,
      bucket: null,
      winPct: null,
      hitDiff: null,
      roi: null,
      bias: null,
      relBias: null,
      nLines: 0,
      nMatches: 0,
      avgOdds: null,
      avgImplied: null,
      updatedAt: now,
    };

    // Prepare per team/scope stats structure
    for (const teamScope of teamScopes) {
      const [teamName, scope] = teamScope.split('__');
      const docFilter = { 'meta.lagnamn': teamName, 'meta.matchType': scope };

      const updatePayload = {};
      const unsetPayload = { scew: "" };

      for (const stat of PROPS) {
        for (const period of PERIODS) {
          const overKey = `${teamName}__${scope}__${stat}__${period}__over`;
          const underKey = `${teamName}__${scope}__${stat}__${period}__under`;
          const overRow = overallRows.get(overKey);
          const underRow = overallRows.get(underKey);

          const pickRow = (() => {
            const overFactor = overRow?.factor ?? -Infinity;
            const underFactor = underRow?.factor ?? -Infinity;
            if (!Number.isFinite(overFactor) && !Number.isFinite(underFactor)) return null;
            return overFactor >= underFactor ? { row: overRow, direction: 'over' } : { row: underRow, direction: 'under' };
          })();

          const scewEntry = (() => {
            if (!pickRow?.row) return { ...neutral };
            const { row, direction } = pickRow;
            return {
              scewScore: toScewScore(row, direction),
              direction,
              factor: row.factor ?? null,
              bucket: row.bucket ?? null,
              winPct: row.winPct ?? null,
              hitDiff: row.hitDiff ?? null,
              roi: row.roi ?? null,
              bias: row.bias ?? null,
              relBias: row.relBias ?? null,
              nLines: row.total ?? 0,
              nMatches: row.matches ?? 0,
              avgOdds: row.avgOdds ?? null,
              avgImplied: row.avgImplied ?? null,
              updatedAt: now,
            };
          })();

          const path = `statistics.for.${stat}.${period}.scew`;
          updatePayload[path] = scewEntry;
          // Per-bucket entries (för odds-bucket match)
          const bucketOver = bucketStatMap.get(overKey) || {};
          const bucketUnder = bucketStatMap.get(underKey) || {};
          const mergedBuckets = { ...bucketOver, ...bucketUnder };
          const cleanedBuckets = {};
          for (const [blabel, brow] of Object.entries(mergedBuckets)) {
            if (!brow) continue;
            cleanedBuckets[blabel] = {
              scewScore: toScewScore(brow, brow.direction),
              direction: brow.direction,
              factor: brow.factor ?? null,
              bucket: brow.bucket ?? blabel,
              winPct: brow.winPct ?? null,
              hitDiff: brow.hitDiff ?? null,
              roi: brow.roi ?? null,
              bias: brow.bias ?? null,
              relBias: brow.relBias ?? null,
              nLines: brow.total ?? 0,
              nMatches: brow.matches ?? 0,
              avgOdds: brow.avgOdds ?? null,
              avgImplied: brow.avgImplied ?? null,
              updatedAt: now,
            };
          }
          if (Object.keys(cleanedBuckets).length) {
            updatePayload[`statistics.for.${stat}.${period}.scewBuckets`] = cleanedBuckets;
          }
        }
      }
      updatePayload['statistics.scewUpdatedAt'] = now;

      ops.push({
        updateOne: {
          filter: docFilter,
          update: {
            $set: updatePayload,
            $unset: unsetPayload,
          },
        }
      });
    }

    if (ops.length) {
      const res = await teamprofilesCol.bulkWrite(ops, { ordered: false });
      console.log(`   ✅ Scew factors saved (matched: ${res.matchedCount}, modified: ${res.modifiedCount})`);
    } else {
      console.log('   ℹ️  No scew factors to save');
    }
  }

  console.log('\n✅ Klar');
  await client.close();
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
