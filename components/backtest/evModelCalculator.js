function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampProbability(probability) {
  if (!Number.isFinite(probability)) return null;
  if (probability < 0) return 0;
  if (probability > 1) return 1;
  return probability;
}

function extractOdds(result) {
  if (!result) return null;
  const source = result.bet?.odds ?? result.params?.odds;
  const numeric = toFiniteNumber(source);
  if (numeric == null || numeric <= 0) return null;
  return numeric;
}

function formatDecimal(value, digits = 2) {
  if (!Number.isFinite(value)) return "";
  return Number(value)
    .toFixed(digits)
    .replace(/\.00$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatOdds(odds) {
  if (!Number.isFinite(odds)) return "";
  return formatDecimal(odds, 2);
}

function formatProbability(probability) {
  const pct = probability * 100;
  return `${formatDecimal(pct, 1)}%`;
}

function computePoissonThreshold(line, isOver) {
  if (!Number.isFinite(line)) return null;
  return isOver ? Math.max(-1, Math.ceil(line) - 1) : Math.floor(line);
}

function computeLambdaFromMetrics(attack, attackAvg, concede, concedeAvg, overallAverage) {
  if (
    Number.isFinite(attack) &&
    Number.isFinite(attackAvg) &&
    attackAvg > 0 &&
    Number.isFinite(concede) &&
    Number.isFinite(concedeAvg) &&
    concedeAvg > 0 &&
    Number.isFinite(overallAverage)
  ) {
    return (attack / attackAvg) * (concede / concedeAvg) * overallAverage;
  }

  const fallback = [attack, concede].filter((value) => Number.isFinite(value));
  if (fallback.length) {
    return fallback.reduce((sum, value) => sum + value, 0) / fallback.length;
  }

  if (Number.isFinite(overallAverage)) {
    return overallAverage;
  }

  return null;
}

export function describeEvModel(result) {
  if (!result) return null;
  const evValue = toFiniteNumber(result.evPct);
  const probability = clampProbability(toFiniteNumber(result.modelProb));
  const odds = extractOdds(result);
  const metrics = result.leagueAvgHistory || result.leagueAvg?.details?.metrics || {};
  const homeAttack = toFiniteNumber(metrics.homeAttack);
  const homeAttackAvg = toFiniteNumber(metrics.homeAttackAvg);
  const awayConcede = toFiniteNumber(metrics.awayConcede);
  const awayConcedeAvg = toFiniteNumber(metrics.awayConcedeAvg);
  const awayAttack = toFiniteNumber(metrics.awayAttack);
  const awayAttackAvg = toFiniteNumber(metrics.awayAttackAvg);
  const homeConcede = toFiniteNumber(metrics.homeConcede);
  const homeConcedeAvg = toFiniteNumber(metrics.homeConcedeAvg);
  const overallAverage = toFiniteNumber(metrics.overallAverage);
  const lambdaHome = computeLambdaFromMetrics(
    homeAttack,
    homeAttackAvg,
    awayConcede,
    awayConcedeAvg,
    overallAverage
  );
  const lambdaAway = computeLambdaFromMetrics(
    awayAttack,
    awayAttackAvg,
    homeConcede,
    homeConcedeAvg,
    overallAverage
  );
  const lambdaSelected = toFiniteNumber(result.lambda);
  const scope = String(result.params?.scope || "total");
  const isOver = Boolean(result.params?.over);
  const line = toFiniteNumber(result.params?.line);
  const k = computePoissonThreshold(line, isOver);

  if (evValue == null || probability == null || odds == null) {
    return null;
  }

  const steps = [];

  if (lambdaHome != null) {
    if (
      homeAttack != null &&
      homeAttackAvg != null &&
      awayConcede != null &&
      awayConcedeAvg != null &&
      overallAverage != null
    ) {
      steps.push(
        `λ_home=(${formatDecimal(homeAttack)} / ${formatDecimal(homeAttackAvg)}) × (${formatDecimal(
          awayConcede
        )} / ${formatDecimal(awayConcedeAvg)}) × ${formatDecimal(overallAverage)} = ${formatDecimal(
          lambdaHome
        )}`
      );
    } else {
      steps.push(`λ_home=${formatDecimal(lambdaHome)}`);
    }
  }

  if (lambdaAway != null) {
    if (
      awayAttack != null &&
      awayAttackAvg != null &&
      homeConcede != null &&
      homeConcedeAvg != null &&
      overallAverage != null
    ) {
      steps.push(
        `λ_away=(${formatDecimal(awayAttack)} / ${formatDecimal(awayAttackAvg)}) × (${formatDecimal(
          homeConcede
        )} / ${formatDecimal(homeConcedeAvg)}) × ${formatDecimal(overallAverage)} = ${formatDecimal(
          lambdaAway
        )}`
      );
    } else {
      steps.push(`λ_away=${formatDecimal(lambdaAway)}`);
    }
  }

  if (lambdaHome != null && lambdaAway != null) {
    steps.push(
      `λ_total=${formatDecimal(lambdaHome)} + ${formatDecimal(lambdaAway)} = ${formatDecimal(
        lambdaHome + lambdaAway
      )}`
    );
  }

  if (lambdaSelected != null) {
    steps.push(`λ_${scope}=${formatDecimal(lambdaSelected)}`);
  }

  if (k != null && lambdaSelected != null) {
    const poissonExpr = isOver
      ? `1 - PoissonCDF(k=${k}, λ=${formatDecimal(lambdaSelected)})`
      : `PoissonCDF(k=${k}, λ=${formatDecimal(lambdaSelected)})`;
    steps.push(`${poissonExpr} = ${formatProbability(probability)}`);
  }

  steps.push(`${formatProbability(probability)} × ${formatOdds(odds)} - 100`);

  const formula = `= (${steps.join("; ")})`;

  return {
    value: evValue,
    probability,
    odds,
    formula,
  };
}
