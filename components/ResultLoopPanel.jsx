"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

const fetcher = async (input) => {
  const response = await fetch(input);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || `HTTP ${response.status}`);
  }
  return response.json();
};

function formatOddsValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "—";
}

async function requireOk(response, fallbackMessage) {
  if (response.ok) return;
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload?.message || fallbackMessage || `HTTP ${response.status}`);
}

function SummaryCard({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "positive"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : tone === "accent"
        ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
        : tone === "warning"
          ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
          : "border-white/10 bg-white/[0.03] text-slate-200";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-black tracking-tight">{value}</div>
    </div>
  );
}

function StatusBadge({ status, result, clvPct }) {
  const text = result || status;
  const toneClass =
    result === "win"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
      : result === "loss"
        ? "border-rose-500/20 bg-rose-500/10 text-rose-200"
        : result === "push"
          ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
          : status === "open"
            ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
            : "border-white/10 bg-white/5 text-slate-300";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${toneClass}`}>{text}</span>
      {Number.isFinite(clvPct) ? (
        <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${clvPct >= 0 ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : "border-amber-500/20 bg-amber-500/10 text-amber-200"}`}>
          CLV {clvPct >= 0 ? "+" : ""}{clvPct}%
        </span>
      ) : null}
    </div>
  );
}

export default function ResultLoopPanel({ onOpenMatch, onSummaryChange }) {
  const [mutationError, setMutationError] = useState(null);
  const { mutate } = useSWRConfig();
  const { data, error, isLoading } = useSWR("/api/result-loop?days=180&limit=120", fetcher, {
    revalidateOnFocus: false,
  });

  const summary = data?.summary || null;
  const items = data?.items || [];

  useEffect(() => {
    onSummaryChange?.(summary || { trackedBets: 0, settledBets: 0, openBets: 0, roiPct: 0 });
  }, [onSummaryChange, summary]);

  useEffect(() => {
    let cancelled = false;

    const refreshClosingLines = async () => {
      try {
        await fetcher("/api/closing-lines?days=180&limit=120");
        if (!cancelled) {
          await mutate("/api/result-loop?days=180&limit=120");
        }
      } catch {
        // Resultatloopen ska fortsätta fungera även om CLV-refresh misslyckas.
      }
    };

    void refreshClosingLines();
    return () => {
      cancelled = true;
    };
  }, [mutate]);

  const removeTrackedBet = async (trackingKey) => {
    try {
      setMutationError(null);
      const response = await fetch("/api/result-loop", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackingKey }),
      });
      await requireOk(response, "Kunde inte ta bort spelad-markeringen.");
      mutate("/api/result-loop?days=180&limit=120");
    } catch (err) {
      setMutationError(err?.message || "Kunde inte uppdatera resultatloopen.");
    }
  };

  return (
    <section className="rounded-2xl border border-white/5 bg-[#09090b] shadow-2xl overflow-hidden">
      <div className="border-b border-white/5 bg-white/[0.02] px-4 py-4">
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-slate-100">Resultatloop</h2>
        <p className="mt-2 max-w-4xl text-sm text-slate-300">
          Här knyts loopen ihop: spel markerade som tagna, vad som fortfarande är öppet, vad som avgjorts, CLV och hur utfallet ser ut över tid.
        </p>
      </div>

      <div className="p-4">
        {mutationError ? (
          <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">{mutationError}</div>
        ) : null}
        {isLoading ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">Laddar resultatloopen…</div>
        ) : error ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">Kunde inte läsa resultatloopen: {error.message}</div>
        ) : summary ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <SummaryCard label="Spelade" value={summary.trackedBets} tone="accent" />
              <SummaryCard label="Öppna" value={summary.openBets} tone={summary.openBets ? "warning" : "neutral"} />
              <SummaryCard label="Avgjorda" value={summary.settledBets} tone="accent" />
              <SummaryCard label="Win rate" value={`${summary.winRatePct}%`} tone={summary.winRatePct >= 50 ? "positive" : "neutral"} />
              <SummaryCard label="ROI" value={`${summary.roiPct >= 0 ? "+" : ""}${summary.roiPct}%`} tone={summary.roiPct >= 0 ? "positive" : "warning"} />
              <SummaryCard label="Beat close" value={`${summary.beatClosePct}%`} tone={summary.beatClosePct >= 50 ? "positive" : "neutral"} />
            </div>

            <div className="mt-4 rounded-2xl border border-white/5 bg-[#050505] p-4 shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-100">Senaste loopade spel</h3>
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Shortlist → Spelat → Utfall</span>
              </div>

              {items.length ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {items.map((item) => (
                    <article key={item.trackingKey} className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{item.leagueName || "Liga"} · {item.source || "manual"}</div>
                          <div className="mt-1 text-sm font-semibold text-white">{item.homeTeamName} vs {item.awayTeamName}</div>
                          <div className="mt-2 text-sm text-slate-300">{item.headline}</div>
                        </div>
                        <StatusBadge status={item.status} result={item.result} clvPct={item.clvPct} />
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-200">
                        <span>Sparat {formatOddsValue(item.savedOdds)}</span>
                        {Number.isFinite(Number(item.closingOdds)) ? (
                          <>
                            <span>·</span>
                            <span>Close {formatOddsValue(item.closingOdds)}</span>
                          </>
                        ) : null}
                        <span>·</span>
                        <span>Stake {item.stakeUnits || 1}u</span>
                        <span>·</span>
                        <span>EV {item.primaryEv >= 0 ? "+" : ""}{item.primaryEv?.toFixed?.(1) ?? item.primaryEv}%</span>
                        <span>·</span>
                        <span>Confidence {item.confidenceScore}/100</span>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span>{item.bet?.scope === "home" ? item.homeTeamName : item.bet?.scope === "away" ? item.awayTeamName : "Totalt"}</span>
                        <span>·</span>
                        <span>{item.bet?.period === "1ST" ? "Första halvlek" : item.bet?.period === "2ND" ? "Andra halvlek" : "Hela matchen"}</span>
                        {Number.isFinite(item.actualValue) ? (
                          <>
                            <span>·</span>
                            <span>Utfall {item.actualValue}</span>
                          </>
                        ) : null}
                        {Number.isFinite(item.pnlUnits) ? (
                          <>
                            <span>·</span>
                            <span>PnL {item.pnlUnits >= 0 ? "+" : ""}{item.pnlUnits}u</span>
                          </>
                        ) : null}
                        {item.eventTimestampMs && item.closingLineAvailable === false ? (
                          <>
                            <span>·</span>
                            <span className="text-amber-300">Saknar closing-historik</span>
                          </>
                        ) : null}
                        {item.oddsCapturedAfterStart ? (
                          <>
                            <span>·</span>
                            <span className="text-amber-300">Odds sparat efter kickoff döljs i CLV</span>
                          </>
                        ) : null}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenMatch?.({ id: item.matchId, matchId: item.matchId }, "backtest")}
                          className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300"
                        >
                          Öppna match
                        </button>
                        <button
                          type="button"
                          onClick={() => removeTrackedBet(item.trackingKey)}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300"
                        >
                          Ta bort
                        </button>
                        {item.eventUrl ? (
                          <a
                            href={item.eventUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300"
                          >
                            Oddsmarknad
                          </a>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                  Inga spel markerade ännu. Markera spel som tagna från Auto-läget eller matchkortet för att börja bygga resultatloopen.
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
