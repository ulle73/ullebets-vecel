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

export function describeEvMultiplier(result) {
  if (!result) return null;
  const evValue = toFiniteNumber(result.evPctWithMultiplier);
  const probability = clampProbability(toFiniteNumber(result.modelProbWithMultiplier));
  const odds = extractOdds(result);
  const baseLambda = toFiniteNumber(result.lambda);
  const multiplier = toFiniteNumber(result.multiplier?.multiplier ?? result.multiplier?.value);
  const adjustedLambda = toFiniteNumber(result.lambdaWithMultiplier);
  const isOver = Boolean(result.params?.over);
  const line = toFiniteNumber(result.params?.line);
  const k = computePoissonThreshold(line, isOver);

  if (evValue == null || probability == null || odds == null) {
    return null;
  }

  const steps = [];

  if (baseLambda != null && multiplier != null && adjustedLambda != null) {
    steps.push(
      `λ=${formatDecimal(baseLambda)} × ${formatDecimal(multiplier)} = ${formatDecimal(adjustedLambda)}`
    );
  }

  if (k != null && (adjustedLambda != null || baseLambda != null)) {
    const lambdaForProbability = adjustedLambda != null ? adjustedLambda : baseLambda;
    const poissonExpr = isOver
      ? `1 - PoissonCDF(k=${k}, λ=${formatDecimal(lambdaForProbability)})`
      : `PoissonCDF(k=${k}, λ=${formatDecimal(lambdaForProbability)})`;
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
