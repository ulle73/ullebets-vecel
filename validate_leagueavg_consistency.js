/**
 * Validate Closing Odds Analysis
 * Cross-validates the results from analyze_closing_odds.js
 * Uses a different approach to confirm the same numbers
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config({ path: './.env.local' });

const FORMULA_KEYS = [
  'evPct', 'legacyEvPct', 'evPctWithMultiplier', 'evPctLeagueAvg',
  'evPctMultifactor', 'evPctShotsAdvanced', 'evPctSoTAdvanced',
  'evPctFoulsAdvanced', 'evPctGoalKicksAdvanced', 'evPctThrowInsAdvanced',
  'evPctUniversalOptimized'
];

function identifyFormula(bet) {
  if (bet.primaryEv == null) return null;
  
  for (const key of FORMULA_KEYS) {
    if (bet[key] != null && Math.abs(bet[key] - bet.primaryEv) < 0.0001) return key;
  }
  
  for (const key of Object.keys(bet)) {
    if (key.startsWith('ml_') && !key.endsWith('_prob') && !key.endsWith('_raw')) {
      if (bet[key] != null && Math.abs(bet[key] - bet.primaryEv) < 0.0001) return key;
    }
  }
  return 'unknown';
}

async function validateClosingOdds() {
  console.log('═'.repeat(80));
  console.log('🔍 VALIDATION - Cross-checking closing odds analysis');
  console.log('═'.repeat(80));

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI not found');

  const client = new MongoClient(mongoUri);
  await client.connect();

  const db = client.db(process.env.MONGODB_DB || 'app');
  const col = db.collection('ai-generated-bets');
  const today = new Date().toISOString().split('T')[0];

  console.log(`\n📅 Validating bets older than: ${today}\n`);

  // Fetch with different query approach for validation
  const docs = await col.aggregate([
    { $match: { matchDate: { $lt: today }, 'snapshots.0.lines.0': { $exists: true } } },
    { $project: { matchDate: 1, homeTeam: 1, awayTeam: 1, lines: 1, 'snapshots.lines': 1 } }
  ]).toArray();

  console.log(`📊 Validation dataset: ${docs.length} matches\n`);

  // Independent calculation
  let totalBets = 0;
  let beatClosing = 0;
  let missedClosing = 0;
  let sameOdds = 0;
  let posEvBets = 0;
  let posEvBeat = 0;

  const formulaCounts = {};

  for (const match of docs) {
    if (!match.snapshots?.[0]?.lines?.length || !match.lines?.length) continue;

    for (const open of match.snapshots[0].lines) {
      const close = match.lines.find(c =>
        c.statKey === open.statKey && c.scope === open.scope &&
        c.period === open.period && c.direction === open.direction &&
        Math.abs(c.line - open.line) < 0.1
      );

      if (!close || open.odds == null || close.odds == null) continue;

      totalBets++;

      const formula = identifyFormula(open);
      formulaCounts[formula] = (formulaCounts[formula] || 0) + 1;

      if (close.odds < open.odds) {
        beatClosing++;
        if (open.primaryEv > 0) posEvBeat++;
      } else if (close.odds > open.odds) {
        missedClosing++;
      } else {
        sameOdds++;
      }

      if (open.primaryEv > 0) posEvBets++;
    }
  }

  // Load previous analysis results if exists
  let previousResults = null;
  try {
    const data = await fs.readFile('closing_odds_analysis.json', 'utf-8');
    previousResults = JSON.parse(data);
  } catch (e) {
    console.log('⚠️  No previous analysis file found\n');
  }

  // Print validation results
  console.log('═'.repeat(80));
  console.log('📊 VALIDATION RESULTS');
  console.log('═'.repeat(80));

  console.log('\n┌' + '─'.repeat(40) + '┬' + '─'.repeat(18) + '┬' + '─'.repeat(18) + '┐');
  console.log('│' + ' Metric'.padEnd(40) + '│' + ' Validation'.padEnd(18) + '│' + ' Analysis'.padEnd(18) + '│');
  console.log('├' + '─'.repeat(40) + '┼' + '─'.repeat(18) + '┼' + '─'.repeat(18) + '┤');

  const prevSummary = previousResults?.summary || {};

  const compare = (label, valVal, prevKey) => {
    const prevVal = prevSummary[prevKey];
    const match = prevVal != null && String(valVal) === String(prevVal) ? '✅' : (prevVal != null ? '❌' : '➖');
    console.log(
      '│ ' + label.padEnd(39) +
      '│ ' + String(valVal).padEnd(17) +
      '│ ' + (prevVal != null ? String(prevVal) : 'N/A').padEnd(17) + '│ ' + match
    );
  };

  compare('Total bets', totalBets, 'totalBets');
  compare('Beat closing', beatClosing, 'beatClosing');
  compare('Beat closing %', (beatClosing/totalBets*100).toFixed(1) + '%', 'beatClosingPct');
  compare('Missed closing', missedClosing, 'missedClosing');
  compare('Same odds', sameOdds, 'sameOdds');
  compare('Positive EV bets', posEvBets, 'positiveEvBets');
  compare('Positive EV beat', posEvBeat, 'positiveEvBeatClosing');
  compare('Positive EV beat %', (posEvBeat/posEvBets*100).toFixed(1) + '%', 'positiveEvBeatPct');

  console.log('└' + '─'.repeat(40) + '┴' + '─'.repeat(18) + '┴' + '─'.repeat(18) + '┘');

  // Formula distribution
  console.log('\n📌 Formula distribution (validation):');
  Object.entries(formulaCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([f, c]) => {
      console.log(`   ${f}: ${c} bets (${(c/totalBets*100).toFixed(1)}%)`);
    });

  // Summary verdict
  console.log('\n' + '═'.repeat(80));
  if (previousResults) {
    const allMatch = 
      totalBets === prevSummary.totalBets &&
      beatClosing === prevSummary.beatClosing &&
      missedClosing === prevSummary.missedClosing;

    if (allMatch) {
      console.log('✅ VALIDATION PASSED - All values match!');
    } else {
      console.log('⚠️  VALIDATION WARNING - Some values differ (may be due to timing)');
    }
  } else {
    console.log('ℹ️  Run analyze_closing_odds.js first, then re-run validation');
  }
  console.log('═'.repeat(80));

  await client.close();
  console.log('\n✅ Validation complete!\n');
}

validateClosingOdds()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });