import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHistoricalPredictionSummary,
  isDateBeforeTodayLocal,
} from "./lib/dayInsightsSummary.js";

test("isDateBeforeTodayLocal treats yesterday as historical in local time", () => {
  const now = new Date("2026-05-13T00:30:00+02:00");
  assert.equal(isDateBeforeTodayLocal("2026-05-12", now), true);
  assert.equal(isDateBeforeTodayLocal("2026-05-13", now), false);
});

test("buildHistoricalPredictionSummary returns a visible placeholder when rows lack outcomes", () => {
  const summary = buildHistoricalPredictionSummary(
    [
      {
        outcomeValue: null,
        leagueBaseline: 4.5,
      },
    ],
    "over",
    true
  );

  assert.equal(summary.state, "pending");
  assert.equal(summary.count, 0);
  assert.equal(summary.total, 0);
  assert.equal(summary.label, "0/0 avgjorda");
});

test("buildHistoricalPredictionSummary counts successful over rows against baseline", () => {
  const summary = buildHistoricalPredictionSummary(
    [
      { outcomeValue: 7, leagueBaseline: 5 },
      { outcomeValue: 4, leagueBaseline: 5 },
      { outcomeValue: 6, leagueBaseline: 5 },
    ],
    "over",
    true
  );

  assert.equal(summary.state, "ready");
  assert.equal(summary.count, 2);
  assert.equal(summary.total, 3);
  assert.equal(summary.label, "2/3 över • +13.3%");
});
