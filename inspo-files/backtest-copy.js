import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { computeEvMultiplier } from "./utils/backtest-ev-multiplier.js";
import { computeMultifactorProjection } from "./utils/ev-multifactor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let ROI_CALIBRATION = null;
try {
  const calibrationPath = path.join(__dirname, "utils", "calibration.json");
  const txt = await fs.readFile(calibrationPath, "utf-8");
  ROI_CALIBRATION = JSON.parse(txt);
  console.log("📈 Loaded ROI calibration");
} catch (err) {
  console.log("⚠️ No calibration file found, using raw EV");
}

const DISABLE_CAL = true;

function calibrateEv(ev) {
  if (DISABLE_CAL) return ev;
  if (!ROI_CALIBRATION) return ev;
  const size = ROI_CALIBRATION.bucketSize || 5;
  const bucket = Math.floor(ev / size) * size;
  const data = ROI_CALIBRATION.buckets?.[bucket];
  return data?.avgRoi ?? ev;
}

const IMPORTANCE_STEP = 0.05;
const IMPORTANCE_RANGE = [0.8, 1.2];

function clamp(min, val, max) {
  return Math.min(Math.max(val, min), max);
}

function importanceFactor(importance) {
  const [min, max] = IMPORTANCE_RANGE;
  return clamp(min, 1 + IMPORTANCE_STEP * (importance - 5), max);
}

function blendProb(p_mod, k, n, w = 5) {
  const α0 = p_mod * w;
  const β0 = (1 - p_mod) * w;
  return (α0 + k) / (α0 + β0 + n);
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

const [
  homeArg,
  awayArg,
  dirArg,
  lineArg,
  scopeArg = "total",
  statArg = "totalShots",
  periodArg = "ALL",
  formArg = "all",
  neutralGroundArg = "false",
  oddsArg,
  homeImpArg = "5",
  awayImpArg = "5",
] = process.argv.slice(2);

console.log(`valda match:      ${homeArg} vs ${awayArg}`);
console.log(`hemmalag:         ${homeArg}`);
console.log(`bortalag:         ${awayArg}`);
console.log(`condition:        ${dirArg}`);
console.log(`threshold:        ${lineArg}`);
console.log(`scope:            ${scopeArg}`);
console.log(`statKey:          ${statArg}`);
console.log(`period:           ${periodArg}`);
console.log(`antal matcher:    ${formArg}`);
console.log(`neutral ground:   ${neutralGroundArg}`);
console.log(`odds:             ${oddsArg}`);
console.log(`home importance:  ${homeImpArg}`);
console.log(`away importance:  ${awayImpArg}`);
console.log("────────────────────────────────────────");

if (!homeArg || !awayArg || !dirArg || !lineArg) {
  console.error(
    'Syntax:\nnode backtest-copy.js "hemmalag" "bortalag" "över|under" <linje> <scope> <statKey> <period> <antal|all> <neutralGround> <odds?> <homeImportance?> <awayImportance?>'
  );
  process.exit(1);
}

const HOME = homeArg.toLowerCase();
const AWAY = awayArg.toLowerCase();
function teamSlug(name) {
  const slug = name.toLowerCase().replace(/\s/g, "_");
  const aliases = { mirassol: "mirrasol", mirrasol: "mirrasol" };
  return aliases[slug] || slug;
}
const dirLower = dirArg.toLowerCase();
const OVER = ['över', 'over', 'o', '>'].some(str => dirLower.startsWith(str));
const LINE = parseFloat(lineArg);
const SCOPE = scopeArg.toLowerCase();
const STAT = statArg;
const PERIOD_KEY = periodArg.toUpperCase();
const FORM = formArg.toLowerCase() === "all" ? Infinity : parseInt(formArg, 10);
const NEUTRAL_GROUND = neutralGroundArg.toLowerCase() === "true";
const ODDS = oddsArg ? parseFloat(oddsArg) : null;
const HOME_IMPORTANCE = parseInt(homeImpArg, 10);
const AWAY_IMPORTANCE = parseInt(awayImpArg, 10);

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

const DEFAULT_PERIODS = ["ALL", "1ST", "2ND"];

let leagueRankingPromise = null;
let teamLeagueMapPromise = null;

async function loadLeagueRankings() {
  if (!leagueRankingPromise) {
    const filePath = path.join(__dirname, "league_ranking.json");
    leagueRankingPromise = fs
      .readFile(filePath, "utf-8")
      .then((txt) => JSON.parse(txt))
      .catch((err) => {
        console.warn("⚠️ Kunde inte läsa league_ranking.json:", err.message);
        return [];
      });
  }
  return leagueRankingPromise;
}

async function loadTeamLeagueMap() {
  if (!teamLeagueMapPromise) {
    const filePath = path.join(__dirname, "leagues-and-teams.json");
    teamLeagueMapPromise = fs
      .readFile(filePath, "utf-8")
      .then((txt) => {
        const json = JSON.parse(txt);
        const map = new Map();
        for (const [league, info] of Object.entries(json)) {
          for (const team of info.teams || []) {
            map.set(normalizeTeamName(team.name), league);
          }
        }
        return map;
      })
      .catch((err) => {
        console.warn("⚠️ Kunde inte läsa leagues-and-teams.json:", err.message);
        return new Map();
      });
  }
  return teamLeagueMapPromise;
}

function normalizeTeamName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findLeagueBlock(leagueRankings, leagueName) {
  return leagueRankings.find((league) => league.league === leagueName) || null;
}

function findLeagueByTeam(leagueRankings, teamName) {
  const normalized = normalizeTeamName(teamName);
  for (const league of leagueRankings) {
    const ranking = league?.ranking || {};
    for (const stat of Object.values(ranking)) {
      for (const type of ["for", "against"]) {
        const container = stat?.[type];
        if (!container) continue;
        for (const entries of Object.values(container)) {
          if (!Array.isArray(entries)) continue;
          const match = entries.find(
            (entry) => normalizeTeamName(entry.team) === normalized
          );
          if (match) {
            return league.league;
          }
        }
      }
    }
  }
  return null;
}

function findTeamEntry(entries, teamName) {
  if (!Array.isArray(entries)) return null;
  const normalized = normalizeTeamName(teamName);
  return (
    entries.find((entry) => normalizeTeamName(entry.team) === normalized) ||
    entries.find((entry) =>
      normalizeTeamName(entry.team).includes(normalized)
    ) ||
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
  periodKey = "ALL",
  scope = "total",
  neutralGround = false,
}) {
  const [leagueRankings, teamLeagueMap] = await Promise.all([
    loadLeagueRankings(),
    loadTeamLeagueMap(),
  ]);

  const normalizedHome = normalizeTeamName(homeTeam);
  const normalizedAway = normalizeTeamName(awayTeam);

  const homeLeagueName =
    teamLeagueMap.get(normalizedHome) || findLeagueByTeam(leagueRankings, homeTeam);
  const awayLeagueName =
    teamLeagueMap.get(normalizedAway) || findLeagueByTeam(leagueRankings, awayTeam);

  if (!homeLeagueName || !awayLeagueName) {
    return { lambda: null, selectedLambda: null, scope, reason: "missing-league" };
  }

  const homeLeagueBlock = findLeagueBlock(leagueRankings, homeLeagueName);
  const awayLeagueBlock = findLeagueBlock(leagueRankings, awayLeagueName);

  if (!homeLeagueBlock || !awayLeagueBlock) {
    return {
      lambda: null,
      selectedLambda: null,
      scope,
      reason: "missing-league-block",
    };
  }

  const homeStat = homeLeagueBlock?.ranking?.[statKey];
  const awayStat = awayLeagueBlock?.ranking?.[statKey];

  if (!homeStat || !awayStat) {
    return { lambda: null, selectedLambda: null, scope, reason: "missing-stat" };
  }

  const lambdaPeriods = periodKey ? [periodKey] : ["ALL"];
  const reportPeriods = Array.from(new Set([...DEFAULT_PERIODS, ...lambdaPeriods]));

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
      leagues: { home: homeLeagueName, away: awayLeagueName },
    };
  }

  if (!Number.isFinite(lambdaHomeTotal) || !Number.isFinite(lambdaAwayTotal)) {
    return {
      lambda: null,
      selectedLambda: null,
      scope,
      reason: "invalid-lambda",
      formulas,
      leagues: { home: homeLeagueName, away: awayLeagueName },
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
    leagues: { home: homeLeagueName, away: awayLeagueName },
    formulas,
  };
}

if (!STAT_PATTERNS[STAT]) {
  console.error(`❌ Okänd statKey '${STAT}'.`);
  process.exit(1);
}
if (!["home", "away", "total"].includes(SCOPE)) {
  console.error("❌ scope måste vara 'home', 'away' eller 'total'");
  process.exit(1);
}

function extractTuple(detail) {
  if (!detail?.statistics) return null;
  const blk = Array.isArray(detail.statistics)
    ? detail.statistics.find(
        (b) => (b.period ?? "").toUpperCase() === PERIOD_KEY
      ) || detail.statistics[0]
    : detail.statistics;
  if (!blk?.groups) return null;
  const stats = {};
  const patterns = Object.entries(STAT_PATTERNS).map(
    ([key, { keys, names }]) => ({
      stat: key,
      keys: keys.map((k) => k.toLowerCase()),
      names: names.map((n) => n.toLowerCase()),
    })
  );
  for (const g of blk.groups) {
    for (const row of g.statisticsItems || []) {
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

      const entry = {
        home: homeValue,
        away: awayValue,
        total: homeValue + awayValue,
      };

      features[slug] = entry;
      const alias = slug.replace(/_/g, "");
      if (alias && alias !== slug && !features[alias]) {
        features[alias] = entry;
      }
    }
  }
  return features;
}

function toFeatureSlug(value) {
  if (!value) return "";
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function calcTuple(match) {
  const t = extractTuple(match.matchDetails);
  if (!t) return null;
  const result = {};
  for (const stat in STAT_PATTERNS) {
    if (t[stat]) {
      result[stat] = { ...t[stat] };
    } else {
      const h = match.matchDetails?.homeStats?.[stat];
      const a = match.matchDetails?.awayStats?.[stat];
      if (typeof h === "number" && typeof a === "number")
        result[stat] = { home: h, away: a, total: h + a };
    }
  }
  if (t.__features) {
    result.__features = t.__features;
  }
  if (result.freeKicks) {
    const safeNumber = (value) =>
      typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function scopedValue(t, isHomeSide) {
  if (SCOPE === "total") return t[STAT]?.total;
  if (SCOPE === "home") return isHomeSide ? t[STAT]?.home : null;
  if (SCOPE === "away") return !isHomeSide ? t[STAT]?.away : null;
}

function lambda60_40_basic(
  homeHome,
  awayAway,
  homeAgainst,
  awayAgainst,
  homeImp = 5,
  awayImp = 5
) {
  const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
  const gfH = mean(homeHome.map((t) => t.data[STAT]?.home || 0));
  const gaH = mean(homeAgainst.map((t) => t.data[STAT]?.away || 0));
  const gfA = mean(awayAway.map((t) => t.data[STAT]?.away || 0));
  const gaA = mean(awayAgainst.map((t) => t.data[STAT]?.home || 0));
  const hFactor = importanceFactor(homeImp);
  const aFactor = importanceFactor(awayImp);
  const gfHAdj = gfH * hFactor;
  const gaHAdj = gaH / hFactor;
  const gfAAdj = gfA * aFactor;
  const gaAAdj = gaA / aFactor;
  return 0.6 * gfHAdj + 0.4 * gaAAdj + 0.6 * gfAAdj + 0.4 * gaHAdj;
}

function lambda60_40(
  homeHome,
  awayAway,
  homeAgainst,
  awayAgainst,
  homeImp = 5,
  awayImp = 5
) {
  const gfH = weightedMean(
    homeHome.map((t) => t.data[STAT]?.home || 0),
    homeHome.map((t) => t.meta.timestamp)
  );
  const gaH = weightedMean(
    homeAgainst.map((t) => t.data[STAT]?.away || 0),
    homeAgainst.map((t) => t.meta.timestamp)
  );
  const gfA = weightedMean(
    awayAway.map((t) => t.data[STAT]?.away || 0),
    awayAway.map((t) => t.meta.timestamp)
  );
  const gaA = weightedMean(
    awayAgainst.map((t) => t.data[STAT]?.home || 0),
    awayAgainst.map((t) => t.meta.timestamp)
  );
  console.log(
    "home stats for:",
    homeHome.map((t) => t.data[STAT]?.home)
  );
  console.log(
    "home stats against:",
    homeAgainst.map((t) => t.data[STAT]?.away)
  );
  console.log(
    "away stats for:",
    awayAway.map((t) => t.data[STAT]?.away)
  );
  console.log(
    "away stats against:",
    awayAgainst.map((t) => t.data[STAT]?.home)
  );
  console.log(
    `gfH=${gfH.toFixed(2)}, gaH=${gaH.toFixed(2)}, gfA=${gfA.toFixed(
      2
    )}, gaA=${gaA.toFixed(2)}`
  );
  const hFactor = importanceFactor(homeImp);
  const aFactor = importanceFactor(awayImp);
  const gfHAdj = gfH * hFactor;
  const gaHAdj = gaH / hFactor;
  const gfAAdj = gfA * aFactor;
  const gaAAdj = gaA / aFactor;
  const λ = 0.6 * gfHAdj + 0.4 * gaAAdj + 0.6 * gfAAdj + 0.4 * gaHAdj;
  console.log("calculated lambda:", λ.toFixed(2));
  return λ;
}

function poissonCdf(k, λ) {
  let sum = 0;
  let term = Math.exp(-λ);
  for (let i = 0; i <= k; i++) {
    if (i > 0) term *= λ / i;
    sum += term;
  }
  return sum;
}
const fmt = (p) => (p * 100).toFixed(1) + "%";

function edgeLine(prob) {
  if (!ODDS) {
    console.log("(Ange odds för värde-bedömning)");
    return;
  }
  const implied = 1 / ODDS,
    edgePP = (prob - implied) * 100,
    rawEv = (prob * ODDS - 1) * 100,
    evPct = calibrateEv(rawEv);
  console.log(
    `Model prob: ${fmt(prob)}, Book implied: ${fmt(implied)}, odds: ${ODDS}`
  );
  console.log(
    `EV% calculation: raw ${rawEv.toFixed(1)}% -> calibrated ${evPct.toFixed(
      1
    )}%`
  );
  console.log(
    prob > implied
      ? `✅ Värde! edge ${edgePP.toFixed(1)}pp, EV ${evPct.toFixed(1)}%`
      : `❌ Inget värde, edge ${edgePP.toFixed(1)}pp`
  );
}

const dir = path.join(__dirname, "teamstats");

const HOME_SLUG = teamSlug(HOME);
const AWAY_SLUG = teamSlug(AWAY);
const homeFile = NEUTRAL_GROUND
  ? `${HOME_SLUG}_away_match_stats.json`
  : `${HOME_SLUG}_home_match_stats.json`;
const awayFile = `${AWAY_SLUG}_away_match_stats.json`;

console.log("HOMEFILE", homeFile, awayFile);

const files = [homeFile, awayFile].filter((f) => existsSync(path.join(dir, f)));

console.log(`📂 Läser in filer: ${files.join(", ")}…`);

const tuplesRaw = [];
for (const f of files) {
  const fullPath = path.join(dir, f);
  try {
    const txt = await fs.readFile(fullPath, "utf-8");
    const obj = JSON.parse(txt);
    const arr = Array.isArray(obj.full) ? obj.full : [];

    tuplesRaw.push(...arr);
  } catch (e) {
    console.warn(`⚠️ Error parsing ${f}: ${e.message}`);
  }
}

console.log(`🔢 Totalt laddade matcher: ${tuplesRaw.length}`);

const seen = new Set();
const unique = [];
for (const m of tuplesRaw) {
  const key = `${teamSlug(m.homeTeamName)}_${teamSlug(
    m.awayTeamName
  )}_${m.timestamp}`;
  if (!seen.has(key)) {
    seen.add(key);
    unique.push(m);
  }
}
tuplesRaw.length = 0;
tuplesRaw.push(...unique);

console.log(`🔢 Efter dedupe: ${tuplesRaw.length} matcher för dina valda lag`);

const tuples = tuplesRaw
  .map((m) => ({ meta: m, data: calcTuple(m) })
  ).filter((x) => x.data && x.data[STAT])
  .sort((a, b) => b.meta.timestamp - a.meta.timestamp);

console.log(`✅ Matcher kvar: ${tuples.length}`);
console.log(
  "Loaded tuples:",
  tuples.map((t) => ({
    homeTeam: t.meta.homeTeamName,
    awayTeam: t.meta.awayTeamName,
    stat: t.data[STAT],
  }))
);
console.log("────────────────────────────────────────");

const baselineValues = tuples
  .map((t) => scopedValue(t.data, !NEUTRAL_GROUND))
  .filter(Number.isFinite);

const homeConceded = NEUTRAL_GROUND
  ? tuples
      .filter((t) => teamSlug(t.meta.awayTeamName) === HOME_SLUG)
      .map((t) => t.data[STAT]?.home)
  : tuples
      .filter((t) => teamSlug(t.meta.homeTeamName) === HOME_SLUG)
      .map((t) => t.data[STAT]?.away);

const awayConceded = tuples
  .filter((t) => teamSlug(t.meta.awayTeamName) === AWAY_SLUG)
  .map((t) => t.data[STAT]?.home);

const homeAgainst = homeConceded.filter(Number.isFinite);
const awayAgainst = awayConceded.filter(Number.isFinite);

let teamTuples = [];
let oppTuples = [];
let statsFor = [];
let statsAgainst = [...homeAgainst, ...awayAgainst];
let hitsFor = 0;
let hitsUnder = 0;
let hitsOver = 0;
let hitsAgainst = 0;
let hitsExact = 0;
let meanFor = 0;
let meanAgainst = 0;
let lambdaVal = 0;
let prob = 0;
let empirical = 0;
let blended = 0;
let probLegacy = 0;
let multiplierResult = {
  multiplier: 1,
  rawScore: 0,
  featureBreakdown: {},
  teamStrength: {},
};
let lambdaWithMultiplier = null;
let probWithMultiplier = null;
let rawEvMultiplier = null;
let evPctMultiplier = null;
let edgeWithMultiplier = null;
let multifactorProjection = null;
let probMultifactor = null;
let rawEvMultifactor = null;
let evPctMultifactor = null;
let edgeMultifactor = null;
let leagueAvgProjection = null;
let probLeagueAvg = null;
let rawEvLeagueAvg = null;
let evPctLeagueAvg = null;
let edgeLeagueAvg = null;

if (SCOPE === "total") {
  const homeMatches = tuples.filter((t) =>
    NEUTRAL_GROUND
      ? teamSlug(t.meta.awayTeamName) === HOME_SLUG
      : teamSlug(t.meta.homeTeamName) === HOME_SLUG
  );
  if (homeMatches.length === 0) {
    console.error(
      `❌ Inga matcher hittades för ${HOME} som ${
        NEUTRAL_GROUND ? "bortalag" : "hemmalag"
      }.`
    );
    process.exit(1);
  }

  const homeHomeArr = tuples.filter((t) =>
    NEUTRAL_GROUND
      ? teamSlug(t.meta.awayTeamName) === HOME_SLUG
      : teamSlug(t.meta.homeTeamName) === HOME_SLUG
  );
  const awayAwayArr = tuples.filter((t) => teamSlug(t.meta.awayTeamName) === AWAY_SLUG);
  const homeAgainstArr = tuples.filter((t) =>
    NEUTRAL_GROUND
      ? teamSlug(t.meta.awayTeamName) === HOME_SLUG
      : teamSlug(t.meta.homeTeamName) === HOME_SLUG
  );
  const awayAgainstArr = tuples.filter((t) => teamSlug(t.meta.awayTeamName) === AWAY_SLUG);

  lambdaVal = lambda60_40(
    homeHomeArr,
    awayAwayArr,
    homeAgainstArr,
    awayAgainstArr,
    HOME_IMPORTANCE,
    AWAY_IMPORTANCE
  );
  const lambdaLegacy = lambda60_40_basic(
    homeHomeArr,
    awayAwayArr,
    homeAgainstArr,
    awayAgainstArr,
    HOME_IMPORTANCE,
    AWAY_IMPORTANCE
  );

  const k = OVER ? Math.max(-1, Math.ceil(LINE) - 1) : Math.floor(LINE);
  const cdfVal = poissonCdf(k, lambdaVal);
  prob = Math.min(1, Math.max(0, OVER ? 1 - cdfVal : cdfVal));

  const cdfLegacy = poissonCdf(k, lambdaLegacy);
  probLegacy = Math.min(1, Math.max(0, OVER ? 1 - cdfLegacy : cdfLegacy));

  multiplierResult = await computeEvMultiplier({
    statKey: STAT,
    scope: SCOPE,
    tuples,
    homeSlug: HOME_SLUG,
    awaySlug: AWAY_SLUG,
    periodKey: PERIOD_KEY,
    formLimit: FORM,
    teamSlugFn: teamSlug,
  });
  lambdaWithMultiplier = lambdaVal * multiplierResult.multiplier;
  const cdfMultiplier = poissonCdf(k, lambdaWithMultiplier);
  probWithMultiplier = Math.min(1, Math.max(0, OVER ? 1 - cdfMultiplier : cdfMultiplier));

  hitsOver = baselineValues.filter((n) => n > LINE).length;
  hitsUnder = baselineValues.filter((n) => n < LINE).length;
  hitsExact = baselineValues.filter((n) => n === LINE).length;
  hitsFor = OVER ? hitsOver : hitsUnder;
  hitsAgainst = baselineValues.length - hitsFor - hitsExact;

  const baselineN = baselineValues.length;
  empirical = baselineN ? hitsFor / baselineN : 0;
  blended = blendProb(prob, hitsFor, baselineN, 5);

  statsFor = baselineValues;

  teamTuples = Array(baselineN).fill(null);
} else {
  const sliceN = (lst) => lst.slice(0, FORM);

  teamTuples = sliceN(
    tuples.filter((t) =>
      NEUTRAL_GROUND
        ? teamSlug(t.meta.awayTeamName) ===
          (SCOPE === "home" ? HOME_SLUG : AWAY_SLUG)
        : SCOPE === "home"
        ? teamSlug(t.meta.homeTeamName) === HOME_SLUG
        : teamSlug(t.meta.awayTeamName) === AWAY_SLUG
    )
  );

  oppTuples = sliceN(
    tuples.filter((t) =>
      NEUTRAL_GROUND
        ? teamSlug(t.meta.awayTeamName) ===
          (SCOPE === "home" ? AWAY_SLUG : HOME_SLUG)
        : SCOPE === "home"
        ? teamSlug(t.meta.awayTeamName) === AWAY_SLUG
        : teamSlug(t.meta.homeTeamName) === HOME_SLUG
    )
  );

  if (teamTuples.length === 0) {
    console.error(
      `❌ Inga matcher hittades för ${HOME} som ${
        SCOPE === "home"
          ? NEUTRAL_GROUND
            ? "bortalag"
            : "hemmalag"
          : "bortalag"
      }.`
    );
    process.exit(1);
  }
  if (oppTuples.length === 0) {
    console.error(
      `❌ Inga matcher hittades för ${AWAY} som ${
        SCOPE === "home" ? "bortalag" : "hemmalag"
      }.`
    );
    process.exit(1);
  }

  statsFor = teamTuples
    .map((t) => {
      if (SCOPE === "home") {
        return NEUTRAL_GROUND ? t.data[STAT]?.away : t.data[STAT]?.home;
      }
      return t.data[STAT]?.away;
    })
    .filter(Number.isFinite);

  const OPPONENT = SCOPE === "home" ? AWAY_SLUG : HOME_SLUG;

  statsAgainst = oppTuples
    .map((t) => {
      const d = t.data[STAT];
      if (!d) return undefined;

      const oppIsHome = teamSlug(t.meta.homeTeamName) === OPPONENT;

      return oppIsHome ? d.away : d.home;
    })
    .filter(Number.isFinite);

  console.log("statsFor (team shots):", statsFor);
  console.log("statsAgainst (opponent shots conceded):", statsAgainst);

  hitsOver = statsFor.filter((n) => n > LINE).length;
  hitsUnder = statsFor.filter((n) => n < LINE).length;
  hitsExact = statsFor.filter((n) => n === LINE).length;
  hitsFor = OVER ? hitsOver : hitsUnder;
  hitsAgainst = statsAgainst.filter((n) => (OVER ? n > LINE : n < LINE)).length;

  const meanForBasic =
    statsFor.reduce((s, x) => s + x, 0) / statsFor.length || 0;
  const meanAgainstBasic =
    statsAgainst.reduce((s, x) => s + x, 0) / statsAgainst.length || 0;
  meanFor = weightedMean(
    statsFor,
    teamTuples.map((t) => t.meta.timestamp)
  );
  meanAgainst = weightedMean(
    statsAgainst,
    oppTuples.map((t) => t.meta.timestamp)
  );
  const homeFactor = importanceFactor(HOME_IMPORTANCE);
  const awayFactor = importanceFactor(AWAY_IMPORTANCE);
  let meanForLegacy = meanForBasic;
  let meanAgainstLegacy = meanAgainstBasic;
  if (SCOPE === "home") {
    meanFor *= homeFactor;
    meanAgainst /= awayFactor;
    meanForLegacy *= homeFactor;
    meanAgainstLegacy /= awayFactor;
  } else if (SCOPE === "away") {
    meanFor *= awayFactor;
    meanAgainst /= homeFactor;
    meanForLegacy *= awayFactor;
    meanAgainstLegacy /= homeFactor;
  }
  lambdaVal = (meanFor + meanAgainst) / 2;
  const lambdaLegacy = (meanForLegacy + meanAgainstLegacy) / 2;

  const k = OVER ? Math.max(-1, Math.ceil(LINE) - 1) : Math.floor(LINE);
  const cdfValue = poissonCdf(k, lambdaVal);
  prob = Math.min(1, Math.max(0, OVER ? 1 - cdfValue : cdfValue));

  const cdfLegacy = poissonCdf(k, lambdaLegacy);
  probLegacy = Math.min(1, Math.max(0, OVER ? 1 - cdfLegacy : cdfLegacy));

  empirical = teamTuples.length ? hitsFor / teamTuples.length : 0;
  blended = blendProb(prob, hitsFor, teamTuples.length, 5);

  console.log(
    `Empirical freq: ${(empirical * 100).toFixed(1)}% (${hitsFor}/${
      teamTuples.length
    })`
  );

  multiplierResult = await computeEvMultiplier({
    statKey: STAT,
    scope: SCOPE,
    tuples,
    homeSlug: HOME_SLUG,
    awaySlug: AWAY_SLUG,
    periodKey: PERIOD_KEY,
    formLimit: FORM,
    teamSlugFn: teamSlug,
  });
  lambdaWithMultiplier = lambdaVal * multiplierResult.multiplier;
  const cdfMultiplier = poissonCdf(k, lambdaWithMultiplier);
  probWithMultiplier = Math.min(1, Math.max(0, OVER ? 1 - cdfMultiplier : cdfMultiplier));

  console.log(`Blended prob (w=5): ${(blended * 100).toFixed(1)}%`);
  edgeLine(prob);
}

if (probWithMultiplier != null) {
  rawEvMultiplier =
    ODDS != null ? probWithMultiplier * ODDS * 100 - 100 : null;
  evPctMultiplier =
    rawEvMultiplier != null ? calibrateEv(rawEvMultiplier) : null;
  console.log(
    `🧮 Multiplier (${STAT}): x${multiplierResult.multiplier.toFixed(
      3
    )} (score ${multiplierResult.rawScore.toFixed(3)})`
  );
  const featureEntries = Object.entries(
    multiplierResult.featureBreakdown || {}
  )
    .map(([key, value]) => ({ key, score: value.score }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score !== 0)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 3);
  if (featureEntries.length) {
    console.log(
      "Top feature weights:",
      featureEntries
        .map((f) => `${f.key}:${f.score >= 0 ? "+" : ""}${f.score.toFixed(3)}`)
        .join(", ")
    );
  }
  const teamStrengthEntries = Object.entries(
    multiplierResult.teamStrength || {}
  ).filter(([, val]) => Number.isFinite(val) && val !== 0);
  if (teamStrengthEntries.length) {
    console.log(
      "Team strength impact:",
      teamStrengthEntries
        .map(([k, v]) => `${k}:${v >= 0 ? "+" : ""}${v.toFixed(3)}`)
        .join(", ")
    );
  }
  const impliedProbMultiplier = ODDS ? 1 / ODDS : 0;
  edgeWithMultiplier =
    ODDS != null ? (probWithMultiplier - impliedProbMultiplier) * 100 : null;
  const edgeText =
    edgeWithMultiplier != null ? edgeWithMultiplier.toFixed(1) : "n/a";
  console.log(
    `Multiplier prob: ${(probWithMultiplier * 100).toFixed(1)}%` +
      (ODDS
        ? `, edge ${edgeText}pp, EV ${
            evPctMultiplier != null
              ? evPctMultiplier.toFixed(1)
              : rawEvMultiplier?.toFixed(1)
          }%`
        : "")
  );
}

try {
  const leagueRankKey = STAT_PATTERNS[STAT]?.rankKey || STAT;
  leagueAvgProjection = await computeLeagueAverageProjection({
    homeTeam: homeArg,
    awayTeam: awayArg,
    statKey: leagueRankKey,
    periodKey: PERIOD_KEY,
    scope: SCOPE,
    neutralGround: NEUTRAL_GROUND,
  });

  if (
    leagueAvgProjection?.selectedLambda != null &&
    Number.isFinite(leagueAvgProjection.selectedLambda)
  ) {
    const lambdaLeagueAvg = leagueAvgProjection.selectedLambda;
    const k = OVER ? Math.max(-1, Math.ceil(LINE) - 1) : Math.floor(LINE);
    const cdfLeague = poissonCdf(k, lambdaLeagueAvg);
    probLeagueAvg = Math.min(1, Math.max(0, OVER ? 1 - cdfLeague : cdfLeague));

    if (ODDS != null) {
      rawEvLeagueAvg = probLeagueAvg * ODDS * 100 - 100;
      edgeLeagueAvg = (probLeagueAvg - 1 / ODDS) * 100;
      evPctLeagueAvg = calibrateEv(rawEvLeagueAvg);
    }

    console.log(
      `LigaAvg λ=${lambdaLeagueAvg.toFixed(2)}, prob=${(
        probLeagueAvg * 100
      ).toFixed(1)}%`
    );
  } else {
    console.log("⚠️ LigaAvg EV saknas (otillräcklig data)");
  }

  if (leagueAvgProjection?.formulas?.length) {
    console.log("📐 Liga-snittsformler:");
    for (const periodFormula of leagueAvgProjection.formulas) {
      const tag = `[${periodFormula.period}]`;
      console.log(`${tag} ${homeArg} (hemmalag): ${periodFormula.home.formula}`);
      console.log(`${tag} ${awayArg} (bortalag): ${periodFormula.away.formula}`);
      console.log(`${tag} Totalt: ${periodFormula.total.formula}`);
    }
  }
} catch (err) {
  console.warn("⚠️ EV ligaavg error:", err.message);
}

try {
  multifactorProjection = await computeMultifactorProjection({
    homeTeam: homeArg,
    awayTeam: awayArg,
    statKey: STAT,
    periodKey: PERIOD_KEY,
    scope: SCOPE,
    neutralGround: NEUTRAL_GROUND,
    tuples,
    leagueLambda: leagueAvgProjection?.selectedLambda ?? 25.57
  });

  if (
    multifactorProjection?.lambda != null &&
    Number.isFinite(multifactorProjection.lambda)
  ) {
    const lambdaMultiFactor = multifactorProjection.lambda;
    const k = OVER ? Math.max(-1, Math.ceil(LINE) - 1) : Math.floor(LINE);
    const cdfMf = poissonCdf(k, lambdaMultiFactor);
    probMultifactor = Math.min(1, Math.max(0, OVER ? 1 - cdfMf : cdfMf));

    if (ODDS != null) {
      rawEvMultifactor = probMultifactor * ODDS * 100 - 100;
      edgeMultifactor = (probMultifactor - 1 / ODDS) * 100;
      evPctMultifactor = calibrateEv(rawEvMultifactor);
    }

    console.log(
      `Multifactor λ=${lambdaMultiFactor.toFixed(2)}, prob=${(
        probMultifactor * 100
      ).toFixed(1)}%`
    );
  } else {
    console.log("⚠️ Multifactor EV saknas (otillräcklig data)");
  }
} catch (err) {
  console.warn("⚠️ EV multifactor error:", err.message);
}

const homeMatches = tuples
  .filter((t) =>
    NEUTRAL_GROUND
      ? teamSlug(t.meta.awayTeamName) === HOME_SLUG
      : teamSlug(t.meta.homeTeamName) === HOME_SLUG
  )
  .map((t) => ({
    homeTeam: t.meta.homeTeamName,
    awayTeam: t.meta.awayTeamName,
    stat: t.data[STAT],
    totalShots: t.data.totalShots,
  }));

const awayMatches = tuples
  .filter((t) => teamSlug(t.meta.awayTeamName) === AWAY_SLUG)
  .map((t) => ({
    homeTeam: t.meta.homeTeamName,
    awayTeam: t.meta.awayTeamName,
    stat: t.data[STAT],
    totalShots: t.data.totalShots,
  }));

(async () => {
  const implied = ODDS ? 1 / ODDS : 0;
  const rawEvPct = ODDS != null ? prob * ODDS * 100 - 100 : null;
  const evPct = rawEvPct != null ? calibrateEv(rawEvPct) : null;
  const hitsAgainstArray = statsAgainst;
  const hitsAgainstWins = hitsAgainstArray.filter((n) =>
    OVER ? n > LINE : n < LINE
  ).length;
  const hitsAgainstDisplay = hitsAgainstArray.length
    ? `${hitsAgainstWins}/${hitsAgainstArray.length}`
    : "0/0";
  const resultObj = {
    params: {
      home: homeArg,
      away: awayArg,
      over: OVER,
      line: LINE,
      scope: SCOPE,
      stat: STAT,
      period: PERIOD_KEY,
      form: formArg,
      neutralGround: NEUTRAL_GROUND,
      odds: ODDS,
      homeImportance: HOME_IMPORTANCE,
      awayImportance: AWAY_IMPORTANCE,
    },
    modelProb: prob,
    empiricalProb: empirical,
    blendedProb: blended,
    edgePP: ODDS != null ? (prob - implied) * 100 : null,
    evPct,
    rawEvPct,
    legacyProb: probLegacy,
    legacyEvPct: ODDS != null ? probLegacy * ODDS * 100 - 100 : null,
    multiplier: {
      value: multiplierResult?.multiplier ?? 1,
      rawScore: multiplierResult?.rawScore ?? 0,
      teamStrength: multiplierResult?.teamStrength ?? {},
      features: multiplierResult?.featureBreakdown ?? {},
    },
    lambdaWithMultiplier:
      lambdaWithMultiplier != null
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
    matches: teamTuples.length,
    statsFor,
    statsAgainst,
    hitsOver: `${hitsOver}/${teamTuples.length}`,
    hitsUnder: `${hitsUnder}/${teamTuples.length}`,
    hitsExact: `${hitsExact}/${teamTuples.length}`,
    meanFor: parseFloat(meanFor.toFixed(2)),
    meanAgainst: parseFloat(meanAgainst.toFixed(2)),
    lambda: parseFloat(lambdaVal.toFixed(2)),
    homeConceded: homeAgainst,
    awayConceded: awayAgainst,
    hitsAgainst: hitsAgainstDisplay,
    homeMatches,
    awayMatches,
  };

  const json = JSON.stringify(resultObj, null, 2);
  const resultFile =
    process.env.RESULT_FILE || path.join(__dirname, "backtest-result.json");
  await fs.writeFile(resultFile, json, "utf-8");
  console.log(`✅ Sparat resultat: ${resultFile}`);
  console.log(json);
  process.exit(0);
})().catch((e) => {
  console.error("🚨 JSON-spar fel:", e);
  process.exit(1);
});