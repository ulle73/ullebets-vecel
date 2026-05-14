import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMatchFromStatisticsPayload,
  buildMatchupOutcome,
  normalizeStatisticsBlocks,
} from "./lib/matchupsOutcome.js";

function makeFinishedMatch() {
  return {
    homeScore: 2,
    awayScore: 1,
    matchDetails: {
      statistics: [
        {
          period: "ALL",
          groups: [
            {
              statisticsItems: [
                { key: "shotsOnGoal", homeValue: 5, awayValue: 3 },
                { key: "yellowCards", homeValue: 2, awayValue: 4 },
              ],
            },
          ],
        },
      ],
    },
  };
}

test("buildMatchupOutcome resolves total/home/away values from match statistics", () => {
  const match = makeFinishedMatch();

  assert.deepEqual(
    buildMatchupOutcome(match, { statKey: "shotsOnGoal", period: "ALL", scope: "total" }),
    { actualValue: 8, homeValue: 5, awayValue: 3 }
  );

  assert.deepEqual(
    buildMatchupOutcome(match, { statKey: "shotsOnGoal", period: "ALL", scope: "home" }),
    { actualValue: 5, homeValue: 5, awayValue: 3 }
  );

  assert.deepEqual(
    buildMatchupOutcome(match, { statKey: "shotsOnGoal", period: "ALL", scope: "away" }),
    { actualValue: 3, homeValue: 5, awayValue: 3 }
  );
});

test("buildMatchupOutcome skips unfinished matches by default", () => {
  const unfinishedMatch = {
    startTimestamp: Math.floor(Date.now() / 1000) + 60 * 60,
    matchDetails: {
      statistics: [
        {
          period: "ALL",
          groups: [
            {
              statisticsItems: [{ key: "shotsOnGoal", homeValue: 1, awayValue: 1 }],
            },
          ],
        },
      ],
    },
  };

  assert.equal(
    buildMatchupOutcome(unfinishedMatch, { statKey: "shotsOnGoal", period: "ALL", scope: "total" }),
    null
  );
});

test("buildMatchupOutcome can use fallback statistics when finished status is unavailable", () => {
  const fallbackMatch = {
    matchDetails: {
      statistics: [
        {
          period: "ALL",
          groups: [
            {
              statisticsItems: [{ key: "yellowCards", homeValue: 1, awayValue: 5 }],
            },
          ],
        },
      ],
    },
  };

  assert.deepEqual(
    buildMatchupOutcome(
      fallbackMatch,
      { statKey: "yellowCards", period: "ALL", scope: "away" },
      { requireFinished: false }
    ),
    { actualValue: 5, homeValue: 1, awayValue: 5 }
  );
});

test("normalizeStatisticsBlocks handles nested fallback payload shape from fetchMatchStatistics", () => {
  const statistics = [
    {
      period: "2ND",
      groups: [
        {
          statisticsItems: [{ key: "totalTackle", homeValue: 11, awayValue: 5 }],
        },
      ],
    },
  ];

  assert.deepEqual(normalizeStatisticsBlocks(statistics), statistics);
  assert.deepEqual(normalizeStatisticsBlocks({ statistics }), statistics);
  assert.deepEqual(normalizeStatisticsBlocks({ data: { statistics } }), statistics);

  const match = buildMatchFromStatisticsPayload({ statistics });
  assert.deepEqual(
    buildMatchupOutcome(
      match,
      { statKey: "totalTackle", period: "2ND", scope: "total" },
      { requireFinished: false }
    ),
    { actualValue: 16, homeValue: 11, awayValue: 5 }
  );
});

test("buildMatchupOutcome resolves rankKey aliases like totalShotsOnGoal", () => {
  const match = {
    homeScore: 1,
    awayScore: 0,
    matchDetails: {
      statistics: [
        {
          period: "ALL",
          groups: [
            {
              statisticsItems: [{ key: "totalShotsOnGoal", homeValue: 16, awayValue: 8 }],
            },
          ],
        },
      ],
    },
  };

  assert.deepEqual(
    buildMatchupOutcome(match, { statKey: "totalShotsOnGoal", period: "ALL", scope: "total" }),
    { actualValue: 24, homeValue: 16, awayValue: 8 }
  );
});
