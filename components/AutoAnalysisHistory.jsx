"use client";

import useSWR from "swr";

const fetcher = async (input) => {
  const response = await fetch(input);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || `HTTP ${response.status}`);
  }
  return response.json();
};

function MetricCard({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "positive"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : tone === "accent"
        ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
        : "border-white/10 bg-white/[0.03] text-slate-200";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-70">
        {label}
      </div>
      <div className="mt-2 text-2xl font-black tracking-tight">
        {value}
      </div>
    </div>
  );
}

function BucketTable({ title, rows = [], valueLabel }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-[#050505] p-4 shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-100">
          {title}
        </h3>
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
          {valueLabel}
        </span>
      </div>

      {rows.length ? (
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <div key={row.key} className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white">{row.key}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {row.bets} bets · {row.winRatePct}% träff · avg EV {row.avgEv >= 0 ? "+" : ""}{row.avgEv}%
                  </div>
                </div>
                <div className={`text-sm font-black ${row.roiPct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {row.roiPct >= 0 ? "+" : ""}{row.roiPct}%
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
          Ingen historik ännu.
        </div>
      )}
    </div>
  );
}

export default function AutoAnalysisHistory({ onOpenMatch }) {
  const { data, error, isLoading } = useSWR("/api/analysis-eval?days=60&limit=300", fetcher, {
    revalidateOnFocus: false,
  });

  const summary = data?.summary || null;
  const recentSettled = data?.recentSettled || [];
  const byStrategy = data?.byStrategy || [];
  const byStat = data?.byStat || [];
  const byLeague = data?.byLeague || [];

  return (
    <section className="rounded-2xl border border-white/5 bg-[#09090b] shadow-2xl overflow-hidden">
      <div className="border-b border-white/5 bg-white/[0.02] px-4 py-4">
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-slate-100">
          Historik & eval
        </h2>
        <p className="mt-2 max-w-4xl text-sm text-slate-300">
          Här syns hur shortlistade spel faktiskt har gått över tid baserat på sparade autoanalys-snapshots och avslutade matcher.
        </p>
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
            Laddar historik…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
            Kunde inte läsa historiken: {error.message}
          </div>
        ) : summary ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard label="Settlade spel" value={summary.settledBets} tone="accent" />
              <MetricCard label="Win rate" value={`${summary.winRatePct}%`} tone={summary.winRatePct >= 50 ? "positive" : "neutral"} />
              <MetricCard label="ROI" value={`${summary.roiPct >= 0 ? "+" : ""}${summary.roiPct}%`} tone={summary.roiPct >= 0 ? "positive" : "neutral"} />
              <MetricCard label="Avg EV" value={`${summary.avgEv >= 0 ? "+" : ""}${summary.avgEv}%`} tone={summary.avgEv >= 0 ? "positive" : "neutral"} />
              <MetricCard label="Avg confidence" value={`${summary.avgConfidence}/100`} tone="accent" />
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
              <span>Snapshots: {summary.snapshots}</span>
              <span>·</span>
              <span>Deduperade bets: {summary.dedupedBets}</span>
              <span>·</span>
              <span>Osettlade: {summary.unsettledBets}</span>
              <span>·</span>
              <span>Duplicat bortfiltrerade: {summary.duplicateSnapshotsSkipped}</span>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              <BucketTable title="Bäst per strategi" rows={byStrategy} valueLabel="ROI" />
              <BucketTable title="Bäst per stat" rows={byStat} valueLabel="ROI" />
              <BucketTable title="Bäst per liga" rows={byLeague} valueLabel="ROI" />
            </div>

            <div className="mt-4 rounded-2xl border border-white/5 bg-[#050505] p-4 shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-100">
                  Senast settled
                </h3>
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  20 senaste
                </span>
              </div>

              {recentSettled.length ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {recentSettled.map((entry) => (
                    <article
                      key={`${entry.strategyId}:${entry.matchId}:${entry.bet?.key || entry.headline}`}
                      className="rounded-xl border border-white/5 bg-white/[0.03] p-3"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                            {entry.leagueName || "Liga"} · {entry.strategyLabel || entry.strategyId || "Strategi"}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-white">
                            {entry.homeTeamName} vs {entry.awayTeamName}
                          </div>
                          <div className="mt-2 text-sm text-slate-300">
                            {entry.headline}
                          </div>
                        </div>
                        <div className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
                          entry.result === "win"
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                            : entry.result === "loss"
                              ? "border-rose-500/20 bg-rose-500/10 text-rose-200"
                              : "border-amber-500/20 bg-amber-500/10 text-amber-200"
                        }`}>
                          {entry.result}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                        <span>Utfall: {Number.isFinite(entry.actualValue) ? entry.actualValue : "—"}</span>
                        <span>·</span>
                        <span>EV {entry.primaryEv >= 0 ? "+" : ""}{entry.primaryEv?.toFixed?.(1) ?? entry.primaryEv}%</span>
                        <span>·</span>
                        <span>ROI {entry.roiUnits >= 0 ? "+" : ""}{entry.roiUnits}</span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenMatch?.({ id: entry.matchId, matchId: entry.matchId }, "backtest")}
                          className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300"
                        >
                          Öppna match
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                  Inga settled spel ännu. Kör autoanalysen några dagar så byggs historiken upp automatiskt.
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
