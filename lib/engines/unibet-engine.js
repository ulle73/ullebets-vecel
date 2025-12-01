/**
 * @fileoverview Unibet Engine - High-level Unibet odds orchestration.
 * 
 * CRITICAL: This engine MUST follow the EXACT pattern from `/api/backtest` route's
 * `handleAutoUnibetOdds()` function (app/api/backtest/route.js:150-198).
 * This is the PROVEN WORKING FLOW used by mainpage via LeagueTable.jsx.
 * 
 * @module lib/engines/unibet-engine
 */

import { findUnibetEvent, fetchUnibetOdds, buildEventOddsUrl } from '../repos/unibet.js';
import { UNIBET_EVENT_BASE_URL } from '../backtest/unibetAuto.js';
import mapUnibetOdds from '../../components/backtest/unibetOddsMapper.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Extract Unibet event ID from various input formats.
 * 
 * @param {string|number} eventId - Event ID (can be URL or plain ID)
 * @returns {string|null} Cleaned event ID or null
 */
function extractUnibetEventId(eventId) {
  if (!eventId) return null;
  
  const str = String(eventId).trim();
  if (!str) return null;
  
  // If it's a URL, extract the ID from the end
  if (str.includes('/')) {
    const parts = str.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  }
  
  return str;
}

/**
 * Get Unibet odds for a single match.
 * 
 * CRITICAL: This follows the EXACT flow from handleAutoUnibetOdds in /api/backtest.
 * Reference: app/api/backtest/route.js:150-198
 * 
 * Flow:
 * 1. If eventId provided directly, use it
 * 2. Find event via findUnibetEventForMatch
 * 3. If not found, retry with forceRefresh after 1500ms delay
 * 4. If still not found, throw
 * 5. Fetch odds for found eventId
 * 6. Map odds to tuples via unibetOddsMapper
 * 7. Return structured result
 * 
 * @param {Object} matchInfo - Match information
 * @param {string} [matchInfo.eventId] - Direct Unibet event ID (optional)
 * @param {string} matchInfo.homeTeam - Home team name
 * @param {string} matchInfo.awayTeam - Away team name
 * @param {string} [matchInfo.leagueName] - League name
 * @param {string|number} [matchInfo.timestamp] - Match timestamp
 * @param {Object} [options] - Options
 * @param {boolean} [options.includeRawOdds=false] - Include raw odds data
 * @returns {Promise<Object>} Unibet odds data with tuples
 * 
 * @example
 * const result = await getUnibetOddsForMatch({
 *   homeTeam: "Arsenal",
 *   awayTeam: "Chelsea",
 *   leagueName: "Premier League",
 *   timestamp: Date.now()
 * });
 * // Returns: { eventId, eventUrl, tuples, matched: {...} }
 */
export async function getUnibetOddsForMatch(matchInfo, options = {}) {
  const { includeRawOdds = false } = options;
  
  // CRITICAL CHANGE: Always do discovery, never trust eventId from database
  // This matches mainpage behavior exactly (app/api/backtest/route.js:150-198)
  
  // Step 1: Prepare search info
  const searchInfo = {
    homeTeam: matchInfo.homeTeam || matchInfo.homeTeamName,
    awayTeam: matchInfo.awayTeam || matchInfo.awayTeamName,
    leagueName: matchInfo.leagueName,
    timestamp: matchInfo.timestamp || matchInfo.kickoff || matchInfo.start,
  };
  
  if (!searchInfo.homeTeam || !searchInfo.awayTeam) {
    throw new Error('Saknar lag för automatisk Unibet-hämtning');
  }
  
  // Step 2: Find event via discovery
  let match = await findUnibetEvent(searchInfo);
  
  // Step 3: If not found, retry with forceRefresh after delay
  if (!match) {
    console.warn('[unibet-engine] Initial lookup miss, retrying with refresh', {
      league: searchInfo.leagueName,
      home: searchInfo.homeTeam,
      away: searchInfo.awayTeam,
    });
    
    await sleep(1500); // CRITICAL: Same delay as mainpage (1500ms)
    match = await findUnibetEvent(searchInfo, { forceRefresh: true });
  }
  
  // Step 4: If still not found, throw
  if (!match) {
    throw new Error('Kunde inte hitta match i Unibets listView');
  }
  
  // Step 5: Fetch odds for found eventId
  const oddsData = await fetchUnibetOdds(match.eventId);
  
  // Step 6: Map odds to tuples
  const tuples = mapUnibetOdds(
    oddsData.betOffers,
    match.homeTeam,
    match.awayTeam
  );
  
  // Step 7: Return structured result
  const result = {
    eventId: match.eventId,
    eventUrl: match.eventUrl,
    tuples,
    matched: {
      home: match.homeTeam,
      away: match.awayTeam,
      league: match.league,
      start: match.start,
    },
  };
  
  if (includeRawOdds) {
    result.rawOdds = oddsData;
  }
  
  return result;
}

/**
 * Get Unibet odds for multiple matches (batch processing).
 * 
 * @param {Array} matches - Array of match info objects
 * @param {Object} [options] - Options
 * @param {number} [options.concurrency=3] - Max concurrent requests
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<Array>} Array of results (successful and failed)
 * 
 * @example
 * const results = await getUnibetOddsForMatches(matches, {
 *   concurrency: 3,
 *   onProgress: (current, total) => console.log(`${current}/${total}`)
 * });
 */
export async function getUnibetOddsForMatches(matches, options = {}) {
  const { concurrency = 3, onProgress } = options;
  
  if (!Array.isArray(matches) || matches.length === 0) {
    return [];
  }
  
  const results = [];
  const queue = [...matches];
  let completed = 0;
  
  // Process with concurrency limit
  const processMatch = async (match) => {
    try {
      const result = await getUnibetOddsForMatch(match);
      results.push({ success: true, match, result });
    } catch (error) {
      console.error(`[unibet-engine] Failed for ${match.homeTeam} vs ${match.awayTeam}:`, error.message);
      results.push({ success: false, match, error: error.message });
    } finally {
      completed++;
      if (onProgress) {
        onProgress(completed, matches.length);
      }
    }
  };
  
  // Run with concurrency control
  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const match = queue.shift();
        if (match) {
          await processMatch(match);
        }
      }
    })());
  }
  
  await Promise.all(workers);
  
  return results;
}
