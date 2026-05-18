import test from "node:test";
import assert from "node:assert/strict";

import {
  isLikelyPlayerMarketLeak,
  isValidTrackedBet,
} from "./lib/autoAnalysis/marketValidity.js";

test("flags leaked player shots-on-goal bet as invalid match total", () => {
  const bet = {
    statKey: "shotsOnGoal",
    scope: "total",
    period: "ALL",
    line: 0.5,
  };

  assert.equal(isLikelyPlayerMarketLeak(bet), true);
  assert.equal(isValidTrackedBet(bet), false);
});

test("flags leaked player total-shots bet as invalid match total", () => {
  const bet = {
    statKey: "totalShots",
    scope: "total",
    period: "ALL",
    line: 2.5,
  };

  assert.equal(isLikelyPlayerMarketLeak(bet), true);
  assert.equal(isValidTrackedBet(bet), false);
});

test("keeps plausible full-match total lines", () => {
  const totalShotsBet = {
    statKey: "totalShots",
    scope: "total",
    period: "ALL",
    line: 24.5,
  };
  const shotsOnGoalBet = {
    statKey: "shotsOnGoal",
    scope: "total",
    period: "ALL",
    line: 8.5,
  };

  assert.equal(isLikelyPlayerMarketLeak(totalShotsBet), false);
  assert.equal(isLikelyPlayerMarketLeak(shotsOnGoalBet), false);
  assert.equal(isValidTrackedBet(totalShotsBet), true);
  assert.equal(isValidTrackedBet(shotsOnGoalBet), true);
});
