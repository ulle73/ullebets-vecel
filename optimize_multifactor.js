import { extractDrivers, applyMultiFactorFormula } from "./lib/backtest/multiFactor.js";
import { fetchTeamMatches } from "./lib/backtest/data.js";
import { fetchLeaguesAndTeams } from "./lib/backtest/data.js";
import fs from "fs";

// Weight ranges for grid search
const WEIGHT_RANGES = {
  wma_home: [0.5, 0.7, 0.9, 1.0, 1.2],
  wma_away: [0.0, 0.2, 0.5], // Typically opponent's historical performance matters less
  opta_rank_diff: [-0.2, -0.1, 0, 0.1, 0.2],
  opta_rating_diff: [-0.1, 0, 0.1],
  home_rank_for_all: [0.0, 0.3, 0.5],
  away_rank_against_all: [-0.5, -0.3, 0.0],
  matchup_score: [0.0, 0.5, 1.0],
  home_1h: [0.0, 0.2, 0.5],
  home_2h: [0.0, 0.2, 0.5],
  away_1h: [0.0, 0.1],
  away_2h: [0.0, 0.1],
  home_advantage: [0.0, 0.5, 1.0],
};

const BIAS_RANGE = [-2, -1, 0, 1, 2];

/**
 * Generate all combinations of weights from ranges
 * WARNING: This creates a MASSIVE number of combinations
 * For efficiency, we'll use a smaller subset for initial testing
 */
function generateWeightCombinations() {
  // Start with just the most important drivers
  const importantDrivers = [
    'wma_home',
    'opta_rank_diff',
    'home_rank_for_all',
    'matchup_score',
    'home_advantage'
  ];
  
  const combinations = [];
  
  function recurse(index, current) {
    if (index === importantDrivers.length) {
      // Add all other drivers with default weight 0
      const fullWeights = { ...current };
      for (const driver in WEIGHT_RANGES) {
        if (!fullWeights[driver]) fullWeights[driver] = 0;
      }
      combinations.push(fullWeights);
      return;
    }
    
    const driver = importantDrivers[index];
    for (const value of WEIGHT_RANGES[driver]) {
      recurse(index + 1, { ...current, [driver]: value });
    }
  }
  
  recurse(0, {});
  return combinations;
}

/**
 * Evaluate a weight configuration on all teams
 */
async function evaluateWeights(statKey, matchType, weights, bias) {
  // Fetch all teams
  const leaguesData = await fetchLeaguesAndTeams();
  let allTeams = [];
  
  for (const leagueKey in leaguesData) {
    const league = leaguesData[leagueKey];
    if (Array.isArray(league)) {
      league.forEach(t => {
        if (t.name || t.teamName) allTeams.push(t.name || t.teamName);
      });
    }
  }
  
  if (allTeams.length === 0) {
    allTeams = ["Arsenal", "Manchester City", "Liverpool"];
  }
  
  // Limit teams for testing (remove this limit for final run)
  allTeams = allTeams.slice(0, 6);
  
  let totalError = 0;
  let totalMatches = 0;
  
  for (const team of allTeams) {
    const homeMatches = await fetchTeamMatches(team, "home", { limit: 40 });
    const awayMatches = await fetchTeamMatches(team, "away", { limit: 40 });
    
    // Test on recent matches (last 20)
    const testMatches = matchType === "home" ? homeMatches.slice(0, 20) : awayMatches.slice(0, 20);
    
    for (const match of testMatches) {
      if (!match.matchDetails?.statistics) continue;
      
      const isHome = match.homeTeamName?.toLowerCase().includes(team.toLowerCase());
      const opponent = isHome ? match.awayTeamName : match.homeTeamName;
      
      // Get historical data (excluding this match)
      const historyHome = homeMatches.slice(1);
      const historyAway = awayMatches.slice(1);
      
      try {
        // Extract drivers
        const drivers = await extractDrivers(
          isHome ? team : opponent,
          isHome ? opponent : team,
          historyHome,
          historyAway,
          statKey,
          { recent: 3, medium: 2, old: 1 }
        );
        
        // Predict
        const predicted = applyMultiFactorFormula(drivers, weights, bias);
        
        // Get actual value
        const groups = match.matchDetails.statistics[0].groups;
        let actual = 0;
        for (const group of groups) {
          const item = group.statisticsItems?.find(x => x.key === statKey);
          if (item) {
            actual = isHome ? parseFloat(item.homeValue || 0) : parseFloat(item.awayValue || 0);
            break;
          }
        }
        
        totalError += Math.abs(predicted - actual);
        totalMatches++;
      } catch (err) {
        // Skip this match if extraction fails
        continue;
      }
    }
  }
  
  return totalMatches > 0 ? totalError / totalMatches : Infinity;
}

/**
 * Optimize weights for a specific stat and match type
 */
async function optimizeStatKey(statKey, matchType) {
  console.log(`\nOptimizing ${statKey} (${matchType})...`);
  
  const weightCombinations = generateWeightCombinations();
  console.log(`Testing ${weightCombinations.length * BIAS_RANGE.length} combinations...`);
  
  let bestConfig = null;
  let minError = Infinity;
  let testedCount = 0;
  
  for (const weights of weightCombinations) {
    for (const bias of BIAS_RANGE) {
      testedCount++;
      if (testedCount % 100 === 0) {
        console.log(`Progress: ${testedCount}/${weightCombinations.length * BIAS_RANGE.length} (Best error so far: ${minError.toFixed(4)})`);
      }
      
      const error = await evaluateWeights(statKey, matchType, weights, bias);
      
      if (error < minError) {
        minError = error;
        bestConfig = { weights, bias, error };
        console.log(`New best: Error ${minError.toFixed(4)}`);
      }
    }
  }
  
  return bestConfig;
}

async function main() {
  const STATS = ["totalShotsOnGoal", "cornerKicks", "fouls"];
  const results = {};
  
  for (const stat of STATS) {
    results[stat] = {
      home: await optimizeStatKey(stat, "home"),
      away: await optimizeStatKey(stat, "away")
    };
    
    console.log(`\n✓ ${stat} optimization complete`);
    console.log(`  HOME: Error ${results[stat].home.error.toFixed(4)}`);
    console.log(`  AWAY: Error ${results[stat].away.error.toFixed(4)}`);
  }
  
  // Save results
  fs.writeFileSync(
    "./config/optimized_multifactor_weights.json",
    JSON.stringify(results, null, 2)
  );
  
  console.log("\n✓ All optimizations complete!");
  console.log("Results saved to config/optimized_multifactor_weights.json");
}

main();
