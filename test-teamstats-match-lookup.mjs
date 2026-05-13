import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMatchIdCandidates,
  extractTeamstatsMatchSelections,
} from "./lib/teamstatsLookup.js";

function statisticsBlock(homeValue, awayValue, period = "ALL") {
  return {
    period,
    groups: [
      {
        statisticsItems: [
          {
            key: "cornerKicks",
            name: "Corner kicks",
            homeValue,
            awayValue,
          },
        ],
      },
    ],
  };
}

test("buildMatchIdCandidates keeps numeric and string forms for stable Mongo lookups", () => {
  assert.deepEqual(buildMatchIdCandidates("15237966"), ["15237966", 15237966]);
  assert.deepEqual(buildMatchIdCandidates(15237966), ["15237966", 15237966]);
  assert.deepEqual(buildMatchIdCandidates("abc-123"), ["abc-123"]);
});

test("extractTeamstatsMatchSelections finds matches stored inside teamstats full arrays", () => {
  const selections = extractTeamstatsMatchSelections(
    [
      {
        _id: "team-doc-home",
        full: [
          {
            matchId: 15237966,
            status: { type: "notstarted" },
            homeTeamName: "Botafogo",
            awayTeamName: "Mirassol",
            timestamp: 1775082600,
          },
          {
            matchId: 15237966,
            status: { type: "finished" },
            homeScore: 3,
            awayScore: 0,
            homeTeamName: "Botafogo",
            awayTeamName: "Mirassol",
            timestamp: 1775082600,
            matchDetails: {
              statistics: [statisticsBlock(7, 2)],
            },
          },
        ],
      },
      {
        _id: "other-team-doc",
        full: [
          {
            matchId: 999,
            status: { type: "finished" },
            matchDetails: {
              statistics: [statisticsBlock(1, 1)],
            },
          },
        ],
      },
    ],
    ["15237966"]
  );

  const selection = selections.get("15237966");
  assert.equal(selection.match.homeScore, 3);
  assert.equal(selection.match.matchDetails.statistics[0].groups[0].statisticsItems[0].homeValue, 7);
  assert.equal(selection.meta.candidateCount, 2);
  assert.equal(selection.meta.sourceDocCount, 1);
});

test("extractTeamstatsMatchSelections preserves legacy documents keyed directly by _id", () => {
  const selections = extractTeamstatsMatchSelections(
    [
      {
        _id: "legacy-match-id",
        full: [
          {
            status: { type: "finished" },
            homeScore: 1,
            awayScore: 1,
            matchDetails: {
              statistics: [statisticsBlock(5, 6)],
            },
          },
        ],
      },
    ],
    ["legacy-match-id"]
  );

  const selection = selections.get("legacy-match-id");
  assert.equal(selection.match.homeScore, 1);
  assert.equal(selection.meta.candidateCount, 1);
});
