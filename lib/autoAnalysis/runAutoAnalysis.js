import {
  getStrategyProfile,
  matchesStrategyFilters,
  normalizeBatchResult,
  scoreResultForStrategy,
} from "../backtest/resultSummary.js";
import { sanitizeAutoAnalysisBet, sanitizeAutoAnalysisRun } from "./store.js";

const DEFAULT_CONCURRENCY = 2;
const MAX_BETS_PER_MATCH = 120;

function sortByStrategyThenEv(a, b) {
  if ((b?.strategyScore || 0) !== (a?.strategyScore || 0)) {
    return (b?.strategyScore || 0) - (a?.strategyScore || 0);
  }
  return (b?.primaryEv || 0) - (a?.primaryEv || 0);
}

export function buildBatchBets(match, tuples) {
  const unique = new Map();

  for (const tuple of Array.isArray(tuples) ? tuples : []) {
    const base = {
      homeTeam: match?.homeTeamName,
      awayTeam: match?.awayTeamName,
      line: tuple.line,
      scope: tuple.scope,
      stat: tuple.statKey,
      period: tuple.period,
      form: "all",
      neutralGround: false,
      home_importance: 5,
      away_importance: 5,
    };

    if (Number.isFinite(tuple?.odds?.over) && tuple.odds.over > 1) {
      const key = `${base.homeTeam}|${base.awayTeam}|${base.stat}|${base.scope}|${base.period}|${base.line}|over`;
      unique.set(key, { ...base, over: true, odds: tuple.odds.over });
    }

    if (Number.isFinite(tuple?.odds?.under) && tuple.odds.under > 1) {
      const key = `${base.homeTeam}|${base.awayTeam}|${base.stat}|${base.scope}|${base.period}|${base.line}|under`;
      unique.set(key, { ...base, over: false, odds: tuple.odds.under });
    }
  }

  return Array.from(unique.values()).slice(0, MAX_BETS_PER_MATCH);
}

async function analyzeSingleMatch(match, options, deps, now) {
  const { strategyId = "balanced", learningProfile = null, runMeta = {} } = options;
  const lookup = await deps.lookupOdds(match);
  const tuples = deps.mapOdds(lookup?.odds, match?.homeTeamName, match?.awayTeamName);
  if (!tuples.length) {
    return {
      match,
      eventUrl: lookup?.eventUrl || null,
      marketCount: 0,
      candidates: [],
      qualifyingCandidates: [],
      bestBet: null,
      status: "no-markets",
    };
  }

  const bets = buildBatchBets(match, tuples);
  if (!bets.length) {
    return {
      match,
      eventUrl: lookup?.eventUrl || null,
      marketCount: 0,
      candidates: [],
      qualifyingCandidates: [],
      bestBet: null,
      status: "no-bets",
    };
  }

  const rawResults = await deps.evaluateBatchBets(bets, match);
  const scoredCandidates = (Array.isArray(rawResults) ? rawResults : [])
    .filter((entry) => entry && !entry.error)
    .map((entry) => normalizeBatchResult(entry))
    .filter(Boolean)
    .map((entry) => scoreResultForStrategy(entry, strategyId, learningProfile))
    .sort(sortByStrategyThenEv);

  const qualifyingCandidates = scoredCandidates
    .filter((candidate) => matchesStrategyFilters(candidate, strategyId))
    .sort(sortByStrategyThenEv);

  const bestTrackingKey = qualifyingCandidates[0]?.bet?.key || null;
  const sanitizedCandidates = scoredCandidates.map((candidate) =>
    sanitizeAutoAnalysisBet({
      run: runMeta,
      match,
      candidate,
      marketCount: bets.length,
      eventUrl: lookup?.eventUrl || null,
      checkpointKey: runMeta.checkpointKey || null,
      checkpointLabel: runMeta.checkpointLabel || null,
      checkpointTargetDays: runMeta.checkpointTargetDays ?? null,
      wasShownInUi: matchesStrategyFilters(candidate, strategyId),
      isBestBetForMatch: Boolean(bestTrackingKey && candidate?.bet?.key === bestTrackingKey),
      passesStrategyFilters: matchesStrategyFilters(candidate, strategyId),
      stakeUnits: 1,
      createdAt: now,
    })
  );

  const bestBet = sanitizedCandidates.find((candidate) => candidate.isBestBetForMatch) || null;

  return {
    match,
    eventUrl: lookup?.eventUrl || null,
    marketCount: bets.length,
    candidates: sanitizedCandidates,
    qualifyingCandidates: sanitizedCandidates.filter((candidate) => candidate.passesStrategyFilters),
    bestBet,
    status: bestBet ? "ok" : "no-qualified-bets",
  };
}

export async function runAutoAnalysis(config = {}, deps = {}) {
  const strategyId = config?.strategyId || "balanced";
  const strategyProfile = getStrategyProfile(strategyId);
  const now = config?.createdAt instanceof Date ? config.createdAt : new Date();
  const runMeta = {
    runId: config?.runId || null,
    runKey: config?.runKey || null,
    date: config?.date || null,
    strategyId,
    strategyLabel: config?.strategyLabel || strategyProfile.label,
    source: config?.source || "manual-ui",
    checkpointKey: config?.checkpoint?.key || null,
    checkpointLabel: config?.checkpoint?.label || null,
    checkpointTargetDays: config?.checkpoint?.targetDays ?? null,
  };
  const runtime = {
    ...deps,
  };

  if (typeof runtime.lookupOdds !== "function") {
    throw new Error("runAutoAnalysis requires deps.lookupOdds");
  }
  if (typeof runtime.mapOdds !== "function") {
    throw new Error("runAutoAnalysis requires deps.mapOdds");
  }
  if (typeof runtime.evaluateBatchBets !== "function") {
    throw new Error("runAutoAnalysis requires deps.evaluateBatchBets");
  }

  const matches = Array.isArray(config?.matches) ? config.matches : [];
  const concurrency = Math.max(1, Math.min(Number(config?.concurrency || deps?.concurrency || DEFAULT_CONCURRENCY), matches.length || 1));
  const results = new Array(matches.length);
  let pointer = 0;

  const worker = async () => {
    while (pointer < matches.length) {
      const currentIndex = pointer++;
      const match = matches[currentIndex];
      try {
        results[currentIndex] = await analyzeSingleMatch(match, {
          strategyId,
          learningProfile: config?.learningProfile || null,
          runMeta,
        }, runtime, now);
      } catch (error) {
        results[currentIndex] = {
          match,
          eventUrl: null,
          marketCount: 0,
          candidates: [],
          qualifyingCandidates: [],
          bestBet: null,
          status: "error",
          error: error?.message || "Kunde inte analysera matchen",
        };
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  const entries = results.filter(Boolean);
  const shortlist = entries
    .filter((entry) => entry.bestBet)
    .map((entry) => ({
      match: entry.match,
      eventUrl: entry.eventUrl,
      marketCount: entry.marketCount,
      bestBet: entry.bestBet,
      qualifyingCandidatesCount: entry.qualifyingCandidates.length,
    }))
    .sort((a, b) => sortByStrategyThenEv(a.bestBet, b.bestBet));

  const candidates = entries.flatMap((entry) => entry.candidates).sort(sortByStrategyThenEv);
  const qualifyingCandidates = entries.flatMap((entry) => entry.qualifyingCandidates).sort(sortByStrategyThenEv);
  const bestOverall = shortlist[0]?.bestBet || null;

  const run = sanitizeAutoAnalysisRun({
    ...runMeta,
    analyzedMatches: matches.length,
    marketCount: entries.reduce((sum, entry) => sum + (entry.marketCount || 0), 0),
    candidateCount: candidates.length,
    qualifyingCandidateCount: qualifyingCandidates.length,
    shortlistCount: shortlist.length,
    provenCount: shortlist.filter((entry) => entry.bestBet?.proof?.historicalReady).length,
    createdAt: now,
    updatedAt: now,
  });

  return {
    run,
    entries,
    shortlist,
    candidates,
    qualifyingCandidates,
    bestOverall,
    summary: {
      shortlistCount: run.shortlistCount,
      provenCount: run.provenCount,
      candidateCount: run.candidateCount,
      qualifyingCandidateCount: run.qualifyingCandidateCount,
      marketCount: run.marketCount,
    },
  };
}
