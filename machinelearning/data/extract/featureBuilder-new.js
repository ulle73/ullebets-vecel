import {
  buildFeatureNamesNew,
  EXTRA_PROFILE_KEYS_NEW,
  FORMULA_FEATURE_KEYS_NEW,
} from "./pipelineConfig-new.js";

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stdDev(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function getExtraValue(profile, direction, key) {
  const nestedValue = (candidate) =>
    toNumber(candidate?.ALL?.value ?? candidate?.value ?? candidate ?? 0);

  if (direction === "for") {
    return nestedValue(
      profile?.extraFor?.[key] ??
        profile?.[`extraFor_${key}`] ??
        profile?.statistics?.for?.[key] ??
        0,
    );
  }
  return nestedValue(
    profile?.extraAgainst?.[key] ??
      profile?.[`extraAgainst_${key}`] ??
      profile?.statistics?.against?.[key] ??
      0,
  );
}

export function buildStrictProfileFlagsNew() {
  return {
    includeProfileFeatures: false,
    includeExtendedProfileFeatures: false,
  };
}

export function buildSampleFeatureBundleNew(context, featureMode = "strict") {
  const includeProfileFeatures = featureMode === "extended";
  const includeExtendedProfileFeatures = featureMode === "extended";
  const {
    statKey,
    scope,
    period,
    target,
    market = {},
    teams,
    formulaPredictions = {},
    metadata = {},
  } = context;

  const home = teams?.home ?? {};
  const away = teams?.away ?? {};
  const homeProfile = home.profile ?? {};
  const awayProfile = away.profile ?? {};

  const overOdds = toNumber(market.overOdds ?? market.odds);
  const underOdds = toNumber(market.underOdds);
  const impliedOver = overOdds > 0 ? 1 / overOdds : 0;
  const impliedUnder = underOdds > 0 ? 1 / underOdds : 0;
  const margin =
    impliedOver > 0 && impliedUnder > 0 ? impliedOver + impliedUnder - 1 : 0;

  const rawFeatures = [
    toNumber(market.line),
    overOdds,
    impliedOver,
    underOdds,
    impliedUnder,
    margin,
    toNumber(home.optaRank, 100),
    toNumber(home.optaRating, 80),
    toNumber(away.optaRank, 100),
    toNumber(away.optaRating, 80),
    toNumber(home.optaRank, 100) - toNumber(away.optaRank, 100),
    toNumber(home.optaRating, 80) - toNumber(away.optaRating, 80),
    toNumber(home.wmaFor?.recent),
    toNumber(home.wmaFor?.medium),
    toNumber(home.wmaFor?.long),
    toNumber(away.wmaFor?.recent),
    toNumber(away.wmaFor?.medium),
    toNumber(away.wmaFor?.long),
    toNumber(home.wmaAgainst?.recent),
    toNumber(home.wmaAgainst?.medium),
    toNumber(home.wmaAgainst?.long),
    toNumber(away.wmaAgainst?.recent),
    toNumber(away.wmaAgainst?.medium),
    toNumber(away.wmaAgainst?.long),
  ];

  const formulaValues = FORMULA_FEATURE_KEYS_NEW.map((key) =>
    toNumber(formulaPredictions[key]),
  );
  rawFeatures.push(...formulaValues);

  const numericFormulaValues = Object.values(formulaPredictions).filter((value) =>
    Number.isFinite(Number(value)),
  ).map((value) => Number(value));
  rawFeatures.push(
    numericFormulaValues.length,
    numericFormulaValues.length
      ? numericFormulaValues.reduce((sum, value) => sum + value, 0) /
          numericFormulaValues.length
      : 0,
    stdDev(numericFormulaValues),
    numericFormulaValues.length
      ? Math.max(...numericFormulaValues) - Math.min(...numericFormulaValues)
      : 0,
    numericFormulaValues.length ? Math.max(...numericFormulaValues) : 0,
    numericFormulaValues.length ? Math.min(...numericFormulaValues) : 0,
    median(numericFormulaValues),
  );

  rawFeatures.push(
    overOdds > 0 ? 0 : 1,
    metadata.supervised ? 1 : 0,
    numericFormulaValues.length > 0 ? 1 : 0,
    scope === "home" ? 1 : 0,
    scope === "away" ? 1 : 0,
    scope === "total" ? 1 : 0,
    period === "ALL" ? 1 : 0,
    period === "1ST" ? 1 : 0,
    period === "2ND" ? 1 : 0,
  );

  if (includeProfileFeatures) {
    const matchupScore =
      toNumber(homeProfile.rankFor, 50) /
      Math.max(1, toNumber(awayProfile.rankAgainst, 50));
    rawFeatures.push(
      toNumber(homeProfile.statValue),
      toNumber(homeProfile.statRank, 50),
      toNumber(awayProfile.statValue),
      toNumber(awayProfile.statRank, 50),
      toNumber(homeProfile.rankFor, 50),
      toNumber(homeProfile.rankAgainst, 50),
      toNumber(awayProfile.rankFor, 50),
      toNumber(awayProfile.rankAgainst, 50),
      matchupScore,
      toNumber(homeProfile.scoreFirstPct, 50),
      toNumber(awayProfile.scoreFirstPct, 50),
      toNumber(homeProfile.scoreFirstPct, 50) -
        toNumber(awayProfile.scoreFirstPct, 50),
      toNumber(homeProfile.shotsPerMinute?.leading),
      toNumber(homeProfile.shotsPerMinute?.trailing),
      toNumber(homeProfile.shotsPerMinute?.tied),
      toNumber(awayProfile.shotsPerMinute?.leading),
      toNumber(awayProfile.shotsPerMinute?.trailing),
      toNumber(awayProfile.shotsPerMinute?.tied),
      toNumber(homeProfile.shotsPerTenMinutes),
      toNumber(awayProfile.shotsPerTenMinutes),
    );
  }

  if (includeExtendedProfileFeatures) {
    for (const key of EXTRA_PROFILE_KEYS_NEW) {
      rawFeatures.push(
        getExtraValue(homeProfile, "for", key),
        getExtraValue(awayProfile, "for", key),
        getExtraValue(homeProfile, "against", key),
        getExtraValue(awayProfile, "against", key),
      );
    }
  }

  const expectedLength = buildFeatureNamesNew(featureMode).length;
  if (rawFeatures.length !== expectedLength) {
    throw new Error(
      `Feature length mismatch for ${statKey}_${scope}_${period}_${featureMode}: ` +
        `${rawFeatures.length} !== ${expectedLength}`,
    );
  }

  return {
    raw_features: rawFeatures,
    formula_predictions: formulaPredictions,
    consensus_features: {
      formula_count: numericFormulaValues.length,
      formula_std: stdDev(numericFormulaValues),
      formula_median: median(numericFormulaValues),
    },
    historical_win_rates: {},
    target: toNumber(target),
    metadata: {
      ...metadata,
      statKey,
      scope,
      period,
      featureMode,
    },
    feature_flags: {
      includeProfileFeatures,
      includeExtendedProfileFeatures,
    },
  };
}
