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

function Panel({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-[#050505] p-4 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{subtitle}</div>
          <h3 className="mt-1 text-sm font-black uppercase tracking-[0.18em] text-slate-100">{title}</h3>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function PrimaryLine({ label, value, tone = "neutral" }) {
  const toneClass = tone === "positive" ? "text-emerald-300" : tone === "warning" ? "text-amber-200" : "text-cyan-300";
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-black ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function DashboardCockpit({ autoState, watchlistAlertCount = 0, onOpenMatch }) {
  const { data: evalData } = useSWR("/api/analysis-eval?days=30&limit=250", fetcher, { revalidateOnFocus: false });
  const { data: clvData } = useSWR("/api/closing-lines?days=7&limit=80", fetcher, { revalidateOnFocus: false });
  const { data: rankingFeedback } = useSWR("/api/ranking-feedback?days=90&limit=400", fetcher, { revalidateOnFocus: false });

  const shortlist = autoState?.shortlist || [];
  const bestOverall = autoState?.bestOverall || null;
  const mostProven = [...shortlist].sort((a, b) => (b.bestBet?.proof?.proofScore || 0) - (a.bestBet?.proof?.proofScore || 0))[0]?.bestBet || null;
  const highestEdge = [...shortlist].sort((a, b) => (b.bestBet?.primaryEv || 0) - (a.bestBet?.primaryEv || 0))[0]?.bestBet || null;
  const mostRisky = [...shortlist].sort((a, b) => (b.bestBet?.riskScore || 0) - (a.bestBet?.riskScore || 0))[0]?.bestBet || null;
  const bestStrategy = evalData?.byStrategy?.[0] || null;
  const clvSummary = clvData?.summary || null;
  const avoidBucket = [...(rankingFeedback?.leaders?.stat || [])].reverse().find((item) => Number(item.adjustment) < 0) || null;

  return (
    <section className="rounded-2xl border border-white/5 bg-[#09090b] shadow-2xl overflow-hidden">
      <div className="border-b border-white/5 bg-white/[0.02] px-4 py-4">
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-slate-100">Cockpit</h2>
        <p className="mt-2 max-w-4xl text-sm text-slate-300">
          Ett snabbcenter för dagens bästa spel, bevisnivå, watchlist-alerts och vad motorn säger att du bör fokusera på just nu.
        </p>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <Panel title="Dagens toppspel" subtitle="Live snapshot">
          {bestOverall ? (
            <div className="space-y-3">
              <div>
                <div className="text-base font-semibold text-white">{bestOverall.headline}</div>
                <div className="mt-1 text-sm text-slate-300">{bestOverall.rationale}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <PrimaryLine label="EV" value={`+${bestOverall.primaryEv?.toFixed(1)}%`} tone="positive" />
                <PrimaryLine label="Confidence" value={`${bestOverall.confidenceScore}/100`} />
                <PrimaryLine label="Ranking" value={bestOverall.strategyScore?.toFixed(1)} />
              </div>
              <button
                type="button"
                onClick={() => onOpenMatch?.({ id: bestOverall.matchId, matchId: bestOverall.matchId }, "backtest")}
                className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300"
              >
                Öppna toppspel
              </button>
            </div>
          ) : (
            <div className="text-sm text-slate-400">Kör dagens autoanalys för att fylla cockpit med livekandidater.</div>
          )}
        </Panel>

        <Panel title="Mest bevisade idag" subtitle="Proof-first">
          {mostProven ? (
            <div className="space-y-3">
              <div className="text-base font-semibold text-white">{mostProven.headline}</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <PrimaryLine label="Proof" value={`${mostProven.proof?.proofScore || 0}/100`} tone={mostProven.proof?.proofScore >= 70 ? "positive" : "warning"} />
                <PrimaryLine label="Historik" value={mostProven.proof?.historicalReady ? "Verifierad" : "Byggs upp"} tone={mostProven.proof?.historicalReady ? "positive" : "warning"} />
                <PrimaryLine label="Sample" value={`${mostProven.sampleSize || 0} matcher`} />
              </div>
              <div className="text-sm text-slate-300">{mostProven.rationale}</div>
            </div>
          ) : (
            <div className="text-sm text-slate-400">Inget bevisat case ännu idag.</div>
          )}
        </Panel>

        <Panel title="Högst edge idag" subtitle="Aggressiv vy">
          {highestEdge ? (
            <div className="space-y-3">
              <div className="text-base font-semibold text-white">{highestEdge.headline}</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <PrimaryLine label="Edge" value={`+${highestEdge.primaryEv?.toFixed(1)}%`} tone="positive" />
                <PrimaryLine label="Odds" value={highestEdge.bet?.odds?.toFixed ? highestEdge.bet.odds.toFixed(2) : highestEdge.bet?.odds} />
                <PrimaryLine label="Risk" value={highestEdge.riskScore || 0} tone={(highestEdge.riskScore || 0) <= 2 ? "positive" : "warning"} />
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-400">Ingen edge-data ännu.</div>
          )}
        </Panel>

        <Panel title="Watchlist & marknadsläge" subtitle="Operativt">
          <div className="grid gap-3 sm:grid-cols-2">
            <PrimaryLine label="Watchlist-alerts" value={watchlistAlertCount} tone={watchlistAlertCount > 0 ? "positive" : "warning"} />
            <PrimaryLine label="Beat close 7d" value={clvSummary?.beatClosePct != null ? `${clvSummary.beatClosePct}%` : "—"} tone={Number(clvSummary?.beatClosePct) >= 50 ? "positive" : "warning"} />
            <PrimaryLine label="Avg CLV 7d" value={clvSummary?.avgClv != null ? `${clvSummary.avgClv >= 0 ? "+" : ""}${clvSummary.avgClv}%` : "—"} tone={Number(clvSummary?.avgClv) >= 0 ? "positive" : "warning"} />
            <PrimaryLine label="Bäst strategi 30d" value={bestStrategy ? `${bestStrategy.key} (${bestStrategy.roiPct >= 0 ? "+" : ""}${bestStrategy.roiPct}%)` : "—"} tone={bestStrategy?.roiPct >= 0 ? "positive" : "warning"} />
          </div>
          {avoidBucket || mostRisky ? (
            <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-sm text-slate-300">
              {avoidBucket ? `Marknad att vara försiktig med just nu: ${avoidBucket.key} (${avoidBucket.adjustment} i lärandejustering).` : `Mest riskfyllda topplacering idag: ${mostRisky?.headline}.`}
            </div>
          ) : null}
        </Panel>
      </div>
    </section>
  );
}
