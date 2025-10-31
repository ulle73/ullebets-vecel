import { STAT_CONFIG } from "./statConfig";

export const SCOPE_TOTAL = "TOTAL";
export const SCOPE_HOME = "HOME_TEAM";
export const SCOPE_AWAY = "AWAY_TEAM";

const DEFAULT_PERIOD = "ALL";

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickPeriodNode(node, period) {
  if (!node || typeof node !== "object") return null;
  return node?.[period] ?? node?.[DEFAULT_PERIOD] ?? null;
}

export function getTeamStatValue(profile, orientation, statKey, period = DEFAULT_PERIOD) {
  const node = profile?.statistics?.[orientation]?.[statKey];
  const periodNode = pickPeriodNode(node, period);
  const value = periodNode?.value ?? periodNode?.Value ?? periodNode;
  return toNumber(value);
}

export function getLeagueAverageValue(profile, orientation, statKey, period = DEFAULT_PERIOD) {
  const node = profile?.statistics?.leagueAverage?.[orientation]?.[statKey];
  const periodNode = pickPeriodNode(node, period);
  const value = periodNode?.value ?? periodNode?.Value ?? periodNode;
  return toNumber(value);
}

function normalizeScope(scope) {
  const key = typeof scope === "string" ? scope.toUpperCase() : "";
  if (key === SCOPE_TOTAL) return SCOPE_TOTAL;
  if (key === "HOME" || key === SCOPE_HOME) return SCOPE_HOME;
  if (key === "AWAY" || key === SCOPE_AWAY) return SCOPE_AWAY;
  return null;
}

function computeAverage(modifiers) {
  if (!modifiers.length) return null;
  const sum = modifiers.reduce((acc, val) => acc + val, 0);
  return sum / modifiers.length;
}

export function calculateBaseline({
  statKey,
  period = DEFAULT_PERIOD,
  homeProfile,
  awayProfile,
  config = STAT_CONFIG,
}) {
  const mapping = config?.[statKey];
  const marketStat = mapping?.market_stat ?? statKey;

  const homeFor = getTeamStatValue(homeProfile, "for", marketStat, period);
  const homeAgainst = getTeamStatValue(homeProfile, "against", marketStat, period);
  const awayFor = getTeamStatValue(awayProfile, "for", marketStat, period);
  const awayAgainst = getTeamStatValue(awayProfile, "against", marketStat, period);

  const homeLeagueFor = getLeagueAverageValue(homeProfile, "for", marketStat, period);
  const homeLeagueAgainst = getLeagueAverageValue(homeProfile, "against", marketStat, period);
  const awayLeagueFor = getLeagueAverageValue(awayProfile, "for", marketStat, period);
  const awayLeagueAgainst = getLeagueAverageValue(awayProfile, "against", marketStat, period);

  const totalBaseline =
    Number.isFinite(homeFor) &&
    Number.isFinite(homeAgainst) &&
    Number.isFinite(awayFor) &&
    Number.isFinite(awayAgainst)
      ? ((homeFor + awayAgainst) + (awayFor + homeAgainst)) / 2
      : null;
  const homeBaseline =
    Number.isFinite(homeFor) && Number.isFinite(awayAgainst)
      ? (homeFor + awayAgainst) / 2
      : null;
  const awayBaseline =
    Number.isFinite(awayFor) && Number.isFinite(homeAgainst)
      ? (awayFor + homeAgainst) / 2
      : null;

  const totalLeagueBaseline =
    Number.isFinite(homeLeagueFor) &&
    Number.isFinite(homeLeagueAgainst) &&
    Number.isFinite(awayLeagueFor) &&
    Number.isFinite(awayLeagueAgainst)
      ? ((homeLeagueFor + awayLeagueAgainst) + (awayLeagueFor + homeLeagueAgainst)) / 2
      : null;
  const homeLeagueBaseline =
    Number.isFinite(homeLeagueFor) && Number.isFinite(awayLeagueAgainst)
      ? (homeLeagueFor + awayLeagueAgainst) / 2
      : null;
  const awayLeagueBaseline =
    Number.isFinite(awayLeagueFor) && Number.isFinite(homeLeagueAgainst)
      ? (awayLeagueFor + homeLeagueAgainst) / 2
      : null;

  return {
    marketStat,
    values: {
      home: {
        for: homeFor,
        against: homeAgainst,
      },
      away: {
        for: awayFor,
        against: awayAgainst,
      },
    },
    perScope: {
      [SCOPE_TOTAL]: totalBaseline,
      [SCOPE_HOME]: homeBaseline,
      [SCOPE_AWAY]: awayBaseline,
    },
    league: {
      values: {
        home: {
          for: homeLeagueFor,
          against: homeLeagueAgainst,
        },
        away: {
          for: awayLeagueFor,
          against: awayLeagueAgainst,
        },
      },
      perScope: {
        [SCOPE_TOTAL]: totalLeagueBaseline,
        [SCOPE_HOME]: homeLeagueBaseline,
        [SCOPE_AWAY]: awayLeagueBaseline,
      },
    },
  };
}

export function calculateStyleModifier({
  statKey,
  period = DEFAULT_PERIOD,
  homeProfile,
  awayProfile,
  config = STAT_CONFIG,
}) {
  const recipe = config?.[statKey];
  if (!recipe || !Array.isArray(recipe.drivers) || !recipe.drivers.length) {
    return {
      drivers: [],
      perScope: {
        [SCOPE_TOTAL]: null,
        [SCOPE_HOME]: null,
        [SCOPE_AWAY]: null,
      },
      sampleSizes: {
        [SCOPE_TOTAL]: 0,
        [SCOPE_HOME]: 0,
        [SCOPE_AWAY]: 0,
      },
    };
  }

  const driverDetails = [];
  const totalMods = [];
  const homeMods = [];
  const awayMods = [];

  for (const driver of recipe.drivers) {
    const orientation = driver.type === "against" ? "against" : "for";
    const homeValue = getTeamStatValue(homeProfile, orientation, driver.stat, period);
    const awayValue = getTeamStatValue(awayProfile, orientation, driver.stat, period);
    const homeLeagueAvg = getLeagueAverageValue(homeProfile, orientation, driver.stat, period);
    const awayLeagueAvg = getLeagueAverageValue(awayProfile, orientation, driver.stat, period);

    const homeModifier =
      Number.isFinite(homeValue) && Number.isFinite(homeLeagueAvg) && homeLeagueAvg !== 0
        ? homeValue / homeLeagueAvg
        : null;
    const awayModifier =
      Number.isFinite(awayValue) && Number.isFinite(awayLeagueAvg) && awayLeagueAvg !== 0
        ? awayValue / awayLeagueAvg
        : null;

    if (Number.isFinite(homeModifier)) totalMods.push(homeModifier);
    if (Number.isFinite(awayModifier)) totalMods.push(awayModifier);

    if (driver.type === "for") {
      if (Number.isFinite(homeModifier)) homeMods.push(homeModifier);
      if (Number.isFinite(awayModifier)) awayMods.push(awayModifier);
    } else {
      if (Number.isFinite(awayModifier)) homeMods.push(awayModifier);
      if (Number.isFinite(homeModifier)) awayMods.push(homeModifier);
    }

    driverDetails.push({
      stat: driver.stat,
      type: driver.type,
      home: {
        value: homeValue,
        leagueAverage: homeLeagueAvg,
        modifier: homeModifier,
      },
      away: {
        value: awayValue,
        leagueAverage: awayLeagueAvg,
        modifier: awayModifier,
      },
    });
  }

  return {
    drivers: driverDetails,
    perScope: {
      [SCOPE_TOTAL]: computeAverage(totalMods),
      [SCOPE_HOME]: computeAverage(homeMods),
      [SCOPE_AWAY]: computeAverage(awayMods),
    },
    sampleSizes: {
      [SCOPE_TOTAL]: totalMods.length,
      [SCOPE_HOME]: homeMods.length,
      [SCOPE_AWAY]: awayMods.length,
    },
  };
}

export function calculateForecast({
  statKey,
  period = DEFAULT_PERIOD,
  scope = SCOPE_TOTAL,
  homeProfile,
  awayProfile,
  config = STAT_CONFIG,
}) {
  const scopeKey = normalizeScope(scope);
  if (!scopeKey) return { baseline: null, styleModifier: null, adjusted: null };

  const baseline = calculateBaseline({ statKey, period, homeProfile, awayProfile, config });
  const styleModifier = calculateStyleModifier({ statKey, period, homeProfile, awayProfile, config });

  const baselineValue = baseline?.perScope?.[scopeKey] ?? null;
  const modifierValue = styleModifier?.perScope?.[scopeKey] ?? null;
  const adjusted =
    baselineValue != null ? baselineValue * (Number.isFinite(modifierValue) ? modifierValue : 1) : null;
  const leagueBaseline = baseline?.league?.perScope?.[scopeKey] ?? null;
  const normalized =
    Number.isFinite(adjusted) &&
    Number.isFinite(leagueBaseline) &&
    leagueBaseline !== 0
      ? adjusted / leagueBaseline
      : null;

  return {
    baseline: baselineValue,
    styleModifier: Number.isFinite(modifierValue) ? modifierValue : null,
    adjusted,
    normalized: Number.isFinite(normalized) ? normalized : null,
    details: {
      baseline,
      styleModifier,
    },
  };
}

export function computeForecastBundle({
  statKey,
  period = DEFAULT_PERIOD,
  homeProfile,
  awayProfile,
  config = STAT_CONFIG,
}) {
  const baseline = calculateBaseline({ statKey, period, homeProfile, awayProfile, config });
  const styleModifier = calculateStyleModifier({ statKey, period, homeProfile, awayProfile, config });

  const adjusted = {
    [SCOPE_TOTAL]: null,
    [SCOPE_HOME]: null,
    [SCOPE_AWAY]: null,
  };
  const normalized = {
    [SCOPE_TOTAL]: null,
    [SCOPE_HOME]: null,
    [SCOPE_AWAY]: null,
  };

  for (const scope of [SCOPE_TOTAL, SCOPE_HOME, SCOPE_AWAY]) {
    const baselineValue = baseline?.perScope?.[scope];
    if (baselineValue == null) {
      adjusted[scope] = null;
      normalized[scope] = null;
      continue;
    }
    const modifierValue = styleModifier?.perScope?.[scope];
    const mod = Number.isFinite(modifierValue) ? modifierValue : 1;
    adjusted[scope] = baselineValue * mod;
    const leagueBaseline = baseline?.league?.perScope?.[scope];
    normalized[scope] =
      Number.isFinite(adjusted[scope]) &&
      Number.isFinite(leagueBaseline) &&
      leagueBaseline !== 0
        ? adjusted[scope] / leagueBaseline
        : null;
  }

  return {
    baseline,
    styleModifier,
    adjusted,
    normalized,
  };
}
