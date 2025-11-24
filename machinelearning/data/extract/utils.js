/**
 * Utility functions for data extraction
 */

/**
 * Calculate Weighted Moving Average for a statistic
 * 
 * @param {Array} matches - Historical matches (sorted newest first)
 * @param {string} statKey - Statistic key to calculate
 * @param {number} window - Number of matches to include
 * @param {Date} beforeDate - Only include matches before this date
 * @param {string} mode - 'for' (own stats) or 'against' (opponent stats)
 * @returns {number} - WMA value
 */
export function calculateWMA(matches, statKey, window, beforeDate, mode = 'for') {
  if (!matches || matches.length === 0) return 0;
  
  // Filter matches before the given date
  const relevantMatches = matches
    .filter(m => {
      const matchDate = new Date(m.date || m.matchDate || m.timestamp);
      return matchDate < beforeDate;
    })
    .slice(0, window);
  
  if (relevantMatches.length === 0) return 0;
  
  // Calculate WMA with exponentially decaying weights
  let weightedSum = 0;
  let totalWeight = 0;
  
  for (let i = 0; i < relevantMatches.length; i++) {
    const weight = Math.pow(0.9, i); // Exponential decay
    const value = extractStatValue(relevantMatches[i], statKey, mode);
    
    weightedSum += value * weight;
    totalWeight += weight;
  }
  
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Extract stat value from match data
 * @param {string} mode - 'for' (own team) or 'against' (opponent)
 */
function extractStatValue(match, statKey, mode = 'for') {
  // Try matchDetails first
  if (match.matchDetails?.statistics) {
    // Handle both array and object formats
    const stats = Array.isArray(match.matchDetails.statistics)
      ? match.matchDetails.statistics
      : Object.values(match.matchDetails.statistics);
    
    for (const statGroup of stats) {
      if (!statGroup.groups) continue;
      
      for (const group of statGroup.groups) {
        const item = group.statisticsItems?.find(i => i.key === statKey);
        if (item) {
          // For home stats: FOR = homeValue, AGAINST = awayValue
          // For away stats: FOR = awayValue, AGAINST = homeValue
          const isHome = match._importMeta?.teamRole === 'home';
          let value;
          
          if (mode === 'for') {
            value = parseInt(isHome ? item.homeValue : item.awayValue || '0');
          } else { // 'against'
            value = parseInt(isHome ? item.awayValue : item.homeValue || '0');
          }
          
          return isNaN(value) ? 0 : value;
        }
      }
    }
  }
  
  // Try teamStats format
  if (match.teamStats?.[statKey]) {
    const value = parseInt(match.teamStats[statKey]);
    return isNaN(value) ? 0 : value;
  }
  
  return 0;
}

/**
 * Normalize team name for matching
 */
export function normalizeTeamName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate standard deviation
 */
export function stdDev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Calculate median
 */
export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
