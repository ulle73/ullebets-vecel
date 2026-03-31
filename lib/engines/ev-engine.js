/**
 * @fileoverview EV Engine - Expected Value calculation orchestration.
 * Wraps existing lib/backtest/engine.js with data prep and caching.
 * 
 * @module lib/engines/ev-engine
 */

import { calculateEVFromData } from '../backtest/engine.js';
import { fetchTeamProfilesBundle, fetchTeamMatches } from '../backtest/data.js';
import { pickPrimaryEvSelection } from '../backtest/primaryEvSelection.js';

// Team data cache to avoid redundant DB queries
const teamDataCache = new Map();

/**
 * Ensure team data is loaded and cached.
 * 
 * @param {string} teamName - Team name
 * @returns {Promise<Object>} Team data { profiles, homeMatches, awayMatches }
 */
async function ensureTeamData(teamName) {
  if (!teamDataCache.has(teamName)) {
    const [profiles, homeMatches, awayMatches] = await Promise.all([
      fetchTeamProfilesBundle(teamName),
      fetchTeamMatches(teamName, 'home'),
      fetchTeamMatches(teamName, 'away'),
    ]);
    
    teamDataCache.set(teamName, {
      profiles,
      homeMatches,
      awayMatches,
    });
  }
  
  return teamDataCache.get(teamName);
}

/**
 * Calculate EV for a single bet.
 * 
 * @param {Object} betParams - Bet parameters
 * @param {string} betParams.homeTeam - Home team name
 * @param {string} betParams.awayTeam - Away team name
 * @param {string} betParams.stat - Statistic type
 * @param {string} betParams.scope - Scope ('home'|'away'|'total')
 * @param {string} betParams.period - Period ('ALL'|'1ST'|'2ND')
 * @param {number} betParams.line - Line value
 * @param {boolean} betParams.over - True for over, false for under
 * @param {number} betParams.odds - Decimal odds
 * @param {string} [betParams.form='all'] - Form filter
 * @param {boolean} [betParams.neutralGround=false] - Neutral ground
 * @param {number} [betParams.home_importance=5] - Home importance
 * @param {number} [betParams.away_importance=5] - Away importance
 * @param {Object} [options] - Options
 * @returns {Promise<Object>} EV calculation result
 * 
 * @example
 * const result = await calculateEvForBet({
 *   homeTeam: 'Arsenal',
 *   awayTeam: 'Chelsea',
 *   stat: 'cornerKicks',
 *   scope: 'total',
 *   period: 'ALL',
 *   line: 10.5,
 *   over: true,
 *   odds: 1.85,
 *   form: 'all',
 *   neutralGround: false,
 *   home_importance: 5,
 *   away_importance: 5
 * });
 */
export async function calculateEvForBet(betParams, options = {}) {
  const {
    homeTeam,
    awayTeam,
    stat,
    scope,
    period,
    line,
    over,
    odds,
    form = 'all',
    neutralGround = false,
    home_importance = 5,
    away_importance = 5,
  } = betParams;
  
  // Validate required params
  if (!homeTeam || !awayTeam) {
    throw new Error('homeTeam and awayTeam are required');
  }
  
  // Fetch team data (with caching)
  const [homeData, awayData] = await Promise.all([
    ensureTeamData(homeTeam),
    ensureTeamData(awayTeam),
  ]);
  
  // Build fetchedData object
  const fetchedData = {
    homeBundle: homeData.profiles,
    awayBundle: awayData.profiles,
    homeMatchesRaw: homeData.homeMatches,
    awayMatchesRaw: awayData.awayMatches,
  };
  
  // Build params for calculateEVFromData
  const params = {
    homeTeam,
    awayTeam,
    stat,
    scope,
    period,
    line,
    over,
    odds,
    form,
    neutralGround,
    home_importance,
    away_importance,
  };
  
  // Calculate EV
  const result = await calculateEVFromData(params, fetchedData);
  
  // Extract primary EV value
  const evDetails = collectEvDetails(result);
  const primaryEv = resolvePrimaryEvValue(evDetails, betParams);
  
  return {
    ...result,
    evDetails,
    value: primaryEv,
  };
}

/**
 * Calculate EV for multiple bets (batch processing).
 * Uses shared team data cache for efficiency.
 * 
 * @param {Array} betsArray - Array of bet parameter objects
 * @param {Object} [options] - Options
 * @param {boolean} [options.parallel=true] - Process in parallel
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<Array>} Array of EV results
 */
export async function calculateEvForBets(betsArray, options = {}) {
  const { parallel = true, onProgress } = options;
  
  if (!Array.isArray(betsArray) || betsArray.length === 0) {
    return [];
  }
  
  if (parallel) {
    // Parallel processing
    let completed = 0;
    return await Promise.all(
      betsArray.map(async (bet) => {
        try {
          const result = await calculateEvForBet(bet);
          completed++;
          if (onProgress) onProgress(completed, betsArray.length);
          return { success: true, bet, result };
        } catch (error) {
          completed++;
          if (onProgress) onProgress(completed, betsArray.length);
          return { success: false, bet, error: error.message };
        }
      })
    );
  } else {
    // Sequential processing
    const results = [];
    for (let i = 0; i < betsArray.length; i++) {
      try {
        const result = await calculateEvForBet(betsArray[i]);
        results.push({ success: true, bet: betsArray[i], result });
      } catch (error) {
        results.push({ success: false, bet: betsArray[i], error: error.message });
      }
      
      if (onProgress) onProgress(i + 1, betsArray.length);
    }
    return results;
  }
}

/**
 * Collect all EV-related details from result.
 * 
 * @param {Object} result - Result from calculateEVFromData
 * @returns {Object} EV details
 */
function collectEvDetails(result) {
  if (!result || typeof result !== 'object') return {};
  
  const evDetails = {};
  for (const [key, value] of Object.entries(result)) {
    if (
      key.startsWith('evPct') ||
      key === 'legacyEvPct' ||
      key.includes('Ev') ||
      key.startsWith('ml_')
    ) {
      const numericValue = toNumber(value);
      if (numericValue !== null) {
        evDetails[key] = numericValue;
      }
    }
  }
  return evDetails;
}

/**
 * Resolve primary EV value using preferred order.
 * 
 * @param {Object} evDetails - EV details object
 * @returns {number|null} Primary EV value
 */
function resolvePrimaryEvValue(evDetails, context = {}) {
  if (!evDetails) return null;

  const selection = pickPrimaryEvSelection({
    evDetails,
    statKey: context?.stat ?? context?.statKey ?? context,
    scope: context?.scope ?? "total",
    period: context?.period ?? "ALL",
  });
  return selection.evPct;
}

/**
 * Convert value to number.
 * 
 * @param {*} value - Value to convert
 * @returns {number|null} Number or null
 */
function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/**
 * Clear team data cache.
 * Useful for freeing memory after large batch operations.
 */
export function clearTeamDataCache() {
  teamDataCache.clear();
}
