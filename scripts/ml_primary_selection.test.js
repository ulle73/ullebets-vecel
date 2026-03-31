import test from "node:test";
import assert from "node:assert/strict";

import {
  getMlSelectionMode,
  resolveMlFormulaKey,
} from "../lib/backtest/mlSelectionPolicy.js";
import { pickPrimaryEvSelection } from "../lib/backtest/primaryEvSelection.js";

test("getMlSelectionMode defaults supported Phase 1 combos to off", () => {
  assert.equal(getMlSelectionMode("totalShots", "home", "ALL"), "off");
  assert.equal(getMlSelectionMode("shotsOnGoal", "away", "ALL"), "off");
});

test("resolveMlFormulaKey returns null for unsupported period", () => {
  assert.equal(resolveMlFormulaKey("totalShots", "home", "1ST"), null);
  assert.equal(resolveMlFormulaKey("cornerKicks", "total", "ALL"), null);
});

test("pickPrimaryEvSelection follows formulaConfig display order when ML is off", () => {
  const selection = pickPrimaryEvSelection({
    statKey: "totalShots",
    scope: "total",
    period: "ALL",
    evDetails: {
      evPct: 4,
      evPctLeagueAvg: 9,
      evPctWithMultiplier: 6,
    },
  });

  assert.equal(selection.formulaKey, "base");
  assert.equal(selection.valueKey, "evPct");
  assert.equal(selection.evPct, 4);
});

test("pickPrimaryEvSelection can prioritize ML for a supported combo when mode is primary", () => {
  const selection = pickPrimaryEvSelection({
    statKey: "shotsOnGoal",
    scope: "away",
    period: "ALL",
    mlMode: "primary",
    evDetails: {
      ml_shotsOnGoal_away_ALL: 11,
      evPct: 4,
      evPctLeagueAvg: 7,
    },
  });

  assert.equal(selection.formulaKey, "ml_shotsOnGoal_away_ALL");
  assert.equal(selection.valueKey, "ml_shotsOnGoal_away_ALL");
  assert.equal(selection.evPct, 11);
});

test("pickPrimaryEvSelection falls back when ML is requested but unsupported", () => {
  const selection = pickPrimaryEvSelection({
    statKey: "shotsOnGoal",
    scope: "away",
    period: "1ST",
    mlMode: "primary",
    evDetails: {
      ml_shotsOnGoal_away_1ST: 13,
      evPct: 5,
      evPctLeagueAvg: 8,
    },
  });

  assert.equal(selection.formulaKey, "base");
  assert.equal(selection.valueKey, "evPct");
  assert.equal(selection.evPct, 5);
});
