
import { fetchTeamMatches, fetchTeamProfilesBundle } from "./data";
import { createCache } from "./cache";

const RESULT_CACHE = createCache({ ttlMs: 45 * 60 * 1000 });
const logEngine = (...args) => console.log("[backtest:engine]", ...args);

const STAT_PATTERNS = {
  totalShots: {
    keys: ["totalshots", "totalshotsongoal"],
    names: ["total shots"],
    rankKey: "totalShotsOnGoal",
  },
  shotsOnGoal: {
    keys: ["shotsongoal"],
    names: ["shots on goal", "shots on target"],
    rankKey: "shotsOnGoal",
  },
  cornerKicks: {
    keys: ["cornerkicks"],
    names: ["corner kicks", "corners"],
    rankKey: "cornerKicks",
  },
  yellowCards: {
    keys: ["yellowcards"],
    names: ["yellow cards"],
    rankKey: "yellowCards",
  },
  throwIns: {
    keys: ["throwins"],
    names: ["throw-ins"],
    rankKey: "throwIns",
  },
  freeKicks: {
    keys: ["freekicks"],
    names: ["free kicks"],
    rankKey: "freeKicks",
  },
  fouls: { keys: ["fouls"], names: ["fouls"], rankKey: "fouls" },
  totalTackle: {
    keys: ["totaltackle", "tackles"],
    names: ["tackles", "total tackles"],
    rankKey: "totalTackle",
  },
  offsides: { keys: ["offsides"], names: ["offsides"], rankKey: "offsides" },
};

const PERIODS = ["ALL", "1ST", "2ND"];
const DEFAULT_FORM = "all";
const IMPORTANCE_RANGE = [0.8, 1.2];
const IMPORTANCE_STEP = 0.05;

const DEFAULT_MULTIPLIER_RESULT = {
  multiplier: 1,
  rawScore: 0,
  teamStrength: {},
  featureBreakdown: {},
};

const DEFAULT_MULTIFACTOR_RESULT = {
  lambda: null,
};

function normalizeTeamName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function teamSlug(name) {
  return normalizeTeamName(name).replace(/\s+/g, "_");
}

function clamp(min, val, max) {
  return Math.min(Math.max(val, min), max);
}

function importanceFactor(importance) {
  const [min, max] = IMPORTANCE_RANGE;
  return clamp(min, 1 + IMPORTANCE_STEP * (importance - 5), max);
}

function weightedMean(values, timestamps, halfLifeDays = 20) {
  const now = Date.now();
  const timeWeights = timestamps.map((ts) => {
    const days = (now - new Date(ts).getTime()) / (1000 * 60 * 60 * 24);
    return Math.exp((-Math.LN2 * days) / halfLifeDays);
  });
  const indexWeight = (idx) => {
    if (idx < 3) return 4;
    if (idx < 6) return 3;
    if (idx < 10) return 2;
    if (idx < 20) return 1;
    return 0.5;
  };
  const weights = timeWeights.map((w, i) => w * indexWeight(i));
  const sumW = weights.reduce((s, w) => s + w, 0) || 1;
  return values.reduce((s, v, i) => s + v * weights[i], 0) / sumW;
}

const formatNumber = (value) =>
  Number.isFinite(value) ? Number(value).toFixed(2) : "n/a";

function averageNumbers(values) {
  const valid = (values || []).filter((val) => Number.isFinite(val));
  if (!valid.length) return null;
  return valid.reduce((sum, val) => sum + val, 0) / valid.length;
}

function readProfileStatEntry(profile, sectionKey, statKey, periodKey) {
  const section = profile?.statistics?.[sectionKey];
  if (!section?.[statKey]) return null;
  const stat = section[statKey];
  const periodEntry = stat?.[periodKey] ?? (periodKey !== "ALL" ? stat?.ALL : null);
  if (!periodEntry) return null;
  const numeric = Number(periodEntry.value);
  return {
    value: Number.isFinite(numeric) ? numeric : null,
    rank: periodEntry.rank ?? null,
  };
}

function readProfileLeagueAverageEntry(profile, sectionKey, statKey, periodKey) {
  const section = profile?.statistics?.leagueAverage?.[sectionKey];
  if (!section?.[statKey]) return null;
  const stat = section[statKey];
  const periodEntry = stat?.[periodKey] ?? (periodKey !== "ALL" ? stat?.ALL : null);
  if (!periodEntry) return null;
  const numeric = Number(periodEntry.value);
  return {
    value: Number.isFinite(numeric) ? numeric : null,
    rank: null,
  };
}

function pickBundleEntry(bundle, matchTypes, reader) {
  const values = [];
  let rank = null;
  for (const matchType of matchTypes) {
    const profile = bundle?.[matchType];
    if (!profile) continue;
    const entry = reader(profile);
    if (!entry) continue;
    if (Number.isFinite(entry.value)) {
      values.push(entry.value);
    }
    if (rank == null && entry.rank != null) {
      rank = entry.rank;
    }
  }
  return {
    value: values.length ? averageNumbers(values) : null,
    rank,
  };
}

function poissonCdf(k, lambda) {
  let sum = 0;
  let term = Math.exp(-lambda);
  for (let i = 0; i <= k; i++) {
    if (i > 0) term *= lambda / i;
    sum += term;
  }
  return sum;
}

function blendProb(prob, successes, total, weight = 5) {
  const alpha0 = prob * weight;
  const beta0 = (1 - prob) * weight;
  return (alpha0 + successes) / (alpha0 + beta0 + total);
}

function calibrateEv(ev) {
  return ev;
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}
function findTeamEntry(entries, teamName) {
  if (!Array.isArray(entries)) return null;
  const normalized = normalizeTeamName(teamName);
  return (
    entries.find((entry) => normalizeTeamName(entry.team) === normalized) ||
    entries.find((entry) => normalizeTeamName(entry.team).includes(normalized)) ||
    null
  );
}

function getPeriodEntries(section, periodKey) {
  if (!section) return null;
  if (Array.isArray(section[periodKey]) && section[periodKey].length) {
    return section[periodKey];
  }
  if (periodKey !== "ALL" && Array.isArray(section.ALL) && section.ALL.length) {
    return section.ALL;
  }
  const firstArray = Object.values(section).find(
    (value) => Array.isArray(value) && value.length
  );
  return firstArray || null;
}

function valueFromEntry(entry, location) {
  if (!entry) return null;
  const home = Number(entry.home_rawValue);
  const away = Number(entry.away_rawValue);
  const hasHome = Number.isFinite(home);
  const hasAway = Number.isFinite(away);
  if (!hasHome && !hasAway) return null;

  if (location === "both") {
    const values = [];
    if (hasHome) values.push(home);
    if (hasAway) values.push(away);
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  if (location === "home") {
    return hasHome ? home : hasAway ? away : null;
  }

  if (location === "away") {
    return hasAway ? away : hasHome ? home : null;
  }

  return null;
}

function averageEntries(entries, location) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const values = entries
    .map((entry) => valueFromEntry(entry, location))
    .filter((val) => Number.isFinite(val));
  if (!values.length) return null;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

function getTeamMetric(stat, type, periodKey, teamName, location) {
  const section = stat?.[type];
  if (!section) return null;
  const entries = getPeriodEntries(section, periodKey);
  if (!entries) return null;
  const entry = findTeamEntry(entries, teamName);
  return valueFromEntry(entry, location);
}

function getLeagueAverageMetric(stat, type, periodKey, location) {
  const section = stat?.[type];
  if (!section) return null;
  const entries = getPeriodEntries(section, periodKey);
  if (!entries) return null;
  return averageEntries(entries, location);
}

function computeOverallAverage(stat, periodKey) {
  const avg = stat?.leagueAverage;
  if (!avg) return null;
  if (Number.isFinite(avg?.[periodKey])) return avg[periodKey];
  if (periodKey !== "ALL" && Number.isFinite(avg?.ALL)) return avg.ALL;
  const values = Object.values(avg).filter((val) => Number.isFinite(val));
  if (!values.length) return null;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

function safeDivide(value, divisor) {
  if (!Number.isFinite(value) || !Number.isFinite(divisor) || divisor === 0) {
    return null;
  }
  return value / divisor;
}

function toFeatureSlug(value) {
  if (!value) return "";
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extractAllFeaturesFromBlock(block) {
  if (!block?.groups) return null;
  const features = {};
  for (const group of block.groups) {
    for (const row of group.statisticsItems || []) {
      const slug = toFeatureSlug(row.key || row.name);
      if (!slug) continue;
      const homeValue = Number(row.homeValue);
      const awayValue = Number(row.awayValue);
      if (!Number.isFinite(homeValue) || !Number.isFinite(awayValue)) continue;
      const entry = { home: homeValue, away: awayValue, total: homeValue + awayValue };
      features[slug] = entry;
      const alias = slug.replace(/_/g, "");
      if (alias && alias !== slug && !features[alias]) {
        features[alias] = entry;
      }
    }
  }
  return features;
}

function extractTuple(detail, statKey, periodKey) {
  if (!detail?.statistics) return null;
  const blk = Array.isArray(detail.statistics)
    ? detail.statistics.find((b) => (b.period ?? "").toUpperCase() === periodKey) || detail.statistics[0]
    : detail.statistics;
  if (!blk?.groups) return null;

  const stats = {};
  const patterns = Object.entries(STAT_PATTERNS).map(([key, { keys, names }]) => ({
    stat: key,
    keys: keys.map((k) => k.toLowerCase()),
    names: names.map((n) => n.toLowerCase()),
  }));

  for (const group of blk.groups) {
    for (const row of group.statisticsItems || []) {
      const kk = row.key?.toLowerCase();
      const nn = row.name?.toLowerCase().trim();
      const match = patterns.find(
        (p) => (kk && p.keys.includes(kk)) || (nn && p.names.includes(nn))
      );
      if (match) {
        stats[match.stat] = {
          home: row.homeValue,
          away: row.awayValue,
          total: row.homeValue + row.awayValue,
        };
      }
    }
  }

  const featureMap = extractAllFeaturesFromBlock(blk);
  if (featureMap && Object.keys(featureMap).length) {
    stats.__features = featureMap;
  }
  return stats;
}

function calcTuple(match, statKey, periodKey) {
  const tuple = extractTuple(match.matchDetails, statKey, periodKey);
  if (!tuple) return null;
  const result = {};
  for (const stat in STAT_PATTERNS) {
    if (tuple[stat]) {
      result[stat] = { ...tuple[stat] };
    }
  }
  if (tuple.__features) {
    result.__features = tuple.__features;
  }
  if (result.freeKicks) {
    const homeBase = safeNumber(result.freeKicks.home);
    const awayBase = safeNumber(result.freeKicks.away);
    const offsides = result.offsides || {};
    const homeOpponentOffsides = safeNumber(offsides.away);
    const awayOpponentOffsides = safeNumber(offsides.home);
    const homeAdjusted = homeBase + homeOpponentOffsides;
    const awayAdjusted = awayBase + awayOpponentOffsides;
    result.freeKicks = {
      home: homeAdjusted,
      away: awayAdjusted,
      total: homeAdjusted + awayAdjusted,
    };
  }
  return result;
}
function createBaselineFilter({
  tuples,
  neutralGround,
  scope,
  homeSlug,
  awaySlug,
  statKey,
}) {
  const values = tuples
    .map((t) => {
      if (!t.data[statKey]) return undefined;
      if (scope === "total") return t.data[statKey].total;
      if (scope === "home") {
        const isHomeTeam = teamSlug(t.meta.homeTeamName) === homeSlug;
        if (neutralGround) {
          return isHomeTeam ? t.data[statKey].away : t.data[statKey].home;
        }
        return isHomeTeam ? t.data[statKey].home : undefined;
      }
      const isAwayTeam = teamSlug(t.meta.awayTeamName) === awaySlug;
      return isAwayTeam ? t.data[statKey].away : undefined;
    })
    .filter((value) => Number.isFinite(value));
  return values;
}

function lambda60_40(
  homeHome,
  awayAway,
  homeAgainst,
  awayAgainst,
  homeImportance,
  awayImportance,
  statKey
) {
  const gfH = weightedMean(
    homeHome.map((t) => t.data[statKey]?.home || 0),
    homeHome.map((t) => t.meta.timestamp)
  );
  const gaH = weightedMean(
    homeAgainst.map((t) => t.data[statKey]?.away || 0),
    homeAgainst.map((t) => t.meta.timestamp)
  );
  const gfA = weightedMean(
    awayAway.map((t) => t.data[statKey]?.away || 0),
    awayAway.map((t) => t.meta.timestamp)
  );
  const gaA = weightedMean(
    awayAgainst.map((t) => t.data[statKey]?.home || 0),
    awayAgainst.map((t) => t.meta.timestamp)
  );
  const hFactor = importanceFactor(homeImportance);
  const aFactor = importanceFactor(awayImportance);
  const gfHAdj = gfH * hFactor;
  const gaHAdj = gaH / hFactor;
  const gfAAdj = gfA * aFactor;
  const gaAAdj = gaA / aFactor;
  return 0.6 * gfHAdj + 0.4 * gaAAdj + 0.6 * gfAAdj + 0.4 * gaHAdj;
}

function lambda60_40_basic(
  homeHome,
  awayAway,
  homeAgainst,
  awayAgainst,
  homeImportance,
  awayImportance,
  statKey
) {
  const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const gfH = mean(homeHome.map((t) => t.data[statKey]?.home || 0));
  const gaH = mean(homeAgainst.map((t) => t.data[statKey]?.away || 0));
  const gfA = mean(awayAway.map((t) => t.data[statKey]?.away || 0));
  const gaA = mean(awayAgainst.map((t) => t.data[statKey]?.home || 0));
  const hFactor = importanceFactor(homeImportance);
  const aFactor = importanceFactor(awayImportance);
  const gfHAdj = gfH * hFactor;
  const gaHAdj = gaH / hFactor;
  const gfAAdj = gfA * aFactor;
  const gaAAdj = gaA / aFactor;
  return 0.6 * gfHAdj + 0.4 * gaAAdj + 0.6 * gfAAdj + 0.4 * gaHAdj;
}

function computeSinglePeriodProjection({
  periodKey,
  homeTeam,
  awayTeam,
  homeStat,
  awayStat,
  neutralGround,
}) {
  const attackLocationHome = neutralGround ? "both" : "home";
  const defendLocationAway = neutralGround ? "both" : "away";
  const attackLocationAway = neutralGround ? "both" : "away";
  const defendLocationHome = neutralGround ? "both" : "home";

  const homeAttack = getTeamMetric(
    homeStat,
    "for",
    periodKey,
    homeTeam,
    attackLocationHome
  );
  const homeAttackAvg = getLeagueAverageMetric(
    homeStat,
    "for",
    periodKey,
    attackLocationHome
  );
  const awayConcede = getTeamMetric(
    awayStat,
    "against",
    periodKey,
    awayTeam,
    defendLocationAway
  );
  const awayConcedeAvg = getLeagueAverageMetric(
    awayStat,
    "against",
    periodKey,
    defendLocationAway
  );

  const awayAttack = getTeamMetric(
    awayStat,
    "for",
    periodKey,
    awayTeam,
    attackLocationAway
  );
  const awayAttackAvg = getLeagueAverageMetric(
    awayStat,
    "for",
    periodKey,
    attackLocationAway
  );
  const homeConcede = getTeamMetric(
    homeStat,
    "against",
    periodKey,
    homeTeam,
    defendLocationHome
  );
  const homeConcedeAvg = getLeagueAverageMetric(
    homeStat,
    "against",
    periodKey,
    defendLocationHome
  );

  const overallCandidates = [
    computeOverallAverage(homeStat, periodKey),
    computeOverallAverage(awayStat, periodKey),
  ].filter((val) => Number.isFinite(val));

  let overallAverage = overallCandidates.length
    ? overallCandidates.reduce((sum, val) => sum + val, 0) /
      overallCandidates.length
    : null;

  if (!Number.isFinite(overallAverage)) {
    const fallback = [
      homeAttackAvg,
      awayAttackAvg,
      homeConcedeAvg,
      awayConcedeAvg,
    ].filter((val) => Number.isFinite(val));
    if (fallback.length) {
      overallAverage = fallback.reduce((sum, val) => sum + val, 0) / fallback.length;
    }
  }

  const homeAttackFactor = safeDivide(homeAttack, homeAttackAvg);
  const awayConcedeFactor = safeDivide(awayConcede, awayConcedeAvg);
  const awayAttackFactor = safeDivide(awayAttack, awayAttackAvg);
  const homeConcedeFactor = safeDivide(homeConcede, homeConcedeAvg);

  if (
    [
      homeAttackFactor,
      awayConcedeFactor,
      awayAttackFactor,
      homeConcedeFactor,
      overallAverage,
    ].some((val) => !Number.isFinite(val))
  ) {
    return null;
  }

  const lambdaHome = homeAttackFactor * awayConcedeFactor * overallAverage;
  const lambdaAway = awayAttackFactor * homeConcedeFactor * overallAverage;
  const lambdaTotal = lambdaHome + lambdaAway;

  const format = (val) => (Number.isFinite(val) ? val.toFixed(2) : "n/a");

  return {
    period: periodKey,
    home: {
      lambda: lambdaHome,
      components: {
        attack: homeAttack,
        attackAvg: homeAttackAvg,
        concede: awayConcede,
        concedeAvg: awayConcedeAvg,
        overall: overallAverage,
      },
      formula: `(${format(homeAttack)} / ${format(homeAttackAvg)}) * (${format(
        awayConcede
      )} / ${format(awayConcedeAvg)}) * ${format(overallAverage)} = ${format(
        lambdaHome
      )}`,
    },
    away: {
      lambda: lambdaAway,
      components: {
        attack: awayAttack,
        attackAvg: awayAttackAvg,
        concede: homeConcede,
        concedeAvg: homeConcedeAvg,
        overall: overallAverage,
      },
      formula: `(${format(awayAttack)} / ${format(awayAttackAvg)}) * (${format(
        homeConcede
      )} / ${format(homeConcedeAvg)}) * ${format(overallAverage)} = ${format(
        lambdaAway
      )}`,
    },
    total: {
      lambda: lambdaTotal,
      formula: `${format(lambdaHome)} + ${format(lambdaAway)} = ${format(
        lambdaTotal
      )}`,
    },
  };
}

async function computeLeagueAverageProjection({
  homeTeam,
  awayTeam,
  statKey,
  periodKey,
  scope,
  neutralGround,
}) {
  const leagueRankings = await loadLeagueRankings();

  const normalizedHome = normalizeTeamName(homeTeam);
  const normalizedAway = normalizeTeamName(awayTeam);

  const homeLeagueBlock = leagueRankings.find((entry) => {
    const teams = entry?.ranking?.[statKey]?.for?.ALL || [];
    return teams.some((team) => normalizeTeamName(team.team) === normalizedHome);
  });
  const awayLeagueBlock = leagueRankings.find((entry) => {
    const teams = entry?.ranking?.[statKey]?.for?.ALL || [];
    return teams.some((team) => normalizeTeamName(team.team) === normalizedAway);
  });

  if (!homeLeagueBlock || !awayLeagueBlock) {
    return { lambda: null, selectedLambda: null, scope, reason: "missing-league" };
  }

  const homeStat = homeLeagueBlock?.ranking?.[statKey];
  const awayStat = awayLeagueBlock?.ranking?.[statKey];

  if (!homeStat || !awayStat) {
    return { lambda: null, selectedLambda: null, scope, reason: "missing-stat" };
  }

  const lambdaPeriods = periodKey ? [periodKey] : ["ALL"];
  const reportPeriods = Array.from(new Set([...PERIODS, ...lambdaPeriods]));

  const formulas = [];
  let lambdaHomeTotal = 0;
  let lambdaAwayTotal = 0;
  let lambdaHomeCounted = 0;
  let lambdaAwayCounted = 0;

  for (const per of reportPeriods) {
    const periodProjection = computeSinglePeriodProjection({
      periodKey: per,
      homeTeam,
      awayTeam,
      homeStat,
      awayStat,
      neutralGround,
    });

    if (!periodProjection) continue;
    formulas.push(periodProjection);

    if (lambdaPeriods.includes(per)) {
      lambdaHomeTotal += periodProjection.home.lambda;
      lambdaAwayTotal += periodProjection.away.lambda;
      lambdaHomeCounted += 1;
      lambdaAwayCounted += 1;
    }
  }

  if (!lambdaHomeCounted || !lambdaAwayCounted) {
    return {
      lambda: null,
      selectedLambda: null,
      scope,
      reason: "missing-period",
      formulas,
      leagues: {
        home: homeLeagueBlock.league,
        away: awayLeagueBlock.league,
      },
    };
  }

  const lambdaTotal = lambdaHomeTotal + lambdaAwayTotal;
  const selectedLambda =
    scope === "home"
      ? lambdaHomeTotal
      : scope === "away"
      ? lambdaAwayTotal
      : lambdaTotal;

  return {
    lambda: { home: lambdaHomeTotal, away: lambdaAwayTotal, total: lambdaTotal },
    selectedLambda,
    scope,
    reason: null,
    leagues: {
      home: homeLeagueBlock.league,
      away: awayLeagueBlock.league,
    },
    formulas,
  };
}

async function computeMultiplier() {
  return DEFAULT_MULTIPLIER_RESULT;
}

async function computeMultifactor() {
  return DEFAULT_MULTIFACTOR_RESULT;
}
function buildCacheKey(params) {
  return JSON.stringify(params, Object.keys(params).sort());
}

function parseFormValue(form) {
  if (form === undefined || form === null) return DEFAULT_FORM;
  if (String(form).toLowerCase() === "all") return Infinity;
  const parsed = Number.parseInt(form, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
}

function validateScope(scope) {
  const normalized = String(scope || "total").toLowerCase();
  if (["home", "away", "total"].includes(normalized)) {
    return normalized;
  }
  return "total";
}

function validatePeriod(period) {
  const normalized = String(period || "ALL").toUpperCase();
  if (PERIODS.includes(normalized)) {
    return normalized;
  }
  return "ALL";
}

function validateImportance(value, fallback = 5) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return fallback;
  return clamp(1, numeric, 10);
}

function parseOdds(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export async function computeExpectedValue(params) {
  const {
    homeTeam,
    awayTeam,
    over = true,
    line,
    scope = "total",
    stat = "totalShots",
    period = "ALL",
    form = DEFAULT_FORM,
    odds,
    neutralGround = false,
    home_importance = 5,
    away_importance = 5,
  } = params;

  if (!homeTeam || !awayTeam || line === undefined || line === null) {
    throw new Error("Hemmalag, bortalag och lina krävs");
  }

  if (!STAT_PATTERNS[stat]) {
    throw new Error(`Okänd statKey '${stat}'`);
  }

  const parsedLine = Number.parseFloat(line);
  if (!Number.isFinite(parsedLine)) {
    throw new Error("Ogiltig lina");
  }

  const parsedScope = validateScope(scope);
  const parsedPeriod = validatePeriod(period);
  const parsedForm = parseFormValue(form);
  const parsedOdds = parseOdds(odds);
  const homeImportance = validateImportance(home_importance);
  const awayImportance = validateImportance(away_importance);

  logEngine("computeExpectedValue:start", {
    homeTeam,
    awayTeam,
    stat,
    scope: parsedScope,
    period: parsedPeriod,
    form: parsedForm,
    odds: parsedOdds,
    neutralGround,
    formRaw: form,
  });

  const cacheKey = buildCacheKey({
    homeTeam,
    awayTeam,
    over,
    line: parsedLine,
    scope: parsedScope,
    stat,
    period: parsedPeriod,
    form: parsedForm,
    neutralGround,
    odds: parsedOdds,
    homeImportance,
    awayImportance,
  });

  const cached = RESULT_CACHE.get(cacheKey);
  if (cached) {
    logEngine("computeExpectedValue:cache-hit", { cacheKey });
    return cached;
  }
  logEngine("computeExpectedValue:cache-miss", { cacheKey });

  const homeMatchType = neutralGround ? "away" : "home";

  if (!tuplesRaw.length) {
    throw new Error(`Inga matcher hittades för ${homeTeam} / ${awayTeam}.`);
  }

  const seen = new Set();
  const unique = [];
  for (const match of tuplesRaw) {
    const key = `${teamSlug(match.homeTeamName)}_${teamSlug(
      match.awayTeamName
    )}_${match.timestamp}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(match);
    }
  }

  const tuples = unique
    .map((match) => ({
      meta: match,
      data: calcTuple(match, stat, parsedPeriod),
    }))
    .filter((tuple) => tuple.data && tuple.data[stat])
    .sort((a, b) => (b.meta.timestamp || 0) - (a.meta.timestamp || 0));

  if (!tuples.length) {
    throw new Error("Ingen statistik hittades för valda inställningar.");
  }

  const homeSlug = teamSlug(homeTeam);
  const awaySlug = teamSlug(awayTeam);

  const baselineValuesInitial = createBaselineFilter({
    tuples,
    neutralGround,
    scope: parsedScope,
    homeSlug,
    awaySlug,
    statKey: stat,
  });

  const OVER = Boolean(over);
  const LINE = parsedLine;
  const FORM = parsedForm;

  const applyFormLimit = (items) =>
    FORM === Infinity ? items : items.slice(0, FORM);

  const oddsValue = parsedOdds;
  const implied = oddsValue ? 1 / oddsValue : 0;

  let result;

  if (FORM === Infinity) {
    const homeHomeArr = tuples.filter((t) =>
      neutralGround
        ? teamSlug(t.meta.awayTeamName) === homeSlug
        : teamSlug(t.meta.homeTeamName) === homeSlug
    );
    const awayAwayArr = tuples.filter(
      (t) => teamSlug(t.meta.awayTeamName) === awaySlug
    );
    const homeAgainstArr = tuples.filter((t) =>
      neutralGround
        ? teamSlug(t.meta.awayTeamName) === homeSlug
        : teamSlug(t.meta.homeTeamName) === homeSlug
    );
    const awayAgainstArr = tuples.filter(
      (t) => teamSlug(t.meta.awayTeamName) === awaySlug
    );

    const baselineValues = baselineValuesInitial;

    const homeConcededRaw = (neutralGround ? homeAgainstArr : homeHomeArr).map((t) =>
      neutralGround ? t.data[stat]?.home : t.data[stat]?.away
    );
    const awayConcededRaw = awayAgainstArr.map((t) => t.data[stat]?.home);

    const homeAgainst = homeConcededRaw.filter((val) => Number.isFinite(val));
    const awayAgainst = awayConcededRaw.filter((val) => Number.isFinite(val));
    const statsAgainstValues = [...homeAgainst, ...awayAgainst];

    const lambdaVal = lambda60_40(
      homeHomeArr,
      awayAwayArr,
      homeAgainstArr,
      awayAgainstArr,
      homeImportance,
      awayImportance,
      stat
    );
    const lambdaLegacy = lambda60_40_basic(
      homeHomeArr,
      awayAwayArr,
      homeAgainstArr,
      awayAgainstArr,
      homeImportance,
      awayImportance,
      stat
    );

    const k = OVER ? Math.max(-1, Math.ceil(LINE) - 1) : Math.floor(LINE);
    const cdfVal = poissonCdf(k, lambdaVal);
    const prob = Math.min(1, Math.max(0, OVER ? 1 - cdfVal : cdfVal));
    const cdfLegacy = poissonCdf(k, lambdaLegacy);
    const probLegacy = Math.min(1, Math.max(0, OVER ? 1 - cdfLegacy : cdfLegacy));

    const hitsOver = baselineValues.filter((n) => n > LINE).length;
    const hitsUnder = baselineValues.filter((n) => n < LINE).length;
    const hitsExact = baselineValues.filter((n) => n === LINE).length;
    const hitsFor = OVER ? hitsOver : hitsUnder;
    const baselineN = baselineValues.length;
    const empirical = baselineN ? hitsFor / baselineN : 0;
    const blended = blendProb(prob, hitsFor, baselineN, 5);

    const rawEvPct = oddsValue != null ? prob * oddsValue * 100 - 100 : null;
    const evPct = rawEvPct != null ? calibrateEv(rawEvPct) : null;

    const multiplierResult = await computeMultiplier();
    const lambdaWithMultiplier = lambdaVal * multiplierResult.multiplier;
    const cdfMultiplier = poissonCdf(k, lambdaWithMultiplier);
    const probWithMultiplier = Math.min(
      1,
      Math.max(0, OVER ? 1 - cdfMultiplier : cdfMultiplier)
    );
    const rawEvMultiplier =
      oddsValue != null ? probWithMultiplier * oddsValue * 100 - 100 : null;
    const evPctMultiplier =
      rawEvMultiplier != null ? calibrateEv(rawEvMultiplier) : null;
    const edgeWithMultiplier =
      oddsValue != null ? (probWithMultiplier - implied) * 100 : null;

    const leagueAvgProjection = await computeLeagueAverageProjection({
      homeTeam,
      awayTeam,
      statKey: STAT_PATTERNS[stat]?.rankKey || stat,
      periodKey: parsedPeriod,
      scope: parsedScope,
      neutralGround,
    });

    let probLeagueAvg = 0;
    let rawEvLeagueAvg = null;
    let evPctLeagueAvg = null;
    let edgeLeagueAvg = null;

    if (
      leagueAvgProjection?.selectedLambda != null &&
      Number.isFinite(leagueAvgProjection.selectedLambda)
    ) {
      const lambdaLeagueAvg = leagueAvgProjection.selectedLambda;
      const cdfLeague = poissonCdf(k, lambdaLeagueAvg);
      probLeagueAvg = Math.min(
        1,
        Math.max(0, OVER ? 1 - cdfLeague : cdfLeague)
      );
      if (oddsValue != null) {
        rawEvLeagueAvg = probLeagueAvg * oddsValue * 100 - 100;
        edgeLeagueAvg = (probLeagueAvg - implied) * 100;
        evPctLeagueAvg = calibrateEv(rawEvLeagueAvg);
      }
    }

    const multifactorProjection = await computeMultifactor();

    let probMultifactor = 0;
    let rawEvMultifactor = null;
    let evPctMultifactor = null;
    let edgeMultifactor = null;

    if (
      multifactorProjection?.lambda != null &&
      Number.isFinite(multifactorProjection.lambda)
    ) {
      const lambdaMultifactor = multifactorProjection.lambda;
      const cdfMf = poissonCdf(k, lambdaMultifactor);
      probMultifactor = Math.min(
        1,
        Math.max(0, OVER ? 1 - cdfMf : cdfMf)
      );
      if (oddsValue != null) {
        rawEvMultifactor = probMultifactor * oddsValue * 100 - 100;
        edgeMultifactor = (probMultifactor - implied) * 100;
        evPctMultifactor = calibrateEv(rawEvMultifactor);
      }
    }

    const hitsAgainst = baselineValues.length - hitsFor - hitsExact;
    const hitsAgainstDisplay = baselineValues.length
      ? `${hitsAgainst}/${baselineValues.length}`
      : "0/0";

    result = {
      params: {
        home: homeTeam,
        away: awayTeam,
        over: OVER,
        line: LINE,
        scope: parsedScope,
        stat,
        period: parsedPeriod,
        form,
        neutralGround,
        odds: oddsValue,
        homeImportance,
        awayImportance,
      },
      modelProb: prob,
      empiricalProb: empirical,
      blendedProb: blended,
      edgePP: oddsValue != null ? (prob - implied) * 100 : null,
      evPct,
      rawEvPct,
      legacyProb: probLegacy,
      legacyEvPct: oddsValue != null ? probLegacy * oddsValue * 100 - 100 : null,
      multiplier: multiplierResult,
      lambdaWithMultiplier:
        Number.isFinite(lambdaWithMultiplier)
          ? parseFloat(lambdaWithMultiplier.toFixed(2))
          : null,
      modelProbWithMultiplier: probWithMultiplier,
      edgePPWithMultiplier: edgeWithMultiplier,
      rawEvPctWithMultiplier: rawEvMultiplier,
      evPctWithMultiplier: evPctMultiplier,
      multifactor: {
        lambda:
          multifactorProjection?.lambda != null &&
          Number.isFinite(multifactorProjection.lambda)
            ? parseFloat(multifactorProjection.lambda.toFixed(2))
            : null,
        prob: probMultifactor,
        rawEvPct: rawEvMultifactor,
        evPct: evPctMultifactor,
        edgePP: edgeMultifactor,
        details: multifactorProjection,
      },
      leagueAvg: {
        lambda:
          leagueAvgProjection?.lambda &&
          typeof leagueAvgProjection.lambda === "object"
            ? {
                total: Number.isFinite(leagueAvgProjection.lambda.total)
                  ? parseFloat(leagueAvgProjection.lambda.total.toFixed(2))
                  : null,
                home: Number.isFinite(leagueAvgProjection.lambda.home)
                  ? parseFloat(leagueAvgProjection.lambda.home.toFixed(2))
                  : null,
                away: Number.isFinite(leagueAvgProjection.lambda.away)
                  ? parseFloat(leagueAvgProjection.lambda.away.toFixed(2))
                  : null,
              }
            : null,
        selectedLambda:
          leagueAvgProjection?.selectedLambda != null &&
          Number.isFinite(leagueAvgProjection.selectedLambda)
            ? parseFloat(leagueAvgProjection.selectedLambda.toFixed(2))
            : null,
        prob: probLeagueAvg,
        rawEvPct: rawEvLeagueAvg,
        evPct: evPctLeagueAvg,
        edgePP: edgeLeagueAvg,
        details: leagueAvgProjection,
      },
      modelProbMultifactor: probMultifactor,
      rawEvPctMultifactor: rawEvMultifactor,
      evPctMultifactor: evPctMultifactor,
      edgePPMultifactor: edgeMultifactor,
      modelProbLeagueAvg: probLeagueAvg,
      rawEvPctLeagueAvg: rawEvLeagueAvg,
      evPctLeagueAvg,
      edgePPLeagueAvg: edgeLeagueAvg,
      timestamp: new Date().toISOString(),
      matches: baselineValues.length,
      statsFor: baselineValues,
      statsAgainst: statsAgainstValues,
      hitsOver: `${hitsOver}/${baselineValues.length}`,
      hitsUnder: `${hitsUnder}/${baselineValues.length}`,
      hitsExact: `${hitsExact}/${baselineValues.length}`,
      meanFor: baselineValues.length
        ? parseFloat(
            (
              baselineValues.reduce((sum, val) => sum + val, 0) /
              baselineValues.length
            ).toFixed(2)
          )
        : 0,
      meanAgainst: statsAgainstValues.length
        ? parseFloat(
            (
              statsAgainstValues.reduce((sum, val) => sum + val, 0) /
              statsAgainstValues.length
            ).toFixed(2)
          )
        : 0,
      lambda: parseFloat(lambdaVal.toFixed(2)),
      homeConceded: homeAgainst,
      awayConceded: awayAgainst,
      hitsAgainst: hitsAgainstDisplay,
      homeMatches: homeHomeArr.map((t) => t.meta),
      awayMatches: awayAwayArr.map((t) => t.meta),
    };
  } else {
    const teamTuples = applyFormLimit(
      tuples.filter((t) =>
        neutralGround
          ? teamSlug(t.meta.awayTeamName) ===
            (parsedScope === "home" ? homeSlug : awaySlug)
          : parsedScope === "home"
          ? teamSlug(t.meta.homeTeamName) === homeSlug
          : teamSlug(t.meta.awayTeamName) === awaySlug
      )
    );

    const oppTuples = applyFormLimit(
      tuples.filter((t) =>
        neutralGround
          ? teamSlug(t.meta.awayTeamName) ===
            (parsedScope === "home" ? awaySlug : homeSlug)
          : parsedScope === "home"
          ? teamSlug(t.meta.awayTeamName) === awaySlug
          : teamSlug(t.meta.homeTeamName) === homeSlug
      )
    );

    if (!teamTuples.length) {
      throw new Error("Inga matcher hittades för vald form (lag).");
    }

    if (!oppTuples.length) {
      throw new Error("Inga matcher hittades för vald form (motståndare).");
    }

    const statsFor = teamTuples
      .map((t) => {
        if (parsedScope === "home") {
          return neutralGround ? t.data[stat]?.away : t.data[stat]?.home;
        }
        if (parsedScope === "away") {
          return t.data[stat]?.away;
        }
        return t.data[stat]?.total;
      })
      .filter((value) => Number.isFinite(value));

    const opponentSlug = parsedScope === "home" ? awaySlug : homeSlug;

    const statsAgainst = oppTuples
      .map((t) => {
        const d = t.data[stat];
        if (!d) return undefined;
        const oppIsHome = teamSlug(t.meta.homeTeamName) === opponentSlug;
        return oppIsHome ? d.away : d.home;
      })
      .filter((value) => Number.isFinite(value));

    const baselineValues = statsFor.slice();

    const hitsOver = baselineValues.filter((n) => n > LINE).length;
    const hitsUnder = baselineValues.filter((n) => n < LINE).length;
    const hitsExact = baselineValues.filter((n) => n === LINE).length;
    const hitsFor = OVER ? hitsOver : hitsUnder;
    const baselineN = baselineValues.length;
    const empirical = baselineN ? hitsFor / baselineN : 0;
    const blended = blendProb(empirical, hitsFor, baselineN, 5);

    const lambdaVal = lambda60_40(
      teamTuples,
      oppTuples,
      teamTuples,
      oppTuples,
      homeImportance,
      awayImportance,
      stat
    );
    const lambdaLegacy = lambda60_40_basic(
      teamTuples,
      oppTuples,
      teamTuples,
      oppTuples,
      homeImportance,
      awayImportance,
      stat
    );

    const k = OVER ? Math.max(-1, Math.ceil(LINE) - 1) : Math.floor(LINE);
    const cdfVal = poissonCdf(k, lambdaVal);
    const prob = Math.min(1, Math.max(0, OVER ? 1 - cdfVal : cdfVal));
    const cdfLegacy = poissonCdf(k, lambdaLegacy);
    const probLegacy = Math.min(1, Math.max(0, OVER ? 1 - cdfLegacy : cdfLegacy));

    const rawEvPct = oddsValue != null ? prob * oddsValue * 100 - 100 : null;
    const evPct = rawEvPct != null ? calibrateEv(rawEvPct) : null;

    const multiplierResult = await computeMultiplier();
    const lambdaWithMultiplier = lambdaVal * multiplierResult.multiplier;
    const cdfMultiplier = poissonCdf(k, lambdaWithMultiplier);
    const probWithMultiplier = Math.min(
      1,
      Math.max(0, OVER ? 1 - cdfMultiplier : cdfMultiplier)
    );
    const rawEvMultiplier =
      oddsValue != null ? probWithMultiplier * oddsValue * 100 - 100 : null;
    const evPctMultiplier =
      rawEvMultiplier != null ? calibrateEv(rawEvMultiplier) : null;
    const edgeWithMultiplier =
      oddsValue != null ? (probWithMultiplier - implied) * 100 : null;

    const leagueAvgProjection = await computeLeagueAverageProjection({
      homeTeam,
      awayTeam,
      statKey: STAT_PATTERNS[stat]?.rankKey || stat,
      periodKey: parsedPeriod,
      scope: parsedScope,
      neutralGround,
    });

    let probLeagueAvg = 0;
    let rawEvLeagueAvg = null;
    let evPctLeagueAvg = null;
    let edgeLeagueAvg = null;

    if (
      leagueAvgProjection?.selectedLambda != null &&
      Number.isFinite(leagueAvgProjection.selectedLambda)
    ) {
      const lambdaLeagueAvg = leagueAvgProjection.selectedLambda;
      const cdfLeague = poissonCdf(k, lambdaLeagueAvg);
      probLeagueAvg = Math.min(
        1,
        Math.max(0, OVER ? 1 - cdfLeague : cdfLeague)
      );
      if (oddsValue != null) {
        rawEvLeagueAvg = probLeagueAvg * oddsValue * 100 - 100;
        edgeLeagueAvg = (probLeagueAvg - implied) * 100;
        evPctLeagueAvg = calibrateEv(rawEvLeagueAvg);
      }
    }

    const multifactorProjection = await computeMultifactor();

    let probMultifactor = 0;
    let rawEvMultifactor = null;
    let evPctMultifactor = null;
    let edgeMultifactor = null;

    if (
      multifactorProjection?.lambda != null &&
      Number.isFinite(multifactorProjection.lambda)
    ) {
      const lambdaMultifactor = multifactorProjection.lambda;
      const cdfMf = poissonCdf(k, lambdaMultifactor);
      probMultifactor = Math.min(
        1,
        Math.max(0, OVER ? 1 - cdfMf : cdfMf)
      );
      if (oddsValue != null) {
        rawEvMultifactor = probMultifactor * oddsValue * 100 - 100;
        edgeMultifactor = (probMultifactor - implied) * 100;
        evPctMultifactor = calibrateEv(rawEvMultifactor);
      }
    }

    const hitsAgainst = baselineValues.length - hitsFor - hitsExact;
    const hitsAgainstDisplay = baselineValues.length
      ? `${hitsAgainst}/${baselineValues.length}`
      : "0/0";

    result = {
      params: {
        home: homeTeam,
        away: awayTeam,
        over: OVER,
        line: LINE,
        scope: parsedScope,
        stat,
        period: parsedPeriod,
        form,
        neutralGround,
        odds: oddsValue,
        homeImportance,
        awayImportance,
      },
      modelProb: prob,
      empiricalProb: empirical,
      blendedProb: blended,
      edgePP: oddsValue != null ? (prob - implied) * 100 : null,
      evPct,
      rawEvPct,
      legacyProb: probLegacy,
      legacyEvPct: oddsValue != null ? probLegacy * oddsValue * 100 - 100 : null,
      multiplier: multiplierResult,
      lambdaWithMultiplier:
        Number.isFinite(lambdaWithMultiplier)
          ? parseFloat(lambdaWithMultiplier.toFixed(2))
          : null,
      modelProbWithMultiplier: probWithMultiplier,
      edgePPWithMultiplier: edgeWithMultiplier,
      rawEvPctWithMultiplier: rawEvMultiplier,
      evPctWithMultiplier: evPctMultiplier,
      multifactor: {
        lambda:
          multifactorProjection?.lambda != null &&
          Number.isFinite(multifactorProjection.lambda)
            ? parseFloat(multifactorProjection.lambda.toFixed(2))
            : null,
        prob: probMultifactor,
        rawEvPct: rawEvMultifactor,
        evPct: evPctMultifactor,
        edgePP: edgeMultifactor,
        details: multifactorProjection,
      },
      leagueAvg: {
        lambda:
          leagueAvgProjection?.lambda &&
          typeof leagueAvgProjection.lambda === "object"
            ? {
                total: Number.isFinite(leagueAvgProjection.lambda.total)
                  ? parseFloat(leagueAvgProjection.lambda.total.toFixed(2))
                  : null,
                home: Number.isFinite(leagueAvgProjection.lambda.home)
                  ? parseFloat(leagueAvgProjection.lambda.home.toFixed(2))
                  : null,
                away: Number.isFinite(leagueAvgProjection.lambda.away)
                  ? parseFloat(leagueAvgProjection.lambda.away.toFixed(2))
                  : null,
              }
            : null,
        selectedLambda:
          leagueAvgProjection?.selectedLambda != null &&
          Number.isFinite(leagueAvgProjection.selectedLambda)
            ? parseFloat(leagueAvgProjection.selectedLambda.toFixed(2))
            : null,
        prob: probLeagueAvg,
        rawEvPct: rawEvLeagueAvg,
        evPct: evPctLeagueAvg,
        edgePP: edgeLeagueAvg,
        details: leagueAvgProjection,
      },
      modelProbMultifactor: probMultifactor,
      rawEvPctMultifactor: rawEvMultifactor,
      evPctMultifactor: evPctMultifactor,
      edgePPMultifactor: edgeMultifactor,
      modelProbLeagueAvg: probLeagueAvg,
      rawEvPctLeagueAvg: rawEvLeagueAvg,
      evPctLeagueAvg,
      edgePPLeagueAvg: edgeLeagueAvg,
      timestamp: new Date().toISOString(),
      matches: baselineValues.length,
      statsFor,
      statsAgainst,
      hitsOver: `${hitsOver}/${baselineValues.length}`,
      hitsUnder: `${hitsUnder}/${baselineValues.length}`,
      hitsExact: `${hitsExact}/${baselineValues.length}`,
      meanFor: baselineValues.length
        ? parseFloat(
            (
              baselineValues.reduce((sum, val) => sum + val, 0) /
              baselineValues.length
            ).toFixed(2)
          )
        : 0,
      meanAgainst: statsAgainst.length
        ? parseFloat(
            (
              statsAgainst.reduce((sum, val) => sum + val, 0) /
              statsAgainst.length
            ).toFixed(2)
          )
        : 0,
      lambda: parseFloat(lambdaVal.toFixed(2)),
      homeConceded: statsAgainst,
      awayConceded: statsAgainst,
      hitsAgainst: hitsAgainstDisplay,
      homeMatches: teamTuples.map((t) => t.meta),
      awayMatches: oppTuples.map((t) => t.meta),
    };
  }

  RESULT_CACHE.set(cacheKey, result);
  return result;
}













