import test from "node:test";
import assert from "node:assert/strict";

import {
  buildComparisonKey,
  buildAutoAnalysisQueryOptions,
  buildTrackingKey,
  sanitizeAutoAnalysisBet,
  sanitizeAutoAnalysisRun,
  summarizeAutoAnalysisBets,
} from "../lib/autoAnalysis/store.js";

test("sanitizeAutoAnalysisRun normalizes run metadata", () => {
  const createdAt = new Date("2026-05-15T08:30:00.000Z");
  const run = sanitizeAutoAnalysisRun({
    runId: "2026-05-17:balanced:abc123",
    date: "2026-05-17",
    strategyId: "balanced",
    strategyLabel: "Balans",
    source: "manual-ui",
    analyzedMatches: "43",
    marketCount: "5160",
    candidateCount: "242",
    qualifyingCandidateCount: "36",
    shortlistCount: "31",
    provenCount: "14",
    createdAt,
  });

  assert.equal(run.runId, "2026-05-17:balanced:abc123");
  assert.equal(run.analyzedMatches, 43);
  assert.equal(run.marketCount, 5160);
  assert.equal(run.candidateCount, 242);
  assert.equal(run.qualifyingCandidateCount, 36);
  assert.equal(run.shortlistCount, 31);
  assert.equal(run.provenCount, 14);
  assert.equal(run.source, "manual-ui");
  assert.equal(run.createdAt, createdAt);
});

test("sanitizeAutoAnalysisBet keeps atomized analysis fields and computes expected units", () => {
  const bet = sanitizeAutoAnalysisBet({
    run: {
      runId: "2026-05-17:balanced:abc123",
      date: "2026-05-17",
      strategyId: "balanced",
      strategyLabel: "Balans",
      source: "manual-ui",
    },
    match: {
      matchId: 99,
      homeTeamName: "Como",
      awayTeamName: "Parma",
      leagueName: "Serie A",
      timestamp: 1780000000,
    },
    candidate: {
      headline: "Under 4.5 Hörnor",
      primaryEv: 24.2,
      confidenceScore: 100,
      agreementPct: 100,
      sampleSize: 47,
      strategyScore: 99.4,
      strategyId: "balanced",
      strategyLabel: "Balans",
      proof: { proofScore: 86, historicalReady: true },
      ranking: { edgeScore: 91, marketScore: 76, learningAdjustment: 0 },
      riskFlags: [{ id: "thin-edge", label: "Tunn edge", severity: 1 }],
      bet: {
        key: "como::parma::cornerKicks::total::ALL::4.5::under",
        statKey: "cornerKicks",
        scope: "total",
        period: "ALL",
        line: 4.5,
        direction: "under",
        odds: 2.23,
        homeTeam: "Como",
        awayTeam: "Parma",
      },
    },
    checkpointKey: "d3",
    checkpointLabel: "3 dagar innan",
    checkpointTargetDays: 3,
    marketCount: 120,
    wasShownInUi: true,
    isBestBetForMatch: true,
    passesStrategyFilters: true,
    stakeUnits: 1,
    createdAt: new Date("2026-05-15T08:30:00.000Z"),
  });

  assert.equal(bet.runId, "2026-05-17:balanced:abc123");
  assert.equal(bet.matchId, "99");
  assert.equal(bet.trackingKey, buildTrackingKey("99", bet.bet));
  assert.equal(bet.comparisonKey, buildComparisonKey("99", bet.bet, "balanced"));
  assert.equal(bet.checkpointKey, "d3");
  assert.equal(bet.checkpointTargetDays, 3);
  assert.equal(bet.expectedUnits, 0.24);
  assert.equal(bet.isPositiveEv, true);
  assert.equal(bet.passesStrategyFilters, true);
  assert.equal(bet.isBestBetForMatch, true);
  assert.equal(bet.wasShownInUi, true);
  assert.equal(bet.proof.proofScore, 86);
  assert.equal(bet.ranking.edgeScore, 91);
});

test("buildAutoAnalysisQueryOptions converts atomic filters into a mongo-ready filter", () => {
  const { filter, limit } = buildAutoAnalysisQueryOptions({
    date: "2026-05-17",
    strategyId: "balanced",
    minStrategyScore: "90",
    minConfidenceScore: "60",
    minPrimaryEv: "8",
    minSampleSize: "10",
    checkpointKey: "d3",
    statKey: "cornerKicks",
    matchId: "99",
    passesStrategyFilters: "true",
    status: "settled",
    result: "win",
    limit: "150",
  });

  assert.equal(limit, 150);
  assert.deepEqual(filter.date, "2026-05-17");
  assert.deepEqual(filter.strategyId, "balanced");
  assert.deepEqual(filter.matchId, "99");
  assert.deepEqual(filter.checkpointKey, "d3");
  assert.deepEqual(filter.passesStrategyFilters, true);
  assert.deepEqual(filter.status, "settled");
  assert.deepEqual(filter.result, "win");
  assert.deepEqual(filter.strategyScore, { $gte: 90 });
  assert.deepEqual(filter.confidenceScore, { $gte: 60 });
  assert.deepEqual(filter.primaryEv, { $gte: 8 });
  assert.deepEqual(filter.sampleSize, { $gte: 10 });
  assert.deepEqual(filter["bet.statKey"], "cornerKicks");
});

test("summarizeAutoAnalysisBets aggregates expected value and realized performance", () => {
  const summary = summarizeAutoAnalysisBets([
    { expectedUnits: 0.24, pnlUnits: 1.23, result: "win", stakeUnits: 1, primaryEv: 24.2, confidenceScore: 100, strategyScore: 99.4, proof: { historicalReady: true } },
    { expectedUnits: 0.08, pnlUnits: -1, result: "loss", stakeUnits: 1, primaryEv: 8, confidenceScore: 62, strategyScore: 90.1, proof: { historicalReady: false } },
    { expectedUnits: 0.05, pnlUnits: 0, result: "push", stakeUnits: 1, primaryEv: 5, confidenceScore: 58, strategyScore: 88.5, proof: { historicalReady: false } },
  ]);

  assert.equal(summary.bets, 3);
  assert.equal(summary.settledBets, 3);
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 1);
  assert.equal(summary.pushes, 1);
  assert.equal(summary.winRatePct, 33);
  assert.equal(summary.expectedUnits, 0.37);
  assert.equal(summary.pnlUnits, 0.23);
  assert.equal(summary.roiPct, 7.7);
  assert.equal(summary.avgEv, 12.4);
  assert.equal(summary.avgStrategyScore, 92.7);
  assert.equal(summary.proofReadyPct, 33);
});
