import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

/**
 * Calculate Historical Win Rates for Each Formula
 * 
 * Analyzes past unibet-backtest documents to determine which formulas
 * perform well in different contexts (league, statKey, scope, period).
 */

/**
 * Calculate win rates for all formulas
 * 
 * @param {Object} db - MongoDB database instance  
 * @param {string} statKey
 * @param {string} scope  
 * @param {string} period
 * @param {Date} beforeDate - Only analyze matches before this date
 * @param {number} limit - Number of historical matches to analyze
 * @returns {Object} - { formulaName: winRate }
 */
export async function calculateHistoricalWinRates(
  db,
  statKey,
  scope,
  period,
  beforeDate,
  limit = 50
) {
  const col = db.collection('unibet-backtest');
  
  // Find similar past matches (same statKey/scope/period)
  const matches = await col
    .find({
      matchDate: { $lt: beforeDate },
      'lines': {
        $elemMatch: {
          statKey,
          scope,
          period,
          win: { $ne: null } // Has been rättat
        }
      }
    })
    .sort({ matchDate: -1 })
    .limit(limit)
    .toArray();
  
  if (matches.length === 0) {
    return {};
  }
  
  // Aggregate wins/losses per formula
  const formulaStats = {};
  
  for (const match of matches) {
    const relevantLines = match.lines.filter(l =>
      l.statKey === statKey &&
      l.scope === scope &&
      l.period === period &&
      l.win !== null
    );
    
    for (const line of relevantLines) {
      if (!line.evDetails) continue;
      
      for (const [formulaName, evValue] of Object.entries(line.evDetails)) {
        if (typeof evValue !== 'number') continue;
        
        if (!formulaStats[formulaName]) {
          formulaStats[formulaName] = { wins: 0, total: 0 };
        }
        
        // Consider "high EV" bets (>5%) as predictions
        if (evValue > 5) {
          formulaStats[formulaName].total++;
          if (line.win) {
            formulaStats[formulaName].wins++;
          }
        }
      }
    }
  }
  
  // Calculate win rates
  const winRates = {};
  for (const [formulaName, stats] of Object.entries(formulaStats)) {
    if (stats.total >= 5) { // Need at least 5 bets for meaningful win rate
      winRates[`${formulaName}_win_rate_last_${limit}`] = stats.wins / stats.total;
    }
  }
  
  return winRates;
}

/**
 * Get best performing formula for a context
 */
export function getBestPerformer(winRates) {
  if (Object.keys(winRates).length === 0) return null;
  
  let bestFormula = null;
  let bestRate = 0;
  
  for (const [formulaKey, rate] of Object.entries(winRates)) {
    if (rate > bestRate) {
      bestRate = rate;
      bestFormula = formulaKey.replace(/_win_rate_last_\d+$/, '');
    }
  }
  
  return bestFormula;
}
