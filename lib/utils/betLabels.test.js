import test from "node:test";
import assert from "node:assert/strict";

import {
  formatBetContextLabels,
  formatBetPeriodLabel,
  formatBetScopeLabel,
} from "./betLabels.js";

test("formatBetScopeLabel makes scope explicit", () => {
  assert.equal(formatBetScopeLabel("home", "SC Freiburg", "RB Leipzig"), "Hemmalaget – SC Freiburg");
  assert.equal(formatBetScopeLabel("away", "SC Freiburg", "RB Leipzig"), "Bortalaget – RB Leipzig");
  assert.equal(formatBetScopeLabel("total", "SC Freiburg", "RB Leipzig"), "Totalt i matchen");
});

test("formatBetPeriodLabel keeps the match period readable", () => {
  assert.equal(formatBetPeriodLabel("ALL"), "Hela matchen");
  assert.equal(formatBetPeriodLabel("1ST"), "Första halvlek");
  assert.equal(formatBetPeriodLabel("2ND"), "Andra halvlek");
});

test("formatBetContextLabels combines scope and period", () => {
  assert.deepEqual(
    formatBetContextLabels({ scope: "away", period: "ALL" }, "SC Freiburg", "RB Leipzig"),
    {
      scopeLabel: "Bortalaget – RB Leipzig",
      periodLabel: "Hela matchen",
    }
  );
});
