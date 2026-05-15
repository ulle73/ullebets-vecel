"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { isPastStockholmDate } from "@/lib/stockholmDate";

const fetcher = async (input) => {
  const response = await fetch(input);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || `HTTP ${response.status}`);
  }
  return response.json();
};

async function requireOk(response, fallbackMessage) {
  if (response.ok) return;
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload?.message || fallbackMessage || `HTTP ${response.status}`);
}

function buildTrackingKey(item) {
  return `${item.matchId}:${item.bet?.key || `${item.bet?.statKey}:${item.bet?.scope}:${item.bet?.period}:${item.bet?.line}:${item.bet?.direction}`}`;
}

function buildAlertsForItem(item, shortlistMap, clvMap) {
  const alerts = [];
  const live = shortlistMap.get(item.trackingKey);
  if (live) {
    alerts.push({ id: "live-shortlist", label: "På shortlist idag", tone: "positive" });
    if ((live.ranking?.learningAdjustment || 0) >= 3) alerts.push({ id: "live-learning", label: "Historik lyfter", tone: "positive" });
    if ((live.strategyScore || 0) >= 72) alerts.push({ id: "live-ranking", label: "Hög ranking", tone: "positive" });
  }
  const clv = clvMap.get(item.trackingKey);
  if (clv?.clvPct != null) {
    alerts.push({ id: "clv", label: clv.clvPct >= 0 ? `CLV +${clv.clvPct}%` : `CLV ${clv.clvPct}%`, tone: clv.clvPct >= 0 ? "positive" : "warning" });
  }
  if (!alerts.length) alerts.push({ id: "watching", label: "Bevakas", tone: "neutral" });
  return alerts.slice(0, 3);
}

export default function WatchlistPanel({ currentShortlist = [], date, onOpenMatch, onAlertCountChange }) {
  const [mutationError, setMutationError] = useState(null);
  const [settlementMessage, setSettlementMessage] = useState(null);
  const [isSettling, setIsSettling] = useState(false);
  const { mutate } = useSWRConfig();
  const { data, error, isLoading } = useSWR("/api/watchlist", fetcher, { revalidateOnFocus: false });
  const { data: clvData } = useSWR("/api/closing-lines?days=21&limit=120", fetcher, { revalidateOnFocus: false });

  const items = data?.items || [];
  const shortlistMap = new Map((currentShortlist || []).map((entry) => [buildTrackingKey(entry.bestBet || entry), entry.bestBet || entry]));
  const clvMap = new Map((clvData?.recent || []).map((entry) => [entry.trackingKey, entry]));
  const enriched = items.map((item) => ({ ...item, alerts: buildAlertsForItem(item, shortlistMap, clvMap) }));
  const alertCount = enriched.reduce((sum, item) => sum + item.alerts.filter((alert) => alert.tone === "positive").length, 0);
  const canManuallySettle = isPastStockholmDate(date);

  useEffect(() => {
    onAlertCountChange?.(alertCount);
  }, [alertCount, onAlertCountChange]);

  const removeFromWatchlist = async (trackingKey) => {
    try {
      setMutationError(null);
      const response = await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackingKey }),
      });
      await requireOk(response, "Kunde inte ta bort bevakningen.");
      mutate("/api/watchlist");
    } catch (err) {
      setMutationError(err?.message || "Kunde inte uppdatera watchlist.");
    }
  };

  const settleDateMatches = async () => {
    if (!canManuallySettle || !date || isSettling) return;

    try {
      setIsSettling(true);
      setMutationError(null);
      setSettlementMessage(null);
      const response = await fetch("/api/matchups-settlement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Kunde inte rätta matcher för datumet.");
      }

      await Promise.all([
        mutate("/api/watchlist"),
        mutate("/api/closing-lines?days=21&limit=120"),
        mutate(`/api/matchups-score?date=${encodeURIComponent(date)}`),
        mutate(`/api/matchups-league-avg?date=${encodeURIComponent(date)}`),
        mutate("/api/result-loop?days=180&limit=120"),
      ]);
      setSettlementMessage(payload?.message || `Rättning klar för ${date}.`);
    } catch (err) {
      setMutationError(err?.message || "Kunde inte rätta matcher för datumet.");
    } finally {
      setIsSettling(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/5 bg-[#09090b] shadow-2xl overflow-hidden">
      <div className="border-b border-white/5 bg-white/[0.02] px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-slate-100">Watchlist</h2>
            <p className="mt-2 max-w-4xl text-sm text-slate-300">Bevaka spel du vill följa under dagen. Här samlas in-app alerts när shortlist, historik eller CLV ger nya signaler.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canManuallySettle ? (
              <button
                type="button"
                onClick={settleDateMatches}
                disabled={isSettling}
                className="rounded-full border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSettling ? "Rättar…" : "Rätta alla matcher"}
              </button>
            ) : null}
            <div className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300">Alerts: {alertCount}</div>
          </div>
        </div>
      </div>

      <div className="p-4">
        {mutationError ? (
          <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">{mutationError}</div>
        ) : null}
        {settlementMessage ? (
          <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">{settlementMessage}</div>
        ) : null}
        {isLoading ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">Laddar watchlist…</div>
        ) : error ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">Kunde inte läsa watchlist: {error.message}</div>
        ) : !enriched.length ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">Inga bevakade spel ännu. Lägg till från Auto-läget för att få alerts här.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {enriched.map((item) => (
              <article key={item.trackingKey} className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{item.leagueName || "Liga"}</div>
                    <div className="mt-1 text-sm font-semibold text-white">{item.homeTeamName} vs {item.awayTeamName}</div>
                    <div className="mt-2 text-sm text-slate-300">{item.headline}</div>
                  </div>
                  <button type="button" onClick={() => removeFromWatchlist(item.trackingKey)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300">Ta bort</button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {item.alerts.map((alert) => (
                    <span key={alert.id} className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${alert.tone === "positive" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : alert.tone === "warning" ? "border-amber-500/20 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/5 text-slate-300"}`}>{alert.label}</span>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                  <span>EV {item.primaryEv >= 0 ? "+" : ""}{item.primaryEv?.toFixed?.(1) ?? item.primaryEv}%</span>
                  <span>·</span>
                  <span>Confidence {item.confidenceScore}/100</span>
                  <span>·</span>
                  <span>Ranking {item.strategyScore?.toFixed?.(1) ?? item.strategyScore}</span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => onOpenMatch?.({ id: item.matchId, matchId: item.matchId }, "backtest")} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300">Öppna match</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
