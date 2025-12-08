/**
 * Analyze Closing Odds - Which formula beats closing odds?
 * 
 * For EACH formula, check if that formula had +EV at opening
 * and whether the odds dropped (favorable movement = beating closing)
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config({ path: './.env.local' });

async function analyzeClosingOdds() {
  console.log('🔍 Starting closing odds analysis...\n');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI not found');

  const client = new MongoClient(mongoUri);
  await client.connect();
  console.log('✅ Connected to MongoDB\n');

  const db = client.db(process.env.MONGODB_DB || 'app');
  const col = db.collection('ai-generated-bets');

  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 Analyzing bets older than: ${today}\n`);

  const docs = await col.find({
    matchDate: { $lt: today },
    'snapshots.0': { $exists: true }
  }).toArray();

  console.log(`📊 Found ${docs.length} matches with snapshots\n`);

  // Collect all unique formula keys from the data
  const formulaKeys = new Set();
  for (const match of docs) {
    const snapshots = match.snapshots;
    const closingLines = match.lines;
    if (snapshots?.length) {
      const openingBets = snapshots[0].lines || [];
      for (const bet of openingBets) {
        Object.keys(bet).forEach(key => {
          if (key.startsWith('evPct') || key === 'legacyEvPct' || key.startsWith('ml_')) {
            formulaKeys.add(key);
          }
        });
      }
    }
    if (closingLines?.length) {
      for (const bet of closingLines) {
        Object.keys(bet).forEach(key => {
          if (key.startsWith('evPct') || key === 'legacyEvPct' || key.startsWith('ml_')) {
            formulaKeys.add(key);
          }
        });
      }
    }
  }
  const FORMULA_KEYS = Array.from(formulaKeys).sort();

  console.log(`📈 Found ${FORMULA_KEYS.length} formula keys: ${FORMULA_KEYS.join(', ')}\n`);

  // Stats per formula - track ALL formulas independently
  const formulaStats = {};
  FORMULA_KEYS.forEach(key => {
    formulaStats[key] = {
      totalBets: 0,        // Bets where this formula has a value
      oddsDropped: 0,      // Closing < Opening (favorable)
      oddsSame: 0,         // Closing = Opening
      oddsIncreased: 0,    // Closing > Opening (unfavorable)
      positiveEvBets: 0,   // Bets where this formula was +EV
      positiveEvDropped: 0, // +EV bets where odds dropped
      positiveEvSame: 0,    // +EV bets where odds stayed same
      positiveEvIncreased: 0 // +EV bets where odds increased
    };
  });

  let totalComparisons = 0;

  for (const match of docs) {
    const snapshots = match.snapshots;
    const closingLines = match.lines;

    if (!snapshots?.length || !closingLines?.length) continue;

    const openingBets = snapshots[0].lines || [];

    for (const openBet of openingBets) {
      const closeBet = closingLines.find(cb =>
        cb.statKey === openBet.statKey &&
        cb.scope === openBet.scope &&
        cb.period === openBet.period &&
        cb.direction === openBet.direction &&
        Math.abs(cb.line - openBet.line) < 0.1
      );

      if (!closeBet || openBet.odds == null || closeBet.odds == null) continue;

      const openOdds = openBet.odds;
      const closeOdds = closeBet.odds;

      totalComparisons++;

      // For EACH formula, check its performance
      for (const formulaKey of FORMULA_KEYS) {
        const evValue = openBet[formulaKey];
        if (evValue == null || typeof evValue !== 'number') continue;

        formulaStats[formulaKey].totalBets++;

        // Track odds movement
        if (closeOdds < openOdds) {
          formulaStats[formulaKey].oddsDropped++;
          if (evValue > 0) {
            formulaStats[formulaKey].positiveEvDropped++;
          }
        } else if (closeOdds > openOdds) {
          formulaStats[formulaKey].oddsIncreased++;
          if (evValue > 0) {
            formulaStats[formulaKey].positiveEvIncreased++;
          }
        } else {
          formulaStats[formulaKey].oddsSame++;
          if (evValue > 0) {
            formulaStats[formulaKey].positiveEvSame++;
          }
        }

        // Track +EV bets
        if (evValue > 0) {
          formulaStats[formulaKey].positiveEvBets++;
        }
      }
    }
  }

  console.log(`📈 Total bet comparisons: ${totalComparisons}\n`);

  // Calculate success rates and sort
  const results = Object.entries(formulaStats)
    .map(([formula, stats]) => ({
      formula,
      totalBets: stats.totalBets,
      oddsDropped: stats.oddsDropped,
      oddsSame: stats.oddsSame,
      oddsIncreased: stats.oddsIncreased,
      positiveEvBets: stats.positiveEvBets,
      positiveEvDropped: stats.positiveEvDropped,
      positiveEvSame: stats.positiveEvSame,
      positiveEvIncreased: stats.positiveEvIncreased,
      coverage: totalComparisons > 0 ? (stats.totalBets / totalComparisons * 100) : 0,
      // When odds drop, how often was formula +EV? (precision)
      successRate: stats.oddsDropped > 0 ? (stats.positiveEvDropped / stats.oddsDropped * 100) : 0,
      // When formula is +EV, how often do odds drop? (recall/prediction)
      predictRate: stats.positiveEvBets > 0 ? (stats.positiveEvDropped / stats.positiveEvBets * 100) : 0,
      sameRate: stats.positiveEvBets > 0 ? (stats.positiveEvSame / stats.positiveEvBets * 100) : 0,
      increaseRate: stats.positiveEvBets > 0 ? (stats.positiveEvIncreased / stats.positiveEvBets * 100) : 0
    }))
    .sort((a, b) => b.successRate - a.successRate);

  // Print header table
  console.log('🏆 FORMULA SUCCESS AT PREDICTING FAVORABLE ODDS MOVEMENT:\n');
  console.log(
    'Formula'.padEnd(25),
    'Coverage'.padEnd(10),
    'Odds Dropped'.padEnd(13),
    '+EV When Dropped'.padEnd(17),
    'Success %'
  );
  console.log('─'.repeat(80));

  results.forEach(r => {
    console.log(
      r.formula.padEnd(25),
      `${r.coverage.toFixed(1)}%`.padEnd(10),
      r.oddsDropped.toString().padEnd(13),
      r.positiveEvDropped.toString().padEnd(17),
      `${r.successRate.toFixed(1)}%`
    );
  });

  // NEW: Prediction rate table
  console.log('\n' + '═'.repeat(80));
  console.log('🎯 WHEN FORMULA SHOWS +EV, HOW OFTEN DO ODDS DROP?');
  console.log('═'.repeat(80));

  const sortedByPredictRate = [...results].sort((a, b) => b.predictRate - a.predictRate);

  console.log('\n' +
    'Formula'.padEnd(25),
    '+EV Bets'.padEnd(10),
    'Dropped (%)'.padEnd(16),
    'Same (%)'.padEnd(16),
    'Increased (%)'
  );
  console.log('─'.repeat(90));

  sortedByPredictRate.forEach(r => {
    const droppedStr = `${r.positiveEvDropped} (${r.predictRate.toFixed(1)}%)`;
    const sameStr = `${r.positiveEvSame} (${r.sameRate.toFixed(1)}%)`;
    const increasedStr = `${r.positiveEvIncreased} (${r.increaseRate.toFixed(1)}%)`;

    console.log(
      r.formula.padEnd(25),
      r.positiveEvBets.toString().padEnd(10),
      droppedStr.padEnd(16),
      sameStr.padEnd(16),
      increasedStr
    );
  });

  // Detailed per-formula breakdown
  console.log('\n' + '═'.repeat(80));
  console.log('📊 DETAILED BREAKDOWN PER FORMULA');
  console.log('═'.repeat(80));

  console.log('\n' +
    'Formula'.padEnd(25),
    'Total'.padEnd(8),
    'Dropped'.padEnd(10),
    'Same'.padEnd(8),
    'Increased'.padEnd(10),
    '+EV Bets'.padEnd(10),
    '+EV Drop'
  );
  console.log('─'.repeat(90));

  results.forEach(r => {
    console.log(
      r.formula.padEnd(25),
      r.totalBets.toString().padEnd(8),
      r.oddsDropped.toString().padEnd(10),
      r.oddsSame.toString().padEnd(8),
      r.oddsIncreased.toString().padEnd(10),
      r.positiveEvBets.toString().padEnd(10),
      r.positiveEvDropped.toString()
    );
  });

  // Save detailed results
  const output = {
    analysisDate: new Date().toISOString(),
    totalComparisons,
    totalMatches: docs.length,
    formulaResults: results
  };

  await fs.writeFile('closing_odds_analysis.json', JSON.stringify(output, null, 2));
  console.log('\n💾 Saved detailed results to closing_odds_analysis.json');

  await client.close();
  console.log('✅ Analysis complete!');
}

analyzeClosingOdds()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });