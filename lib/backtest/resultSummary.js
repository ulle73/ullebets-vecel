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

export const STRATEGY_PROFILES = {
  safe: {
    id: "safe",
    label: "Safe",
    minConfidence: 72,
    minAgreementPct: 60,
    minSampleSize: 10,
    allowedStats: null,
    boosts: {},
    weights: { confidence: 1.15, ev: 2.2, agreement: 0.4, sample: 0.8 },
    riskPenalty: 10,
  },
  balanced: {
    id: "balanced",
    label: "Balans",
    minConfidence: 55,
    minAgreementPct: 40,
    minSampleSize: 6,
    allowedStats: null,
    boosts: {},
    weights: { confidence: 1, ev: 2.8, agreement: 0.32, sample: 0.6 },
    riskPenalty: 8,
  },
  aggressive: {
    id: "aggressive",
    label: "Aggressiv",
    minConfidence: 40,
    minAgreementPct: 20,
    minSampleSize: 4,
    allowedStats: null,
    boosts: {},
    weights: { confidence: 0.75, ev: 3.5, agreement: 0.22, sample: 0.4 },
    riskPenalty: 5,
  },
  corners: {
    id: "corners",
    label: "Hörnor",
    minConfidence: 52,
    minAgreementPct: 35,
    minSampleSize: 6,
    allowedStats: ["cornerKicks"],
    boosts: { cornerKicks: 18 },
    weights: { confidence: 0.95, ev: 3.1, agreement: 0.3, sample: 0.55 },
    riskPenalty: 7,
  },
  shots: {
    id: "shots",
    label: "Skott",
    minConfidence: 52,
    minAgreementPct: 35,
    minSampleSize: 6,
    allowedStats: ["totalShots", "shotsOnGoal"],
    boosts: { totalShots: 10, shotsOnGoal: 12 },
    weights: { confidence: 0.95, ev: 3, agreement: 0.3, sample: 0.55 },
    riskPenalty: 7,
  },
};

function clamp(min, value, max) {
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

  const riskLabel = risks[0]?.label ? `Största risken är ${risks[0].label.toLowerCase()}.` : "Riskbilden ser kontrollerad ut.";

  if (!bestSignals.length) {
    return `${buildBetHeadline(result)} sticker ut marginellt. ${riskLabel}`;
  }

  return `${buildBetHeadline(result)} får stöd eftersom ${bestSignals.join(", ")}. ${riskLabel}`;
}

export function enrichPositiveResult(result) {
  const primaryEv = getPrimaryEv(result);
  const enriched = {
    ...result,
    primaryEv,
    headline: buildBetHeadline(result),
    scopeLabel: humanizeScope(result?.bet?.scope, result),
    periodLabel: humanizePeriod(result?.bet?.period),
  };
  const metrics = buildConfidenceMetrics(enriched);
  const riskFlags = buildRiskFlags({ ...enriched, ...metrics });
  return {
    ...enriched,
    ...metrics,
    riskFlags,
    riskScore: riskFlags.reduce((sum, flag) => sum + (flag.severity || 0), 0),
    rationale: buildNarrativeSummary({ ...enriched, ...metrics, riskFlags }),
  };
}

export function normalizeBatchResult(result) {
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

  return enrichPositiveResult({ ...result, bet });
}

export function buildPositiveResultsSummary(results = [], unibetUrl = null) {
  const enriched = (Array.isArray(results) ? results : [])
    .map((result) => (result?.riskFlags ? result : enrichPositiveResult(result)))
    .sort((a, b) => {
      if (b.autoScore !== a.autoScore) return b.autoScore - a.autoScore;
      return (b.primaryEv || 0) - (a.primaryEv || 0);
    });

  return {
    count: enriched.length,
    items: enriched,
    bestBet: enriched[0] || null,
    unibetUrl: unibetUrl || null,
  };
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

export function scoreResultForStrategy(result, strategyId = "balanced") {
  const enriched = result?.riskFlags ? result : enrichPositiveResult(result);
  const strategy = getStrategyProfile(strategyId);
  const weights = strategy.weights;
  const statBoost = strategy.boosts?.[enriched?.bet?.statKey] || 0;
  const score =
    enriched.confidenceScore * weights.confidence +
    (enriched.primaryEv || 0) * weights.ev +
    enriched.agreementPct * weights.agreement +
    Math.min(enriched.sampleSize, 20) * weights.sample +
    statBoost -
    enriched.riskScore * strategy.riskPenalty;

  return {
    ...enriched,
    strategyId: strategy.id,
    strategyLabel: strategy.label,
    strategyScore: Number(score.toFixed(2)),
  };
}
