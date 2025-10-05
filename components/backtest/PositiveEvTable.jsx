import { memo, useMemo } from "react";
import { collectEvMetrics, computePrimaryFormula, DEFAULT_FORMULAS } from "./formulas";
import { formatPercent } from "./utils";

function resolveTeamLabel(result) {
  if (!result?.bet) return "-";
  if (result.bet.scope === "home") return result.bet.homeTeam ?? "Hemmalag";
  if (result.bet.scope === "away") return result.bet.awayTeam ?? "Bortalag";
  return `${result.bet.homeTeam ?? "Hemmalag"} - ${result.bet.awayTeam ?? "Bortalag"}`;
}

const PositiveEvTable = memo(function PositiveEvTable({ results, statLabels, formulas = DEFAULT_FORMULAS }) {
  const rows = useMemo(() => {
    if (!Array.isArray(results)) return [];
    return results
      .map((result) => {
        const { formula, value } = computePrimaryFormula(result, formulas);
        return {
          result,
          formula,
          primaryValue: value,
          metrics: collectEvMetrics(result),
        };
      })
      .filter((entry) => typeof entry.primaryValue === "number" && entry.primaryValue > 0)
      .sort((a, b) => b.primaryValue - a.primaryValue);
  }, [results, formulas]);

  if (!rows.length) {
    return null;
  }

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-gray-900 shadow">
      <div className="border-b border-gray-800 bg-gray-950 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-200">
          Alla +EV
        </h2>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full divide-y divide-gray-800 text-sm text-gray-100">
          <thead className="bg-gray-950/60 text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Statistik</th>
              <th className="px-4 py-3 text-left font-semibold">Lag</th>
              <th className="px-4 py-3 text-left font-semibold">Period</th>
              <th className="px-4 py-3 text-left font-semibold">Spel</th>
              <th className="px-4 py-3 text-left font-semibold">Odds</th>
              <th className="px-4 py-3 text-left font-semibold">Värde</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {rows.map(({ result, metrics, primaryValue, formula }) => {
              const statName = statLabels?.[result.bet.statKey] ?? result.bet.statKey;
              const teamLabel = resolveTeamLabel(result);
              const periodLabel =
                result.bet.period === "ALL"
                  ? "Hela matchen"
                  : result.bet.period === "1ST"
                  ? "Första halvlek"
                  : "Andra halvlek";
              const direction = result.bet.direction === "över" ? "Över" : "Under";
              const extraMetrics = metrics.filter((metric) => metric.key !== formula?.metricKey);
              return (
                <tr key={result.bet.key} className="bg-gray-900/60 hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-medium text-gray-100">{statName}</td>
                  <td className="px-4 py-3 text-gray-200">{teamLabel}</td>
                  <td className="px-4 py-3 text-gray-300">{periodLabel}</td>
                  <td className="px-4 py-3 text-gray-200">
                    {direction} {result.bet.line}
                  </td>
                  <td className="px-4 py-3 text-gray-100">{result.bet.odds}</td>
                  <td className="px-4 py-3 text-green-400">
                    <div className="font-semibold">
                      {formatPercent(primaryValue)}
                      {formula?.label ? ` (${formula.label})` : ""}
                    </div>
                    {extraMetrics.map((metric) => (
                      <div key={metric.key} className="text-xs text-gray-400">
                        {formatPercent(metric.value)} ({metric.label})
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});

export default PositiveEvTable;
