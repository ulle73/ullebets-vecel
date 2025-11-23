import { fetchTeamMatches } from "./data.js";
import { runFormulas } from "./formulas/index.js";
import { calcTuple } from "./tuples.js";

// Default weights
const DEFAULT_WEIGHTS = {
  recent: 3,
  medium: 2,
  old: 1,
};

function getWeight(index, weights = DEFAULT_WEIGHTS) {
  if (index < 5) return weights.recent;
  if (index < 15) return weights.medium;
  return weights.old;
}

/**
 * Calculates weighted average stats for a specific team from a history of matches.
 */
function getTeamStatsWMA(teamName, historyMatches, weights) {
  const stats = {
    matchOverview: {
      ballPossession: 0,
      totalShotsOnGoal: 0,
      totalTackle: 0,
      bigChanceCreated: 0,
      cornerKicks: 0,
      fouls: 0,
    },
    shots: {
      shotsOffGoal: 0,
      shotsOnGoal: 0,
      totalShotsInsideBox: 0,
      totalShotsOutsideBox: 0,
    },
    passes: {
      finalThirdEntries: 0,
      accuratePasses: 0,
    },
    defending: {
      totalClearance: 0,
      interceptionWon: 0,
      ballRecovery: 0,
    },
  };

  const counts = JSON.parse(JSON.stringify(stats)); // To track total weights per stat

  historyMatches.forEach((match, index) => {
    if (index >= 30) return;
    const weight = getWeight(index, weights);
    
    // Normalize team name check
    const isHome = match.homeTeamName.toLowerCase().includes(teamName.toLowerCase());
    
    // Helper to accumulate
    const acc = (group, key, val) => {
      if (val !== undefined && val !== null && !isNaN(val)) {
        stats[group][key] += parseFloat(val) * weight;
        counts[group][key] += weight;
      }
    };

    const groups = match.matchDetails?.statistics?.[0]?.groups;
    if (!groups) return;

    for (const group of groups) {
      // Map group names to our structure keys
      let targetGroup = null;
      if (group.groupName === "Match overview") targetGroup = "matchOverview";
      else if (group.groupName === "Shots") targetGroup = "shots";
      else if (group.groupName === "Passes") targetGroup = "passes";
      else if (group.groupName === "Defending") targetGroup = "defending";
      
      if (!targetGroup) continue;

      for (const item of group.statisticsItems) {
        const key = item.key;
        if (stats[targetGroup][key] !== undefined) {
           const val = isHome ? item.homeValue : item.awayValue;
           acc(targetGroup, key, val);
        }
      }
    }
  });

  // Calculate averages
  for (const group in stats) {
    for (const key in stats[group]) {
      if (counts[group][key] > 0) {
        stats[group][key] = stats[group][key] / counts[group][key];
      }
    }
  }

  return stats;
}

function buildMockBundle(stats) {
  const bundle = {
    statistics: {}
  };

  for (const group in stats) {
    bundle.statistics[group] = {};
    for (const key in stats[group]) {
      bundle.statistics[group][key] = {
        ALL: { value: stats[group][key] }
      };
    }
  }
  return { home: bundle };
}

export async function runSimulation(teamName, statKey = "totalShots", options = {}) {
  const { limit = 30, weights = DEFAULT_WEIGHTS, matchType = "all" } = options;
  // console.log(`Starting simulation for ${teamName} - ${statKey} (Last ${limit} matches, Type: ${matchType})`);
  
  const homeMatches = await fetchTeamMatches(teamName, "home", { limit: 60 });
  const awayMatches = await fetchTeamMatches(teamName, "away", { limit: 60 });
  
  let combined = [...homeMatches, ...awayMatches].sort((a, b) => {
    return new Date(b.date) - new Date(a.date);
  });

  // Filter out matches without stats
  combined = combined.filter(m => m.matchDetails?.statistics);

  const results = [];

  // 2. Simulation Loop
  for (let i = 0; i < Math.min(limit, combined.length - 10); i++) {
    const targetMatch = combined[i];
    
    const isHome = targetMatch.homeTeamName.toLowerCase().includes(teamName.toLowerCase());
    
    // Filter by matchType if specified
    if (matchType === "home" && !isHome) continue;
    if (matchType === "away" && isHome) continue;

    const history = combined.slice(i + 1, i + 31); // 30 matches history

    if (history.length < 5) {
      // console.log(`Skipping match ${targetMatch.date} - insufficient history (${history.length})`);
      continue;
    }

    // 3. Calculate Pre-Match Stats (WMA)
    const teamStats = getTeamStatsWMA(teamName, history, weights);
    
    // Prediction (simplified for now to just return the WMA value for the stat)
    // In future this will run the full formula engine.
    let predictedValue = 0;
    if (statKey === "totalShotsOnGoal") predictedValue = teamStats.matchOverview.totalShotsOnGoal;
    else if (statKey === "ballPossession") predictedValue = teamStats.matchOverview.ballPossession;
    // Add more mappings as needed
    
    // Actual Value
    const actualValue = isHome 
      ? parseFloat(targetMatch.matchDetails.statistics[0].groups[1].statisticsItems.find(x => x.key === "totalShotsOnGoal")?.homeValue || 0)
      : parseFloat(targetMatch.matchDetails.statistics[0].groups[1].statisticsItems.find(x => x.key === "totalShotsOnGoal")?.awayValue || 0);

    let matchDate = "Unknown";
    if (targetMatch.date) matchDate = targetMatch.date;
    else if (targetMatch.matchDate) matchDate = targetMatch.matchDate;
    else if (targetMatch.matchDetails?.date) matchDate = targetMatch.matchDetails.date;
    else if (targetMatch.timestamp) {
      const ts = Number(targetMatch.timestamp);
      // If timestamp is in seconds (small number), multiply by 1000
      const dateObj = new Date(ts < 10000000000 ? ts * 1000 : ts);
      matchDate = dateObj.toISOString().split('T')[0];
    }

    results.push({
      date: matchDate,
      opponent: isHome ? targetMatch.awayTeamName : targetMatch.homeTeamName,
      type: isHome ? "Home" : "Away",
      predicted: predictedValue.toFixed(2),
      actual: actualValue,
      diff: (predictedValue - actualValue).toFixed(2)
    });
  }

  return results;
}
