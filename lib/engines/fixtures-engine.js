/**
 * @fileoverview Fixtures Engine - Match retrieval with DB/API fallback.
 * 
 * CRITICAL RULE: ALWAYS fetch from Database OR API. 
 * NEVER use Unibet listView as a data source for fixtures.
 * 
 * @module lib/engines/fixtures-engine
 */

import { getMatchesForDate, getMatchById, getMatchesByIds } from '../repos/fixtures.js';

/**
 * Get matches for a specific date with optional filtering.
 * 
 * Priority order:
 * 1. Database (match-for-date collection)
 * 2. API (/api/matches/by-date) as fallback
 * 3. NO Unibet listView - that's only for odds discovery
 * 
 * @param {string} date - YYYY-MM-DD
 * @param {Object} [options] - Options
 * @param {Array<string>} [options.leagues] - Filter by league names
 * @param {Function} [options.filter] - Custom filter function
 * @returns {Promise<Array>} Array of matches
 * 
 * @example
 * const matches = await getMatchesForDate('2024-11-28', {
 *   leagues: ['Premier League', 'La Liga']
 * });
 */
export async function getMatchesForDateFiltered(date, options = {}) {
  const { leagues, filter } = options;
  
  let matches = await getMatchesForDate(date);
  
  // Apply league filter
  if (leagues && Array.isArray(leagues) && leagues.length > 0) {
    const leagueSet = new Set(leagues.map(l => l.toLowerCase().trim()));
    matches = matches.filter(m => {
      const league = (m.leagueName || m.league?.name || '').toLowerCase().trim();
      return leagueSet.has(league);
    });
  }
  
  // Apply custom filter
  if (typeof filter === 'function') {
    matches = matches.filter(filter);
  }
  
  return matches;
}

/**
 * Get matches for multiple dates (batch fetch).
 * 
 * @param {Array<string>} dates - Array of YYYY-MM-DD dates
 * @param {Object} [options] - Options
 * @returns {Promise<Object>} Map of date => matches array
 * 
 * @example
 * const matchesByDate = await getMatchesForMultipleDates(['2024-11-28', '2024-11-29']);
 * // Returns: { '2024-11-28': [...], '2024-11-29': [...] }
 */
export async function getMatchesForMultipleDates(dates, options = {}) {
  if (!Array.isArray(dates) || dates.length === 0) {
    return {};
  }
  
  const results = {};
  
  // Fetch all dates in parallel
  await Promise.all(
    dates.map(async (date) => {
      try {
        const matches = await getMatchesForDateFiltered(date, options);
        results[date] = matches;
      } catch (error) {
        console.error(`[fixtures-engine] Failed to fetch ${date}:`, error.message);
        results[date] = [];
      }
    })
  );
  
  return results;
}

/**
 * Find a match by ID with enhanced error messaging.
 * 
 * @param {string|number} matchId - Match ID
 * @param {Object} [options] - Options
 * @param {number} [options.dayRange=7] - Days to search
 * @returns {Promise<Object|null>} Match or null
 */
export async function findMatchById(matchId, options = {}) {
  return await getMatchById(matchId, options);
}

/**
 * Find multiple matches by IDs with results grouped by found/notFound.
 * 
 * @param {Array} matchIds - Array of match IDs
 * @param {Object} [options] - Options
 * @returns {Promise<Object>} { found: [...], notFound: [...] }
 */
export async function findMatchesByIds(matchIds, options = {}) {
  if (!Array.isArray(matchIds) || matchIds.length === 0) {
    return { found: [], notFound: [] };
  }
  
  const found = await getMatchesByIds(matchIds, options);
  const foundIds = new Set(
    found.map(m => {
      const id = m.matchId || m.id || m.event?.id;
      return id ? String(id) : null;
    }).filter(Boolean)
  );
  
  const notFound = matchIds.filter(id => !foundIds.has(String(id)));
  
  return { found, notFound };
}

// Re-export for convenience
export { getMatchesForDate, getMatchById, getMatchesByIds };
