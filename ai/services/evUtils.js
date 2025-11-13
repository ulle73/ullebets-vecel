"use client";

import { getFormulaConfig } from "@/lib/backtest/formulaConfig";

const FORMULA_DEFINITIONS = {
  multiplier: { valueKey: "evPctWithMultiplier", labelKey: "ev_multiplier_label" },
  multifactor: { valueKey: "evPctMultifactor", labelKey: "ev_multifactor_label" },
  leagueAvg: { valueKey: "evPctLeagueAvg", labelKey: "ev_league_avg_label" },
  base: { valueKey: "evPct", labelKey: "ev_model_label" },
  legacy: { valueKey: "legacyEvPct", labelKey: "ev_legacy_label" },
};

const DEFAULT_RESULT_PRIORITY = ["multiplier", "multifactor", "leagueAvg", "base", "legacy"];

const PRIMARY_LABELS = {
  multiplier: "EV (multiplier)",
  multifactor: "EV (multifaktor)",
  leagueAvg: "EV (liga)",
  base: "EV (modell)",
  legacy: "EV (legacy)",
};

export function resolvePrimaryEv(result, statKey) {
  if (!result) return { primaryEv: null, primaryLabel: null };
  const config = getFormulaConfig(statKey);
  const displayOrder = Array.isArray(config?.display) ? config.display : [];
  const priority = Array.from(new Set([...displayOrder, ...DEFAULT_RESULT_PRIORITY]));
  for (const key of priority) {
    const def = FORMULA_DEFINITIONS[key];
    if (!def) continue;
    const value = result[def.valueKey];
    if (typeof value === "number") {
      return { primaryEv: value, primaryLabel: PRIMARY_LABELS[key] || "" };
    }
  }
  return { primaryEv: null, primaryLabel: null };
}
