/**
 * Analyze which formulas predict favorable odds movement
 * Compares all opening predictions vs current odds
 *
 * Logic:
 * 1. For all matches with snapshots, compare opening vs current odds
 * 2. When current odds < opening odds, odds "dropped" (favorable movement)
 * 3. Count which formulas had +EV at opening for favorable movements
 * 4. Formula with highest % = best at predicting market agreement
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config({ path: './.env.local' });

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
  // Add ML formulas dynamically
];

async function analyzeClosingOdds() {
  console.log('🔍 Starting closing odds analysis...\n');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI not found');
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  console.log('✅ Connected to MongoDB\n');

  const db = client.db(process.env.MONGODB_DB || 'app');
  // Try different collections that might have snapshots
  const collections = ['ai-generated-bets', 'matches', 'snapshots'];
  let matches = [];

  for (const colName of collections) {
    try {
      const col = db.collection(colName);
      // Find documents with snapshots array containing multiple items
      const docs = await col.find({
        'snapshots.1': { $exists: true } // Has at least 2 snapshots
      }).toArray();

      if (docs.length > 0) {
        console.log(`📊 Found ${docs.length} matches with multiple snapshots in '${colName}' collection`);
        matches = docs;
        break;
      }
    } catch (e) {
      // Collection doesn't exist or error
    }
  }
  console.log(`📊 Found ${matches.length} matches with multiple snapshots\n`);

  // Stats tracking
  const formulaStats = {};
  FORMULA_KEYS.forEach(key => {
    formulaStats[key] = {
      totalBets: 0,
      marketWins: 0, // Closing odds moved favorably
      predictedWins: 0, // Formula had +EV AND market moved favorably
    };
  });

  let totalComparisons = 0;

  for (const match of matches) {
    const snapshots = match.snapshots;

    if (!Array.isArray(snapshots) || snapshots.length < 2) continue;

    // Compare opening snapshot vs current/latest lines (root level)
    const openingSnapshot = snapshots[0];
    const currentLines = match.lines; // Root lines = latest

    if (!openingSnapshot.lines?.length || !currentLines?.length) continue;

    // Compare each opening bet with corresponding closing bet
    for (const openingBet of openingSnapshot.lines) {
      // Find matching current bet (same stat/scope/period/direction/line)
      const currentBet = currentLines.find(cb =>
        cb.statKey === openingBet.statKey &&
        cb.scope === openingBet.scope &&
        cb.period === openingBet.period &&
        cb.direction === openingBet.direction &&
        Math.abs(cb.line - openingBet.line) < 0.1 // Allow small line differences
      );

      if (!currentBet) continue;

      const openingOdds = openingBet.odds;
      const currentOdds = currentBet.odds;

      if (!openingOdds || !currentOdds) continue;

      totalComparisons++;

      // Check if odds dropped (current odds < opening odds = market moved favorably)
      const oddsDropped = currentOdds < openingOdds;

      // Debug: log some examples
      if (totalComparisons < 5) {
        console.log(`Example: ${openingBet.statKey} ${openingBet.direction} ${openingBet.line} - Opening: ${openingOdds}, Current: ${currentOdds}, Odds dropped: ${oddsDropped}`);
      }

      // Check which formulas had +EV at opening
      FORMULA_KEYS.forEach(formulaKey => {
        const evValue = openingBet[formulaKey];
        if (evValue != null && typeof evValue === 'number') {
          formulaStats[formulaKey].totalBets++;

          if (oddsDropped) {
            formulaStats[formulaKey].marketWins++;

            if (evValue > 0) {
              formulaStats[formulaKey].predictedWins++;
            }
          }
        }
      });
    }
  }

  console.log(`📈 Total bet comparisons: ${totalComparisons}\n`);

  // Calculate success rates
  const results = Object.entries(formulaStats)
    .map(([formula, stats]) => ({
      formula,
      totalBets: stats.totalBets,
      marketWins: stats.marketWins,
      predictedWins: stats.predictedWins,
      successRate: stats.marketWins > 0 ? (stats.predictedWins / stats.marketWins * 100) : 0,
      coverage: totalComparisons > 0 ? (stats.totalBets / totalComparisons * 100) : 0
    }))
    .filter(r => r.totalBets > 0)
    .sort((a, b) => b.successRate - a.successRate);

  console.log('🏆 FORMULA SUCCESS AT PREDICTING FAVORABLE ODDS MOVEMENT:\n');
  console.log('Formula'.padEnd(25), 'Coverage'.padEnd(10), 'Odds Dropped'.padEnd(12), '+EV When Dropped'.padEnd(16), 'Success %');
  console.log('─'.repeat(75));

  results.forEach(r => {
    console.log(
      r.formula.padEnd(25),
      `${r.coverage.toFixed(1)}%`.padEnd(10),
      r.marketWins.toString().padEnd(12),
      r.predictedWins.toString().padEnd(16),
      `${r.successRate.toFixed(1)}%`
    );
  });

  // Save detailed results
  const output = {
    analysisDate: new Date().toISOString(),
    totalComparisons,
    totalMatches: matches.length,
    formulaResults: results
  };

  await fs.writeFile('closing_odds_analysis.json', JSON.stringify(output, null, 2));
  console.log('\n💾 Saved detailed results to closing_odds_analysis.json');

  await client.close();
  console.log('✅ Analysis complete!');
}

// Run if called directly
analyzeClosingOdds()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });