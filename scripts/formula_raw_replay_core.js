import { getMatchTimestamp } from "../lib/backtest/tuples.js";
import { poissonCdf } from "../lib/backtest/math.js";
import { getFormulaConfig } from "../lib/backtest/formulaConfig.js";
import { computeMultiplierProjection } from "../lib/backtest/methods/multiplier.js";
import { computeMultifactorProjection } from "../lib/backtest/methods/multifactor.js";
import { evPct } from "../lib/backtest/formulas/evPct.js";
import { evPctLeagueAvg } from "../lib/backtest/formulas/evPctLeagueAvg.js";
import { evPctMultifactor } from "../lib/backtest/formulas/evPctMultifactor.js";
import { evPctWithMultiplier } from "../lib/backtest/formulas/evPctWithMultiplier.js";
import { getConfiguredFormulaOrder } from "./formula_research_core.js";
import {
  applyNumericMutation,
  readNumericProperty,
} from "./research_autoloop_core.js";

export const SUPPORTED_RAW_REPLAY_STATS = [
  "cornerKicks",
  "totalShots",
  "yellowCards",
];

function buildSettledLineMap(lines = []) {
  const settledMap = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const betKey = line?.betKey;
    if (!betKey) continue;
    settledMap.set(betKey, line);
  }
  return settledMap;
}

export function flattenReplayCandidates(docs = []) {
  const rows = [];

  for (const doc of Array.isArray(docs) ? docs : []) {
    const settledMap = buildSettledLineMap(doc?.lines);
    for (const snapshot of Array.isArray(doc?.snapshots) ? doc.snapshots : []) {
      for (const snapshotLine of Array.isArray(snapshot?.lines) ? snapshot.lines : []) {
        if (!SUPPORTED_RAW_REPLAY_STATS.includes(snapshotLine?.statKey)) continue;

        const settled = settledMap.get(snapshotLine?.betKey) || {};
        rows.push({
          ...snapshotLine,
          actual: settled?.actual ?? null,
          win: settled?.win ?? null,
          homeTeam: doc?.homeTeam ?? null,
          awayTeam: doc?.awayTeam ?? null,
          matchDate: doc?.matchDate ?? null,
          snapshotFetchedAt: snapshot?.fetchedAt ?? null,
        });
      }
    }
  }

  return rows;
}

export function filterMatchesBeforeCutoff(matches = [], cutoffTimestamp) {
  if (!Number.isFinite(cutoffTimestamp)) return [];
  return (Array.isArray(matches) ? matches : []).filter((match) => {
    const timestamp = getMatchTimestamp(match);
    return Number.isFinite(timestamp) && timestamp < cutoffTimestamp;
  });
}

export function evPctToProbability(evPct, odds) {
  if (evPct == null || odds == null) {
    return null;
  }
  const evValue = Number(evPct);
  const oddsValue = Number(odds);
  if (!Number.isFinite(evValue) || !Number.isFinite(oddsValue) || oddsValue <= 0) {
    return null;
  }
  return (evValue / 100 + 1) / oddsValue;
}

export function readReplayMutationValue(source, declarationName, propertyPath = []) {
  return readNumericProperty(source, declarationName, propertyPath);
}

export function applyReplayMutation(source, mutation) {
  return applyNumericMutation(source, mutation);
}

export function buildNextNumericProposal({
  source,
  attemptedIds = new Set(),
  templates = [],
}) {
  for (const template of Array.isArray(templates) ? templates : []) {
    if (attemptedIds?.has?.(template.id)) continue;
    const currentValue = readReplayMutationValue(
      source,
      template.declarationName,
      template.propertyPath
    );
    if (currentValue === template.nextValue) continue;
    const nextSource = applyReplayMutation(source, template);
    const propertyLabel = template.propertyPath.join(".");
    return {
      ...template,
      description: `${template.description} (${propertyLabel} ${currentValue} -> ${template.nextValue})`,
      nextSource,
    };
  }
  return null;
}

export function normalizeConditionToIsOver(condition) {
  const normalized = String(condition || "").trim().toLowerCase();
  if (["over", "över", "o", "ovr"].includes(normalized)) return true;
  if (["under", "u", "und"].includes(normalized)) return false;
  return null;
}

function eventProbability(lambda, line, isOver) {
  const safeLambda = Number(lambda);
  const safeLine = Number(line);
  if (!Number.isFinite(safeLambda) || !Number.isFinite(safeLine)) {
    return null;
  }
  const threshold = isOver ? Math.max(-1, Math.ceil(safeLine) - 1) : Math.floor(safeLine);
  const cdf = poissonCdf(threshold, safeLambda);
  return isOver ? 1 - cdf : cdf;
}

export function inferPoissonLambdaFromProbability({
  probability,
  line,
  isOver,
  maxLambda = 20,
  iterations = 48,
}) {
  const target = Number(probability);
  const safeLine = Number(line);
  if (
    !Number.isFinite(target) ||
    !Number.isFinite(safeLine) ||
    target <= 0 ||
    target >= 1
  ) {
    return null;
  }

  let low = 0.0001;
  let high = Number.isFinite(maxLambda) && maxLambda > low ? maxLambda : 20;

  for (let i = 0; i < iterations; i += 1) {
    const mid = (low + high) / 2;
    const current = eventProbability(mid, safeLine, Boolean(isOver));
    if (!Number.isFinite(current)) {
      return null;
    }
    if (isOver) {
      if (current < target) {
        low = mid;
      } else {
        high = mid;
      }
    } else {
      if (current > target) {
        low = mid;
      } else {
        high = mid;
      }
    }
  }

  return (low + high) / 2;
}

function computeActualEv(row) {
  const odds = Number(row?.odds);
  if (!Number.isFinite(odds) || odds <= 0 || row?.win == null) return null;
  return row.win ? odds - 1 : -1;
}

export function buildReplayFormulaValues({
  row,
  baseResult,
  leagueLambda,
  homeSlug,
  awaySlug,
}) {
  const oddsValue = Number(row?.odds);
  const implied = Number.isFinite(oddsValue) && oddsValue > 0 ? 1 / oddsValue : null;
  const isOver = normalizeConditionToIsOver(row?.condition ?? row?.direction);
  const probabilityOf = (lambda) => {
    if (isOver == null) return null;
    return eventProbability(lambda, row?.line, isOver);
  };

  const baseValues = evPct({
    baseResult,
    oddsValue,
    implied,
  });

  const multiplierResult = computeMultiplierProjection({
    base: baseResult,
    tuples: baseResult?.tuples || [],
    homeSlug,
    awaySlug,
  });
  const multiplierValues = evPctWithMultiplier({
    baseResult,
    multiplierResult,
    oddsValue,
    implied,
    probabilityOf,
  });

  const leagueProjection =
    Number.isFinite(leagueLambda)
      ? { selectedLambda: leagueLambda, lambda: { total: leagueLambda } }
      : { selectedLambda: null, lambda: null };

  const leagueAvgValues = evPctLeagueAvg({
    leagueProjection,
    oddsValue,
    implied,
    probabilityOf,
  });

  const config = getFormulaConfig(row?.statKey || row?.stat || "unknown");
  const multifactorProjection = computeMultifactorProjection({
    base: baseResult,
    leagueProjection,
    weights: {
      leagueWeight: Number.isFinite(config?.multifactor?.leagueWeight)
        ? config.multifactor.leagueWeight
        : undefined,
    },
  });
  const multifactorValues = evPctMultifactor({
    multifactorProjection,
    oddsValue,
    implied,
    probabilityOf,
  });

  return {
    base: baseValues.evPct,
    multiplier: multiplierValues.evPctWithMultiplier,
    leagueAvg: leagueAvgValues.evPctLeagueAvg,
    multifactor: multifactorValues.evPctMultifactor,
    legacy:
      Number.isFinite(row?.evDetails?.legacyEvPct) ? row.evDetails.legacyEvPct : null,
  };
}

export function scoreReplaySelections(rows = []) {
  const totals = {
    selectedBets: 0,
    settledBets: 0,
    wins: 0,
    expectedEvSum: 0,
    actualEvSum: 0,
    returnSum: 0,
    formulaCounts: {},
  };
  const topExamples = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const order = getConfiguredFormulaOrder(row?.statKey || row?.stat || "unknown");
    let selectedFormula = null;
    let selectedEv = null;

    for (const formulaKey of order) {
      const candidate = row?.formulaValues?.[formulaKey];
      if (!Number.isFinite(candidate)) continue;
      selectedFormula = formulaKey;
      selectedEv = candidate;
      break;
    }

    if (!Number.isFinite(selectedEv) || selectedEv <= 0) continue;

    totals.selectedBets += 1;
    totals.expectedEvSum += selectedEv;
    totals.formulaCounts[selectedFormula] =
      (totals.formulaCounts[selectedFormula] || 0) + 1;

    const actualEv = computeActualEv(row);
    if (actualEv != null) {
      totals.settledBets += 1;
      totals.actualEvSum += actualEv * 100;
      totals.returnSum += row.win ? Number(row.odds) : 0;
      if (row.win) totals.wins += 1;
    }

    topExamples.push({
      headline: row?.headline || row?.betKey || "unknown",
      statKey: row?.statKey || row?.stat || "unknown",
      formulaKey: selectedFormula,
      evPct: Number(selectedEv.toFixed(2)),
      odds: Number(row?.odds) || null,
      win: row?.win ?? null,
    });
  }

  topExamples.sort((a, b) => b.evPct - a.evPct);

  return {
    metrics: {
      selectedBets: totals.selectedBets,
      settledBets: totals.settledBets,
      roiPct:
        totals.settledBets > 0
          ? Number(
              (((totals.returnSum - totals.settledBets) / totals.settledBets) * 100).toFixed(2)
            )
          : 0,
      expectedEvPct:
        totals.selectedBets > 0
          ? Number((totals.expectedEvSum / totals.selectedBets).toFixed(2))
          : 0,
      actualEvPct:
        totals.settledBets > 0
          ? Number((totals.actualEvSum / totals.settledBets).toFixed(2))
          : 0,
      winRatePct:
        totals.settledBets > 0
          ? Number(((totals.wins / totals.settledBets) * 100).toFixed(2))
          : 0,
      formulaCounts: totals.formulaCounts,
    },
    topExamples: topExamples.slice(0, 10),
  };
}
