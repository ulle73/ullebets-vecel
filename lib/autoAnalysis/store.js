export const AUTO_ANALYSIS_RUN_COLLECTION = "auto-analysis-runs";
export const AUTO_ANALYSIS_BET_COLLECTION = "auto-analysis-bets";

const MAX_QUERY_LIMIT = 5000;

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toInteger(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function clamp(min, value, max) {
  return Math.min(Math.max(value, min), max);
}

function sanitizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeDateString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeRiskFlags(flags) {
  return Array.isArray(flags)
    ? flags.slice(0, 8).map((flag) => ({
        id: sanitizeString(flag?.id),
        label: sanitizeString(flag?.label),
        severity: toInteger(flag?.severity, 0),
      }))
    : [];
}

function sanitizeEntries(entries) {
  return Array.isArray(entries)
    ? entries.slice(0, 8).map((entry) => ({
        key: sanitizeString(entry?.key),
        label: sanitizeString(entry?.label),
        value: toFiniteNumber(entry?.value),
      }))
    : [];
}

function sanitizeRankReasons(reasons) {
  return Array.isArray(reasons)
    ? reasons.slice(0, 8).map((reason) => ({
        id: sanitizeString(reason?.id),
        label: sanitizeString(reason?.label),
        tone: sanitizeString(reason?.tone),
      }))
    : [];
}

function sanitizeRanking(ranking) {
  if (!ranking || typeof ranking !== "object") return null;
  return {
    edgeScore: toFiniteNumber(ranking.edgeScore),
    confidenceScore: toFiniteNumber(ranking.confidenceScore),
    consensusScore: toFiniteNumber(ranking.consensusScore),
    sampleScore: toFiniteNumber(ranking.sampleScore),
    priceScore: toFiniteNumber(ranking.priceScore),
    marketScore: toFiniteNumber(ranking.marketScore),
    formulaSpread: toFiniteNumber(ranking.formulaSpread),
    formulaDeviation: toFiniteNumber(ranking.formulaDeviation),
    learningAdjustment: toFiniteNumber(ranking.learningAdjustment),
    learningConfidencePct: toFiniteNumber(ranking.learningConfidencePct),
    learningMinBets: toFiniteNumber(ranking.learningMinBets),
  };
}

function sanitizeProof(proof) {
  if (!proof || typeof proof !== "object") return null;
  return {
    proofScore: toFiniteNumber(proof.proofScore),
    label: sanitizeString(proof.label),
    sampleReady: toBoolean(proof.sampleReady),
    modelCoverageReady: toBoolean(proof.modelCoverageReady),
    historicalReady: toBoolean(proof.historicalReady),
    flags: Array.isArray(proof.flags)
      ? proof.flags.slice(0, 4).map((flag) => ({
          id: sanitizeString(flag?.id),
          label: sanitizeString(flag?.label),
          tone: sanitizeString(flag?.tone),
        }))
      : [],
  };
}

export function sanitizeBetPayload(bet = {}) {
  return {
    key: sanitizeString(bet.key),
    statKey: sanitizeString(bet.statKey),
    line: toFiniteNumber(bet.line),
    direction: bet.direction === "under" ? "under" : "over",
    scope: sanitizeString(bet.scope) || "total",
    period: sanitizeString(bet.period) || "ALL",
    odds: toFiniteNumber(bet.odds),
    homeTeam: sanitizeString(bet.homeTeam),
    awayTeam: sanitizeString(bet.awayTeam),
  };
}

export function buildTrackingKey(matchId, bet) {
  const normalizedMatchId = matchId != null ? String(matchId) : "unknown-match";
  if (typeof bet?.key === "string" && bet.key.trim()) {
    return `${normalizedMatchId}:${bet.key.trim()}`;
  }
  return `${normalizedMatchId}:${bet?.statKey || "stat"}:${bet?.scope || "total"}:${bet?.period || "ALL"}:${bet?.line ?? "line"}:${bet?.direction || "over"}`;
}

export function buildComparisonKey(matchId, bet, strategyId = "balanced") {
  return `${buildTrackingKey(matchId, bet)}:${strategyId || "balanced"}`;
}

export function sanitizeShortlistItem(item = {}) {
  return {
    trackingKey: sanitizeString(item.trackingKey),
    comparisonKey: sanitizeString(item.comparisonKey),
    matchId: item.matchId != null ? String(item.matchId) : null,
    homeTeamName: sanitizeString(item.homeTeamName),
    awayTeamName: sanitizeString(item.awayTeamName),
    leagueName: sanitizeString(item.leagueName),
    matchDate: sanitizeString(item.matchDate),
    headline: sanitizeString(item.headline),
    primaryEv: toFiniteNumber(item.primaryEv),
    confidenceScore: toFiniteNumber(item.confidenceScore),
    agreementPct: toFiniteNumber(item.agreementPct),
    sampleSize: toFiniteNumber(item.sampleSize),
    strategyScore: toFiniteNumber(item.strategyScore),
    strategyId: sanitizeString(item.strategyId),
    strategyLabel: sanitizeString(item.strategyLabel),
    checkpointKey: sanitizeString(item.checkpointKey),
    checkpointLabel: sanitizeString(item.checkpointLabel),
    checkpointTargetDays: toFiniteNumber(item.checkpointTargetDays),
    timestamp: toFiniteNumber(item.timestamp),
    scopeLabel: sanitizeString(item.scopeLabel),
    periodLabel: sanitizeString(item.periodLabel),
    rationale: sanitizeString(item.rationale),
    riskFlags: sanitizeRiskFlags(item.riskFlags),
    entries: sanitizeEntries(item.entries),
    rankReasons: sanitizeRankReasons(item.rankReasons),
    ranking: sanitizeRanking(item.ranking),
    proof: sanitizeProof(item.proof),
    bet: sanitizeBetPayload(item.bet),
  };
}

export function sanitizeAutoAnalysisRun(body = {}) {
  return {
    runId: sanitizeString(body.runId),
    runKey: sanitizeString(body.runKey),
    date: sanitizeDateString(body.date),
    strategyId: sanitizeString(body.strategyId),
    strategyLabel: sanitizeString(body.strategyLabel),
    source: sanitizeString(body.source) || "manual-ui",
    checkpointKey: sanitizeString(body.checkpointKey),
    checkpointLabel: sanitizeString(body.checkpointLabel),
    checkpointTargetDays: toFiniteNumber(body.checkpointTargetDays),
    analyzedMatches: toInteger(body.analyzedMatches, 0),
    marketCount: toInteger(body.marketCount, 0),
    candidateCount: toInteger(body.candidateCount, 0),
    qualifyingCandidateCount: toInteger(body.qualifyingCandidateCount, 0),
    shortlistCount: toInteger(body.shortlistCount, 0),
    provenCount: toInteger(body.provenCount, 0),
    createdAt: body.createdAt instanceof Date ? body.createdAt : new Date(),
    updatedAt: body.updatedAt instanceof Date ? body.updatedAt : body.createdAt instanceof Date ? body.createdAt : new Date(),
  };
}

export function sanitizeAnalysisSnapshot(body = {}) {
  return {
    runId: sanitizeString(body.runId),
    runKey: sanitizeString(body.runKey),
    date: sanitizeDateString(body.date),
    strategyId: sanitizeString(body.strategyId),
    strategyLabel: sanitizeString(body.strategyLabel),
    checkpointKey: sanitizeString(body.checkpointKey),
    checkpointLabel: sanitizeString(body.checkpointLabel),
    checkpointTargetDays: toFiniteNumber(body.checkpointTargetDays),
    analyzedMatches: toInteger(body.analyzedMatches, 0),
    shortlist: Array.isArray(body.shortlist) ? body.shortlist.map(sanitizeShortlistItem).filter((item) => item.matchId && item.bet?.statKey && item.bet?.line != null) : [],
    createdAt: body.createdAt instanceof Date ? body.createdAt : new Date(),
  };
}

export function sanitizeAutoAnalysisBet(input = {}) {
  const run = input?.run || {};
  const match = input?.match || {};
  const candidate = input?.candidate || {};
  const bet = sanitizeBetPayload(candidate.bet);
  const primaryEv = toFiniteNumber(candidate.primaryEv) ?? 0;
  const stakeUnits = toFiniteNumber(input.stakeUnits) ?? 1;
  const expectedUnits = round((primaryEv / 100) * stakeUnits, 2);
  const matchId = match?.matchId ?? match?.id ?? candidate?.matchId ?? null;
  const createdAt = input.createdAt instanceof Date ? input.createdAt : new Date();
  const strategyId = sanitizeString(run.strategyId) || sanitizeString(candidate.strategyId) || "balanced";

  return {
    runId: sanitizeString(run.runId),
    runKey: sanitizeString(run.runKey),
    date: sanitizeDateString(run.date),
    strategyId,
    strategyLabel: sanitizeString(run.strategyLabel) || sanitizeString(candidate.strategyLabel),
    source: sanitizeString(run.source) || "manual-ui",
    trackingKey: buildTrackingKey(matchId, bet),
    comparisonKey: buildComparisonKey(matchId, bet, strategyId),
    matchId: matchId != null ? String(matchId) : null,
    homeTeamName: sanitizeString(match.homeTeamName) || sanitizeString(candidate.homeTeamName) || bet.homeTeam,
    awayTeamName: sanitizeString(match.awayTeamName) || sanitizeString(candidate.awayTeamName) || bet.awayTeam,
    leagueName: sanitizeString(match.leagueName) || sanitizeString(candidate.leagueName),
    matchDate: sanitizeString(match.matchDate) || sanitizeString(match.start) || null,
    timestamp: toFiniteNumber(match.timestamp),
    checkpointKey: sanitizeString(run.checkpointKey) || sanitizeString(input.checkpointKey),
    checkpointLabel: sanitizeString(run.checkpointLabel) || sanitizeString(input.checkpointLabel),
    checkpointTargetDays: toFiniteNumber(run.checkpointTargetDays ?? input.checkpointTargetDays),
    headline: sanitizeString(candidate.headline),
    rationale: sanitizeString(candidate.rationale),
    scopeLabel: sanitizeString(candidate.scopeLabel),
    periodLabel: sanitizeString(candidate.periodLabel),
    primaryEv,
    confidenceScore: toFiniteNumber(candidate.confidenceScore),
    agreementPct: toFiniteNumber(candidate.agreementPct),
    sampleSize: toFiniteNumber(candidate.sampleSize),
    strategyScore: toFiniteNumber(candidate.strategyScore),
    proof: sanitizeProof(candidate.proof),
    ranking: sanitizeRanking(candidate.ranking),
    riskFlags: sanitizeRiskFlags(candidate.riskFlags),
    rankReasons: sanitizeRankReasons(candidate.rankReasons),
    entries: sanitizeEntries(candidate.entries),
    marketCount: toInteger(input.marketCount, 0),
    stakeUnits,
    expectedUnits,
    eventUrl: sanitizeString(input.eventUrl),
    status: sanitizeString(input.status) || "pending",
    result: sanitizeString(input.result),
    actualValue: toFiniteNumber(input.actualValue),
    roiUnits: toFiniteNumber(input.roiUnits),
    pnlUnits: toFiniteNumber(input.pnlUnits),
    isPositiveEv: primaryEv > 0,
    passesStrategyFilters: toBoolean(input.passesStrategyFilters),
    isBestBetForMatch: toBoolean(input.isBestBetForMatch),
    wasShownInUi: toBoolean(input.wasShownInUi),
    bet,
    createdAt,
    updatedAt: input.updatedAt instanceof Date ? input.updatedAt : createdAt,
  };
}

export function buildAutoAnalysisQueryOptions(input = {}) {
  const filter = {};

  const date = sanitizeDateString(input.date);
  const runId = sanitizeString(input.runId);
  const strategyId = sanitizeString(input.strategyId);
  const matchId = input.matchId != null ? String(input.matchId) : null;
  const statKey = sanitizeString(input.statKey);
  const leagueName = sanitizeString(input.leagueName);
  const checkpointKey = sanitizeString(input.checkpointKey);
  const comparisonKey = sanitizeString(input.comparisonKey);
  const status = sanitizeString(input.status);
  const result = sanitizeString(input.result);
  const passesStrategyFilters = input.passesStrategyFilters;
  const isBestBetForMatch = input.isBestBetForMatch;

  if (date) filter.date = date;
  if (runId) filter.runId = runId;
  if (strategyId) filter.strategyId = strategyId;
  if (matchId) filter.matchId = matchId;
  if (statKey) filter["bet.statKey"] = statKey;
  if (leagueName) filter.leagueName = leagueName;
  if (checkpointKey) filter.checkpointKey = checkpointKey;
  if (comparisonKey) filter.comparisonKey = comparisonKey;
  if (status) filter.status = status;
  if (result) filter.result = result;
  if (passesStrategyFilters !== undefined) filter.passesStrategyFilters = toBoolean(passesStrategyFilters);
  if (isBestBetForMatch !== undefined) filter.isBestBetForMatch = toBoolean(isBestBetForMatch);

  const minStrategyScore = toFiniteNumber(input.minStrategyScore);
  if (minStrategyScore != null) filter.strategyScore = { $gte: minStrategyScore };

  const minConfidenceScore = toFiniteNumber(input.minConfidenceScore);
  if (minConfidenceScore != null) filter.confidenceScore = { $gte: minConfidenceScore };

  const minPrimaryEv = toFiniteNumber(input.minPrimaryEv);
  if (minPrimaryEv != null) filter.primaryEv = { $gte: minPrimaryEv };

  const minSampleSize = toFiniteNumber(input.minSampleSize);
  if (minSampleSize != null) filter.sampleSize = { $gte: minSampleSize };

  const limit = clamp(1, toInteger(input.limit, 250), MAX_QUERY_LIMIT);
  return {
    filter,
    limit,
  };
}

export function summarizeAutoAnalysisBets(items = []) {
  const settled = (Array.isArray(items) ? items : []).filter((item) => ["win", "loss", "push"].includes(item?.result));
  const source = settled.length ? settled : Array.isArray(items) ? items : [];
  const stakedUnits = source.reduce((sum, item) => sum + (toFiniteNumber(item?.stakeUnits) ?? 1), 0);
  const totals = source.reduce(
    (acc, item) => {
      const expectedUnits = toFiniteNumber(item?.expectedUnits) ?? 0;
      const pnlUnits = toFiniteNumber(item?.pnlUnits) ?? 0;
      const primaryEv = toFiniteNumber(item?.primaryEv) ?? 0;
      const confidenceScore = toFiniteNumber(item?.confidenceScore) ?? 0;
      const strategyScore = toFiniteNumber(item?.strategyScore) ?? 0;

      acc.bets += 1;
      if (item?.result === "win") acc.wins += 1;
      if (item?.result === "loss") acc.losses += 1;
      if (item?.result === "push") acc.pushes += 1;
      acc.expectedUnits += expectedUnits;
      acc.pnlUnits += pnlUnits;
      acc.evSum += primaryEv;
      acc.confidenceSum += confidenceScore;
      acc.strategyScoreSum += strategyScore;
      if (item?.proof?.historicalReady) acc.proofReady += 1;
      return acc;
    },
    {
      bets: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      expectedUnits: 0,
      pnlUnits: 0,
      evSum: 0,
      confidenceSum: 0,
      strategyScoreSum: 0,
      proofReady: 0,
    }
  );

  return {
    bets: totals.bets,
    settledBets: settled.length,
    wins: totals.wins,
    losses: totals.losses,
    pushes: totals.pushes,
    winRatePct: totals.bets ? Math.round((totals.wins / totals.bets) * 100) : 0,
    expectedUnits: round(totals.expectedUnits, 2),
    pnlUnits: round(totals.pnlUnits, 2),
    roiPct: stakedUnits ? round((totals.pnlUnits / stakedUnits) * 100, 1) : 0,
    avgEv: totals.bets ? round(totals.evSum / totals.bets, 1) : 0,
    avgConfidence: totals.bets ? Math.round(totals.confidenceSum / totals.bets) : 0,
    avgStrategyScore: totals.bets ? round(totals.strategyScoreSum / totals.bets, 1) : 0,
    proofReadyPct: totals.bets ? Math.round((totals.proofReady / totals.bets) * 100) : 0,
  };
}
