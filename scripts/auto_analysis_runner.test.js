import test from "node:test";
import assert from "node:assert/strict";

import { runAutoAnalysis } from "../lib/autoAnalysis/runAutoAnalysis.js";

test("runAutoAnalysis persists all evaluated bets while deriving shortlist from qualified candidates", async () => {
  const match = {
    matchId: "match-1",
    homeTeamName: "Como",
    awayTeamName: "Parma",
    leagueName: "Serie A",
    timestamp: 1780000000,
  };

  const result = await runAutoAnalysis(
    {
      date: "2026-05-17",
      matches: [match],
      strategyId: "balanced",
      strategyLabel: "Balans",
      source: "manual-ui",
      learningProfile: null,
      checkpoint: {
        key: "d3",
        label: "3 dagar innan",
        targetDays: 3,
      },
    },
    {
      concurrency: 1,
      lookupOdds: async () => ({ odds: [{ market: "stub" }], eventUrl: "https://example.com/event/1" }),
      mapOdds: () => ([
        { statKey: "cornerKicks", scope: "total", period: "ALL", line: 4.5, odds: { under: 2.23 } },
        { statKey: "cornerKicks", scope: "total", period: "ALL", line: 10.5, odds: { over: 3.4 } },
      ]),
      evaluateBatchBets: async () => ([
        {
          params: {
            home: "Como",
            away: "Parma",
            stat: "cornerKicks",
            scope: "total",
            period: "ALL",
            line: 4.5,
            over: false,
            odds: 2.23,
            form: "all",
            neutralGround: false,
          },
          evPct: 24.2,
          matches: 47,
        },
        {
          params: {
            home: "Como",
            away: "Parma",
            stat: "cornerKicks",
            scope: "total",
            period: "ALL",
            line: 10.5,
            over: true,
            odds: 3.4,
            form: "all",
            neutralGround: false,
          },
          evPct: -2.5,
          matches: 4,
        },
      ]),
    }
  );

  assert.equal(result.run.analyzedMatches, 1);
  assert.equal(result.run.marketCount, 2);
  assert.equal(result.run.candidateCount, 2);
  assert.equal(result.run.qualifyingCandidateCount, 1);
  assert.equal(result.run.checkpointKey, "d3");
  assert.equal(result.shortlist.length, 1);
  assert.equal(result.bestOverall.headline, "Under 4.5 Hörnor");
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].checkpointKey, "d3");
  assert.equal(result.candidates[0].passesStrategyFilters, true);
  assert.equal(result.candidates[0].isBestBetForMatch, true);
  assert.equal(result.candidates[1].passesStrategyFilters, false);
  assert.equal(result.candidates[1].isPositiveEv, false);
});
