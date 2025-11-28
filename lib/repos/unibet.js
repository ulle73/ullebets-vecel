/**
 * @fileoverview Unibet API repository - centralized Unibet data access.
 * Thin wrapper around existing logic in lib/backtest/unibetAuto.js
 * 
 * @module lib/repos/unibet
 */

import { findUnibetEventForMatch as findEvent, UNIBET_EVENT_BASE_URL } from '../backtest/unibetAuto.js';

// Unibet API base URLs
const EVENT_ODDS_BASE_URL = "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event";
const LIST_VIEW_BASE_URL = UNIBET_EVENT_BASE_URL; // For listView

// Request headers for Unibet API
const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://www.unibet.se/",
  "X-Requested-With": "XMLHttpRequest",
};

/**
 * Find a Unibet event for a given match.
 * Wrapper around lib/backtest/unibetAuto.js:findUnibetEventForMatch
 * 
 * @param {Object} matchInfo - Match information
 * @param {string} matchInfo.homeTeam - Home team name
 * @param {string} matchInfo.awayTeam - Away team name
 * @param {string} [matchInfo.leagueName] - League name
 * @param {string|number} [matchInfo.timestamp] - Match timestamp
 * @param {Object} [options] - Options
 * @param {boolean} [options.forceRefresh=false] - Force refresh cache
 * @returns {Promise<Object|null>} Event data or null if not found
 * 
 * @example
 * const event = await findUnibetEvent({
 *   homeTeam: "Arsenal",
 *   awayTeam: "Chelsea",
 *   leagueName: "Premier League",
 *   timestamp: Date.now()
 * });
 * // Returns: { eventId, eventUrl, start, league, homeTeam, awayTeam }
 */
export async function findUnibetEvent(matchInfo, options = {}) {
  return await findEvent(matchInfo, options);
}

/**
 * Fetch Unibet odds for a specific event ID.
 * 
 * @param {string|number} eventId - Unibet event ID
 * @param {Object} [options] - Options
 * @returns {Promise<Object>} Odds data with betOffers and event
 * 
 * @example
 * const odds = await fetchUnibetOdds(1234567);
 * // Returns: { betOffers: [...], event: {...} }
 */
export async function fetchUnibetOdds(eventId, options = {}) {
  const url = buildEventOddsUrl(eventId);
  
  try {
    const response = await fetch(url, {
      headers: REQUEST_HEADERS,
      next: { revalidate: 60 }, // Cache for 1 minute
    });
    
    if (!response.ok) {
      throw new Error(`Unibet API returned ${response.status} for eventId ${eventId}`);
    }
    
    const data = await response.json();
    
    return {
      betOffers: data?.betOffers || [],
      event: data?.event || null,
    };
  } catch (error) {
    console.error(`[repo:unibet] fetchUnibetOdds(${eventId}) error:`, error.message);
    throw error;
  }
}

/**
 * Build a Unibet list view URL with required parameters.
 * 
 * @param {string} baseUrl - Base URL for the league
 * @returns {string} Complete URL with query parameters
 * 
 * @example
 * const url = buildListViewUrl("https://www.unibet.se/betting/sports/filter/football/england/premier_league");
 */
export function buildListViewUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set("lang", "sv_SE");
  url.searchParams.set("market", "SE");
  url.searchParams.set("client_id", "2");
  url.searchParams.set("channel_id", "1");
  url.searchParams.set("useCombined", "true");
  url.searchParams.set("ncid", Date.now().toString());
  return url.toString();
}

/**
 * Build a Unibet event odds URL for fetching betOffers.
 * 
 * @param {string|number} eventId - Unibet event ID
 * @param {Object} [params] - Additional parameters
 * @param {boolean} [params.includeParticipants=true] - Include participants in response
 * @returns {string} Complete URL with query parameters
 * 
 * @example
 * const url = buildEventOddsUrl(1234567);
 * // Returns: "https://eu1.offering-api.kambicdn.com/.../1234567.json?lang=sv_SE&..."
 */
export function buildEventOddsUrl(eventId, params = {}) {
  const { includeParticipants = true } = params;
  
  const url = new URL(`${EVENT_ODDS_BASE_URL}/${eventId}.json`);
  url.searchParams.set("lang", "sv_SE");
  url.searchParams.set("market", "SE");
  url.searchParams.set("client_id", "2");
  url.searchParams.set("channel_id", "3");
  
  if (includeParticipants) {
    url.searchParams.set("includeParticipants", "true");
  }
  
  url.searchParams.set("ncid", Date.now().toString());
  
  return url.toString();
}

/**
 * Fetch Unibet list view events for discovery.
 * Useful for finding all events in a league.
 * 
 * @param {string} baseUrl - League base URL
 * @param {Object} [options] - Options
 * @param {boolean} [options.forceRefresh=false] - Force refresh cache
 * @returns {Promise<Array>} Array of events
 */
export async function fetchUnibetListView(baseUrl, options = {}) {
  const url = buildListViewUrl(baseUrl);
  
  try {
    const response = await fetch(url, {
      headers: REQUEST_HEADERS,
      next: { revalidate: 300 }, // Cache for 5 minutes
    });
    
    if (!response.ok) {
      console.warn(`[repo:unibet] fetchUnibetListView failed: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const events = (data?.events || [])
      .map(entry => entry.event || entry)
      .filter(e => e?.id && e.homeName && e.awayName);
    
    return events;
  } catch (error) {
    console.error(`[repo:unibet] fetchUnibetListView error:`, error.message);
    return [];
  }
}

// Export constants
export { UNIBET_EVENT_BASE_URL, EVENT_ODDS_BASE_URL };
