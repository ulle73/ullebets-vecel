import test from "node:test";
import assert from "node:assert/strict";

import mapUnibetOdds from "./components/backtest/unibetOddsMapper.js";

function buildCornerOffer(label) {
  return [
    {
      criterion: { label },
      outcomes: [
        { label: "Över", odds: 1500, line: 3500 },
        { label: "Under", odds: 2500, line: 3500 },
      ],
    },
  ];
}

function buildShotsOnGoalOffer(label, odds = 5800) {
  return [
    {
      criterion: { label },
      outcomes: [
        { label: "Över", englishLabel: "Over", odds, line: 500 },
      ],
    },
  ];
}

test("maps both legacy and new Unibet stat prefixes", () => {
  const legacyTuples = mapUnibetOdds(
    buildCornerOffer("Totala hörnor"),
    "Sevilla",
    "Real Sociedad"
  );
  const newTuples = mapUnibetOdds(
    buildCornerOffer("Antal hörnor"),
    "Sevilla",
    "Real Sociedad"
  );

  assert.equal(legacyTuples.length, 1);
  assert.equal(newTuples.length, 1);
  assert.deepEqual(legacyTuples[0].odds, { over: 1.5, under: 2.5 });
  assert.deepEqual(newTuples[0].odds, { over: 1.5, under: 2.5 });
});

test("ignores player-specific shots-on-goal markets", () => {
  const tuples = mapUnibetOdds(
    buildShotsOnGoalOffer("Antal skott på mål av spelaren (avgörs genom Opta Data)"),
    "Newcastle United",
    "West Ham United"
  );

  assert.equal(tuples.length, 0);
});
