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

export function describeEvLegacy(result) {
  if (!result) return null;
  const evValue = toFiniteNumber(result.legacyEvPct);
  const probability = clampProbability(toFiniteNumber(result.legacyProb));
  const odds = extractOdds(result);
  const meanFor = toFiniteNumber(result.meanFor);
  const meanAgainst = toFiniteNumber(result.meanAgainst);
  const legacyLambda =
    meanFor != null && meanAgainst != null ? (meanFor + meanAgainst) / 2 : null;

  if (evValue == null || probability == null || odds == null) {
    return null;
  }

  const steps = [];

  if (legacyLambda != null) {
    steps.push(
      `λ_legacy=(${formatDecimal(meanFor)} + ${formatDecimal(meanAgainst)}) / 2 = ${formatDecimal(legacyLambda)}`
    );
  }

  steps.push(`P_legacy=${formatProbability(probability)}`);
  steps.push(`${formatProbability(probability)} × ${formatOdds(odds)} - 100`);

  const formula = `= (${steps.join("; ")})`;

  return {
    value: evValue,
    probability,
    odds,
    formula,
  };
}
