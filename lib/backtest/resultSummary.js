import { getFormulaConfig } from "./formulaConfig.js";
import {
  STAT_MARKET_PRIORS,
  PERIOD_MARKET_PRIORS,
  SCOPE_MARKET_PRIORS,
  STRATEGY_PROFILES,
  PROOF_THRESHOLDS,
  SCORE_SHAPING,
  DEFAULT_RANKING_WEIGHTS,
  clamp,
  buildPriceScoreFromOdds,
  buildMarketScoreFromBet,
  getStrategyProfile,
  buildLearningAdjustmentFromLookups,
  scoreCandidateWithPolicy,
} from "./rankingPolicy.js";

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

export { STRATEGY_PROFILES, getStrategyProfile };

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
  if (scope === "home") return result?.bet?.homeTeam || "Hemmalag";
  if (scope === "away") return result?.bet?.awayTeam || "Bortalag";
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
  return Math.sqrt(average(filtered.map((value) => (value - avg) ** 2)));
}

function getFormulaOrder(statKey) {
  const config = getFormulaConfig(statKey);
  const display = Array.isArray(config?.display) ? config.display : [];
  return [...new Set([...display, ...DEFAULT_FORMULA_PRIORITY])];
}

export function getCoreFormulaEntries(result) {
  if (!result || typeof result !== "object") return [];

  const entriesByKey = new Map(CORE_RESULT_FIELDS.map((field) => [field.key, field]));
  const statKey = result?.bet?.statKey ?? result?.params?.stat ?? null;
  const orderedKeys = getFormulaOrder(statKey);

  return orderedKeys
    .map((key) => {
      const field = entriesByKey.get(key);
      if (!field) return null;
      const value = toFiniteNumber(result[field.valueKey]);
      if (value == null) return null;
      return { key: field.key, label: field.label, value };
    })
    .filter(Boolean);
}

export function getPrimaryEv(result) {
  if (toFiniteNumber(result?.primaryEv) != null) return result.primaryEv;
  return getCoreFormulaEntries(result)[0]?.value ?? null;
}

export function buildConfidenceMetrics(result) {
  const entries = getCoreFormulaEntries(result);
  const available = entries.length;
  const positive = entries.filter((entry) => entry.value > 0).length;
  const agreementRatio = available ? positive / available : 0;
  const sampleSize = clamp(0, Number(result?.matches) || 0, 25);
  const primaryEv = Math.max(0, Number(getPrimaryEv(result)) || 0);

  const confidenceScore = Math.round(
    agreementRatio * 55 + (sampleSize / 25) * 25 + clamp(0, primaryEv / 15, 1) * 20
  );

  const agreementLabel =
    agreementRatio >= 0.8 ? "Stark konsensus" : agreementRatio >= 0.6 ? "Bra konsensus" : agreementRatio > 0 ? "Splittrad" : "Ingen konsensus";

  return {
    entries,
    available,
    positive,
    agreementRatio,
    agreementPct: Math.round(agreementRatio * 100),
    agreementLabel,
    confidenceScore,
    confidenceLabel: confidenceScore >= 75 ? "Hög" : confidenceScore >= 55 ? "Medium" : "Låg",
    sampleSize: Number(result?.matches) || 0,
    autoScore: Math.round(primaryEv * 3 + confidenceScore),
  };
}

export function buildRiskFlags(result) {
  const metrics = buildConfidenceMetrics(result);
  const odds = Number(result?.bet?.odds);
  const primaryEv = Number(getPrimaryEv(result)) || 0;
  const flags = [];

  if (metrics.confidenceScore < 55) flags.push({ id: "low-confidence", label: "Låg confidence", severity: 3 });
  if (metrics.sampleSize < 8) flags.push({ id: "small-sample", label: "Tunt sample", severity: 2 });
  if (metrics.agreementPct < 60) flags.push({ id: "split-models", label: "Splittrade modeller", severity: 2 });
  if (metrics.available < 3) flags.push({ id: "thin-coverage", label: "Tunn modelltäckning", severity: 2 });
  if (primaryEv < 4) flags.push({ id: "thin-edge", label: "Tunn edge", severity: 1 });
  if (Number.isFinite(odds) && odds > 3) flags.push({ id: "high-variance", label: "Hög varians", severity: 1 });
  if (Number.isFinite(odds) && odds < 1.55) flags.push({ id: "short-price", label: "Kort odds", severity: 1 });

  return flags;
}

function buildConsensusMetrics(entries) {
  const values = entries.map((entry) => entry.value).filter((value) => Number.isFinite(value));
  const spread = values.length ? Math.max(...values) - Math.min(...values) : 0;
  const deviation = standardDeviation(values);
  return {
    spread: Number(spread.toFixed(2)),
    deviation: Number(deviation.toFixed(2)),
    alignmentScore: Math.round(clamp(20, 100 - spread * 4.5 - deviation * 7.5, 100)),
  };
}

function buildEdgeScore(primaryEv) {
  if (!Number.isFinite(primaryEv) || primaryEv <= 0) return 0;
  return Math.round(clamp(0, 100 * (1 - Math.exp(-primaryEv / SCORE_SHAPING.edgeDecay)), 100));
}

function buildSampleScore(sampleSize) {
  if (!Number.isFinite(sampleSize) || sampleSize <= 0) return 0;
  return Math.round(clamp(0, (Math.min(sampleSize, 18) / 18) * 100, 100));
}

export function buildLearningAdjustment(result, learningProfile = null) {
  return buildLearningAdjustmentFromLookups(result, learningProfile?.lookups || learningProfile || null);
}

function buildProofStatus(_result, metrics, _ranking, learning) {
  const modelCoverageReady = metrics.available >= PROOF_THRESHOLDS.modelCoverageMin;
  const sampleReady = metrics.sampleSize >= PROOF_THRESHOLDS.sampleReadyMin;
  const historicalReady = Boolean(learning?.proofReady);
  const proofScore = Math.round(
    clamp(
      0,
      metrics.confidenceScore * PROOF_THRESHOLDS.proofScoreWeights.confidence +
        Math.min(metrics.sampleSize, 20) * PROOF_THRESHOLDS.proofScoreWeights.sample +
        (learning?.confidencePct || 0) * PROOF_THRESHOLDS.proofScoreWeights.learning,
      100
    )
  );
  const label = proofScore >= PROOF_THRESHOLDS.proofStateVerifiedMin ? "Bevisad" : proofScore >= PROOF_THRESHOLDS.proofStateOkayMin ? "OK underlag" : "Tunn data";
  const flags = [];
  if (!sampleReady) flags.push({ id: "proof-sample", label: "För få matcher i sample", tone: "warning" });
  if (!modelCoverageReady) flags.push({ id: "proof-models", label: "För få kärnmodeller", tone: "warning" });
  if (!historicalReady) flags.push({ id: "proof-history", label: "Historik byggs upp", tone: "warning" });
  if (historicalReady) flags.push({ id: "proof-history-good", label: "Historiskt verifierad", tone: "positive" });
  return {
    proofScore,
    label,
    sampleReady,
    modelCoverageReady,
    historicalReady,
    flags: flags.slice(0, 2),
  };
}

function buildRankingReasons({ edgeScore, confidenceScore, consensusScore, priceScore, marketScore, sampleScore, riskScore, learning, proof }) {
  const reasons = [];
  if (edgeScore >= 72) reasons.push({ id: "edge", label: "Tydlig edge", tone: "positive", weight: edgeScore });
  if (confidenceScore >= 72) reasons.push({ id: "confidence", label: "Hög confidence", tone: "positive", weight: confidenceScore });
  if (consensusScore >= 70) reasons.push({ id: "consensus", label: "Stark modellalignment", tone: "positive", weight: consensusScore });
  if (priceScore >= 74) reasons.push({ id: "price", label: "Bra oddsspann", tone: "positive", weight: priceScore });
  if (marketScore >= 74) reasons.push({ id: "market", label: "Bra marknadsprofil", tone: "positive", weight: marketScore });
  if (learning?.adjustment >= 3 && proof?.historicalReady) reasons.push({ id: "learning-up", label: "Historiskt stark marknad", tone: "positive", weight: 72 + learning.adjustment });
  if (learning?.adjustment <= -3 && proof?.historicalReady) reasons.push({ id: "learning-down", label: "Svag historik drar ned", tone: "warning", weight: 72 + Math.abs(learning.adjustment) });
  if (sampleScore < 45) reasons.push({ id: "sample", label: "Tunt sample drar ned", tone: "warning", weight: 100 - sampleScore });
  if (riskScore >= 5) reasons.push({ id: "risk", label: "Riskflaggor drar ned", tone: "warning", weight: riskScore * 20 });
  if (!proof?.historicalReady) reasons.push({ id: "proof", label: "Historiken byggs upp", tone: "warning", weight: 48 });
  return reasons.sort((a, b) => b.weight - a.weight).slice(0, 4).map(({ weight, ...rest }) => rest);
}

function buildRankingContext(result, learningProfile = null) {
  const metrics = buildConfidenceMetrics(result);
  const consensusMeta = buildConsensusMetrics(metrics.entries);
  const learning = buildLearningAdjustment(result, learningProfile);
  return {
    edgeScore: buildEdgeScore(Number(getPrimaryEv(result)) || 0),
    confidenceScore: metrics.confidenceScore,
    consensusScore: Math.round(metrics.agreementPct * 0.6 + consensusMeta.alignmentScore * 0.4),
    sampleScore: buildSampleScore(metrics.sampleSize),
    priceScore: buildPriceScoreFromOdds(Number(result?.bet?.odds)),
    marketScore: buildMarketScoreFromBet(result?.bet),
    formulaSpread: consensusMeta.spread,
    formulaDeviation: consensusMeta.deviation,
    agreementPct: metrics.agreementPct,
    agreementLabel: metrics.agreementLabel,
    learningAdjustment: learning.adjustment,
    learningConfidencePct: learning.confidencePct,
    learningSources: learning.sources,
    learningProofReady: learning.proofReady,
    learningMinBets: learning.minBets,
  };
}

export function buildBetHeadline(result) {
  const bet = result?.bet ?? {};
  return `${humanizeDirection(bet.direction)} ${bet.line != null ? bet.line : "–"} ${humanizeStat(bet.statKey)}`;
}

export function buildNarrativeSummary(result) {
  const metrics = buildConfidenceMetrics(result);
  const risks = buildRiskFlags(result);
  const ranking = result?.ranking || buildRankingContext(result, result?.learningProfile || null);
  const proof = result?.proof || buildProofStatus(result, metrics, ranking, {
    adjustment: ranking.learningAdjustment,
    confidencePct: ranking.learningConfidencePct,
    proofReady: ranking.learningProofReady,
    minBets: ranking.learningMinBets,
  });
  const bestSignals = [];
  if (metrics.agreementPct >= 60) bestSignals.push(`${metrics.positive}/${metrics.available} kärnmodeller är positiva`);
  if (metrics.sampleSize >= 10) bestSignals.push(`samplet är ${metrics.sampleSize} matcher`);
  if ((Number(getPrimaryEv(result)) || 0) >= 7) bestSignals.push(`edgen är tydlig på +${Number(getPrimaryEv(result)).toFixed(1)}%`);
  if ((ranking?.priceScore || 0) >= 74) bestSignals.push(`oddset ligger i ett bra spann`);
  if (proof.historicalReady) bestSignals.push(`historiken stödjer den här marknaden`);
  const riskLabel = risks[0]?.label ? `Största risken är ${risks[0].label.toLowerCase()}.` : "Riskbilden ser kontrollerad ut.";
  if (!bestSignals.length) return `${buildBetHeadline(result)} sticker ut marginellt. ${riskLabel}`;
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
  const learning = {
    adjustment: ranking.learningAdjustment,
    confidencePct: ranking.learningConfidencePct,
    sources: ranking.learningSources,
    proofReady: ranking.learningProofReady,
    minBets: ranking.learningMinBets,
  };
  const proof = buildProofStatus(enriched, metrics, ranking, learning);
  const riskFlags = buildRiskFlags({ ...enriched, ...metrics, ranking });
  const riskScore = riskFlags.reduce((sum, flag) => sum + (flag.severity || 0), 0);
  const rankReasons = buildRankingReasons({
    edgeScore: ranking.edgeScore,
    confidenceScore: ranking.confidenceScore,
    consensusScore: ranking.consensusScore,
    priceScore: ranking.priceScore,
    marketScore: ranking.marketScore,
    sampleScore: ranking.sampleScore,
    riskScore,
    learning,
    proof,
  });
  return {
    ...enriched,
    ...metrics,
    ranking,
    proof,
    riskFlags,
    riskScore,
    rankReasons,
    rationale: buildNarrativeSummary({ ...enriched, ...metrics, ranking, riskFlags, proof }),
  };
}

export function normalizeBatchResult(result, learningProfile = null) {
  if (!result || typeof result !== "object" || !result.params) return null;
  const bet = {
    statKey: result.params.stat,
    line: result.params.line,
    direction: result.params.over ? "over" : "under",
    scope: result.params.scope,
    period: result.params.period,
    odds: result.params.odds,
    homeTeam: result.params.home,
    awayTeam: result.params.away,
    key: [result.params.home, result.params.away, result.params.stat, result.params.scope, result.params.period, result.params.line, result.params.over ? "over" : "under", result.params.form, result.params.neutralGround].join("::"),
  };
  return enrichPositiveResult({ ...result, bet }, learningProfile);
}

export function matchesStrategyFilters(result, strategyId = "balanced") {
  const enriched = result?.riskFlags ? result : enrichPositiveResult(result);
  const strategy = getStrategyProfile(strategyId);
  if (Array.isArray(strategy.allowedStats) && strategy.allowedStats.length > 0 && !strategy.allowedStats.includes(enriched?.bet?.statKey)) return false;
  if (enriched.confidenceScore < strategy.minConfidence) return false;
  if (enriched.agreementPct < strategy.minAgreementPct) return false;
  if (enriched.sampleSize < strategy.minSampleSize) return false;
  if ((enriched.primaryEv || 0) <= 0) return false;
  if (strategy.id === "safe" && enriched.proof?.proofScore < PROOF_THRESHOLDS.safeMinProofScore) return false;
  return true;
}

export function scoreResultForStrategy(result, strategyId = "balanced", learningProfile = null) {
  const enriched = result?.riskFlags && result?.ranking ? result : enrichPositiveResult(result, learningProfile);
  const scored = scoreCandidateWithPolicy(enriched, strategyId);
  return {
    ...enriched,
    learningProfile,
    strategyId: scored.breakdown.strategyId,
    strategyLabel: scored.breakdown.strategyLabel,
    strategyScore: scored.score,
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
  return { count: enriched.length, items: enriched, bestBet: enriched[0] || null, unibetUrl: unibetUrl || null };
}
