import { runSimulation } from "./lib/backtest/simulator.js";
import { optimize } from "./optimize_weights.js";

const args = process.argv.slice(2);
const teamName = args[0] || "Arsenal";
const statKey = args[1] || "totalShotsOnGoal";

async function main() {
  try {
    console.log("Running Global Optimization first...");
    
    // Get best settings for Home games
    const bestHome = await optimize("home");
    
    // Get best settings for Away games
    const bestAway = await optimize("away");

    console.log("\n--------------------------------------------------");
    console.log(`Running simulation for ${teamName} (${statKey}) using GLOBAL BEST settings...`);
    console.log(`HOME Settings: W:[${Object.values(bestHome.weights)}], M:${bestHome.multiplier}, B:${bestHome.bias}`);
    console.log(`AWAY Settings: W:[${Object.values(bestAway.weights)}], M:${bestAway.multiplier}, B:${bestAway.bias}`);
    console.log("--------------------------------------------------\n");
    
    // Run for Home games
    const homeResults = await runSimulation(teamName, statKey, { 
      limit: 30, 
      weights: bestHome.weights, 
      matchType: "home",
      multiplier: bestHome.multiplier,
      bias: bestHome.bias
    });

    // Run for Away games
    const awayResults = await runSimulation(teamName, statKey, { 
      limit: 30, 
      weights: bestAway.weights, 
      matchType: "away",
      multiplier: bestAway.multiplier,
      bias: bestAway.bias
    });

    // Combine and sort by date
    const results = [...homeResults, ...awayResults].sort((a, b) => {
      return new Date(b.date) - new Date(a.date);
    });
    
    console.log(`\nSimulation Results for ${teamName} (${statKey})`);
    console.log("==================================================");
    console.log("Date       | Type | Opponent        | Pred  | Actual | Diff");
    console.log("--------------------------------------------------");
    
    let totalDiff = 0;

    results.forEach(r => {
      console.log(`${r.date} | ${r.type.padEnd(4)} | ${r.opponent.padEnd(15)} | ${r.predicted.padEnd(5)} | ${String(r.actual).padEnd(6)} | ${r.diff}`);
      totalDiff += Math.abs(parseFloat(r.diff));
    });

    console.log("--------------------------------------------------");
    console.log(`Average Error: ${(totalDiff / results.length).toFixed(2)}`);
    
  } catch (err) {
    console.error("Simulation failed:", err);
  }
}

main();
