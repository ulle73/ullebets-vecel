sist/**
 * Debug ML predictions for specific matches
 * Run with: node debug_ml.js
 */

import { calculateEvForBet } from './lib/engines/ev-engine.js';

async function debugMLPrediction(homeTeam, awayTeam, statKey, scope, period, line, over, odds) {
  console.log(`\n=== DEBUG: ${homeTeam} vs ${awayTeam} - ${statKey}/${scope}/${period} ===`);

  const betParam = {
    homeTeam,
    awayTeam,
    stat: statKey,
    scope,
    period,
    line,
    over,
    odds,
    form: "all",
    neutralGround: false,
    home_importance: 5,
    away_importance: 5,
  };

  try {
    const result = await calculateEvForBet(betParam);
    console.log('Available formulas:');
    Object.keys(result).forEach(key => {
      if (key.startsWith('ml_') || key.startsWith('evPct')) {
        console.log(`  ${key}: ${result[key]}`);
      }
    });

    // Check if ML prediction exists
    const mlKey = `ml_${statKey}_${scope}_${period}`;
    if (result[mlKey]) {
      console.log(`\nML Prediction: ${result[mlKey]}`);
      console.log(`Realistic? ${result[mlKey] > 0 && result[mlKey] < 20 ? 'YES' : 'NO - EXTREME VALUE'}`);
    } else {
      console.log('\nNo ML prediction available');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Test the Pisa vs Parma cornerKicks case
debugMLPrediction('Pisa', 'Parma', 'cornerKicks', 'away', 'ALL', 6.5, true, 4.8);