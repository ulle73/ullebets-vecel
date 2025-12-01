/**
 * Correct Unibet Backtest Results
 * 
 * This script fetches completed matches from MongoDB collection unibet-backtest
 * and updates them with actual results from teamstats collection.
 */

import clientPromise from '../lib/mongo.js';
import { toDateStr } from '../lib/core/date.js';

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
  goalKicks: 'goalKicks'
};

// -------------------- Statistik-extraktion (from inspo) --------------
function getStatisticsBlocks(match) {
  if (!match) return [];

  // Format 1: matchDetails.statistics is array
  if (match.matchDetails && Array.isArray(match.matchDetails.statistics)) {
    return match.matchDetails.statistics;
  }

  // Format 2: matchDetails is array directly
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

  // Other variants
  if (Array.isArray(match.statistics)) return match.statistics;
  if (Array.isArray(match.matchStatistics)) return match.matchStatistics;
  if (Array.isArray(match.stats)) return match.stats;

  // Sometimes as object { ALL: {...}, "1ST": {...}, ... }
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
  if (!blocks.length) return 0; // Default to 0 if no data

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
  return 0; // Default to 0 if stat not found (e.g., no yellow cards = 0)
}

// ---------------------- Find match in teamstats -------------------------
async function findMatchInTeamStats(homeTeam, awayTeam, matchDate, teamstatsCol) {
  const dateStr = toDateStr(matchDate);
  if (!dateStr) return null;

  // Try home team's stats first
  const homeStats = await teamstatsCol.findOne({
    '_importMeta.teamName': { $regex: new RegExp(`^${homeTeam}$`, 'i') },
    '_importMeta.teamRole': 'home'
  });

  if (homeStats?.full) {
    const homeMatch = homeStats.full.find(m => {
      const mDate = toDateStr(m.date || m.matchDate || m.timestamp);
      if (!mDate) return false;
      const isCorrectDate = mDate === dateStr;
      const isCorrectOpponent = 
        m.awayTeamName?.toLowerCase() === awayTeam.toLowerCase();
      
      return isCorrectDate && isCorrectOpponent;
    });

    if (homeMatch) {
      console.log(`  ✅ Found home match (matchId: ${homeMatch.matchId})`);
      
      // Now find the away side using matchId
      const awayStats = await teamstatsCol.findOne({
        '_importMeta.teamName': { $regex: new RegExp(`^${awayTeam}$`, 'i') },
        '_importMeta.teamRole': 'away'
      });
      
      const awayMatch = awayStats?.full?.find(m => m.matchId === homeMatch.matchId);
      
      if (awayMatch) {
        console.log(`  ✅ Found away match (same matchId)`);
      } else {
        console.log(`  ⚠️  Away match not found for matchId ${homeMatch.matchId}`);
      }
      
      return { homeMatch, awayMatch };
    }
  }

  // Fallback: try finding via away team first
  const awayStats = await teamstatsCol.findOne({
    '_importMeta.teamName': { $regex: new RegExp(`^${awayTeam}$`, 'i') },
    '_importMeta.teamRole': 'away'
  });

  if (awayStats?.full) {
    const awayMatch = awayStats.full.find(m => {
      const mDate = toDateStr(m.date || m.matchDate || m.timestamp);
      if (!mDate) return false;
      const isCorrectDate = mDate === dateStr;
      const isCorrectOpponent = 
        m.homeTeamName?.toLowerCase() === homeTeam.toLowerCase();
      
      return isCorrectDate && isCorrectOpponent;
    });

    if (awayMatch) {
      console.log(`  ✅ Found away match (matchId: ${awayMatch.matchId})`);
      
      // Find home side using matchId
      const homeStatsRetry = await teamstatsCol.findOne({
        '_importMeta.teamName': { $regex: new RegExp(`^${homeTeam}$`, 'i') },
        '_importMeta.teamRole': 'home'
      });
      
      const homeMatch = homeStatsRetry?.full?.find(m => m.matchId === awayMatch.matchId);
      
      if (homeMatch) {
        console.log(`  ✅ Found home match (same matchId)`);
      }
      
      return { homeMatch, awayMatch };
    }
  }

  return null;
}

// ---------------------- Correct a single match -------------------------
async function correctMatch(backtestDoc, teamstatsCol) {
  const { homeTeam, awayTeam, matchDate, lines } = backtestDoc;
  
  console.log(`\nCorrecting: ${homeTeam} vs ${awayTeam} (${matchDate})`);

  // Find the actual match data
  const matchData = await findMatchInTeamStats(homeTeam, awayTeam, matchDate, teamstatsCol);
  
  if (!matchData || (!matchData.homeMatch && !matchData.awayMatch)) {
    console.log(`  ⚠️  Match not found in teamstats`);
    return { corrected: false, reason: 'not_found' };
  }

  const { homeMatch, awayMatch } = matchData;

  let correctedCount = 0;
  let failedCount = 0;
  const updatedLines = [];
  const failures = {}; // Track why things fail

  // Process each line
  for (const bet of lines) {
    const statKey = STAT_KEY_MAP[bet.statKey] || bet.statKey;
    const over = bet.condition === 'över' || bet.condition === 'over';

    let actual = null;
    let failReason = null;

    if (bet.scope === 'total') {
      const homeVal = homeMatch ? extractStat(homeMatch, statKey, bet.period, 'home') : null;
      const awayVal = awayMatch ? extractStat(awayMatch, statKey, bet.period, 'away') : null;

      if (homeVal == null || awayVal == null) {
        failReason = `total: homeVal=${homeVal}, awayVal=${awayVal}, awayMatch=${!!awayMatch}`;
        failedCount++;
        const key = `${bet.scope}_${statKey}_${bet.period}`;
        failures[key] = (failures[key] || 0) + 1;
        updatedLines.push({ ...bet, actual: null, win: null });
        continue;
      }
      actual = homeVal + awayVal;

    } else if (bet.scope === 'home') {
      const homeVal = homeMatch ? extractStat(homeMatch, statKey, bet.period, 'home') : null;
      if (homeVal == null) {
        failReason = `home: homeVal=null`;
        failedCount++;
        const key = `${bet.scope}_${statKey}_${bet.period}`;
        failures[key] = (failures[key] || 0) + 1;
        updatedLines.push({ ...bet, actual: null, win: null });
        continue;
      }
      actual = homeVal;

    } else if (bet.scope === 'away') {
      const awayVal = awayMatch ? extractStat(awayMatch, statKey, bet.period, 'away') : null;
      if (awayVal == null) {
        failReason = `away: awayVal=null, awayMatch=${!!awayMatch}`;
        failedCount++;
        const key = `${bet.scope}_${statKey}_${bet.period}`;
        failures[key] = (failures[key] || 0) + 1;
        updatedLines.push({ ...bet, actual: null, win: null });
        continue;
      }
      actual = awayVal;

    } else {
      console.log(`  ⚠️  Unknown scope: ${bet.scope}`);
      updatedLines.push({ ...bet, actual: null, win: null });
      continue;
    }

    const win = over ? actual > bet.line : actual < bet.line;

    updatedLines.push({
      ...bet,
      actual,
      win
    });

    correctedCount++;
  }

  console.log(`  ✅ Corrected ${correctedCount}/${lines.length} lines`);
  if (failedCount > 0) {
    console.log(`  ⚠️  Failed ${failedCount} lines:`);
    const top5 = Object.entries(failures)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    top5.forEach(([key, count]) => {
      console.log(`     ${key}: ${count} failures`);
    });
  }

  return {
    corrected: true,
    updatedLines,
    correctedCount
  };
}

// ---------------------- Main function -------------------------
async function main() {
  console.log('🔍 Starting Unibet Backtest Correction...\n');

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || 'app');
  
  const backtestCol = db.collection('unibet-backtest');
  const teamstatsCol = db.collection('teamstats');

  // Get all matches that haven't been corrected yet
  const matches = await backtestCol.find({
    'lines.actual': null
  }).toArray();

  console.log(`Found ${matches.length} matches to correct\n`);

  let successCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;

  for (const match of matches) {
    try {
      const result = await correctMatch(match, teamstatsCol);
      
      if (result.corrected) {
        // Update in database
        await backtestCol.updateOne(
          { _id: match._id },
          { $set: { lines: result.updatedLines } }
        );
        successCount++;
      } else {
        if (result.reason === 'not_found') {
          notFoundCount++;
        }
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      errorCount++;
    }
  }

  console.log('\n📊 Correction Summary:');
  console.log(`  ✅ Successfully corrected: ${successCount}`);
  console.log(`  ⚠️  Match not found: ${notFoundCount}`);
  console.log(`  ❌ Errors: ${errorCount}`);
  console.log(`  Total processed: ${matches.length}`);

  await client.close();
  console.log('\n✅ Done!');
}

// Run
main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
