import { calcTuple } from "./backtest/tuples.js";
import { STAT_PATTERNS } from "./backtest/constants.js";
import { isFinishedMatchSnapshot } from "./teamstatsSnapshots.js";

export function normalizeStatisticsBlocks(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.statistics)) return payload.statistics;
  if (Array.isArray(payload?.data?.statistics)) return payload.data.statistics;
  return null;
}

export function buildMatchFromStatisticsPayload(payload) {
  const statistics = normalizeStatisticsBlocks(payload);
  if (!statistics) return null;
  return { matchDetails: { statistics } };
}

function resolveTupleStat(tuple, statKey) {
  if (!tuple || !statKey) return null;
  if (tuple[statKey]) return tuple[statKey];

  for (const [patternKey, pattern] of Object.entries(STAT_PATTERNS)) {
    if (pattern?.rankKey === statKey && tuple[patternKey]) {
      return tuple[patternKey];
    }
  }

  return null;
}

export function resolveMatchupActualValue(match, row) {
  const statKey = row?.statKey;
  if (!match || !statKey) return null;

  const tuple = calcTuple(match, statKey, row?.period || "ALL");
  const stat = resolveTupleStat(tuple, statKey);
  if (!stat) return null;

  const homeValue = Number(stat.home);
  const awayValue = Number(stat.away);
  const totalValue = Number(stat.total);

  let actualValue = totalValue;
  if (row?.scope === "home") actualValue = homeValue;
  else if (row?.scope === "away") actualValue = awayValue;

  if (!Number.isFinite(actualValue)) return null;

  return {
    actualValue,
    homeValue: Number.isFinite(homeValue) ? homeValue : null,
    awayValue: Number.isFinite(awayValue) ? awayValue : null,
  };
}

export function buildMatchupOutcome(match, row, options = {}) {
  const requireFinished = options.requireFinished !== false;
  if (!match) return null;
  if (requireFinished && !isFinishedMatchSnapshot(match)) return null;
  return resolveMatchupActualValue(match, row);
}
