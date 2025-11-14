"use client";

export default function AIPositiveLinesPanel({ lines = [] }) {
  const sorted = [...lines].sort((a, b) => (b.primaryEv || 0) - (a.primaryEv || 0));

  return (
    <details className="rounded border border-slate-800 bg-slate-900/80 p-4 text-xs text-slate-200">
      <summary className="cursor-pointer font-semibold uppercase tracking-wide text-slate-400">
        Alla +EV-linor ({lines.length})
      </summary>
      <div className="mt-3 overflow-hidden rounded border border-slate-800 bg-slate-950/60">
        <table className="min-w-full text-left text-[11px]">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-1">Match</th>
              <th className="px-2 py-1">Stat</th>
              <th className="px-2 py-1">Direction</th>
              <th className="px-2 py-1">Odds</th>
              <th className="px-2 py-1">EV</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={`${row.matchId}-${row.betKey}`} className="border-t border-slate-900">
                <td className="px-2 py-1 font-semibold text-slate-100">{row.matchLabel}</td>
                <td className="px-2 py-1">{row.statKey ?? "Stat"}</td>
                <td className="px-2 py-1">{row.direction === "over" ? "Över" : "Under"} {row.line ?? "—"}</td>
                <td className="px-2 py-1">{row.odds?.toFixed(2) ?? "—"}x</td>
                <td className="px-2 py-1">{row.primaryEv?.toFixed(1) ?? "0"}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
