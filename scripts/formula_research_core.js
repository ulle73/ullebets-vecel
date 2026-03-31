import {
  getConfiguredFormulaOrder,
  pickPrimaryEvSelection,
  RESEARCH_FORMULA_PRIORITY,
} from "../lib/backtest/primaryEvSelection.js";

export { getConfiguredFormulaOrder };

export function pickConfiguredFormula({ statKey, line }) {
  const selection = pickPrimaryEvSelection({
    statKey,
    scope: line?.scope ?? line?.bet?.scope ?? "total",
    period: line?.period ?? line?.bet?.period ?? "ALL",
    evDetails: line?.evDetails && typeof line.evDetails === "object" ? line.evDetails : line,
    fallbackPriority: RESEARCH_FORMULA_PRIORITY,
  });

  return {
    formulaKey: selection.formulaKey,
    evPct: selection.evPct,
  };
}

function computeActualEv(line) {
  const odds = Number(line?.odds);
  if (!Number.isFinite(odds) || odds <= 0 || line?.win == null) return null;
  return line.win ? odds - 1 : -1;
}

export function summarizeConfiguredFormulaResults(lines = []) {
  const totals = {
    selectedBets: 0,
    settledBets: 0,
    wins: 0,
    expectedEvSum: 0,
    actualEvSum: 0,
    returnSum: 0,
    formulaCounts: {},
  };
  const byStat = Object.create(null);
  const topExamples = [];

  for (const line of Array.isArray(lines) ? lines : []) {
    const statKey = line?.statKey || line?.stat || "unknown";
    const selection = pickConfiguredFormula({ statKey, line });
    if (!Number.isFinite(selection.evPct) || selection.evPct <= 0) continue;

    totals.selectedBets += 1;
    totals.expectedEvSum += selection.evPct;
    totals.formulaCounts[selection.formulaKey] =
      (totals.formulaCounts[selection.formulaKey] || 0) + 1;

    const statEntry = byStat[statKey] || {
      statKey,
      selectedBets: 0,
      settledBets: 0,
      wins: 0,
      expectedEvSum: 0,
      returnSum: 0,
      formulaCounts: {},
    };
    statEntry.selectedBets += 1;
    statEntry.expectedEvSum += selection.evPct;
    statEntry.formulaCounts[selection.formulaKey] =
      (statEntry.formulaCounts[selection.formulaKey] || 0) + 1;

    const actualEv = computeActualEv(line);
    if (actualEv != null) {
      totals.settledBets += 1;
      totals.actualEvSum += actualEv * 100;
      totals.returnSum += line.win ? Number(line.odds) : 0;
      if (line.win) totals.wins += 1;

      statEntry.settledBets += 1;
      statEntry.returnSum += line.win ? Number(line.odds) : 0;
      if (line.win) statEntry.wins += 1;
    }

    byStat[statKey] = statEntry;

    topExamples.push({
      statKey,
      odds: Number(line?.odds) || null,
      win: line?.win ?? null,
      formulaKey: selection.formulaKey,
      evPct: Number(selection.evPct.toFixed(2)),
      headline:
        line?.headline ||
        `${line?.condition || line?.direction || "over"} ${line?.line ?? "?"} ${statKey}`,
    });
  }

  topExamples.sort((a, b) => b.evPct - a.evPct);

  const metrics = {
    selectedBets: totals.selectedBets,
    settledBets: totals.settledBets,
    roiPct:
      totals.settledBets > 0
        ? Number((((totals.returnSum - totals.settledBets) / totals.settledBets) * 100).toFixed(2))
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
  };

  const statBreakdown = Object.values(byStat)
    .map((entry) => ({
      statKey: entry.statKey,
      selectedBets: entry.selectedBets,
      settledBets: entry.settledBets,
      roiPct:
        entry.settledBets > 0
          ? Number((((entry.returnSum - entry.settledBets) / entry.settledBets) * 100).toFixed(2))
          : 0,
      expectedEvPct:
        entry.selectedBets > 0
          ? Number((entry.expectedEvSum / entry.selectedBets).toFixed(2))
          : 0,
      winRatePct:
        entry.settledBets > 0
          ? Number(((entry.wins / entry.settledBets) * 100).toFixed(2))
          : 0,
      formulaCounts: entry.formulaCounts,
    }))
    .sort((a, b) => {
      if (b.roiPct !== a.roiPct) return b.roiPct - a.roiPct;
      return b.selectedBets - a.selectedBets;
    });

  return {
    metrics,
    statBreakdown,
    topExamples: topExamples.slice(0, 10),
  };
}
