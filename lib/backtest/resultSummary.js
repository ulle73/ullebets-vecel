import { getFormulaConfig } from "./formulaConfig.js";

const CORE_RESULT_FIELDS = [
  { key: "multiplier", valueKey: "evPctWithMultiplier", label: "Multiplier" },
  { key: "multifactor", valueKey: "evPctMultifactor", label: "Multifaktor" },
  { key: "leagueAvg", valueKey: "evPctLeagueAvg", label: "Liga" },
  { key: "base", valueKey: "evPct", label: "Modell" },
  { key: "legacy", valueKey: "legacyEvPct", label: "Legacy" },
];

const DEFAULT_FORMULA_PRIORITY = ["multiplier", "multifactor", "leagueAvg", "base", "legacy"];

const STAT_LABELS = {
  totalShots: "Skott",
  shotsOnGoal: "Skott på mål",
  cornerKicks: "Hörnor",
  yellowCards: "Gula kort",
  throwIns: "Inkast",
  freeKicks: "Frisparkar",
  fouls: "Fouls",
  totalTackle: "Tacklingar",
  offsides: "Offside",
};

const STAT_MARKET_PRIORS = {
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

const PERIOD_MARKET_PRIORS = {
  ALL: 100,
  "1ST": 88,
  "2ND": 78,
};

const SCOPE_MARKET_PRIORS = {
  total: 100,
  home: 87,
  away: 87,
};

const DEFAULT_RANKING_WEIGHTS = {
  edge: 0.28,
  confidence: 0.22,
  consensus: 0.18,
  sample: 0.12,
  price: 0.08,
  market: 0.12,
  risk: 1,
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
    },
    riskPenalty: 0,
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
    },
    riskPenalty: 0,
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
      consensus: 0.1,
      sample: 0.08,
      price: 0.06,
      market: 0.08,
      risk: 0.72,
    },
    riskPenalty: 0,
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
      edge: 0.3,
      confidence: 0.18,
      consensus: 0.18,
      sample: 0.12,
      price: 0.08,
      market: 0.14,
      risk: 0.9,
    },
    riskPenalty: 0,
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
      edge: 0.3,
      confidence: 0.18,
      consensus: 0.18,
      sample: 0.12,
      price: 0.08,
      market: 0.14,
      risk: 0.9,
    },
    riskPenalty: 0,
  },
};

function clamp(min, value, max) {
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

function humanizeStat(statKey) {
  return STAT_LABELS[statKey] || statKey || "Stat";
}

function humanizeDirection(direction) {
  return direction === "under" ? "Under" : "Över";
}

function humanizePeriod(period) {
  if (period === "1ST") return "Första halvlek";
  if (period === "2ND") return "Andra halvlek";
  return "Hela matchen";
}

function humanizeScope(scope, result) {
  if (scope === "home") {
    return result?.bet?.homeTeam || "Hemmalag";
  }
  if (scope === "away") {
    return result?.bet?.awayTeam || "Bortalag";
  }
  return "Totalt";
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function standardDeviation(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length < 2) return 0;
  const avg = average(filtered);
  const variance = average(filtered.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function getFormulaOrder(statKey) {
  const config = getFormulaConfig(statKey);
  const display = Array.isArray(config?.display) ? config.display : [];
  return [...new Set([...display, ...DEFAULT_FORMULA_PRIORITY])];
}

export function getCoreFormulaEntries(result) {
  if (!result || typeof result !== "object") {
    return [];
  }

  const entriesByKey = new Map(
    CORE_RESULT_FIELDS.map((field) => [field.key, field])
  );
  const statKey = result?.bet?.statKey ?? result?.params?.stat ?? null;
  const orderedKeys = getFormulaOrder(statKey);

  return orderedKeys
    .map((key) => {
      const field = entriesByKey.get(key);
      if (!field) return null;
      const value = toFiniteNumber(result[field.valueKey]);
      if (value == null) return null;
      return {
        key: field.key,
        label: field.label,
        value,
      };
    })
    .filter(Boolean);
}

export function getPrimaryEv(result) {
  if (toFiniteNumber(result?.primaryEv) != null) {
    return result.primaryEv;
  }
  const first = getCoreFormulaEntries(result)[0];
  return first?.value ?? null;
}

export function buildConfidenceMetrics(result) {
  const entries = getCoreFormulaEntries(result);
  const available = entries.length;
  const positive = entries.filter((entry) => entry.value > 0).length;
  const agreementRatio = available ? positive / available : 0;
  const sampleSize = clamp(0, Number(result?.matches) || 0, 25);
  const sampleRatio = sampleSize / 25;
  const primaryEv = Math.max(0, Number(getPrimaryEv(result)) || 0);
  const edgeRatio = clamp(0, primaryEv / 15, 1);

  const confidenceScore = Math.round(
    agreementRatio * 55 + sampleRatio * 25 + edgeRatio * 20
  );

  const agreementLabel =
    agreementRatio >= 0.8
      ? "Stark konsensus"
      : agreementRatio >= 0.6
        ? "Bra konsensus"
        : agreementRatio > 0
          ? "Splittrad"
          : "Ingen konsensus";

  const confidenceLabel =
    confidenceScore >= 75
      ? "Hög"
      : confidenceScore >= 55
        ? "Medium"
        : "Låg";

  return {
    entries,
    available,
    positive,
    agreementRatio,
    agreementPct: Math.round(agreementRatio * 100),
    agreementLabel,
    confidenceScore,
    confidenceLabel,
    sampleSize: Number(result?.matches) || 0,
    autoScore: Math.round(primaryEv * 3 + confidenceScore),
  };
}

export function buildRiskFlags(result) {
  const metrics = buildConfidenceMetrics(result);
  const odds = Number(result?.bet?.odds);
  const primaryEv = Number(getPrimaryEv(result)) || 0;
  const flags = [];

  if (metrics.confidenceScore < 55) {
    flags.push({ id: "low-confidence", label: "Låg confidence", severity: 3 });
  }
  if (metrics.sampleSize < 8) {
    flags.push({ id: "small-sample", label: "Tunt sample", severity: 2 });
  }
  if (metrics.agreementPct < 60) {
    flags.push({ id: "split-models", label: "Splittrade modeller", severity: 2 });
  }
  if (metrics.available < 3) {
    flags.push({ id: "thin-coverage", label: "Tunn modelltäckning", severity: 2 });
  }
  if (primaryEv < 4) {
    flags.push({ id: "thin-edge", label: "Tunn edge", severity: 1 });
  }
  if (Number.isFinite(odds) && odds > 3) {
    flags.push({ id: "high-variance", label: "Hög varians", severity: 1 });
  }
  if (Number.isFinite(odds) && odds < 1.55) {
    flags.push({ id: "short-price", label: "Kort odds", severity: 1 });
  }

  return flags;
}

function buildPriceScore(odds) {
  if (!Number.isFinite(odds) || odds <= 1) return 45;
  const idealCenter = 2.05;
  const distance = Math.abs(odds - idealCenter);
  const raw = 100 - distance * 55;
  if (odds < 1.45) return 42;
  if (odds > 3.4) return clamp(30, raw, 75);
  return clamp(35, raw, 100);
}

function buildMarketScore(result) {
  const statKey = result?.bet?.statKey;
  const period = result?.bet?.period || "ALL";
  const scope = result?.bet?.scope || "total";
  const statScore = STAT_MARKET_PRIORS[statKey] || 60;
  const periodScore = PERIOD_MARKET_PRIORS[period] || 80;
  const scopeScore = SCOPE_MARKET_PRIORS[scope] || 80;
  return Math.round(statScore * 0.45 + periodScore * 0.25 + scopeScore * 0.3);
}

function buildConsensusMetrics(entries) {
  const values = entries.map((entry) => entry.value).filter((value) => Number.isFinite(value));
  const spread = values.length ? Math.max(...values) - Math.min(...values) : 0;
  const deviation = standardDeviation(values);
  const alignmentScore = clamp(20, 100 - spread * 4.5 - deviation * 7.5, 100);
  return {
    spread: Number(spread.toFixed(2)),
    deviation: Number(deviation.toFixed(2)),
    alignmentScore: Math.round(alignmentScore),
  };
}

function buildEdgeScore(primaryEv) {
  if (!Number.isFinite(primaryEv) || primaryEv <= 0) return 0;
  const raw = 100 * (1 - Math.exp(-primaryEv / 7.5));
  return Math.round(clamp(0, raw, 100));
}

function buildSampleScore(sampleSize) {
  if (!Number.isFinite(sampleSize) || sampleSize <= 0) return 0;
  const raw = (Math.min(sampleSize, 18) / 18) * 100;
  return Math.round(clamp(0, raw, 100));
}

function buildLearningKeys(result) {
  const statKey = result?.bet?.statKey || "unknown";
  const scope = result?.bet?.scope || "total";
  const period = result?.bet?.period || "ALL";
  const leagueStatKey = `${normalizeKey(result?.leagueName || result?.bet?.leagueName || "unknown-league")}|${statKey}`;
  return {
    statKey,
    scopePeriodKey: `${scope}|${period}`,
    leagueStatKey,
  };
}

export function buildLearningAdjustment(result, learningProfile = null) {
  const lookups = learningProfile?.lookups;
  if (!lookups) {
    return {
      adjustment: 0,
      confidencePct: 0,
      sources: [],
    };
  }

  const keys = buildLearningKeys(result);
  const weightedSources = [];

  const sourceSpecs = [
    {
      id: "stat",
      label: "Stat-historik",
      weight: 0.45,
      bucket: lookups?.stat?.[keys.statKey],
    },
    {
      id: "scope-period",
      label: "Scope/period-historik",
      weight: 0.2,
      bucket: lookups?.scopePeriod?.[keys.scopePeriodKey],
    },
    {
      id: "league-stat",
      label: "Liga + stat-historik",
      weight: 0.35,
      bucket: lookups?.leagueStat?.[keys.leagueStatKey],
    },
  ];

  for (const spec of sourceSpecs) {
    if (!spec.bucket) continue;
    const confidence = clamp(0, (Number(spec.bucket.confidencePct) || 0) / 100, 1);
    if (confidence <= 0) continue;
    weightedSources.push({
      id: spec.id,
      label: spec.label,
      weight: spec.weight,
      confidence,
      effectiveWeight: spec.weight * confidence,
      adjustment: Number(spec.bucket.adjustment) || 0,
      bets: Number(spec.bucket.bets) || 0,
      roiPct: Number(spec.bucket.roiPct) || 0,
      winRatePct: Number(spec.bucket.winRatePct) || 0,
    });
  }

  if (!weightedSources.length) {
    return {
      adjustment: 0,
      confidencePct: 0,
      sources: [],
    };
  }

  const totalWeight = weightedSources.reduce((sum, source) => sum + source.effectiveWeight, 0) || 1;
  const weightedAdjustment = weightedSources.reduce(
    (sum, source) => sum + source.adjustment * source.effectiveWeight,
    0
  ) / totalWeight;
  const confidencePct = Math.round(
    (weightedSources.reduce((sum, source) => sum + source.confidence * source.weight, 0) /
      sourceSpecs.reduce((sum, source) => sum + source.weight, 0)) *
      100
  );

  return {
    adjustment: Number(clamp(-12, weightedAdjustment, 12).toFixed(1)),
    confidencePct,
    sources: weightedSources,
  };
}

function buildRankingReasons({
  edgeScore,
  confidenceScore,
  consensusScore,
  priceScore,
  marketScore,
  sampleScore,
  riskScore,
  bet,
  learning,
}) {
  const reasons = [];

  if (edgeScore >= 72) {
    reasons.push({ id: "edge", label: "Tydlig edge", tone: "positive", weight: edgeScore });
  }
  if (confidenceScore >= 72) {
    reasons.push({ id: "confidence", label: "Hög confidence", tone: "positive", weight: confidenceScore });
  }
  if (consensusScore >= 70) {
    reasons.push({ id: "consensus", label: "Stark modellalignment", tone: "positive", weight: consensusScore });
  }
  if (priceScore >= 74) {
    reasons.push({ id: "price", label: "Bra oddsspann", tone: "positive", weight: priceScore });
  }
  if (marketScore >= 74) {
    const marketLabel = bet?.scope === "total" ? "Bra marknadsprofil" : "Bra marknadsprofil";
    reasons.push({ id: "market", label: marketLabel, tone: "positive", weight: marketScore });
  }
  if (learning?.adjustment >= 3 && learning?.confidencePct >= 25) {
    reasons.push({
      id: "learning-up",
      label: "Historiskt stark marknad",
      tone: "positive",
      weight: 70 + learning.adjustment,
    });
  }
  if (learning?.adjustment <= -3 && learning?.confidencePct >= 25) {
    reasons.push({
      id: "learning-down",
      label: "Svag historik drar ned",
      tone: "warning",
      weight: 70 + Math.abs(learning.adjustment),
    });
  }
  if (sampleScore < 45) {
    reasons.push({ id: "sample", label: "Tunt sample drar ned", tone: "warning", weight: 100 - sampleScore });
  }
  if (riskScore >= 5) {
    reasons.push({ id: "risk", label: "Riskflaggor drar ned", tone: "warning", weight: riskScore * 20 });
  }

  return reasons
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map(({ weight, ...rest }) => rest);
}

function buildRankingContext(result, learningProfile = null) {
  const metrics = buildConfidenceMetrics(result);
  const entries = metrics.entries;
  const primaryEv = Number(getPrimaryEv(result)) || 0;
  const odds = Number(result?.bet?.odds);
  const edgeScore = buildEdgeScore(primaryEv);
  const sampleScore = buildSampleScore(metrics.sampleSize);
  const priceScore = buildPriceScore(odds);
  const marketScore = buildMarketScore(result);
  const consensusMeta = buildConsensusMetrics(entries);
  const consensusScore = Math.round(
    metrics.agreementPct * 0.6 + consensusMeta.alignmentScore * 0.4
  );
  const learning = buildLearningAdjustment(result, learningProfile);

  return {
    edgeScore,
    confidenceScore: metrics.confidenceScore,
    consensusScore,
    sampleScore,
    priceScore,
    marketScore,
    formulaSpread: consensusMeta.spread,
    formulaDeviation: consensusMeta.deviation,
    agreementPct: metrics.agreementPct,
    agreementLabel: metrics.agreementLabel,
    learningAdjustment: learning.adjustment,
    learningConfidencePct: learning.confidencePct,
    learningSources: learning.sources,
  };
}

export function buildBetHeadline(result) {
  const bet = result?.bet ?? {};
  const direction = humanizeDirection(bet.direction);
  const line = bet.line != null ? bet.line : "–";
  const stat = humanizeStat(bet.statKey);
  return `${direction} ${line} ${stat}`;
}

export function buildNarrativeSummary(result) {
  const metrics = buildConfidenceMetrics(result);
  const risks = buildRiskFlags(result);
  const ranking = result?.ranking || buildRankingContext(result, result?.learningProfile || null);
  const bestSignals = [];

  if (metrics.agreementPct >= 60) {
    bestSignals.push(`${metrics.positive}/${metrics.available} kärnmodeller är positiva`);
  }
  if (metrics.sampleSize >= 10) {
    bestSignals.push(`samplet är ${metrics.sampleSize} matcher`);
  }
  if ((Number(getPrimaryEv(result)) || 0) >= 7) {
    bestSignals.push(`edgen är tydlig på +${Number(getPrimaryEv(result)).toFixed(1)}%`);
  }
  if ((ranking?.priceScore || 0) >= 74) {
    bestSignals.push(`oddset ligger i ett bra spann`);
  }
  if ((ranking?.learningAdjustment || 0) >= 3 && (ranking?.learningConfidencePct || 0) >= 25) {
    bestSignals.push(`historiken stödjer den här marknaden`);
  }

  const riskLabel = risks[0]?.label ? `Största risken är ${risks[0].label.toLowerCase()}.` : "Riskbilden ser kontrollerad ut.";

  if (!bestSignals.length) {
    return `${buildBetHeadline(result)} sticker ut marginellt. ${riskLabel}`;
  }

  return `${buildBetHeadline(result)} får stöd eftersom ${bestSignals.join(", ")}. ${riskLabel}`;
}

export function enrichPositiveResult(result, learningProfile = null) {
  const primaryEv = getPrimaryEv(result);
  const enriched = {
    ...result,
    primaryEv,
    headline: buildBetHeadline(result),
    scopeLabel: humanizeScope(result?.bet?.scope, result),
    periodLabel: humanizePeriod(result?.bet?.period),
    learningProfile,
  };
  const metrics = buildConfidenceMetrics(enriched);
  const ranking = buildRankingContext({ ...enriched, ...metrics }, learningProfile);
  const riskFlags = buildRiskFlags({ ...enriched, ...metrics, ranking });
  const riskScore = riskFlags.reduce((sum, flag) => sum + (flag.severity || 0), 0);
  const learning = {
    adjustment: ranking.learningAdjustment,
    confidencePct: ranking.learningConfidencePct,
    sources: ranking.learningSources,
  };
  const rankReasons = buildRankingReasons({
    ...ranking,
    riskScore,
    bet: enriched.bet,
    learning,
  });

  return {
    ...enriched,
    ...metrics,
    ranking,
    riskFlags,
    riskScore,
    rankReasons,
    rationale: buildNarrativeSummary({ ...enriched, ...metrics, ranking, riskFlags }),
  };
}

export function normalizeBatchResult(result, learningProfile = null) {
  if (!result || typeof result !== "object" || !result.params) {
    return null;
  }

  const bet = {
    statKey: result.params.stat,
    line: result.params.line,
    direction: result.params.over ? "over" : "under",
    scope: result.params.scope,
    period: result.params.period,
    odds: result.params.odds,
    homeTeam: result.params.home,
    awayTeam: result.params.away,
    key: [
      result.params.home,
      result.params.away,
      result.params.stat,
      result.params.scope,
      result.params.period,
      result.params.line,
      result.params.over ? "over" : "under",
      result.params.form,
      result.params.neutralGround,
    ].join("::"),
  };

  return enrichPositiveResult({ ...result, bet }, learningProfile);
}

export function getStrategyProfile(strategyId = "balanced") {
  return STRATEGY_PROFILES[strategyId] || STRATEGY_PROFILES.balanced;
}

export function matchesStrategyFilters(result, strategyId = "balanced") {
  const enriched = result?.riskFlags ? result : enrichPositiveResult(result);
  const strategy = getStrategyProfile(strategyId);

  if (
    Array.isArray(strategy.allowedStats) &&
    strategy.allowedStats.length > 0 &&
    !strategy.allowedStats.includes(enriched?.bet?.statKey)
  ) {
    return false;
  }

  if (enriched.confidenceScore < strategy.minConfidence) return false;
  if (enriched.agreementPct < strategy.minAgreementPct) return false;
  if (enriched.sampleSize < strategy.minSampleSize) return false;
  if ((enriched.primaryEv || 0) <= 0) return false;
  return true;
}

export function scoreResultForStrategy(result, strategyId = "balanced", learningProfile = null) {
  const enriched = result?.riskFlags && result?.ranking && result?.learningProfile === learningProfile
    ? result
    : enrichPositiveResult(result, learningProfile);
  const strategy = getStrategyProfile(strategyId);
  const weights = { ...DEFAULT_RANKING_WEIGHTS, ...(strategy.weights || {}) };
  const statBoost = strategy.boosts?.[enriched?.bet?.statKey] || 0;
  const ranking = enriched.ranking || buildRankingContext(enriched, learningProfile);

  const score =
    ranking.edgeScore * weights.edge +
    ranking.confidenceScore * weights.confidence +
    ranking.consensusScore * weights.consensus +
    ranking.sampleScore * weights.sample +
    ranking.priceScore * weights.price +
    ranking.marketScore * weights.market +
    statBoost +
    ranking.learningAdjustment -
    enriched.riskScore * 8 * weights.risk;

  return {
    ...enriched,
    ranking,
    learningProfile,
    strategyId: strategy.id,
    strategyLabel: strategy.label,
    strategyScore: Number(score.toFixed(2)),
  };
}

export function buildPositiveResultsSummary(results = [], unibetUrl = null, options = {}) {
  const strategyId = options?.strategyId || "balanced";
  const learningProfile = options?.learningProfile || null;

  const enriched = (Array.isArray(results) ? results : [])
    .map((result) => scoreResultForStrategy(result, strategyId, learningProfile))
    .sort((a, b) => {
      if (b.strategyScore !== a.strategyScore) return b.strategyScore - a.strategyScore;
      return (b.primaryEv || 0) - (a.primaryEv || 0);
    });

  return {
    count: enriched.length,
    items: enriched,
    bestBet: enriched[0] || null,
    unibetUrl: unibetUrl || null,
  };
}
