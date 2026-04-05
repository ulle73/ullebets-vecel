import { runFormulas } from "./lib/backtest/formulas/index.js";

const context = {
  baseResult: {
    prob: 0.5,
    lambda: 2.5,
  },
  multiplierResult: {
    multiplier: 1.1,
  },
  leagueProjection: {
    selectedLambda: 2.6,
  },
  multifactorProjection: {
    lambda: 2.55,
  },
  oddsValue: 2.0,
  implied: 0.5,
  probabilityOf: (lambda) => {
    return Math.min(1, lambda * 0.2);
  },
  homeOpta: {
    rank: 10,
    rating: 90,
  },
  awayOpta: {
    rank: 20,
    rating: 85,
  },
  homeBundle: {
    home: {
      statistics: {
        matchOverview: {
          ballPossession: { ALL: { value: 55 } },
          bigChanceCreated: { ALL: { value: 3 } },
          totalShotsOnGoal: { ALL: { value: 15 } },
          totalTackle: { ALL: { value: 20 } },
        },
        passes: {
          finalThirdEntries: { ALL: { value: 40 } },
        },
        shots: {
          shotsOffGoal: { ALL: { value: 5 } },
        },
        defending: {
          totalClearance: { ALL: { value: 10 } },
          interceptionWon: { ALL: { value: 5 } },
        },
      },
    },
  },
  awayBundle: {
    away: {
      statistics: {
        matchOverview: {
          ballPossession: { ALL: { value: 45 } },
          bigChanceCreated: { ALL: { value: 1 } },
          totalShotsOnGoal: { ALL: { value: 10 } },
          totalTackle: { ALL: { value: 15 } },
        },
        passes: {
          finalThirdEntries: { ALL: { value: 30 } },
        },
        shots: {
          shotsOffGoal: { ALL: { value: 8 } },
        },
        defending: {
          totalClearance: { ALL: { value: 20 } },
          interceptionWon: { ALL: { value: 10 } },
        },
      },
    },
  },
};

console.log("Running formulas with context:", JSON.stringify(context, null, 2));

try {
  const results = runFormulas(context);
  console.log("Results:", JSON.stringify(results, null, 2));

  const expectedKeys = [
    "evPctOptaRank",
    "evPctOptaRating",
    "evPctOptaCombined",
    "evPctOptaPlusBase",
    "evPctOptaPlusLeagueAvg",
    "evPctShotsAdvanced",
    "evPctSoTAdvanced",
    "evPctFoulsAdvanced",
    "evPctGoalKicksAdvanced",
    "evPctThrowInsAdvanced",
  ];

  let allValid = true;
  for (const key of expectedKeys) {
    if (results[key] === undefined) {
      console.error(`Missing result for ${key}`);
      allValid = false;
    } else {
      console.log(`${key}: ${results[key]}`);
    }
  }

  if (allValid) {
    console.log("All new formulas returned values.");
  } else {
    console.error("Some formulas failed.");
    process.exit(1);
  }
} catch (err) {
  console.error("Error running formulas:", err);
  process.exit(1);
}
