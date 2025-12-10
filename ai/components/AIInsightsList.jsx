"use client";

import { buildLineKey } from "@/lib/core/keys";
import { buildMatchLabelSignature } from "@/ai/utils/matchupUtils";

const toDirection = (row) => {
  const value = (row.condition ?? row.direction ?? "").toString().toLowerCase();
  return value.startsWith("u") ? "under" : "over";
};

const buildRowLineKey = (row) =>
  buildLineKey({
    matchId: row.matchId,
    statKey: row.statKey ?? row.statLabel,
    period: row.period,
    scope: row.scope,
    direction: toDirection(row),
  });

const buildRowLabelKey = (row) =>
  buildMatchLabelSignature({
    matchLabel: row.match ?? row.matchLabel ?? "",
    statKey: row.statKey ?? row.statLabel,
    period: row.period,
    scope: row.scope,
    direction: toDirection(row),
  });

export default function AIInsightsList({
  overRows = [],
  underRows = [],
  generatedAt,
  isLoading,
  error,
  lineCounts = new Map(),
}) {
  const resolveCount = (row) => {
    const idKey = buildRowLineKey(row);
    if (idKey && lineCounts.has(idKey)) {
      return lineCounts.get(idKey) ?? 0;
    }
    const labelKey = buildRowLabelKey(row);
    if (labelKey && lineCounts.has(labelKey)) {
      return lineCounts.get(labelKey) ?? 0;
    }
    return 0;
  };

  const renderCards = (rows, type) =>
    rows.length ? (
      <div className="flex flex-col gap-4">
        {rows.map((row) => {
          const comboCount = resolveCount(row);
          const direction = toDirection(row);
          const scewData = row.scew
            ? row.scew[direction] ?? row.scew
            : row.factor || row.scewFactor
            ? {
                factor: row.factor ?? row.scewFactor,
                winPct: row.scewWinPct,
                relBias: row.scewRelBias,
              }
            : null;
          return (
            <div
              key={`${row.matchId}-${row.statKey}-${row.period}-${row.scope}-${row.condition}`}
              className="group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 p-5 transition-all hover:border-slate-600 hover:bg-slate-900 hover:shadow-lg hover:shadow-emerald-900/10"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    {row.league ?? "Liga"}
                  </p>
                  <h4 className="text-lg font-bold text-slate-100 group-hover:text-white">
                    {row.match}
                  </h4>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="inline-flex items-center rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300">
                      {row.statLabel ?? row.statKey ?? "Stat"}
                    </span>
                    <span className="text-sm text-slate-400">
                      {row.period} • {row.scope}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex flex-col items-end">
                    <span className="text-xs text-slate-500">Score</span>
                    <span className="text-2xl font-bold text-emerald-400">
                      {row.score?.toFixed?.(1) ?? row.score ?? "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-800/50 pt-3">
                <span className={type === 'over' ? "text-sm font-bold text-emerald-400" : "text-sm font-bold text-purple-400"}>
                  {type === 'over' ? 'ÖVER' : 'UNDER'} {row.condition}
                </span>
                <div className="flex items-center gap-2">
                  {scewData?.factor != null && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-medium text-sky-300">
                      SCEW {scewData.factor?.toFixed?.(1) ?? scewData.factor}
                      {scewData.winPct != null && (
                        <span className="text-sky-400">• {scewData.winPct.toFixed?.(0) ?? scewData.winPct}%</span>
                      )}
                      {scewData.relBias != null && (
                        <span className="text-sky-400">• Δ{scewData.relBias.toFixed?.(1) ?? scewData.relBias}%</span>
                      )}
                    </span>
                  )}
                  {comboCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      {comboCount} +EV Lines
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-950/30 text-sm text-slate-500">
        Inga {type === 'over' ? 'överspel' : 'underspel'} hittades
      </div>
    );

  const headerInfo = generatedAt
    ? `Uppdaterad ${new Date(generatedAt).toLocaleString("sv-SE", {
      hour: "2-digit",
      minute: "2-digit",
    })}`
    : "";

  if (error) {
    return (
      <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-6 text-center text-red-200">
        <p className="font-semibold">Kunde inte hämta analyser</p>
        <p className="text-sm opacity-70">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {headerInfo && (
        <div className="mb-6 flex justify-end">
          <span className="text-xs text-slate-500">{headerInfo}</span>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Left Column: Over Games */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 pb-2 border-b border-slate-800">
            <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
            <h3 className="text-lg font-bold text-slate-200">Överspel</h3>
          </div>
          {isLoading ? (
            <div className="space-y-4 animate-pulse">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-40 rounded-xl bg-slate-900/50 border border-slate-800" />
              ))}
            </div>
          ) : (
            renderCards(overRows, 'over')
          )}
        </section>

        {/* Right Column: Under Games */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 pb-2 border-b border-slate-800">
            <div className="h-2 w-2 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]" />
            <h3 className="text-lg font-bold text-slate-200">Underspel</h3>
          </div>
          {isLoading ? (
            <div className="space-y-4 animate-pulse">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-40 rounded-xl bg-slate-900/50 border border-slate-800" />
              ))}
            </div>
          ) : (
            renderCards(underRows, 'under')
          )}
        </section>
      </div>
    </div>
  );
}
