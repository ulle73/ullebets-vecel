import { logClientBacktestStep } from "@/lib/backtest/logger";

const EV_METRICS = [
  { key: "evPct", label: "EV (Modell)", shortLabel: "EV Modell" },
  { key: "evPctWithMultiplier", label: "EV (Multiplier)", shortLabel: "EV Mult" },
  { key: "evPctMultifactor", label: "EV (Multifaktor)", shortLabel: "EV Multi" },
  { key: "evPctLeagueAvg", label: "EV (Liga-snitt)", shortLabel: "EV LigaAvg" },
  { key: "legacyEvPct", label: "EV (Legacy)", shortLabel: "EV Legacy" },
];

const computeMetric = (result, key) => {
  const value = result?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
};

export const DEFAULT_FORMULAS = [
  {
    id: "ev-model",
    label: "EV Modell",
    metricKey: "evPct",
    description: "Använder modellens EV.",
    compute: (result) => computeMetric(result, "evPct"),
  },
  {
    id: "ev-multiplier",
    label: "EV Multiplier",
    metricKey: "evPctWithMultiplier",
    description: "Använder EV justerat med multiplier.",
    compute: (result) => computeMetric(result, "evPctWithMultiplier"),
  },
  {
    id: "ev-multifactor",
    label: "EV Multifaktor",
    metricKey: "evPctMultifactor",
    description: "Använder multifaktor-varianten av EV.",
    compute: (result) => computeMetric(result, "evPctMultifactor"),
  },
  {
    id: "ev-league-average",
    label: "EV LigaAvg",
    metricKey: "evPctLeagueAvg",
    description: "Använder EV från ligans historiska snitt.",
    compute: (result) => computeMetric(result, "evPctLeagueAvg"),
  },
  {
    id: "ev-legacy",
    label: "EV Legacy",
    metricKey: "legacyEvPct",
    description: "Använder legacy-EV.",
    compute: (result) => computeMetric(result, "legacyEvPct"),
  },
];

export function computePrimaryFormula(result, formulas = DEFAULT_FORMULAS) {
  for (const formula of formulas) {
    const value = formula.compute(result);
    if (typeof value === "number" && Number.isFinite(value)) {
      logClientBacktestStep("Formel för primärt värde väljs.", {
        formula: formula.id,
        value,
      });
      return { formula, value };
    }
  }
  logClientBacktestStep("Ingen primärformel matchade resultatet.", { result });
  return { formula: formulas[0] ?? null, value: null };
}

export function collectEvMetrics(result) {
  const metrics = EV_METRICS.map((metric) => {
    const value = computeMetric(result, metric.key);
    return {
      ...metric,
      value,
    };
  }).filter((metric) => metric.value !== null);
  logClientBacktestStep("EV-måtten sammanställs för resultatraden.", metrics);
  return metrics;
}
