import { runSimulation } from "./lib/backtest/simulator.js";

// Teams to test (Top 6 + some others for variety)
const TEAMS = [
  "Arsenal",
  "Manchester City",
  "Liverpool",
  "Aston Villa",
  "Tottenham Hotspur",
  "Newcastle United"
];

// Grid of weights to test
// Format: [recent, medium, old]
const WEIGHT_COMBINATIONS = [
  { recent: 1, medium: 1, old: 1 }, // Flat average
  { recent: 2, medium: 1, old: 1 }, // Slight recent bias
  { recent: 3, medium: 2, old: 1 }, // Moderate recent bias (current default)
  { recent: 5, medium: 3, old: 1 }, // Heavy recent bias
  { recent: 5, medium: 1, old: 1 }, // Spike bias
  { recent: 10, medium: 5, old: 1 }, // Extreme recent bias
];

const STAT_KEY = "totalShotsOnGoal";

async function optimize(matchType = "all") {
  console.log(`\nOptimizing for ${matchType.toUpperCase()} games...`);
  console.log("--------------------------------------------------");
  
  let bestWeights = null;
  let minError = Infinity;

  for (const weights of WEIGHT_COMBINATIONS) {
    let totalError = 0;
    let totalMatches = 0;

    // console.log(`Testing weights: ${JSON.stringify(weights)}`);

    for (const team of TEAMS) {
      const results = await runSimulation(team, STAT_KEY, { limit: 30, weights, matchType });
      
      if (results.length === 0) continue;

      const teamError = results.reduce((sum, r) => sum + Math.abs(r.diff), 0);
      totalError += teamError;
      totalMatches += results.length;
    }

    if (totalMatches === 0) continue;

    const avgError = totalError / totalMatches;
    console.log(`Weights [${weights.recent}, ${weights.medium}, ${weights.old}] -> Avg Error: ${avgError.toFixed(4)}`);

    if (avgError < minError) {
      minError = avgError;
      bestWeights = weights;
    }
  }

  console.log("--------------------------------------------------");
  console.log(`BEST WEIGHTS for ${matchType}:`, bestWeights);
  console.log(`MIN ERROR: ${minError.toFixed(4)}`);
  return { bestWeights, minError };
}

async function main() {
  console.log("Starting Optimizer...");
  
  await optimize("home");
  await optimize("away");
  
  // await optimize("all");
}

main();
