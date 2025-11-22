import { clamp, poissonCdf } from "../math.js";
import { PERIODS, DEFAULT_FORM } from "../constants.js";

// --- Start of utility functions ---
export function computePoissonProbability(lambda, line, isOver) {
    if (!Number.isFinite(lambda)) return null;
    const safeLambda = lambda > 0 ? lambda : 0.0001;
    const k = isOver ? Math.max(-1, Math.ceil(line) - 1) : Math.floor(line);
    const cdfVal = poissonCdf(k, safeLambda);
    return Math.min(1, Math.max(0, isOver ? 1 - cdfVal : cdfVal));
  }

export function readPeriodValue(stat, periodKey) {
    if (!stat) return null;
    const entry = stat?.[periodKey] ?? (periodKey !== "ALL" ? stat?.ALL : null);
    if (!entry) return null;
    const raw = typeof entry === "object" ? entry.value ?? entry.avg ?? entry.mean : entry;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
  }
  
  export function readProfileStatValue(profile, sectionKey, statKey, periodKey) {
    if (!profile) return null;
    const section = profile?.statistics?.[sectionKey];
    if (!section?.[statKey]) return null;
    return readPeriodValue(section[statKey], periodKey);
  }
  
  export function readProfileLeagueAverageValue(profile, sectionKey, statKey, periodKey) {
    if (!profile) return null;
    const section = profile?.statistics?.leagueAverage?.[sectionKey];
    if (!section?.[statKey]) return null;
    return readPeriodValue(section[statKey], periodKey);
  }
  
  export function aggregateBundleMetric(bundle, matchTypes, reader) {
    const values = [];
    for (const matchType of matchTypes) {
      const profile = bundle?.[matchType];
      if (!profile) continue;
      const value = reader(profile);
      if (Number.isFinite(value)) {
        values.push(value);
      }
    }
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  
  export function computeLambdaFromMetrics(attack, attackAvg, concede, concedeAvg, overallAverage) {
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
  
    const fallbackCandidates = [attack, concede].filter((value) => Number.isFinite(value));
    if (fallbackCandidates.length) {
      return fallbackCandidates.reduce((sum, value) => sum + value, 0) / fallbackCandidates.length;
    }
  
    if (Number.isFinite(overallAverage)) {
      return overallAverage;
    }
  
    return null;
  }
  
  export function buildTeamProfileProjection({
    homeBundle,
    awayBundle,
    statKey,
    periodKey,
    neutralGround,
  }) {
    const homeMatchTypes = neutralGround ? ["home", "away"] : ["home"];
    const awayMatchTypes = neutralGround ? ["home", "away"] : ["away"];
  
    const homeAttack = aggregateBundleMetric(homeBundle, homeMatchTypes, (profile) =>
      readProfileStatValue(profile, "for", statKey, periodKey)
    );
    const homeConcede = aggregateBundleMetric(homeBundle, homeMatchTypes, (profile) =>
      readProfileStatValue(profile, "against", statKey, periodKey)
    );
    const awayAttack = aggregateBundleMetric(awayBundle, awayMatchTypes, (profile) =>
      readProfileStatValue(profile, "for", statKey, periodKey)
    );
    const awayConcede = aggregateBundleMetric(awayBundle, awayMatchTypes, (profile) =>
      readProfileStatValue(profile, "against", statKey, periodKey)
    );
  
    const homeAttackAvg = aggregateBundleMetric(homeBundle, homeMatchTypes, (profile) =>
      readProfileLeagueAverageValue(profile, "for", statKey, periodKey)
    );
    const homeConcedeAvg = aggregateBundleMetric(homeBundle, homeMatchTypes, (profile) =>
      readProfileLeagueAverageValue(profile, "against", statKey, periodKey)
    );
    const awayAttackAvg = aggregateBundleMetric(awayBundle, awayMatchTypes, (profile) =>
      readProfileLeagueAverageValue(profile, "for", statKey, periodKey)
    );
    const awayConcedeAvg = aggregateBundleMetric(awayBundle, awayMatchTypes, (profile) =>
      readProfileLeagueAverageValue(profile, "against", statKey, periodKey)
    );
  
    const overallCandidates = [
      homeAttackAvg,
      homeConcedeAvg,
      awayAttackAvg,
      awayConcedeAvg,
    ].filter((value) => Number.isFinite(value));
  
    let overallAverage = overallCandidates.length
      ? overallCandidates.reduce((sum, value) => sum + value, 0) / overallCandidates.length
      : null;
  
    if (!Number.isFinite(overallAverage)) {
      const fallback = [homeAttack, homeConcede, awayAttack, awayConcede].filter((value) =>
        Number.isFinite(value)
      );
      overallAverage = fallback.length
        ? fallback.reduce((sum, value) => sum + value, 0) / fallback.length
        : null;
    }
  
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
  
    return {
      lambdaHome,
      lambdaAway,
      metrics: {
        homeAttack,
        homeConcede,
        awayAttack,
        awayConcede,
        homeAttackAvg,
        homeConcedeAvg,
        awayAttackAvg,
        awayConcedeAvg,
        overallAverage,
      },
    };
  }

  export function validateImportance(value, fallback = 5) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric)) return fallback;
    return clamp(1, numeric, 10);
  }
  // --- End of utility functions ---