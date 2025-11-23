import { runSimulation } from "./lib/backtest/simulator.js";
import { fetchLeaguesAndTeams } from "./lib/backtest/data.js";

// Optimized formulas from run_simulator_all.js
const OPTIMIZED_FORMULAS = {
  totalShotsOnGoal: {
    home: { weights: { recent: 2, medium: 1, old: 1 }, multiplier: 0.85, bias: 2 },
    away: { weights: { recent: 3, medium: 2, old: 1 }, multiplier: 0.8, bias: 1 }
  },
  shotsOnGoal: {
    home: { weights: { recent: 4, medium: 2, old: 1 }, multiplier: 0.85, bias: 1 },
    away: { weights: { recent: 2, medium: 1, old: 1 }, multiplier: 0.85, bias: -0.5 }
  },
  cornerKicks: {
    home: { weights: { recent: 2, medium: 1, old: 1 }, multiplier: 0.8, bias: 2 },
    away: { weights: { recent: 3, medium: 2, old: 1 }, multiplier: 0.8, bias: 0.5 }
  },
  throwIns: {
    home: { weights: { recent: 2, medium: 1, old: 1 }, multiplier: 0.8, bias: 2 },
    away: { weights: { recent: 2, medium: 1, old: 1 }, multiplier: 0.8, bias: 2 }
  },
  fouls: {
    home: { weights: { recent: 2, medium: 1, old: 1 }, multiplier: 0.9, bias: 0.5 },
    away: { weights: { recent: 3, medium: 2, old: 1 }, multiplier: 0.8, bias: 2 }
  },
  offsides: {
    home: { weights: { recent: 2, medium: 1, old: 1 }, multiplier: 0.8, bias: 1 },
    away: { weights: { recent: 2, medium: 1, old: 1 }, multiplier: 0.8, bias: 1 }
  },
  goalKicks: {
    home: { weights: { recent: 2, medium: 1, old: 1 }, multiplier: 0.8, bias: 2 },
    away: { weights: { recent: 2, medium: 1, old: 1 }, multiplier: 0.8, bias: 2 }
  },
  yellowCards: {
    home: { weights: { recent: 2, medium: 1, old: 1 }, multiplier: 0.8, bias: 1 },
    away: { weights: { recent: 2, medium: 1, old: 1 }, multiplier: 0.8, bias: 2 }
  }
};

async function verifyFormula(statKey) {
  console.log(`\nVerifying formula for ${statKey}...`);
  
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
      allTeams = ["Arsenal", "Manchester City", "Liverpool", "Aston Villa", "Tottenham Hotspur", "Newcastle United"];
  }

  let homeError = 0;
  let homeMatches = 0;
  let awayError = 0;
  let awayMatches = 0;

  for (const team of allTeams) {
    // Home
    const homeResults = await runSimulation(team, statKey, {
      limit: 30,
      matchType: "home",
      ...OPTIMIZED_FORMULAS[statKey].home
    });
    homeError += homeResults.reduce((sum, r) => sum + Math.abs(r.diff), 0);
    homeMatches += homeResults.length;

    // Away
    const awayResults = await runSimulation(team, statKey, {
      limit: 30,
      matchType: "away",
      ...OPTIMIZED_FORMULAS[statKey].away
    });
    awayError += awayResults.reduce((sum, r) => sum + Math.abs(r.diff), 0);
    awayMatches += awayResults.length;
  }

  return {
    home: homeMatches > 0 ? (homeError / homeMatches).toFixed(4) : "N/A",
    away: awayMatches > 0 ? (awayError / awayMatches).toFixed(4) : "N/A"
  };
}

async function main() {
  console.log("Verifying all optimized formulas...\n");
  console.log("=".repeat(80));
  console.log("FORMULA VERIFICATION - ERROR MARGINS");
  console.log("=".repeat(80) + "\n");

  const stats = Object.keys(OPTIMIZED_FORMULAS);
  
  for (const stat of stats) {
    const errors = await verifyFormula(stat);
    console.log(`${stat.padEnd(20)} | HOME: ${errors.home.padStart(8)} | AWAY: ${errors.away.padStart(8)}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("Verification Complete!");
  console.log("=".repeat(80));
}

main();
