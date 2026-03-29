"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import BacktestPage from "@/components/BacktestPage";
import { buildPositiveResultsSummary } from "@/lib/backtest/resultSummary";

const fetcher = async (input) => {
  const response = await fetch(input);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || `HTTP ${response.status}`);
  }
  return response.json();
};

function buildTrackingKey(matchId, bet) {
  return `${matchId}:${bet?.key || `${bet?.statKey}:${bet?.scope}:${bet?.period}:${bet?.line}:${bet?.direction}`}`;
}

function StatBadge({ label, value, tone = "neutral" }) {
  const toneClass = tone === "positive"
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
    : tone === "accent"
      ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
        : "border-white/10 bg-white/5 text-slate-300";

  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${toneClass}`}>{label}: {value}</span>;
}

export default function BacktestPanel({ match, onSummaryChange }) {
  const [viewMode, setViewMode] = useState("auto");
  const [summary, setSummary] = useState({ count: 0, items: [], bestBet: null, unibetUrl: null });
  const { mutate } = useSWRConfig();
  const { data: rankingFeedback } = useSWR("/api/ranking-feedback?days=120&limit=500", fetcher, { revalidateOnFocus: false });
  const { data: watchlistData } = useSWR("/api/watchlist", fetcher, { revalidateOnFocus: false });
  const watchlistKeys = new Set((watchlistData?.items || []).map((item) => item.trackingKey));

  const handlePositiveResults = useCallback(
    (_match, results, unibetUrl) => {
      const nextSummary = buildPositiveResultsSummary(results, unibetUrl, { strategyId: "balanced", learningProfile: rankingFeedback || null });
      setSummary(nextSummary);
      onSummaryChange?.(nextSummary);
    },
    [onSummaryChange, rankingFeedback]
  );

  useEffect(() => {
    setSummary({ count: 0, items: [], bestBet: null, unibetUrl: null });
  }, [match?.matchId, match?.id]);

  const bestBet = summary.bestBet;
  const shortlist = summary.items.slice(1, 4);

  const toggleWatchlist = async (bet) => {
    const matchId = match?.matchId || match?.id;
    const trackingKey = buildTrackingKey(matchId, bet?.bet);
    if (watchlistKeys.has(trackingKey)) {
      await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackingKey }),
      });
    } else {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trackingKey,
          matchId,
          homeTeamName: bet?.bet?.homeTeam,
          awayTeamName: bet?.bet?.awayTeam,
          leagueName: match?.leagueName,
          headline: bet?.headline,
          strategyScore: bet?.strategyScore,
          confidenceScore: bet?.confidenceScore,
          primaryEv: bet?.primaryEv,
          bet: bet?.bet,
          proof: bet?.proof,
          eventUrl: summary?.unibetUrl,
        }),
      });
    }
    mutate("/api/watchlist");
  };

  const helperText = useMemo(() => {
    if (bestBet) return "Auto-läget visar ett toppspel först, därefter några sekundära chanser. Växla till avancerat när du vill se fler scores och mer rådata.";
    return "Kör backtesten för matchen så fylls auto-läget med ett tydligt toppspel, proof-status och watchlist-knapp.";
  }, [bestBet]);

  const bestTrackingKey = bestBet ? buildTrackingKey(match?.matchId || match?.id, bestBet.bet) : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 shadow-2xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatBadge label="Läge" value={viewMode === "auto" ? "Auto" : "Avancerat"} tone="accent" />
              <StatBadge label="Plusspel" value={summary.count} tone={summary.count > 0 ? "positive" : "neutral"} />
              {bestBet ? <StatBadge label="Proof" value={`${bestBet.proof?.proofScore || 0}/100`} tone={bestBet.proof?.historicalReady ? "positive" : "warning"} /> : null}
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-100">Backtestkort</h3>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">{helperText}</p>
            </div>
          </div>
          <div className="inline-flex items-center rounded-full border border-white/10 bg-black/30 p-1">
            <button type="button" onClick={() => setViewMode("auto")} className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] transition ${viewMode === "auto" ? "bg-cyan-500/15 text-cyan-300" : "text-slate-500 hover:text-slate-300"}`}>Auto</button>
            <button type="button" onClick={() => setViewMode("advanced")} className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] transition ${viewMode === "advanced" ? "bg-cyan-500/15 text-cyan-300" : "text-slate-500 hover:text-slate-300"}`}>Avancerat</button>
          </div>
        </div>

        {bestBet ? (
          <div className="mt-4 space-y-4">
            <article className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.06] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/80">Matchens toppspel</div>
                  <div className="mt-1 text-lg font-semibold text-white">{bestBet.headline}</div>
                  <div className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                    {bestBet.scopeLabel} · {bestBet.periodLabel} · Odds {bestBet.bet?.odds?.toFixed ? bestBet.bet.odds.toFixed(2) : bestBet.bet?.odds}
                  </div>
                  <div className="mt-2 text-sm text-slate-300">{bestBet.rationale}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Ranking</div>
                  <div className="mt-1 text-xl font-black text-cyan-300">{bestBet.strategyScore?.toFixed(1)}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <StatBadge label="EV" value={`+${bestBet.primaryEv?.toFixed(1)}%`} tone="positive" />
                <StatBadge label="Confidence" value={`${bestBet.confidenceScore}/100`} tone="positive" />
                <StatBadge label="Scope" value={bestBet.scopeLabel} tone="accent" />
                <StatBadge label="Period" value={bestBet.periodLabel} tone="accent" />
                <StatBadge label="Odds" value={bestBet.bet?.odds?.toFixed ? bestBet.bet.odds.toFixed(2) : bestBet.bet?.odds} tone="accent" />
                <StatBadge label="Historik" value={bestBet.proof?.historicalReady ? "Verifierad" : "Byggs upp"} tone={bestBet.proof?.historicalReady ? "positive" : "warning"} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => toggleWatchlist(bestBet)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300">{watchlistKeys.has(bestTrackingKey) ? "Ta bort bevakning" : "Bevaka spel"}</button>
                {summary.unibetUrl ? <a href={summary.unibetUrl} target="_blank" rel="noreferrer" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300">Oddsmarknad</a> : null}
              </div>
            </article>

            {viewMode === "advanced" ? (
              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Edge score</div><div className="mt-1 text-sm font-semibold text-white">{bestBet.ranking?.edgeScore}/100</div></div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Price score</div><div className="mt-1 text-sm font-semibold text-white">{bestBet.ranking?.priceScore}/100</div></div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Market score</div><div className="mt-1 text-sm font-semibold text-white">{bestBet.ranking?.marketScore}/100</div></div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Lärande</div><div className="mt-1 text-sm font-semibold text-white">{bestBet.ranking?.learningAdjustment > 0 ? "+" : ""}{bestBet.ranking?.learningAdjustment || 0}</div></div>
              </div>
            ) : null}

            {shortlist.length ? (
              <div className="rounded-2xl border border-white/5 bg-[#050505] p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Sekundära chanser</div>
                <div className="mt-3 grid gap-3 xl:grid-cols-3">
                  {shortlist.map((item) => (
                    <div key={item.bet.key} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-sm font-semibold text-white">{item.headline}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">{item.scopeLabel} · {item.periodLabel} · Odds {item.bet?.odds?.toFixed ? item.bet.odds.toFixed(2) : item.bet?.odds}</div>
                      <div className="mt-2 text-xs text-slate-400">EV +{item.primaryEv?.toFixed(1)}% · Ranking {item.strategyScore?.toFixed(1)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-black/20 p-3 text-sm text-slate-400">Kör backtesten för matchen så fylls auto-kortet med ett tydligt toppspel och proof-status.</div>
        )}
      </section>

      <div className="backtest-panel-shell" data-backtest-mode={viewMode}>
        <BacktestPage match={match} onPositiveResults={handlePositiveResults} />
      </div>

      <style jsx global>{`
        .backtest-panel-shell[data-backtest-mode="auto"] > section > div:last-child > div:last-child { display: none !important; }
      `}</style>
    </div>
  );
}
