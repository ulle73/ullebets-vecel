/**
 * Correct AI Generated Bets
 *
 * Copies the correction flow from correct-unibet-backtest but targets the
 * ai-generated-bets collection. It fills lines.actual and lines.win using data
 * from the teamstats collection.
 */

import clientPromise from '../lib/mongo.js';

// Stat key mapping (same as in inspo file)
const STAT_KEY_MAP = {
  totalShots: 'totalShotsOnGoal',
  shotsOnGoal: 'shotsOnGoal',
  cornerKicks: 'cornerKicks',
  yellowCards: 'yellowCards',
  throwIns: 'throwIns',
  freeKicks: 'freeKicks',
  fouls: 'fouls',
  offsides: 'offsides',
  goalKicks: 'goalKicks',
};

function getStatisticsBlocks(match) {
  if (!match) return [];

  if (match.matchDetails && Array.isArray(match.matchDetails.statistics)) {
    return match.matchDetails.statistics;
  }

  if (Array.isArray(match.matchDetails)) {
    return match.matchDetails
      .map((x) => {
        if (x && typeof x === 'object') {
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

  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj).map(([period, data]) => ({
      period,
      groups: data?.groups || data || [],
    }));
  }

  return [];
}

function normPeriod(p) {
  if (!p) return 'ALL';
  const x = String(p).toUpperCase();
  if (x.includes('1ST')) return '1ST';
  if (x.includes('2ND')) return '2ND';
  if (x.includes('ALL') || x === 'FULL' || x === 'FT' || x.includes('MATCH')) return 'ALL';
  return x;
}

function readSideValue(item, side) {
  const cand = [
    side === 'home' ? 'homeValue' : 'awayValue',
    side,
    side === 'home' ? 'home_team' : 'away_team',
    side === 'home' ? 'homeTeam' : 'awayTeam',
    side === 'home' ? 'home_val' : 'away_val',
    'value',
  ];
  for (const k of cand) {
    if (item[k] != null) {
      const v = item[k];
      const n = typeof v === 'string' ? Number(v.replace(',', '.').replace('%', '')) : Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function keysEqualLoosely(a, b) {
  const A = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const B = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (A === B) return true;
  if (['corners', 'cornerkicks'].includes(A) && ['corners', 'cornerkicks'].includes(B)) return true;
  return false;
}

function extractStat(match, key, period, side) {
  const blocks = getStatisticsBlocks(match);
  if (!blocks.length) return 0;

  const want = normPeriod(period);
  let periodData = blocks.find((b) => normPeriod(b.period) === want);
  if (!periodData) periodData = blocks.find((b) => normPeriod(b.period) === 'ALL');
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
      const k = (it.key || it.name || it.stat || '').toString();
      if (!k) continue;
      if (keysEqualLoosely(k, key)) {
        return readSideValue(it, side);
      }
    }
  }
  return 0;
}

function toDateString(input) {
  if (input == null) return null;
  const num = Number(input);
  if (Number.isFinite(num)) {
    const ms = num > 2e10 ? num : num * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  if (typeof input === 'string' || input instanceof Date) {
    const d = new Date(input);
    if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return null;
}

function normalizeMatchIdCandidates(matchId) {
  if (matchId == null) return [];
  const str = String(matchId);
  const num = Number(matchId);
  const res = [str];
  if (Number.isFinite(num)) res.push(num);
  return res;
}

async function findMatchForLine(line, fallbackDate, teamstatsCol) {
  const candidates = normalizeMatchIdCandidates(line.matchId);
  let homeMatch = null;
  let awayMatch = null;

  // 1) Strict matchId lookup (string → number) using one indexed query with $elemMatch.
  //    We only need a single role doc (home OR away); processing later can work with one side.
  if (candidates.length) {
    const doc = await teamstatsCol.findOne(
      { 'full.matchId': { $in: candidates } },
      {
        projection: {
          full: { $elemMatch: { matchId: { $in: candidates } } },
          '_importMeta.teamRole': 1,
        },
      }
    );

    const match = doc?.full?.[0] || null;
    if (match) {
      if (doc?._importMeta?.teamRole === 'home') {
        homeMatch = match;
      } else {
        awayMatch = match;
      }
      return { homeMatch, awayMatch };
    }
    console.warn(`No teamstats match found for matchId candidates: ${candidates.join(', ')}`);
    return { homeMatch: null, awayMatch: null };
  }

  console.warn(
    `No matchId provided on line (betKey=${line.betKey || 'n/a'}) - skipping match lookup entirely`
  );
  return { homeMatch: null, awayMatch: null };
}

function resolveScope(scope) {
  const s = (scope || 'total').toString().toLowerCase();
  if (s === 'all') return 'total';
  return s;
}

function resolveDirection(direction) {
  const d = (direction || '').toString().toLowerCase();
  if (d.startsWith('u')) return 'under';
  return 'over';
}

async function correctLine(line, teamstatsCol, fallbackDate) {
  const statKey = STAT_KEY_MAP[line.statKey] || line.statKey;
  if (!statKey) {
    return { updatedLine: { ...line, actual: null, win: null }, reason: 'statKey_missing' };
  }

  const { homeMatch, awayMatch } = await findMatchForLine(line, fallbackDate, teamstatsCol);

  if (!homeMatch && !awayMatch) {
    return {
      updatedLine: { ...line, actual: null, win: null },
      reason: line.matchId ? `match_not_found_by_matchId_${line.matchId}` : 'match_not_found',
    };
  }

  const scope = resolveScope(line.scope);
  const lineValue = Number(line.line);
  const hasLineValue = Number.isFinite(lineValue);

  const homeSource = homeMatch || awayMatch;
  const awaySource = awayMatch || homeMatch;

  let actual = null;
  let reason = null;

  if (scope === 'total') {
    const homeVal = homeSource ? extractStat(homeSource, statKey, line.period, 'home') : null;
    const awayVal = awaySource ? extractStat(awaySource, statKey, line.period, 'away') : null;
    if (homeVal == null || awayVal == null) {
      reason = `missing_total_${statKey}_${line.period || 'ALL'}`;
    } else {
      actual = homeVal + awayVal;
    }
  } else if (scope === 'home') {
    const homeVal = homeSource ? extractStat(homeSource, statKey, line.period, 'home') : null;
    if (homeVal == null) {
      reason = `missing_home_${statKey}_${line.period || 'ALL'}`;
    } else {
      actual = homeVal;
    }
  } else if (scope === 'away') {
    const awayVal = awaySource ? extractStat(awaySource, statKey, line.period, 'away') : null;
    if (awayVal == null) {
      reason = `missing_away_${statKey}_${line.period || 'ALL'}`;
    } else {
      actual = awayVal;
    }
  } else {
    reason = `unknown_scope_${scope}`;
  }

  let win = null;
  if (actual != null && hasLineValue) {
    const direction = resolveDirection(line.direction);
    if (direction === 'over') {
      win = actual > lineValue;
    } else if (direction === 'under') {
      win = actual < lineValue;
    } else {
      reason = reason ?? 'direction_unknown';
    }
  } else if (actual != null && !hasLineValue) {
    reason = reason ?? 'line_missing';
  }

  const updatedLine = { ...line, actual, win };

  return { updatedLine, reason };
}

async function main() {
  console.log('Starting AI generated bets correction...');

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || 'app');

  const betsCol = db.collection('ai-generated-bets');
  const teamstatsCol = db.collection('teamstats');

  const docs = await betsCol
    .find({ 'lines.actual': { $in: [null, undefined] } })
    .toArray();

  console.log(`Found ${docs.length} documents to correct`);

  let docsUpdated = 0;
  let totalLines = 0;
  let correctedLines = 0;
  let failedLines = 0;
  const failureReasons = {};

  for (const doc of docs) {
    const fallbackDate = doc.date || doc.matchDate || doc.generatedAt || null;
    const updatedLines = [];

    for (const line of doc.lines || []) {
      totalLines += 1;
      const { updatedLine, reason } = await correctLine(line, teamstatsCol, fallbackDate);
      updatedLines.push(updatedLine);
      if (!reason && updatedLine.actual != null && updatedLine.win != null) {
        correctedLines += 1;
      } else {
        failedLines += 1;
        if (reason) {
          failureReasons[reason] = (failureReasons[reason] || 0) + 1;
        }
      }
    }

    await betsCol.updateOne({ _id: doc._id }, { $set: { lines: updatedLines } });
    docsUpdated += 1;
  }

  console.log('Correction summary:');
  console.log(`  Documents updated: ${docsUpdated}`);
  console.log(`  Lines processed: ${totalLines}`);
  console.log(`  Lines corrected: ${correctedLines}`);
  console.log(`  Lines failed: ${failedLines}`);

  const topFailures = Object.entries(failureReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (topFailures.length) {
    console.log('  Top failure reasons:');
    topFailures.forEach(([key, count]) => {
      console.log(`    ${key}: ${count}`);
    });
  }

  await client.close();
  console.log('Done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error in correct-ai-generated-bets:', err);
    process.exit(1);
  });
