import { runSimulation } from "./lib/backtest/simulator.js";
import { fetchLeaguesAndTeams } from "./lib/backtest/data.js";

// Refined Grid of weights to test
const WEIGHT_COMBINATIONS = [
  { recent: 2, medium: 1, old: 1 }, 
  { recent: 3, medium: 2, old: 1 }, 
  { recent: 4, medium: 2, old: 1 },
  { recent: 5, medium: 3, old: 1 },
];

// Refined Grid of multipliers (0.8 to 1.2 in 0.05 steps)
const MULTIPLIERS = [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2];

// Refined Grid of biases (-2 to +2 in 0.5 steps)
const BIASES = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];

export async function deriveFormula(matchType = "all", statKey = "totalShotsOnGoal") {
  console.log(`\nDeriving Universal Formula for ${statKey} (${matchType.toUpperCase()} games)...`);
  console.log("--------------------------------------------------");
  
  // Fetch ALL teams
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
      console.log("Warning: Could not extract teams. Using default list.");
      allTeams = ["Arsenal", "Manchester City", "Liverpool", "Aston Villa", "Tottenham Hotspur", "Newcastle United"];
  } else {
      console.log(`Using FULL DATASET: ${allTeams.length} teams.`);
  }

  let bestConfig = null;
  let minError = Infinity;

  // Iterate all combinations
  // This is a heavy loop: 4 weights * 9 multipliers * 9 biases = 324 combinations
  // Times N teams. If N=100, that's 32,400 simulations.
  // We might need to optimize the loop or provide progress updates.
  
  let comboCount = 0;
  const totalCombos = WEIGHT_COMBINATIONS.length * MULTIPLIERS.length * BIASES.length;

  for (const weights of WEIGHT_COMBINATIONS) {
    for (const multiplier of MULTIPLIERS) {
        for (const bias of BIASES) {
            comboCount++;
            if (comboCount % 50 === 0) console.log(`Testing combination ${comboCount}/${totalCombos}...`);
            
            let totalError = 0;
            let totalMatches = 0;

            for (const team of allTeams) {
                const results = await runSimulation(team, statKey, { 
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

            if (avgError < minError) {
                minError = avgError;
                bestConfig = { weights, multiplier, bias };
                console.log(`New Best: Error ${minError.toFixed(4)} (W:[${weights.recent},${weights.medium},${weights.old}], M:${multiplier}, B:${bias})`);
            }
        }
    }
  }

  console.log("--------------------------------------------------");
  console.log(`UNIVERSAL FORMULA for ${matchType}:`, bestConfig);
  console.log(`MIN ERROR: ${minError.toFixed(4)}`);
  return bestConfig;
}

// Run if called directly
if (process.argv[1] === import.meta.url || process.argv[1].endsWith('derive_formula.js')) {
    (async () => {
        console.log("Starting Universal Formula Derivation...");
        await deriveFormula("home");
        await deriveFormula("away");
    })();
}
