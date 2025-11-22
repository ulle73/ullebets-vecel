import { fetchTeamProfilesBundle, fetchTeamMatches } from "./data.js";
import { createCache } from "./cache.js";
import { logServerBacktestStep } from "./logger.js";
import { STAT_PATTERNS, PERIODS, DEFAULT_FORM } from "./constants.js";
import { buildTeamProfileProjection, validateImportance } from "./formulas/main.js";
import { buildTuples } from "./tuples.js";
import { runFormulas } from "./formulas/index.js";

const RESULT_CACHE = createCache({ ttlMs: 45 * 60 * 1000 });

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

function parseOdds(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}


/**
 * Performs the core EV calculation, assuming all data has been pre-fetched.
 */
export async function calculateEVFromData(params, fetchedData) {
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
    
      const { homeBundle, awayBundle, homeMatchesRaw, awayMatchesRaw } = fetchedData;

      const parsedLine = Number.parseFloat(line);
      const parsedScope = validateScope(scope);
      const parsedPeriod = validatePeriod(period);
      const parsedForm = parseFormValue(form);
      const parsedOdds = parseOdds(odds);
      const homeImportance = validateImportance(home_importance);
      const awayImportance = validateImportance(away_importance);
      const statProfileKey = STAT_PATTERNS[stat]?.rankKey || stat;

      if (!homeBundle || (!homeBundle.home && !homeBundle.away)) {
        throw new Error(`Kunde inte hitta teamprofile för ${homeTeam}.`);
      }
    
      if (!awayBundle || (!awayBundle.home && !awayBundle.away)) {
        throw new Error(`Kunde inte hitta teamprofile för ${awayTeam}.`);
      }

      const projection = buildTeamProfileProjection({
        homeBundle,
        awayBundle,
        statKey: statProfileKey,
        periodKey: parsedPeriod,
        neutralGround,
      });
    
      const tuples = buildTuples({
        homeMatches: homeMatchesRaw,
        awayMatches: awayMatchesRaw,
        statKey: stat,
        periodKey: parsedPeriod,
      });
    
      if (!tuples.length) {
        throw new Error("Kunde inte hitta några matcher för valda lag.");
      }
    
      const formulaParams = {
          homeTeam,
          awayTeam,
          stat,
          period: parsedPeriod,
          scope: parsedScope,
          over,
          line: parsedLine,
          form: parsedForm,
          neutralGround,
          home_importance: homeImportance,
          away_importance: awayImportance,
          odds: parsedOdds
      }

      const context = {
        tuples,
        homeBundle,
        awayBundle,
      }

      const formulaResult = await runFormulas(formulaParams, context);
    
      const result = {
        params: {
          home: homeTeam,
          away: awayTeam,
          over: Boolean(over),
          line: parsedLine,
          scope: parsedScope,
          stat,
          period: parsedPeriod,
          form,
          neutralGround,
          odds: parsedOdds,
          homeImportance,
          awayImportance,
        },
        ...formulaResult,
        leagueAvgHistory: projection.metrics,
      };

      return result;
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

  logServerBacktestStep("Servern startar expected value-beräkning.", {
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
    logServerBacktestStep("Servern levererar resultat från cache.", { cacheKey });
    return cached;
  }
  logServerBacktestStep("Servern behöver räkna expected value.", { cacheKey });

  const [homeBundle, awayBundle, homeMatchesRaw, awayMatchesRaw] = await Promise.all([
    fetchTeamProfilesBundle(homeTeam),
    fetchTeamProfilesBundle(awayTeam),
    fetchTeamMatches(homeTeam, neutralGround ? "away" : "home"),
    fetchTeamMatches(awayTeam, "away"),
  ]);

  logServerBacktestStep("Lagprofiler hämtade för beräkning.", {
    homeTeam,
    awayTeam,
    homeProfile: {
      hasHome: Boolean(homeBundle?.home),
      hasAway: Boolean(homeBundle?.away),
    },
    awayProfile: {
      hasHome: Boolean(awayBundle?.home),
      hasAway: Boolean(awayBundle?.away),
    },
  });

  const fetchedData = { homeBundle, awayBundle, homeMatchesRaw, awayMatchesRaw };
  const result = await calculateEVFromData(params, fetchedData);

  RESULT_CACHE.set(cacheKey, result);
  logServerBacktestStep("Servern färdigställer expected value-resultat.", {
    stat,
    scope: parsedScope,
    period: parsedPeriod,
    resultPreview: {
      modelProb: result.modelProb,
      evPct: result.evPct,
      lambda: result.lambda,
    },
  });

  return result;
}