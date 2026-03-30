import test from "node:test";
import assert from "node:assert/strict";

import {
  pickConfiguredFormula,
  summarizeConfiguredFormulaResults,
} from "./formula_research_core.js";

test("pickConfiguredFormula uses stat display order before fallback priority", () => {
  const selection = pickConfiguredFormula({
    statKey: "totalShots",
    line: {
      evDetails: {
        evPct: 4,
        evPctLeagueAvg: 9,
        evPctWithMultiplier: 6,
      },
    },
  });

  assert.equal(selection.formulaKey, "base");
  assert.equal(selection.evPct, 4);
});

test("pickConfiguredFormula falls back to base for unknown stats", () => {
  const selection = pickConfiguredFormula({
    statKey: "offsides",
    line: {
      evDetails: {
        evPct: 5,
        evPctLeagueAvg: 8,
      },
    },
  });

  assert.equal(selection.formulaKey, "base");
  assert.equal(selection.evPct, 5);
});

test("summarizeConfiguredFormulaResults aggregates ROI from positive configured picks", () => {
  const summary = summarizeConfiguredFormulaResults([
    {
      statKey: "totalShots",
      odds: 2,
      win: true,
      evDetails: {
        evPct: 4,
        evPctLeagueAvg: 9,
      },
    },
    {
      statKey: "totalShots",
      odds: 3,
      win: false,
      evDetails: {
        evPct: 2,
        evPctLeagueAvg: 8,
      },
    },
    {
      statKey: "yellowCards",
      odds: 2.5,
      win: false,
      evDetails: {
        evPct: -1,
        evPctMultifactor: -3,
      },
    },
  ]);

  assert.equal(summary.metrics.selectedBets, 2);
  assert.equal(summary.metrics.settledBets, 2);
  assert.equal(summary.metrics.formulaCounts.base, 2);
  assert.equal(summary.metrics.roiPct, 0);
  assert.equal(summary.metrics.winRatePct, 50);
});
