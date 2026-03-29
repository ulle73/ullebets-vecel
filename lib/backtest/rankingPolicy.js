export const POLICY_VERSION = "2026-04-01-autoresearch-v1";

export const STAT_MARKET_PRIORS = {
  shotsOnGoal: 84,
  cornerKicks: 82,
  totalShots: 78,
  fouls: 68,
  freeKicks: 64,
  totalTackle: 63,
  yellowCards: 61,
  throwIns: 58,
  offsides: 56,
};

export const PERIOD_MARKET_PRIORS = {
  ALL: 100,
  "1ST": 88,
  "2ND": 78,
};

export const SCOPE_MARKET_PRIORS = {
  total: 100,
  home: 87,
  away: 87,
};

export const DEFAULT_RANKING_WEIGHTS = {
  edge: 0.28,
  confidence: 0.22,
  consensus: 0.18,
  sample: 0.12,
  price: 0.08,
  market: 0.12,
  risk: 1,
  proof: 0.05,
  learning: 1,
};

export const STRATEGY_PROFILES = {
  safe: {
    id: "safe",
    label: "Safe",
    minConfidence: 72,
    minAgreementPct: 60,
    minSampleSize: 10,
    allowedStats: null,
    boosts: {},
    weights: {
      edge: 0.18,
      confidence: 0.28,
      consensus: 0.22,
      sample: 0.16,
      price: 0.08,
      market: 0.08,
      risk: 1.2,
      proof: 0.08,
      learning: 1,
    },
  },
  balanced: {
    id: "balanced",
    label: "Balans",
    minConfidence: 55,
    minAgreementPct: 40,
    minSampleSize: 6,
    allowedStats: null,
    boosts: {},
    weights: {
      edge: 0.28,
      confidence: 0.22,
      consensus: 0.18,
      sample: 0.12,
      price: 0.08,
      market: 0.12,
      risk: 1,
      proof: 0.05,
      learning: 1,
    },
  },
  aggressive: {
    id: "aggressive",
    label: "Aggressiv",
    minConfidence: 40,
    minAgreementPct: 20,
    minSampleSize: 4,
    allowedStats: null,
    boosts: {},
    weights: {
      edge: 0.42,
      confidence: 0.12,
      consensus: 0.10,
      sample: 0.08,
      price: 0.06,
      market: 0.08,
      risk: 0.72,
      proof: 0.03,
      learning: 0.75,
    },
  },
  corners: {
    id: "corners",
    label: "Hörnor",
    minConfidence: 52,
    minAgreementPct: 35,
    minSampleSize: 6,
    allowedStats: ["cornerKicks"],
    boosts: { cornerKicks: 10 },
    weights: {
      edge: 0.30,
      confidence: 0.18,
      consensus: 0.18,
      sample: 0.12,
      price: 0.08,
      market: 0.14,
      risk: 0.90,
      proof: 0.05,
      learning: 1,
    },
  },
  shots: {
    id: "shots",
    label: "Skott",
    minConfidence: 52,
    minAgreementPct: 35,
    minSampleSize: 6,
    allowedStats: ["totalShots", "shotsOnGoal"],
    boosts: { totalShots: 6, shotsOnGoal: 10 },
    weights: {
      edge: 0.30,
      confidence: 0.18,
      consensus: 0.18,
      sample: 0.12,
      price: 0.08,
      market: 0.14,
      risk: 0.90,
      proof: 0.05,
      learning: 1,
    },
  },
};

export const PROOF_THRESHOLDS = {
  learningMinBucketBets: 8,
  learningMinConfidencePct: 35,
  learningReadyMinBets: 20,
  sampleReadyMin: 8,
  modelCoverageMin: 3,
  safeMinProofScore: 55,
  proofStateVerifiedMin: 78,
  proofStateOkayMin: 58,
  proofScoreWeights: {
    confidence: 0.50,
    sample: 1.80,
    learning: 0.18,
  },
};

export const SCORE_SHAPING = {
  edgeDecay: 7.5,
  idealPriceCenter: 2.05,
  priceDistanceWeight: 55,
  shortOddsCutoff: 1.45,
  shortOddsScore: 42,
  highOddsCutoff: 3.4,
  highOddsMinScore: 30,
  highOddsMaxScore: 75,
  normalOddsMinScore: 35,
};

export const RESEARCH_OBJECTIVE = {
  replayDays: 90,
  maxSnapshots: 600,
  picksPerDate: 3,
  strategyId: "balanced",
  scoreWeights: {
    beatClosePct: 0.50,
    avgClvScore: 0.30,
    roiScore: 0.20,
  },
  guardrails: {
    minPickedDates: 10,
    minPickedBets: 20,
    minProofCoveragePct: 25,
  },
};

export function clamp(min, value, max) {
  return Math.min(Math.max(value, min), max);
}

export function buildPriceScoreFromOdds(odds) {
  if (!Number.isFinite(odds) || odds <= 1) return 45;
  const distance = Math.abs(odds - SCORE_SHAPING.idealPriceCenter);
  const raw = 100 - distance * SCORE_SHAPING.priceDistanceWeight;
  if (odds < SCORE_SHAPING.shortOddsCutoff) return SCORE_SHAPING.shortOddsScore;
  if (odds > SCORE_SHAPING.highOddsCutoff) {
    return Math.round(clamp(SCORE_SHAPING.highOddsMinScore, raw, SCORE_SHAPING.highOddsMaxScore));
  }
  return Math.round(clamp(SCORE_SHAPING.normalOddsMinScore, raw, 100));
}

export function buildMarketScoreFromBet(bet = {}) {
  const statScore = STAT_MARKET_PRIORS[bet?.statKey] || 60;
  const periodScore = PERIOD_MARKET_PRIORS[bet?.period || "ALL"] || 80;
  const scopeScore = SCOPE_MARKET_PRIORS[bet?.scope || "total"] || 80;
  return Math.round(statScore * 0.45 + periodScore * 0.25 + scopeScore * 0.30);
}

export function getStrategyProfile(strategyId = "balanced") {
  return STRATEGY_PROFILES[strategyId] || STRATEGY_PROFILES.balanced;
}

export function buildLearningAdjustmentFromLookups(result, lookups = null) {
  if (!lookups) {
    return { adjustment: 0, confidencePct: 0, sources: [], proofReady: false, minBets: 0 };
  }

  const statKey = result?.bet?.statKey || "unknown";
  const scope = result?.bet?.scope || "total";
  const period = result?.bet?.period || "ALL";
  const leagueKey = String(result?.leagueName || result?.bet?.leagueName || "unknown-league")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();

  const sourceSpecs = [
    { id: "stat", label: "Stat-historik", weight: 0.45, bucket: lookups?.stat?.[statKey] },
    { id: "scope-period", label: "Scope/period-historik", weight: 0.20, bucket: lookups?.scopePeriod?.[`${scope}|${period}`] },
    { id: "league-stat", label: "Liga + stat-historik", weight: 0.35, bucket: lookups?.leagueStat?.[`${leagueKey}|${statKey}`] },
  ];

  const weightedSources = sourceSpecs
    .filter((spec) => spec.bucket && (Number(spec.bucket.bets) || 0) >= PROOF_THRESHOLDS.learningMinBucketBets)
    .map((spec) => {
      const confidence = clamp(0, (Number(spec.bucket.confidencePct) || 0) / 100, 1);
      return {
        id: spec.id,
        label: spec.label,
        weight: spec.weight,
        confidence,
        effectiveWeight: spec.weight * confidence,
        adjustment: Number(spec.bucket.adjustment) || 0,
        bets: Number(spec.bucket.bets) || 0,
        roiPct: Number(spec.bucket.roiPct) || 0,
        winRatePct: Number(spec.bucket.winRatePct) || 0,
      };
    })
    .filter((source) => source.effectiveWeight > 0);

  if (!weightedSources.length) {
    return { adjustment: 0, confidencePct: 0, sources: [], proofReady: false, minBets: 0 };
  }

  const totalWeight = weightedSources.reduce((sum, source) => sum + source.effectiveWeight, 0) || 1;
  const weightedAdjustment = weightedSources.reduce((sum, source) => sum + source.adjustment * source.effectiveWeight, 0) / totalWeight;
  const confidencePct = Math.round(
    (weightedSources.reduce((sum, source) => sum + source.confidence * source.weight, 0) /
      sourceSpecs.reduce((sum, source) => sum + source.weight, 0)) * 100
  );
  const minBets = Math.min(...weightedSources.map((source) => source.bets));
  const proofReady = confidencePct >= PROOF_THRESHOLDS.learningMinConfidencePct && minBets >= PROOF_THRESHOLDS.learningReadyMinBets;

  return {
    adjustment: proofReady ? Number(clamp(-12, weightedAdjustment, 12).toFixed(1)) : 0,
    confidencePct,
    sources: weightedSources,
    proofReady,
    minBets,
  };
}

export function computeResearchScore({ beatClosePct = 0, avgClv = 0, roiPct = 0 }) {
  const clvScore = clamp(0, 50 + avgClv * 5, 100);
  const roiScore = clamp(0, 50 + roiPct * 2, 100);
  return Number((
    beatClosePct * RESEARCH_OBJECTIVE.scoreWeights.beatClosePct +
    clvScore * RESEARCH_OBJECTIVE.scoreWeights.avgClvScore +
    roiScore * RESEARCH_OBJECTIVE.scoreWeights.roiScore
  ).toFixed(2));
}

export function scoreCandidateWithPolicy(candidate, strategyId = "balanced") {
  const strategy = getStrategyProfile(strategyId);
  const weights = { ...DEFAULT_RANKING_WEIGHTS, ...(strategy.weights || {}) };
  const riskScore = Number.isFinite(Number(candidate?.riskScore))
    ? Number(candidate.riskScore)
    : Array.isArray(candidate?.riskFlags)
      ? candidate.riskFlags.reduce((sum, flag) => sum + (Number(flag?.severity) || 0), 0)
      : 0;

  const edgeScore = Number.isFinite(Number(candidate?.ranking?.edgeScore)) ? Number(candidate.ranking.edgeScore) : 0;
  const confidenceScore = Number.isFinite(Number(candidate?.confidenceScore)) ? Number(candidate.confidenceScore) : 0;
  const consensusScore = Number.isFinite(Number(candidate?.ranking?.consensusScore))
    ? Number(candidate.ranking.consensusScore)
    : Number.isFinite(Number(candidate?.agreementPct))
      ? Number(candidate.agreementPct)
      : 0;
  const sampleScore = Number.isFinite(Number(candidate?.ranking?.sampleScore)) ? Number(candidate.ranking.sampleScore) : 0;
  const priceScore = Number.isFinite(Number(candidate?.ranking?.priceScore))
    ? Number(candidate.ranking.priceScore)
    : buildPriceScoreFromOdds(Number(candidate?.bet?.odds));
  const marketScore = Number.isFinite(Number(candidate?.ranking?.marketScore))
    ? Number(candidate.ranking.marketScore)
    : buildMarketScoreFromBet(candidate?.bet);
  const learningAdjustment = Number.isFinite(Number(candidate?.ranking?.learningAdjustment))
    ? Number(candidate.ranking.learningAdjustment)
    : 0;
  const proofScore = Number.isFinite(Number(candidate?.proof?.proofScore)) ? Number(candidate.proof.proofScore) : 0;
  const statBoost = strategy.boosts?.[candidate?.bet?.statKey] || 0;

  const score =
    edgeScore * weights.edge +
    confidenceScore * weights.confidence +
    consensusScore * weights.consensus +
    sampleScore * weights.sample +
    priceScore * weights.price +
    marketScore * weights.market +
    learningAdjustment * weights.learning +
    proofScore * weights.proof +
    statBoost -
    riskScore * 8 * weights.risk;

  return {
    score: Number(score.toFixed(2)),
    breakdown: {
      edgeScore,
      confidenceScore,
      consensusScore,
      sampleScore,
      priceScore,
      marketScore,
      learningAdjustment,
      proofScore,
      riskScore,
      statBoost,
      strategyId: strategy.id,
      strategyLabel: strategy.label,
    },
  };
}
