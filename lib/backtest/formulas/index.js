
import { computeBaseProjection } from "./baseProjection.js";
import { computeMultiplierProjection } from "./multiplier.js";
import { computeLeagueAverageProjection } from "./leagueAverage.js";
import { computeMultifactorProjection } from "./multifactor.js";
import { getFormulaConfig } from "../formulaConfig.js";
import { STAT_PATTERNS } from "../constants.js";
import { teamSlug } from "../tuples.js";
import { computePoissonProbability } from "./main.js";
import { calibrateEv } from "../math.js";

function calculateResults(
  baseResult,
  multiplierResult,
  leagueProjection,
  multifactorProjection,
  params
) {
    const { over, line, odds } = params;
    const OVER = Boolean(over);
    const LINE = Number.parseFloat(line);
    const oddsValue = Number.parseFloat(odds);
    const implied = oddsValue ? 1 / oddsValue : 0;

  // Multiplier
  const lambdaWithMultiplier =
    Number.isFinite(baseResult.lambda) &&
    Number.isFinite(multiplierResult?.multiplier)
      ? baseResult.lambda * multiplierResult.multiplier
      : null;

  const probWithMultiplier =
    lambdaWithMultiplier != null
      ? computePoissonProbability(lambdaWithMultiplier, LINE, OVER)
      : null;

  const rawEvMultiplier =
    probWithMultiplier != null && oddsValue != null
      ? probWithMultiplier * oddsValue * 100 - 100
      : null;
  const evPctMultiplier =
    rawEvMultiplier != null ? calibrateEv(rawEvMultiplier) : null;
  const edgeWithMultiplier =
    probWithMultiplier != null && oddsValue != null
      ? (probWithMultiplier - implied) * 100
      : null;

  // League Average
  const leagueLambda =
    leagueProjection?.selectedLambda != null &&
    Number.isFinite(leagueProjection.selectedLambda)
      ? leagueProjection.selectedLambda
      : null;
  const leagueProb =
    leagueLambda != null
      ? computePoissonProbability(leagueLambda, LINE, OVER)
      : null;
  const rawEvLeagueAvg =
    leagueProb != null && oddsValue != null
      ? leagueProb * oddsValue * 100 - 100
      : null;
  const evPctLeagueAvg =
    rawEvLeagueAvg != null ? calibrateEv(rawEvLeagueAvg) : null;
  const edgeLeagueAvg =
    leagueProb != null && oddsValue != null
      ? (leagueProb - implied) * 100
      : null;

  const leagueAvg = {
    lambda:
      leagueProjection?.lambda && typeof leagueProjection.lambda === "object"
        ? {
            total: Number.isFinite(leagueProjection.lambda.total)
              ? Number(leagueProjection.lambda.total.toFixed(2))
              : null,
            home: Number.isFinite(leagueProjection.lambda.home)
              ? Number(leagueProjection.lambda.home.toFixed(2))
              : null,
            away: Number.isFinite(leagueProjection.lambda.away)
              ? Number(leagueProjection.lambda.away.toFixed(2))
              : null,
          }
        : null,
    selectedLambda: leagueLambda != null ? Number(leagueLambda.toFixed(2)) : null,
    prob: leagueProb,
    rawEvPct: rawEvLeagueAvg,
    evPct: evPctLeagueAvg,
    edgePP: edgeLeagueAvg,
    details: leagueProjection,
  };

  // Multifactor
  const multifactorLambda =
    Number.isFinite(multifactorProjection?.lambda)
      ? multifactorProjection.lambda
      : null;
  const probMultifactor =
    multifactorLambda != null
      ? computePoissonProbability(multifactorLambda, LINE, OVER)
      : null;
  const rawEvMultifactor =
    probMultifactor != null && oddsValue != null
      ? probMultifactor * oddsValue * 100 - 100
      : null;
  const evPctMultifactor =
    rawEvMultifactor != null ? calibrateEv(rawEvMultifactor) : null;
  const edgeMultifactor =
    probMultifactor != null && oddsValue != null
      ? (probMultifactor - implied) * 100
      : null;

  return {
    multiplier: multiplierResult,
    lambdaWithMultiplier:
      lambdaWithMultiplier != null
        ? Number(lambdaWithMultiplier.toFixed(2))
        : null,
    modelProbWithMultiplier: probWithMultiplier,
    edgePPWithMultiplier: edgeWithMultiplier,
    rawEvPctWithMultiplier: rawEvMultiplier,
    evPctWithMultiplier: evPctMultiplier,
    multifactor: {
      lambda:
        multifactorLambda != null ? Number(multifactorLambda.toFixed(2)) : null,
      prob: probMultifactor,
      rawEvPct: rawEvMultifactor,
      evPct: evPctMultifactor,
      edgePP: edgeMultifactor,
      details: multifactorProjection,
    },
    leagueAvg,
    modelProbMultifactor: probMultifactor,
    rawEvPctMultifactor: rawEvMultifactor,
    evPctMultifactor,
    edgePPMultifactor: edgeMultifactor,
    modelProbLeagueAvg: leagueProb,
    rawEvPctLeagueAvg: rawEvLeagueAvg,
    evPctLeagueAvg,
    edgePPLeagueAvg: edgeLeagueAvg,
  };
}

export async function runFormulas(params, context) {
    const {
        homeTeam,
        awayTeam,
        stat,
        period,
        scope,
        over,
        line,
        form,
        neutralGround,
        home_importance,
        away_importance,
        odds,
      } = params;

    const { tuples, homeBundle, awayBundle, homeMatchesRaw, awayMatchesRaw } = context;

    const formulaConfig = getFormulaConfig(stat);
    const statProfileKey = STAT_PATTERNS[stat]?.rankKey || stat;
    const homeSlug = teamSlug(homeTeam);
    const awaySlug = teamSlug(awayTeam);

  const baseResult = computeBaseProjection({
    tuples,
    statKey: stat,
    scope,
    over,
    line,
    formLimit: form,
    homeSlug,
    awaySlug,
    homeImportance: home_importance,
    awayImportance: away_importance,
    neutralGround,
    blendWeight: formulaConfig.blendWeight,
  });

  const multiplierResult = computeMultiplierProjection({
    base: baseResult,
    tuples,
    homeSlug,
    awaySlug,
  });

  const leagueProjection = await computeLeagueAverageProjection({
    homeTeam,
    awayTeam,
    statKey: statProfileKey,
    periodKey: period,
    scope,
    neutralGround,
  });

  const multifactorProjection = computeMultifactorProjection({
    base: baseResult,
    leagueProjection,
    weights: formulaConfig.multifactor,
  });

  const otherResults = calculateResults(
    baseResult,
    multiplierResult,
    leagueProjection,
    multifactorProjection,
    params
  );

  const oddsValue = Number.parseFloat(odds);
    const implied = oddsValue ? 1 / oddsValue : 0;
  const rawEvPct =
    oddsValue != null ? baseResult.prob * oddsValue * 100 - 100 : null;
  const evPct = rawEvPct != null ? calibrateEv(rawEvPct) : null;
  const totalMatches =
    baseResult.statsFor.length || baseResult.teamTuples?.length || tuples.length;

  const meanFor = Number.isFinite(baseResult.meanFor)
    ? Number(baseResult.meanFor.toFixed(2))
    : 0;
  const meanAgainst = Number.isFinite(baseResult.meanAgainst)
    ? Number(baseResult.meanAgainst.toFixed(2))
    : 0;
  const baseLambda = Number.isFinite(baseResult.lambda)
    ? Number(baseResult.lambda.toFixed(2))
    : null;

  return {
    ...otherResults,
    modelProb: baseResult.prob,
    empiricalProb: baseResult.empirical,
    blendedProb: baseResult.blended,
    edgePP: oddsValue != null ? (baseResult.prob - implied) * 100 : null,
    evPct,
    rawEvPct,
    legacyProb: baseResult.probLegacy,
    legacyEvPct:
      baseResult.probLegacy != null && oddsValue != null
        ? baseResult.probLegacy * oddsValue * 100 - 100
        : null,
    timestamp: new Date().toISOString(),
    matches: totalMatches,
    statsFor: baseResult.statsFor,
    statsAgainst: baseResult.statsAgainst,
    hitsOver: `${baseResult.hits.over}/${totalMatches}`,
    hitsUnder: `${baseResult.hits.under}/${totalMatches}`,
    hitsExact: `${baseResult.hits.exact}/${totalMatches}`,
    meanFor,
    meanAgainst,
    lambda: baseLambda,
    homeConceded: baseResult.homeConceded,
    awayConceded: baseResult.awayConceded,
    hitsAgainst: `${baseResult.hits.against}/${totalMatches}`,
    homeMatches: baseResult.homeMatches,
    awayMatches: baseResult.awayMatches,
  };
}
