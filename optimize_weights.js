import { runSimulation } from "./lib/backtest/simulator.js";
import { fetchLeaguesAndTeams } from "./lib/backtest/data.js";

// Grid of weights to test
const WEIGHT_COMBINATIONS = [
  { recent: 2, medium: 1, old: 1 }, // Slight recent bias (Home favorite)
  { recent: 3, medium: 2, old: 1 }, // Moderate recent bias
  { recent: 5, medium: 3, old: 1 }, // Heavy recent bias (Away favorite)
];

// Grid of multipliers to test
const MULTIPLIERS = [0.9, 1.0, 1.1];

// Grid of biases to test
const BIASES = [-1, 0, 1];

const STAT_KEY = "totalShotsOnGoal";

export async function optimize(matchType = "all") {
  console.log(`\nOptimizing for ${matchType.toUpperCase()} games...`);
  console.log("--------------------------------------------------");
  
  // Fetch ALL teams
  const leaguesData = await fetchLeaguesAndTeams();
  let allTeams = [];
  
  // Extract team names from leaguesData
  // Structure: { "Premier League": { teams: [...] }, ... } or flat?
  // Checking engine.js usage: findTeamOpta iterates leaguesData values.
  // Let's assume leaguesData is { "LeagueName": [ { name: "TeamA" }, ... ] } or similar.
  // Actually, fetchLeaguesAndTeams returns a combined object where keys are league IDs or names?
  // Let's look at engine.js again or just use a safe extraction.
  
  for (const leagueKey in leaguesData) {
    const league = leaguesData[leagueKey];
    if (Array.isArray(league)) {
        league.forEach(t => {
            if (t.name || t.teamName) allTeams.push(t.name || t.teamName);
        });
    }
  }
  
  // Fallback if extraction fails or empty (mock/test env)
  if (allTeams.length === 0) {
      console.log("Warning: Could not extract teams from leaguesData. Using default list.");
      allTeams = ["Arsenal", "Manchester City", "Liverpool", "Aston Villa", "Tottenham Hotspur", "Newcastle United"];
  } else {
      console.log(`Found ${allTeams.length} teams to test.`);
      // Limit to top 20 for performance if list is huge
      if (allTeams.length > 20) {
          console.log("Limiting to first 20 teams for performance.");
          allTeams = allTeams.slice(0, 20);
      }
  }

  let bestConfig = null;
  let minError = Infinity;

  // Iterate all combinations
  for (const weights of WEIGHT_COMBINATIONS) {
    for (const multiplier of MULTIPLIERS) {
        for (const bias of BIASES) {
            
            let totalError = 0;
            let totalMatches = 0;

            for (const team of allTeams) {
                const results = await runSimulation(team, STAT_KEY, { 
                    limit: 30, 
                    weights, 
                    matchType,
                    multiplier,
                    bias
                });
                
                if (results.length === 0) continue;

                const teamError = results.reduce((sum, r) => sum + Math.abs(r.diff), 0);
                totalError += teamError;
                totalMatches += results.length;
            }

            if (totalMatches === 0) continue;

            const avgError = totalError / totalMatches;
            // console.log(`Config [W:${Object.values(weights)}, M:${multiplier}, B:${bias}] -> Avg Error: ${avgError.toFixed(4)}`);

            if (avgError < minError) {
                minError = avgError;
                bestConfig = { weights, multiplier, bias };
                console.log(`New Best: Error ${minError.toFixed(4)} (W:[${weights.recent},${weights.medium},${weights.old}], M:${multiplier}, B:${bias})`);
            }
        }
    }
  }

  console.log("--------------------------------------------------");
  console.log(`BEST CONFIG for ${matchType}:`, bestConfig);
  console.log(`MIN ERROR: ${minError.toFixed(4)}`);
  return bestConfig;
}

// Only run main if called directly
if (process.argv[1] === import.meta.url || process.argv[1].endsWith('optimize_weights.js')) {
    (async () => {
        console.log("Starting Global Optimizer...");
        await optimize("home");
        await optimize("away");
    })();
}
