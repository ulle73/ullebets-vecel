const EV_METRICS = [
  { key: "evPctWithMultiplier", label: "EV (Multiplier)", shortLabel: "EV Mult" },
  { key: "evPctMultifactor", label: "EV (Multifaktor)", shortLabel: "EV Multi" },
  { key: "evPctLeagueAvg", label: "EV (Liga-snitt)", shortLabel: "EV LigaAvg" },
  { key: "evPct", label: "EV (Modell)", shortLabel: "EV Modell" },
  { key: "legacyEvPct", label: "EV (Legacy)", shortLabel: "EV Legacy" },
];

export const DEFAULT_FORMULAS = [
  {
    id: "league-average",
    label: "EV LigaAvg",
    metricKey: "evPctLeagueAvg",
    description: "Använder EV från ligans historiska snitt (EV-ligaAVG).",
    compute: (result) => {
      const value = result?.evPctLeagueAvg;
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    },
  },
];

export function computePrimaryFormula(result, formulas = DEFAULT_FORMULAS) {
  for (const formula of formulas) {
    const value = formula.compute(result);
    if (typeof value === "number" && Number.isFinite(value)) {
      return { formula, value };
    }
  }
  return { formula: formulas[0] ?? null, value: null };
}

export function collectEvMetrics(result) {
  return EV_METRICS.map((metric) => {
    const value = result?.[metric.key];
    return {
      ...metric,
      value: typeof value === "number" && Number.isFinite(value) ? value : null,
    };
  }).filter((metric) => metric.value !== null);
}
