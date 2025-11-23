import { fetchLeaguesAndTeams, fetchTeamMatches } from "./lib/backtest/data.js";
import { extractDrivers, applyMultiFactorFormula } from "./lib/backtest/multiFactor.js";
import fs from "fs";
import path from "path";

/**
 * QUICK Multi-Factor Optimizer
 * Tests only a SUBSET of teams and fewer weight combinations for speed
 */

// Quick grid - fewer combinations
const WEIGHT_GRID = [0, 0.2, 0.5, 0.8, 1.0];
const BIAS_GRID = [-2, 0, 2];

// Small sample of teams for quick testing
const QUICK_TEAMS = [
  "Arsenal", "Liverpool", "Manchester City", "Chelsea", "Tottenham Hotspur"
];

const STAT_KEYS = [
  "totalShotsOnGoal",
  "shotsOnGoal", 
  "cornerKicks",
  "throwIns",
  "fouls",
  "offsides",
  "goalKicks",
  "yellowCards"
];

async function optimizeQuick() {
  console.log("🚀 Quick Multi-Factor Optimizer");
  console.log(`Testing ${QUICK_TEAMS.length} teams with reduced grid search...\n`);

  const results = {};

  for (const statKey of STAT_KEYS) {
    console.log(`\n📊 Optimizing: ${statKey}`);
    
    const bestConfig = await findBestWeights(statKey);
    results[statKey] = bestConfig;
    
    console.log(`✅ Best config for ${statKey}:`);
    console.log(`   Error: ${bestConfig.avgError.toFixed(3)}`);
    console.log(`   Bias: ${bestConfig.bias}`);
  }

  // Save to config file
  const configDir = path.join(process.cwd(), "config");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const outputPath = path.join(configDir, "optimized_multifactor_weights.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log(`\n✅ Optimization complete!`);
  console.log(`📁 Results saved to: ${outputPath}`);
  
  return results;
}

async function findBestWeights(statKey) {
  let bestError = Infinity;
  let bestConfig = null;

  // Generate all driver weight combinations (simplified)
  const driverNames = [
    "wma_home", "wma_away", 
    "opta_rank_diff", "opta_rating_diff",
    "home_rank_for_all", "away_rank_against_all", "matchup_score",
    "home_1h", "home_2h", "away_1h", "away_2h",
    "home_advantage"
  ];

  // Simple grid: test a few combinations
  const weightCombinations = generateSimpleWeightCombinations(driverNames);

  let tested = 0;
  const total = weightCombinations.length * BIAS_GRID.length;

  for (const weights of weightCombinations) {
    for (const bias of BIAS_GRID) {
      tested++;
      if (tested % 20 === 0) {
        process.stdout.write(`\r   Testing combination ${tested}/${total}...`);
      }

      const avgError = await testConfiguration(statKey, weights, bias);

      if (avgError < bestError) {
        bestError = avgError;
        bestConfig = { weights, bias, avgError };
      }
    }
  }

  console.log(`\r   Tested ${tested} combinations.                    `);
  return bestConfig;
}

function generateSimpleWeightCombinations(driverNames) {
  // Instead of testing ALL combinations, use smart defaults
  // Test: WMA-focused, Opta-focused, Balanced, and Period-focused
  
  const combinations = [];
  
  // 1. WMA-focused (historical data is king)
  combinations.push({
    wma_home: 1.0, wma_away: 0.5,
    opta_rank_diff: 0.2, opta_rating_diff: 0.2,
    home_rank_for_all: 0, away_rank_against_all: 0, matchup_score: 0,
    home_1h: 0, home_2h: 0, away_1h: 0, away_2h: 0,
    home_advantage: 0.2
  });

  // 2. Opta-focused (team quality matters most)
  combinations.push({
    wma_home: 0.5, wma_away: 0.2,
    opta_rank_diff: 0.8, opta_rating_diff: 0.8,
    home_rank_for_all: 0.5, away_rank_against_all: 0.5, matchup_score: 0.5,
    home_1h: 0, home_2h: 0, away_1h: 0, away_2h: 0,
    home_advantage: 0.2
  });

  // 3. Balanced (all drivers equal)
  combinations.push({
    wma_home: 0.5, wma_away: 0.5,
    opta_rank_diff: 0.5, opta_rating_diff: 0.5,
    home_rank_for_all: 0.5, away_rank_against_all: 0.5, matchup_score: 0.5,
    home_1h: 0.2, home_2h: 0.2, away_1h: 0.2, away_2h: 0.2,
    home_advantage: 0.5
  });

  // 4. Period-focused (1H/2H stats matter)
  combinations.push({
    wma_home: 0.5, wma_away: 0.2,
    opta_rank_diff: 0.2, opta_rating_diff: 0.2,
    home_rank_for_all: 0.2, away_rank_against_all: 0.2, matchup_score: 0.2,
    home_1h: 0.8, home_2h: 0.8, away_1h: 0.5, away_2h: 0.5,
    home_advantage: 0.2
  });

  // 5. Matchup-focused (offense vs defense)
  combinations.push({
    wma_home: 0.5, wma_away: 0.2,
    opta_rank_diff: 0.2, opta_rating_diff: 0.2,
    home_rank_for_all: 0.8, away_rank_against_all: 0.8, matchup_score: 1.0,
    home_1h: 0, home_2h: 0, away_1h: 0, away_2h: 0,
    home_advantage: 0.2
  });

  return combinations;
}

async function testConfiguration(statKey, weights, bias) {
  let totalError = 0;
  let count = 0;

  for (const teamName of QUICK_TEAMS) {
    // Fetch matches for this team
    const homeMatches = await fetchTeamMatches(teamName, "home", { limit: 40 });
    const awayMatches = await fetchTeamMatches(teamName, "away", { limit: 40 });

    // Test on last 10 home matches
    for (let i = 0; i < Math.min(10, homeMatches.length); i++) {
      const testMatch = homeMatches[i];
      const historyHome = homeMatches.slice(i + 1, i + 31);
      const historyAway = awayMatches.slice(0, 30);

      if (historyHome.length < 5) continue; // Need enough history

      const opponentName = testMatch.awayTeamName;
      
      try {
        // Extract drivers
        const drivers = await extractDrivers(
          teamName, 
          opponentName, 
          historyHome, 
          historyAway, 
          statKey
        );

        // Apply formula
        const prediction = applyMultiFactorFormula(drivers, weights, bias);

        // Get actual value
        const actualValue = getActualValue(testMatch, statKey);
        if (actualValue === null) continue;

        // Calculate error
        const error = Math.abs(prediction - actualValue);
        totalError += error;
        count++;
      } catch (err) {
        // Skip this match if error
        continue;
      }
    }
  }

  return count > 0 ? totalError / count : Infinity;
}

function getActualValue(match, statKey) {
  if (!match.matchDetails?.statistics?.[0]?.groups) return null;

  const groups = match.matchDetails.statistics[0].groups;
  for (const group of groups) {
    const item = group.statisticsItems?.find(x => x.key === statKey);
    if (item) {
      return parseFloat(item.homeValue || 0);
    }
  }
  return null;
}

// Run optimization
optimizeQuick().catch(console.error);
