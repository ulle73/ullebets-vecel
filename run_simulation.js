import { runSimulation } from "./lib/backtest/simulator.js";

const args = process.argv.slice(2);
const teamName = args[0] || "Arsenal";
const statKey = args[1] || "totalShotsOnGoal";

// Optimized weights from optimize_weights.js
const OPTIMIZED_WEIGHTS = {
  home: { recent: 2, medium: 1, old: 1 },
  away: { recent: 5, medium: 3, old: 1 },
};

async function main() {
  try {
    console.log(`Running simulation for ${teamName} (${statKey}) with OPTIMIZED weights...`);
    
    // Run for Home games
    const homeResults = await runSimulation(teamName, statKey, { 
      limit: 30, 
      weights: OPTIMIZED_WEIGHTS.home, 
      matchType: "home" 
    });

    // Run for Away games
    const awayResults = await runSimulation(teamName, statKey, { 
      limit: 30, 
      weights: OPTIMIZED_WEIGHTS.away, 
      matchType: "away" 
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
