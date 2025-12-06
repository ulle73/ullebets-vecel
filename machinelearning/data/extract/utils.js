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
 * @param {string} period - 'ALL', '1ST', or '2ND' - which period to extract stats from
 * @returns {number} - WMA value
 */
export function calculateWMA(matches, statKey, window, beforeDate, mode = 'for', period = 'ALL') {
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
    const value = extractStatValue(relevantMatches[i], statKey, mode, period);
    
    weightedSum += value * weight;
    totalWeight += weight;
  }
  
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Extract stat value from match data
 * @param {Object} match - Match object with matchDetails
 * @param {string} statKey - The statistic key to extract
 * @param {string} mode - 'for' (own team) or 'against' (opponent)
 * @param {string} period - 'ALL', '1ST', or '2ND'
 */
function extractStatValue(match, statKey, mode = 'for', period = 'ALL') {
  // Try matchDetails first
  if (match.matchDetails?.statistics) {
    // Handle both array and object formats
    const stats = Array.isArray(match.matchDetails.statistics)
      ? match.matchDetails.statistics
      : Object.values(match.matchDetails.statistics);
    
    // Find the correct period section
    const periodSection = stats.find(s => s.period === period) || stats.find(s => s.period === 'ALL');
    
    if (periodSection?.groups) {
      for (const group of periodSection.groups) {
        const item = group.statisticsItems?.find(i => i.key === statKey);
        if (item) {
          // For home stats: FOR = homeValue, AGAINST = awayValue
          // For away stats: FOR = awayValue, AGAINST = homeValue
          const isHome = match._importMeta?.teamRole === 'home';
          let value;
          
          if (mode === 'for') {
            value = parseFloat(isHome ? item.homeValue : item.awayValue) || 0;
          } else { // 'against'
            value = parseFloat(isHome ? item.awayValue : item.homeValue) || 0;
          }
          
          return isNaN(value) ? 0 : value;
        }
      }
    }
  }
  
  // Try teamStats format (only for ALL period)
  if (period === 'ALL' && match.teamStats?.[statKey]) {
    const value = parseFloat(match.teamStats[statKey]);
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
