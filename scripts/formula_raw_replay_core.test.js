import test from "node:test";
import assert from "node:assert/strict";

import {
  SUPPORTED_RAW_REPLAY_STATS,
  applyReplayMutation,
  buildNextNumericProposal,
  buildReplayFormulaValues,
  evPctToProbability,
  filterMatchesBeforeCutoff,
  flattenReplayCandidates,
  inferPoissonLambdaFromProbability,
  normalizeConditionToIsOver,
  readReplayMutationValue,
  scoreReplaySelections,
} from "./formula_raw_replay_core.js";
import { poissonCdf } from "../lib/backtest/math.js";

test("SUPPORTED_RAW_REPLAY_STATS covers the current formula research surface", () => {
  assert.deepEqual(SUPPORTED_RAW_REPLAY_STATS, [
    "cornerKicks",
    "totalShots",
    "yellowCards",
  ]);
});

test("flattenReplayCandidates joins snapshot lines to settled outcomes by betKey", () => {
  const rows = flattenReplayCandidates([
    {
      homeTeam: "Roma",
      awayTeam: "Lazio",
      matchDate: "2026-03-01T19:45:00.000Z",
      lines: [
        {
          betKey: "corners-over-9.5",
          actual: 12,
          win: true,
        },
      ],
      snapshots: [
        {
          fetchedAt: "2026-02-27T12:00:00.000Z",
          lines: [
            {
              betKey: "corners-over-9.5",
              statKey: "cornerKicks",
              scope: "total",
              period: "ALL",
              condition: "över",
              line: 9.5,
              odds: 1.9,
              evDetails: { rawEvPctLeagueAvg: 12, evPctLeagueAvg: 12 },
            },
            {
              betKey: "possession-over-50.5",
              statKey: "possession",
              odds: 1.8,
            },
          ],
        },
      ],
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].betKey, "corners-over-9.5");
  assert.equal(rows[0].statKey, "cornerKicks");
  assert.equal(rows[0].win, true);
  assert.equal(rows[0].actual, 12);
  assert.equal(rows[0].snapshotFetchedAt, "2026-02-27T12:00:00.000Z");
  assert.equal(rows[0].homeTeam, "Roma");
  assert.equal(rows[0].awayTeam, "Lazio");
});

test("filterMatchesBeforeCutoff excludes future and same-instant matches", () => {
  const rows = filterMatchesBeforeCutoff(
    [
      { id: "old", startTimestamp: Date.parse("2026-02-20T12:00:00.000Z") },
      { id: "same", startTimestamp: Date.parse("2026-02-27T12:00:00.000Z") },
      { id: "future", startTimestamp: Date.parse("2026-03-01T12:00:00.000Z") },
    ],
    Date.parse("2026-02-27T12:00:00.000Z")
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ["old"]
  );
});

test("evPctToProbability converts EV percent and odds into an implied model probability", () => {
  const probability = evPctToProbability(10, 2.2);
  assert.equal(Number(probability.toFixed(6)), 0.5);
  assert.equal(evPctToProbability(null, 2.2), null);
  assert.equal(evPctToProbability(10, 0), null);
});

test("applyReplayMutation rewrites formulaConfig numeric parameters and readReplayMutationValue reads them back", () => {
  const source = `
const INLINE_CONFIG = {
  cornerKicks: {
    blendWeight: 0.9,
    multifactor: {
      leagueWeight: 0.9,
    },
  },
};
`;

  const nextSource = applyReplayMutation(source, {
    declarationName: "INLINE_CONFIG",
    propertyPath: ["cornerKicks", "multifactor", "leagueWeight"],
    nextValue: 0.6,
  });

  assert.equal(
    readReplayMutationValue(
      nextSource,
      "INLINE_CONFIG",
      ["cornerKicks", "multifactor", "leagueWeight"]
    ),
    0.6
  );
  assert.match(nextSource, /leagueWeight:\s*0\.6/);
});

test("inferPoissonLambdaFromProbability inverts over-under probabilities to a stable lambda", () => {
  const lambda = 2;
  const overProbability = 1 - poissonCdf(1, lambda);
  const underProbability = poissonCdf(3, lambda);

  const overInferred = inferPoissonLambdaFromProbability({
    probability: overProbability,
    line: 1.5,
    isOver: true,
  });
  const underInferred = inferPoissonLambdaFromProbability({
    probability: underProbability,
    line: 3.5,
    isOver: false,
  });

  assert.ok(Math.abs(overInferred - lambda) < 0.02);
  assert.ok(Math.abs(underInferred - lambda) < 0.02);
});

test("scoreReplaySelections follows formulaConfig order and keeps only positive configured picks", () => {
  const summary = scoreReplaySelections([
    {
      statKey: "totalShots",
      odds: 2,
      win: true,
      headline: "Shots",
      formulaValues: {
        base: 6,
        leagueAvg: 12,
      },
    },
    {
      statKey: "cornerKicks",
      odds: 2,
      win: false,
      headline: "Corners",
      formulaValues: {
        leagueAvg: 4,
        multifactor: 10,
      },
    },
    {
      statKey: "yellowCards",
      odds: 3,
      win: true,
      headline: "Cards",
      formulaValues: {
        base: -2,
        multifactor: 9,
      },
    },
  ]);

  assert.equal(summary.metrics.selectedBets, 2);
  assert.equal(summary.metrics.settledBets, 2);
  assert.equal(summary.metrics.roiPct, 0);
  assert.equal(summary.metrics.expectedEvPct, 5);
  assert.equal(summary.metrics.formulaCounts.base, 1);
  assert.equal(summary.metrics.formulaCounts.leagueAvg, 1);
  assert.deepEqual(
    summary.topExamples.map((row) => row.headline),
    ["Shots", "Corners"]
  );
});

test("normalizeConditionToIsOver handles swedish and english over-under labels", () => {
  assert.equal(normalizeConditionToIsOver("över"), true);
  assert.equal(normalizeConditionToIsOver("Over"), true);
  assert.equal(normalizeConditionToIsOver("under"), false);
  assert.equal(normalizeConditionToIsOver("okänd"), null);
});

test("buildReplayFormulaValues recomputes base, multiplier, leagueAvg, and multifactor values", () => {
  const formulaValues = buildReplayFormulaValues({
    row: {
      statKey: "cornerKicks",
      scope: "home",
      line: 1.5,
      condition: "över",
      odds: 2,
      evDetails: {
        legacyEvPct: 10,
      },
    },
    baseResult: {
      prob: 0.6,
      probLegacy: 0.55,
      empirical: 0.62,
      blended: 0.72,
      lambda: 2,
      teamTuples: [{}, {}],
      statsFor: [7, 8],
      statsAgainst: [4, 5],
      tuples: [
        {
          meta: { homeTeamName: "Roma", awayTeamName: "Lazio" },
          data: { cornerKicks: { home: 7, away: 4, total: 11 } },
        },
        {
          meta: { homeTeamName: "Roma", awayTeamName: "Milan" },
          data: { cornerKicks: { home: 8, away: 3, total: 11 } },
        },
      ],
    },
    leagueLambda: 2.6,
    homeSlug: "roma",
    awaySlug: "lazio",
  });

  assert.equal(Number(formulaValues.base.toFixed(2)), 20);
  assert.ok(formulaValues.multiplier > formulaValues.base);
  assert.ok(formulaValues.leagueAvg > formulaValues.base);
  assert.ok(formulaValues.multifactor > formulaValues.base);
  assert.equal(formulaValues.legacy, 10);
});

test("buildNextNumericProposal skips attempted and already-applied mutations", () => {
  const source = `
const INLINE_CONFIG = {
  cornerKicks: {
    blendWeight: 0.9,
  },
  yellowCards: {
    blendWeight: 0.1,
  },
};
`;

  const proposal = buildNextNumericProposal({
    source,
    attemptedIds: new Set(["corners_blend_070"]),
    templates: [
      {
        id: "corners_blend_070",
        declarationName: "INLINE_CONFIG",
        propertyPath: ["cornerKicks", "blendWeight"],
        nextValue: 0.7,
        description: "lower corners blend weight",
      },
      {
        id: "cards_blend_030",
        declarationName: "INLINE_CONFIG",
        propertyPath: ["yellowCards", "blendWeight"],
        nextValue: 0.3,
        description: "raise cards blend weight",
      },
    ],
  });

  assert.equal(proposal.id, "cards_blend_030");
  assert.match(proposal.description, /0\.1 -> 0\.3/);
  assert.equal(
    readReplayMutationValue(
      proposal.nextSource,
      "INLINE_CONFIG",
      ["yellowCards", "blendWeight"]
    ),
    0.3
  );
});
