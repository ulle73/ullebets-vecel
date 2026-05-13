function parseLocalDateValue(dateValue) {
  if (!dateValue) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateValue));
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function isDateBeforeTodayLocal(dateValue, now = new Date()) {
  const selectedDate = parseLocalDateValue(dateValue);
  if (!selectedDate) return false;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return selectedDate.getTime() < today.getTime();
}

function formatSignedPercent(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function buildHistoricalPredictionSummary(rows, direction, isHistorical) {
  if (!isHistorical) {
    return {
      state: "future",
      count: 0,
      total: 0,
      avgPct: null,
      label: "Väntar på utfall",
      toneClass: "text-slate-500",
    };
  }

  const comparableRows = (Array.isArray(rows) ? rows : []).filter((row) => {
    const baseline = row?.leagueBaseline;
    const outcomeValue = row?.outcomeValue;
    return Number.isFinite(outcomeValue) && Number.isFinite(baseline) && baseline !== 0;
  });

  if (!comparableRows.length) {
    return {
      state: "pending",
      count: 0,
      total: 0,
      avgPct: null,
      label: "0/0 avgjorda",
      toneClass: "text-slate-500",
    };
  }

  const pctDeltas = comparableRows.map(
    (row) => ((row.outcomeValue - row.leagueBaseline) / row.leagueBaseline) * 100
  );
  const successCount = pctDeltas.filter((pctDelta) =>
    direction === "under" ? pctDelta < 0 : pctDelta > 0
  ).length;
  const avgPct = pctDeltas.reduce((sum, value) => sum + value, 0) / pctDeltas.length;
  const positiveTone =
    direction === "under" ? avgPct < 0 : avgPct >= 0;

  return {
    state: "ready",
    count: successCount,
    total: comparableRows.length,
    avgPct,
    label: `${successCount}/${comparableRows.length} ${direction === "under" ? "under" : "över"} • ${formatSignedPercent(avgPct)}`,
    toneClass: positiveTone ? "text-emerald-400" : "text-rose-400",
  };
}
