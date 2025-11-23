import { fetchTeamProfilesBundle } from "./data.js";
import { fetchLeaguesAndTeams } from "./data.js";

/**
 * Extract all available drivers (features) for a match prediction
 * @param {string} homeTeam 
 * @param {string} awayTeam 
 * @param {Array} homeHistory - Historical matches for home team
 * @param {Array} awayHistory - Historical matches for away team
 * @param {string} statKey - The stat to predict
 * @param {Object} weights - WMA weights for historical data
 * @returns {Object} All drivers with their values
 */
export async function extractDrivers(homeTeam, awayTeam, homeHistory, awayHistory, statKey, weights = { recent: 3, medium: 2, old: 1 }) {
  // Fetch team profiles and Opta data
  const [homeBundle, awayBundle, leaguesData] = await Promise.all([
    fetchTeamProfilesBundle(homeTeam),
    fetchTeamProfilesBundle(awayTeam),
    fetchLeaguesAndTeams(),
  ]);

  // Extract Opta data
  const homeOpta = findTeamOpta(homeTeam, leaguesData);
  const awayOpta = findTeamOpta(awayTeam, leaguesData);

  const drivers = {
    // 1. Historical WMA
    wma_home: calculateStatWMA(homeTeam, homeHistory, statKey, true, weights),
    wma_away: calculateStatWMA(awayTeam, awayHistory, statKey, false, weights),
    
    // 2. Team Quality (Opta)
    opta_rank_diff: (homeOpta?.rank || 0) - (awayOpta?.rank || 0),
    opta_rating_diff: (homeOpta?.rating || 0) - (awayOpta?.rating || 0),
    
    // 3. Rank For/Against from teamprofile
    home_rank_for_all: homeBundle?.ALL?.rankFor || 0,
    away_rank_against_all: awayBundle?.ALL?.rankAgainst || 0,
    matchup_score: (homeBundle?.ALL?.rankFor || 1) / (awayBundle?.ALL?.rankAgainst || 1),
    
    // 4. Period-specific stats
    home_1h: homeBundle?.["1H"]?.[statKey] || 0,
    home_2h: homeBundle?.["2H"]?.[statKey] || 0,
    away_1h: awayBundle?.["1H"]?.[statKey] || 0,
    away_2h: awayBundle?.["2H"]?.[statKey] || 0,
    
    // 5. Context
    home_advantage: 1, // Always 1 for home team prediction
  };

  return drivers;
}

/**
 * Find team's Opta data in leaguesData
 */
function findTeamOpta(teamName, leaguesData) {
  if (!leaguesData) return null;
  
  for (const leagueKey in leaguesData) {
    const league = leaguesData[leagueKey];
    if (Array.isArray(league)) {
      const team = league.find(t => 
        (t.name || t.teamName || "").toLowerCase() === teamName.toLowerCase()
      );
      if (team) {
        return {
          rank: team.optaRank || team.rank,
          rating: team.optaRating || team.rating
        };
      }
    }
  }
  return null;
}

/**
 * Calculate WMA for a specific stat from historical matches
 */
function calculateStatWMA(teamName, history, statKey, isHome, weights) {
  if (!history || history.length === 0) return 0;
  
  let totalValue = 0;
  let totalWeight = 0;
  
  const sortedHistory = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
  
  for (let i = 0; i < Math.min(30, sortedHistory.length); i++) {
    const match = sortedHistory[i];
    if (!match.matchDetails?.statistics?.[0]?.groups) continue;
    
    // Determine weight based on recency
    let weight = weights.old;
    if (i < 5) weight = weights.recent;
    else if (i < 15) weight = weights.medium;
    
    // Extract stat value
    const groups = match.matchDetails.statistics[0].groups;
    const matchIsHome = match.homeTeamName?.toLowerCase().includes(teamName.toLowerCase());
    
    for (const group of groups) {
      const item = group.statisticsItems?.find(x => x.key === statKey);
      if (item) {
        const value = matchIsHome ? parseFloat(item.homeValue || 0) : parseFloat(item.awayValue || 0);
        totalValue += value * weight;
        totalWeight += weight;
        break;
      }
    }
  }
  
  return totalWeight > 0 ? totalValue / totalWeight : 0;
}

/**
 * Apply multi-factor formula with given weights
 * @param {Object} drivers - All driver values
 * @param {Object} weights - Weight for each driver
 * @param {number} bias - Bias term
 * @returns {number} Predicted value
 */
export function applyMultiFactorFormula(drivers, weights, bias = 0) {
  let prediction = bias;
  
  for (const [driverName, driverValue] of Object.entries(drivers)) {
    const weight = weights[driverName] || 0;
    prediction += driverValue * weight;
  }
  
  return prediction;
}
