"use client";

import { buildLineKey, buildMatchLabelSignature } from "@/ai/utils/matchupUtils";

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

  const renderRows = (rows) =>
    rows.length ? (
      <ol className="space-y-2">
        {rows.map((row) => {
          const comboCount = resolveCount(row);
          return (
            <li
              key={`${row.matchId}-${row.statKey}-${row.period}-${row.scope}-${row.condition}`}
              className="rounded border border-slate-800/50 bg-slate-900/70 px-3 py-2 text-xs text-slate-200"
            >
              <p className="text-[11px] uppercase text-slate-400">
                {row.league ?? "Liga"} • {row.match}
              </p>
              <p className="text-sm font-semibold text-slate-100">
                {row.statLabel ?? row.statKey ?? "Stat"} ({row.condition}) {row.period} • {row.scope}
              </p>
              <p className="text-[11px] text-slate-400">
                Score:{" "}
                <span className="font-semibold text-emerald-300">
                  {row.score?.toFixed?.(1) ?? row.score ?? "—"}
                </span>
              </p>
              {comboCount ? (
                <p className="text-[10px] text-emerald-300">
                  Found {comboCount} +EV line{comboCount === 1 ? "" : "s"}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    ) : (
      <div className="rounded border border-dashed border-slate-800 bg-slate-950/40 p-3 text-xs uppercase tracking-wider text-slate-500">
        Ingen data
      </div>
    );

  const headerInfo = generatedAt
    ? `Senast uppdaterat ${new Date(generatedAt).toLocaleString("sv-SE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      })}`
    : "Matchups-data saknas";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
        <span>Matchups – topp 20</span>
        <span>{headerInfo}</span>
      </div>
      {error ? (
        <div className="rounded border border-red-600/40 bg-red-900/30 px-3 py-2 text-xs text-red-100">
          {error.message ?? "Kunde inte hämta matchups."}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <section>
            <p className="text-[11px] uppercase tracking-wide text-emerald-300">Över</p>
            {isLoading ? (
              <div className="rounded border border-dashed border-slate-800/50 bg-slate-950/60 p-3 text-center text-xs text-slate-500">
                Laddar…
              </div>
            ) : (
              renderRows(overRows)
            )}
          </section>
          <section>
            <p className="text-[11px] uppercase tracking-wide text-purple-300">Under</p>
            {isLoading ? (
              <div className="rounded border border-dashed border-slate-800/50 bg-slate-950/60 p-3 text-center text-xs text-slate-500">
                Laddar…
              </div>
            ) : (
              renderRows(underRows)
            )}
          </section>
        </div>
      )}
    </div>
  );
}
