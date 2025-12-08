/**
 * Analyze which formula was used as primaryEv and how often it beats closing odds
 * 
 * Logic:
 * 1. Fetch all bets older than today from ai-generated-bets
 * 2. For snapshots[0].lines[0].primaryEv, find which formula matches that EXACT value
 * 3. Get the opening odds from snapshots[0].lines[0].odds
 * 4. Compare with closing odds in root lines[0].odds
 * 5. Analyze how often closing odds are beaten, and which formula beats closing most often
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config({ path: './.env.local' });

// All formula keys to check against primaryEv
const FORMULA_KEYS = [
  'evPct',
  'legacyEvPct',
  'evPctWithMultiplier',
  'evPctLeagueAvg',
  'evPctMultifactor',
  'evPctShotsAdvanced',
  'evPctSoTAdvanced',
  'evPctFoulsAdvanced',
  'evPctGoalKicksAdvanced',
  'evPctThrowInsAdvanced',
  'evPctUniversalOptimized',
];

// Dynamic ML formula patterns
const ML_FORMULA_PATTERN = /^ml_/;

/**
 * Find which formula matches the primaryEv value exactly
 */
function identifyPrimaryFormula(bet) {
  const primaryEv = bet.primaryEv;
  if (primaryEv == null) return null;

  // Check standard formulas
  for (const key of FORMULA_KEYS) {
    const value = bet[key];
    if (value != null && Math.abs(value - primaryEv) < 0.0001) {
      return key;
    }
  }

  // Check ML formulas dynamically
  for (const key of Object.keys(bet)) {
    if (ML_FORMULA_PATTERN.test(key) && !key.endsWith('_prob') && !key.endsWith('_raw')) {
      const value = bet[key];
      if (value != null && Math.abs(value - primaryEv) < 0.0001) {
        return key;
      }
    }
  }

  return 'unknown';
}

async function analyzePrimaryFormulaClosing() {
  console.log('🔍 Analyzing primary formula vs closing odds...\n');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI not found');
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  console.log('✅ Connected to MongoDB\n');

  const db = client.db(process.env.MONGODB_DB || 'app');
  const col = db.collection('ai-generated-bets');

  // Get today's date in YYYY-MM-DD format
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 Today: ${today}`);
  console.log(`📅 Fetching matches older than today...\n`);

  // Fetch all bets with matchDate before today and with snapshots
  const docs = await col.find({
    matchDate: { $lt: today },
    'snapshots.0': { $exists: true }
  }).toArray();

  console.log(`📊 Found ${docs.length} matches older than today with snapshots\n`);

  // Stats tracking
  const formulaStats = {};
  const detailedResults = [];

  let totalBets = 0;
  let betsWithPositiveOpeningEv = 0;
  let closingOddsDropped = 0; // Current odds < opening odds (favorable movement)
  let closingOddsIncreased = 0; // Current odds > opening odds
  let closingOddsSame = 0;

  for (const match of docs) {
    const snapshots = match.snapshots;
    const currentLines = match.lines; // Root lines = closing/latest odds

    if (!Array.isArray(snapshots) || snapshots.length === 0) continue;
    if (!currentLines?.length) continue;

    const openingSnapshot = snapshots[0];
    if (!openingSnapshot.lines?.length) continue;

    for (const openingBet of openingSnapshot.lines) {
      // Find matching closing bet in root lines
      const closingBet = currentLines.find(cb =>
        cb.statKey === openingBet.statKey &&
        cb.scope === openingBet.scope &&
        cb.period === openingBet.period &&
        cb.direction === openingBet.direction &&
        Math.abs(cb.line - openingBet.line) < 0.1
      );

      if (!closingBet) continue;

      const openingOdds = openingBet.odds;
      const closingOdds = closingBet.odds;
      const primaryEv = openingBet.primaryEv;

      if (openingOdds == null || closingOdds == null || primaryEv == null) continue;

      totalBets++;

      // Identify which formula was used as primaryEv
      const formula = identifyPrimaryFormula(openingBet);

      // Initialize formula stats if needed
      if (!formulaStats[formula]) {
        formulaStats[formula] = {
          totalBets: 0,
          positiveEvBets: 0, // primaryEv > 0
          closingBeaten: 0, // Closing odds dropped (favorable for bettor)
          closingWorse: 0, // Closing odds increased (unfavorable)
          avgOddsChange: 0,
          sumOddsChange: 0,
        };
      }

      formulaStats[formula].totalBets++;

      // Track positive EV bets
      if (primaryEv > 0) {
        betsWithPositiveOpeningEv++;
        formulaStats[formula].positiveEvBets++;
      }

      // Calculate odds change
      const oddsChange = closingOdds - openingOdds;
      formulaStats[formula].sumOddsChange += oddsChange;

      // Classify the outcome
      // "Beating closing odds" means: you got BETTER odds at opening than closing
      // If closing odds DROPPED (became lower), the opening odds were better
      if (closingOdds < openingOdds) {
        closingOddsDropped++;
        formulaStats[formula].closingBeaten++;
      } else if (closingOdds > openingOdds) {
        closingOddsIncreased++;
        formulaStats[formula].closingWorse++;
      } else {
        closingOddsSame++;
      }

      // Store detailed result for analysis
      if (primaryEv > 0) {
        detailedResults.push({
          matchId: match.matchId,
          matchDate: match.matchDate,
          statKey: openingBet.statKey,
          scope: openingBet.scope,
          direction: openingBet.direction,
          line: openingBet.line,
          formula,
          primaryEv,
          openingOdds,
          closingOdds,
          oddsChange,
          beatClosing: closingOdds < openingOdds,
        });
      }
    }
  }

  // Calculate averages
  Object.keys(formulaStats).forEach(formula => {
    const stats = formulaStats[formula];
    stats.avgOddsChange = stats.totalBets > 0 ? stats.sumOddsChange / stats.totalBets : 0;
    stats.beatRate = stats.totalBets > 0 ? (stats.closingBeaten / stats.totalBets * 100) : 0;
    stats.beatRatePositiveEv = stats.positiveEvBets > 0 ? 
      (detailedResults.filter(r => r.formula === formula && r.beatClosing).length / stats.positiveEvBets * 100) : 0;
  });

  // Sort formulas by beat rate
  const sortedFormulas = Object.entries(formulaStats)
    .map(([formula, stats]) => ({ formula, ...stats }))
    .filter(f => f.totalBets >= 5) // At least 5 bets to be included
    .sort((a, b) => b.beatRate - a.beatRate);

  // Print summary
  console.log('=' .repeat(100));
  console.log('📊 SUMMARY');
  console.log('=' .repeat(100));
  console.log(`Total bets analyzed: ${totalBets}`);
  console.log(`Bets with positive primaryEv at opening: ${betsWithPositiveOpeningEv} (${(betsWithPositiveOpeningEv/totalBets*100).toFixed(1)}%)`);
  console.log(`\nClosing odds movement:`);
  console.log(`  - Dropped (beat closing): ${closingOddsDropped} (${(closingOddsDropped/totalBets*100).toFixed(1)}%)`);
  console.log(`  - Increased (worse): ${closingOddsIncreased} (${(closingOddsIncreased/totalBets*100).toFixed(1)}%)`);
  console.log(`  - Same: ${closingOddsSame} (${(closingOddsSame/totalBets*100).toFixed(1)}%)`);

  console.log('\n' + '=' .repeat(100));
  console.log('🏆 FORMULA PERFORMANCE - CLOSING ODDS BEAT RATE');
  console.log('=' .repeat(100));
  console.log(
    'Formula'.padEnd(30),
    'Total'.padEnd(8),
    '+EV'.padEnd(8),
    'Beat Closing'.padEnd(14),
    'Beat %'.padEnd(10),
    'Avg Δ Odds'
  );
  console.log('─'.repeat(100));

  sortedFormulas.forEach(f => {
    console.log(
      f.formula.padEnd(30),
      f.totalBets.toString().padEnd(8),
      f.positiveEvBets.toString().padEnd(8),
      f.closingBeaten.toString().padEnd(14),
      `${f.beatRate.toFixed(1)}%`.padEnd(10),
      f.avgOddsChange.toFixed(3)
    );
  });

  // Break down by +EV only
  console.log('\n' + '=' .repeat(100));
  console.log('🎯 POSITIVE EV BETS ONLY - WHICH FORMULAS BEAT CLOSING MOST?');
  console.log('=' .repeat(100));

  const positiveEvByFormula = {};
  detailedResults.forEach(r => {
    if (!positiveEvByFormula[r.formula]) {
      positiveEvByFormula[r.formula] = { total: 0, beatClosing: 0 };
    }
    positiveEvByFormula[r.formula].total++;
    if (r.beatClosing) {
      positiveEvByFormula[r.formula].beatClosing++;
    }
  });

  const sortedPositiveEv = Object.entries(positiveEvByFormula)
    .map(([formula, stats]) => ({
      formula,
      total: stats.total,
      beatClosing: stats.beatClosing,
      beatRate: (stats.beatClosing / stats.total * 100)
    }))
    .filter(f => f.total >= 3)
    .sort((a, b) => b.beatRate - a.beatRate);

  console.log(
    'Formula'.padEnd(30),
    '+EV Bets'.padEnd(12),
    'Beat Closing'.padEnd(14),
    'Beat %'
  );
  console.log('─'.repeat(70));

  sortedPositiveEv.forEach(f => {
    console.log(
      f.formula.padEnd(30),
      f.total.toString().padEnd(12),
      f.beatClosing.toString().padEnd(14),
      `${f.beatRate.toFixed(1)}%`
    );
  });

  // Show some examples
  console.log('\n' + '=' .repeat(100));
  console.log('📝 SAMPLE POSITIVE EV BETS (first 10)');
  console.log('=' .repeat(100));

  detailedResults.slice(0, 10).forEach((r, i) => {
    const status = r.beatClosing ? '✅ BEAT' : '❌ WORSE';
    console.log(`${i + 1}. ${r.matchDate} | ${r.statKey} ${r.scope} ${r.direction} ${r.line}`);
    console.log(`   Formula: ${r.formula} | EV: ${r.primaryEv.toFixed(2)}%`);
    console.log(`   Opening: ${r.openingOdds} → Closing: ${r.closingOdds} (Δ ${r.oddsChange.toFixed(2)}) ${status}`);
    console.log('');
  });

  // Save results
  const output = {
    analysisDate: new Date().toISOString(),
    summary: {
      totalBets,
      betsWithPositiveOpeningEv,
      closingOddsDropped,
      closingOddsIncreased,
      closingOddsSame,
      overallBeatRate: (closingOddsDropped / totalBets * 100).toFixed(2) + '%'
    },
    formulaPerformance: sortedFormulas,
    positiveEvPerformance: sortedPositiveEv,
    detailedResults: detailedResults.slice(0, 100) // Save first 100 for reference
  };

  await fs.writeFile('primary_formula_closing_analysis.json', JSON.stringify(output, null, 2));
  console.log('\n💾 Saved detailed results to primary_formula_closing_analysis.json');

  await client.close();
  console.log('✅ Analysis complete!');
}

// Run if called directly
analyzePrimaryFormulaClosing()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
