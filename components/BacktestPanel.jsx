"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BacktestPage from "@/components/BacktestPage";
import { buildPositiveResultsSummary } from "@/lib/backtest/resultSummary";

function StatBadge({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "positive"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : tone === "accent"
        ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
        : "border-white/10 bg-white/5 text-slate-300";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${toneClass}`}
    >
      {label}: {value}
    </span>
  );
}

export default function BacktestPanel({ match, onSummaryChange }) {
  const [viewMode, setViewMode] = useState("auto");
  const [summary, setSummary] = useState({
    count: 0,
    items: [],
    bestBet: null,
    unibetUrl: null,
  });

  const handlePositiveResults = useCallback(
    (_match, results, unibetUrl) => {
      const nextSummary = buildPositiveResultsSummary(results, unibetUrl);
      setSummary(nextSummary);
      if (typeof onSummaryChange === "function") {
        onSummaryChange(nextSummary);
      }
    },
    [onSummaryChange]
  );

  useEffect(() => {
    setSummary({
      count: 0,
      items: [],
      bestBet: null,
      unibetUrl: null,
    });
  }, [match?.matchId, match?.id]);

  const bestBet = summary.bestBet;
  const helperText = useMemo(() => {
    if (bestBet) {
      return `Bästa autospelet just nu är ${bestBet.headline.toLowerCase()} med EV +${bestBet.primaryEv?.toFixed(1)}%.`;
    }
    return "Auto-läget visar shortlistan och gömmer hela linjegridden tills du vill gräva djupare.";
  }, [bestBet]);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 shadow-2xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatBadge
                label="Läge"
                value={viewMode === "auto" ? "Auto" : "Avancerat"}
                tone="accent"
              />
              <StatBadge
                label="Plusspel"
                value={summary.count}
                tone={summary.count > 0 ? "positive" : "neutral"}
              />
              {bestBet ? (
                <StatBadge
                  label="Confidence"
                  value={`${bestBet.confidenceScore}/100`}
                  tone="positive"
                />
              ) : null}
            </div>

            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-100">
                Backtestkort
              </h3>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                {helperText}
              </p>
            </div>

            {bestBet ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.08] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300/80">
                    Auto-förslag
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {bestBet.headline}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Scope
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {bestBet.scopeLabel}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    EV
                  </div>
                  <div className="mt-1 text-sm font-semibold text-emerald-300">
                    +{bestBet.primaryEv?.toFixed(1)}%
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Konsensus
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {bestBet.agreementPct}% · {bestBet.agreementLabel}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-3 text-sm text-slate-400">
                Kör backtesten för matchen så fylls auto-kortet med bästa spel, confidence och modellkonsensus.
              </div>
            )}
          </div>

          <div className="inline-flex items-center rounded-full border border-white/10 bg-black/30 p-1">
            <button
              type="button"
              onClick={() => setViewMode("auto")}
              className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] transition ${
                viewMode === "auto"
                  ? "bg-cyan-500/15 text-cyan-300"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Auto
            </button>
            <button
              type="button"
              onClick={() => setViewMode("advanced")}
              className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] transition ${
                viewMode === "advanced"
                  ? "bg-cyan-500/15 text-cyan-300"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Avancerat
            </button>
          </div>
        </div>
      </section>

      <div className="backtest-panel-shell" data-backtest-mode={viewMode}>
        <BacktestPage match={match} onPositiveResults={handlePositiveResults} />
      </div>

      <style jsx global>{`
        .backtest-panel-shell[data-backtest-mode="auto"] > section > div:last-child > div:last-child {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
