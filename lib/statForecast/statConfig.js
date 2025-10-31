// Core stats that we currently build projections for.
export const CORE_STATS = [
  "totalShotsOnGoal",
  "shotsOnGoal",
  "cornerKicks",
  "freeKicks",
  "fouls",
  "throwIns",
  "offsides",
  "yellowCards",
  "goalKicks",
  "totalTackle",
];

// Central mapping of market stats and their current driver recipes.
// Drivers can be swapped out without touching the projection formulas.
export const STAT_CONFIG = {
  totalShotsOnGoal: {
    market_stat: "totalShotsOnGoal",
    drivers: [
      { stat: "finalThirdEntries", type: "for" },
      { stat: "touchesInOppBox", type: "for" },
      { stat: "totalShotsOnGoal", type: "against" },
    ],
  },
  shotsOnGoal: {
    market_stat: "shotsOnGoal",
    drivers: [
      { stat: "bigChanceCreated", type: "for" },
      { stat: "bigChanceCreated", type: "against" },
    ],
  },
  cornerKicks: {
    market_stat: "cornerKicks",
    drivers: [
      { stat: "totalShotsOutsideBox", type: "for" },
      { stat: "blockedScoringAttempt", type: "against" },
      { stat: "accurateCross", type: "for" },
    ],
  },
  fouls: {
    market_stat: "fouls",
    drivers: [
      { stat: "dribblesPercentage", type: "for" },
      { stat: "totalTackle", type: "for" },
    ],
  },
  freeKicks: {
    market_stat: "freeKicks",
    drivers: [
      { stat: "dribblesPercentage", type: "for" },
      { stat: "totalTackle", type: "for" },
    ],
  },
  yellowCards: {
    market_stat: "yellowCards",
    drivers: [{ stat: "fouls", type: "for" }],
  },
  throwIns: {
    market_stat: "throwIns",
    drivers: [
      { stat: "accurateCross", type: "for" },
      { stat: "totalClearance", type: "against" },
    ],
  },
  offsides: {
    market_stat: "offsides",
    drivers: [
      { stat: "accurateThroughBall", type: "for" },
      { stat: "offsides", type: "against" },
    ],
  },
  goalKicks: {
    market_stat: "goalKicks",
    drivers: [
      { stat: "shotsOffGoal", type: "for" },
      { stat: "shotsOffGoal", type: "against" },
    ],
  },
  totalTackle: {
    market_stat: "totalTackle",
    drivers: [
      { stat: "dribblesPercentage", type: "against" },
      { stat: "duelWonPercent", type: "for" },
    ],
  },
};

