"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { buildTrackingKey } from "@/lib/autoAnalysis/store";
import { STRATEGY_PROFILES, getStrategyProfile } from "@/lib/backtest/resultSummary";

const DEFAULT_VISIBLE_SCORE = {
  safe: 92,
  balanced: 90,
  aggressive: 85,
  corners: 90,
  shots: 90,
};

function createEmptyState() {
  return {
    run: null,
    bestOverall: null,
    shortlist: [],
    candidates: [],
    summary: {
      shortlistCount: 0,
      provenCount: 0,
      candidateCount: 0,
      qualifyingCandidateCount: 0,
      marketCount: 0,
    },
  };
}

function getDefaultVisibleScore(strategyId) {
  return DEFAULT_VISIBLE_SCORE[strategyId] || 90;
}

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

function MetricBadge({ label, value, tone = "neutral" }) {
  const toneClass = tone === "positive"
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
    : tone === "accent"
      ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
        : "border-white/10 bg-white/5 text-slate-300";

  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] ${toneClass}`}>{label}: {value}</span>;
}

function buildMatchLinkPayload(entry) {
  return {
    id: entry?.matchId,
    matchId: entry?.matchId,
    homeTeamName: entry?.homeTeamName,
    awayTeamName: entry?.awayTeamName,
    leagueName: entry?.leagueName,
  };
}

export default function DailyAutoAnalysis({ date, matches = [], onOpenMatch, onAutoStateChange }) {
  const [strategyId, setStrategyId] = useState("balanced");
  const [serverState, setServerState] = useState(createEmptyState);
  const [visibleMinScore, setVisibleMinScore] = useState(getDefaultVisibleScore("balanced"));
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const { mutate } = useSWRConfig();

  const strategyProfile = getStrategyProfile(strategyId);
  const { data: rankingFeedback } = useSWR("/api/ranking-feedback?days=120&limit=500", fetcher, { revalidateOnFocus: false });
  const { data: watchlistData } = useSWR("/api/watchlist", fetcher, { revalidateOnFocus: false });
  const { data: resultLoopData } = useSWR("/api/result-loop?days=180&limit=120", fetcher, { revalidateOnFocus: false });
  const watchlistKeys = new Set((watchlistData?.items || []).map((item) => item.trackingKey));
  const resultLoopKeys = new Set((resultLoopData?.items || []).map((item) => item.trackingKey));

  useEffect(() => {
    setServerState(createEmptyState());
    setError(null);
  }, [date]);

  useEffect(() => {
    setVisibleMinScore(getDefaultVisibleScore(strategyId));
    setServerState(createEmptyState());
    setError(null);
  }, [strategyId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const derived = useMemo(() => {
    const shortlist = Array.isArray(serverState?.shortlist) ? serverState.shortlist : [];
    return {
      run: serverState?.run || null,
      shortlist,
      candidates: Array.isArray(serverState?.candidates) ? serverState.candidates : [],
      bestOverall: serverState?.bestOverall || shortlist[0]?.bestBet || null,
      summary: {
        shortlistCount: Number(serverState?.summary?.shortlistCount) || shortlist.length,
        provenCount: Number(serverState?.summary?.provenCount) || shortlist.filter((entry) => entry?.bestBet?.proof?.historicalReady).length,
        candidateCount: Number(serverState?.summary?.candidateCount) || 0,
        qualifyingCandidateCount: Number(serverState?.summary?.qualifyingCandidateCount) || 0,
        marketCount: Number(serverState?.summary?.marketCount) || 0,
      },
    };
  }, [serverState]);

  useEffect(() => {
    onAutoStateChange?.({
      ...derived,
      candidateFeed: derived.candidates,
    });
  }, [derived, onAutoStateChange]);

  const runAnalysis = useCallback(async () => {
    if (!matches.length) {
      setServerState(createEmptyState());
      setError("Inga matcher att analysera för valt datum.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setError(null);

    try {
      const response = await fetch("/api/auto-analysis-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date,
          strategyId,
          strategyLabel: strategyProfile.label,
          matches,
          learningProfile: rankingFeedback || null,
          source: "manual-ui",
        }),
        signal: controller.signal,
      });
      await requireOk(response, "Kunde inte köra autoanalysen.");
      const payload = await response.json();
      if (!controller.signal.aborted) {
        setServerState({
          run: payload?.run || null,
          bestOverall: payload?.bestOverall || null,
          shortlist: Array.isArray(payload?.shortlist) ? payload.shortlist : [],
          candidates: Array.isArray(payload?.candidates) ? payload.candidates : [],
          summary: payload?.summary || createEmptyState().summary,
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err?.message || "Autoanalysen misslyckades.");
      }
    } finally {
      if (!controller.signal.aborted) setIsRunning(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [date, matches, rankingFeedback, strategyId, strategyProfile.label]);

  const toggleWatchlist = async (entry) => {
    try {
      setError(null);
      const trackingKey = entry?.trackingKey || buildTrackingKey(entry.matchId, entry.bet);
      if (watchlistKeys.has(trackingKey)) {
        const response = await fetch("/api/watchlist", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trackingKey }),
        });
        await requireOk(response, "Kunde inte ta bort bevakningen.");
      } else {
        const response = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            trackingKey,
            matchId: entry.matchId,
            homeTeamName: entry.bet?.homeTeam,
            awayTeamName: entry.bet?.awayTeam,
            leagueName: entry.leagueName,
            headline: entry.headline,
            strategyScore: entry.strategyScore,
            confidenceScore: entry.confidenceScore,
            primaryEv: entry.primaryEv,
            eventUrl: entry.eventUrl,
            bet: entry.bet,
            proof: entry.proof,
          }),
        });
        await requireOk(response, "Kunde inte lägga spelet i watchlist.");
      }
      mutate("/api/watchlist");
    } catch (err) {
      setError(err?.message || "Kunde inte uppdatera watchlist.");
    }
  };

  const toggleTaken = async (entry) => {
    try {
      setError(null);
      const trackingKey = entry?.trackingKey || buildTrackingKey(entry.matchId, entry.bet);
      if (resultLoopKeys.has(trackingKey)) {
        const response = await fetch("/api/result-loop", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trackingKey }),
        });
        await requireOk(response, "Kunde inte ta bort spelad-markeringen.");
      } else {
        const response = await fetch("/api/result-loop", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            trackingKey,
            matchId: entry.matchId,
            homeTeamName: entry.bet?.homeTeam,
            awayTeamName: entry.bet?.awayTeam,
            leagueName: entry.leagueName,
            headline: entry.headline,
            strategyScore: entry.strategyScore,
            confidenceScore: entry.confidenceScore,
            primaryEv: entry.primaryEv,
            bet: entry.bet,
            proof: entry.proof,
            ranking: entry.ranking,
            timestamp: entry.timestamp ?? null,
            eventUrl: entry.eventUrl || null,
            source: "auto",
            stakeUnits: 1,
          }),
        });
        await requireOk(response, "Kunde inte markera spelet som spelat.");
      }
      mutate("/api/result-loop?days=180&limit=120");
    } catch (err) {
      setError(err?.message || "Kunde inte uppdatera resultatloopen.");
    }
  };

  const bestOverall = derived.bestOverall;
  const bestOverallEntry = derived.shortlist.find((entry) => entry?.bestBet?.trackingKey === bestOverall?.trackingKey) || derived.shortlist[0] || null;
  const bestTracked = bestOverall ? resultLoopKeys.has(bestOverall.trackingKey || buildTrackingKey(bestOverall.matchId, bestOverall.bet)) : false;

  const visibleCandidates = useMemo(
    () =>
      derived.candidates
        .filter((entry) => (entry?.strategyScore || 0) >= visibleMinScore)
        .sort((a, b) => (b?.strategyScore || 0) - (a?.strategyScore || 0) || (b?.primaryEv || 0) - (a?.primaryEv || 0)),
    [derived.candidates, visibleMinScore]
  );

  const visibleSecondary = useMemo(
    () => visibleCandidates.filter((entry) => entry.trackingKey !== bestOverall?.trackingKey),
    [bestOverall?.trackingKey, visibleCandidates]
  );

  const helperText = useMemo(() => {
    if (isRunning) return `Servern kör autoanalysen för ${matches.length} matcher enligt ${strategyProfile.label.toLowerCase()}-profilen och sparar alla evaluerade spel.`;
    if (derived.bestOverall) return "Toppspelet visas först. Under det ser du alla kvalificerade spel över vald rankinggräns, medan full kandidatdata sparas för senare backtest och filtrering.";
    return "Kör dagens autoanalys för att spara alla evaluerade spel, få ett toppspel direkt och samtidigt bygga en full databaskälla för senare filter/backtest.";
  }, [derived.bestOverall, isRunning, matches.length, strategyProfile.label]);

  const scoreFilters = [85, 90, 95];

  return (
    <section className="overflow-hidden rounded-2xl border border-white/5 bg-[#09090b] shadow-2xl">
      <div className="border-b border-white/5 bg-white/[0.02] px-4 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <MetricBadge label="Datum" value={date || "—"} tone="accent" />
              <MetricBadge label="Matcher" value={matches.length} />
              <MetricBadge label="Shortlist" value={derived.summary.shortlistCount} tone={derived.summary.shortlistCount ? "positive" : "neutral"} />
              <MetricBadge label="Kvalificerade spel" value={derived.summary.qualifyingCandidateCount} tone={derived.summary.qualifyingCandidateCount ? "positive" : "neutral"} />
              <MetricBadge label="Proof-klara" value={derived.summary.provenCount} tone={derived.summary.provenCount ? "positive" : "warning"} />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.18em] text-slate-100">Dagens autoanalys</h2>
              <p className="mt-2 max-w-4xl text-sm text-slate-300">{helperText}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={runAnalysis}
            disabled={isRunning || !matches.length}
            className="inline-flex items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10 px-5 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300 transition hover:bg-cyan-500/15 disabled:opacity-40"
          >
            {isRunning ? "Kör analys…" : derived.shortlist.length ? "Kör om dagens autoanalys" : "Kör dagens autoanalys"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {Object.values(STRATEGY_PROFILES).map((profile) => {
            const active = strategyId === profile.id;
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => setStrategyId(profile.id)}
                className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] transition ${active ? "border-cyan-500/20 bg-cyan-500/15 text-cyan-300" : "border-white/10 bg-white/5 text-slate-400 hover:text-slate-200"}`}
              >
                {profile.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4">
        {error ? <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {isRunning ? (
          <div className="mb-4 overflow-hidden rounded-full border border-white/10 bg-black/30">
            <div className="h-2 animate-pulse bg-cyan-400/70" style={{ width: "100%" }} />
          </div>
        ) : null}

        {!derived.shortlist.length && !isRunning ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
            Auto-läget väntar på analys. När körningen är klar sparas alla evaluerade spel i databasen och du får både ett toppspel och en filtrerbar feed direkt här.
          </div>
        ) : null}

        {bestOverall ? (
          <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
            <article className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.06] p-5 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/80">Dagens toppspel</div>
                  <div className="mt-1 text-sm font-semibold text-cyan-100">
                    {bestOverallEntry?.match?.homeTeamName || bestOverall.homeTeamName || bestOverall.bet?.homeTeam} vs {bestOverallEntry?.match?.awayTeamName || bestOverall.awayTeamName || bestOverall.bet?.awayTeam}
                  </div>
                  <div className="mt-2 text-xl font-semibold text-white">{bestOverall.headline}</div>
                  <div className="mt-2 text-sm text-slate-300">{bestOverall.rationale}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Ranking</div>
                  <div className="mt-1 text-2xl font-black text-cyan-300">{bestOverall.strategyScore?.toFixed(1)}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <MetricBadge label="Liga" value={bestOverallEntry?.match?.leagueName || bestOverall.leagueName || "—"} />
                <MetricBadge label="EV" value={`${bestOverall.primaryEv >= 0 ? "+" : ""}${bestOverall.primaryEv?.toFixed(1)}%`} tone="positive" />
                <MetricBadge label="Confidence" value={`${bestOverall.confidenceScore}/100`} tone="positive" />
                <MetricBadge label="Proof" value={`${bestOverall.proof?.proofScore || 0}/100`} tone={bestOverall.proof?.historicalReady ? "positive" : "warning"} />
                <MetricBadge label="Loop" value={bestTracked ? "Spelad" : "Ej spelad"} tone={bestTracked ? "positive" : "neutral"} />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Odds</div>
                  <div className="mt-1 text-sm font-semibold text-white">{bestOverall.bet?.odds?.toFixed ? bestOverall.bet.odds.toFixed(2) : bestOverall.bet?.odds}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Sample</div>
                  <div className="mt-1 text-sm font-semibold text-white">{bestOverall.sampleSize} matcher</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Källspel</div>
                  <div className="mt-1 text-sm font-semibold text-white">{bestOverall.isBestBetForMatch ? "Bäst i matchen" : "Kvalificerat spel"}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(bestOverall.rankReasons || []).map((reason) => (
                  <span key={reason.id} className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${reason.tone === "warning" ? "border-amber-500/20 bg-amber-500/10 text-amber-200" : "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"}`}>{reason.label}</span>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => onOpenMatch?.(buildMatchLinkPayload(bestOverall), "backtest")} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300">Öppna full analys</button>
                <button type="button" onClick={() => toggleWatchlist(bestOverall)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300">{watchlistKeys.has(bestOverall.trackingKey || buildTrackingKey(bestOverall.matchId, bestOverall.bet)) ? "Ta bort bevakning" : "Bevaka spel"}</button>
                <button type="button" onClick={() => toggleTaken(bestOverall)} className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-300">{bestTracked ? "Ta bort spelad" : "Markera spelad"}</button>
              </div>
            </article>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/5 bg-[#050505] p-4 shadow-xl">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Alla spel över vald ranking</div>
                    <div className="mt-1 text-sm text-slate-300">Kvalificerade spel sparade från körningen. Default i `Balans` är 90.</div>
                  </div>
                  <MetricBadge label="Visas" value={visibleCandidates.length} tone={visibleCandidates.length ? "positive" : "neutral"} />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {scoreFilters.map((score) => {
                    const active = visibleMinScore === score;
                    return (
                      <button
                        key={score}
                        type="button"
                        onClick={() => setVisibleMinScore(score)}
                        className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] transition ${active ? "border-cyan-500/20 bg-cyan-500/15 text-cyan-300" : "border-white/10 bg-white/5 text-slate-400 hover:text-slate-200"}`}
                      >
                        Score {score}+
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 max-h-[740px] space-y-3 overflow-y-auto pr-1">
                  {visibleSecondary.length ? visibleSecondary.map((entry) => {
                    const tracked = resultLoopKeys.has(entry.trackingKey || buildTrackingKey(entry.matchId, entry.bet));
                    const watched = watchlistKeys.has(entry.trackingKey || buildTrackingKey(entry.matchId, entry.bet));
                    return (
                      <div key={entry.trackingKey || `${entry.matchId}:${entry.bet?.key}`} className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{entry.leagueName || "Okänd liga"}</div>
                            <div className="mt-1 text-sm font-semibold text-white">{entry.homeTeamName || entry.bet?.homeTeam} vs {entry.awayTeamName || entry.bet?.awayTeam}</div>
                            <div className="mt-1 text-sm text-slate-200">{entry.headline}</div>
                            <div className="mt-1 text-xs text-slate-400">{entry.scopeLabel} · {entry.periodLabel} · Odds {entry.bet?.odds?.toFixed ? entry.bet.odds.toFixed(2) : entry.bet?.odds}</div>
                          </div>
                          <div className="text-sm font-black text-cyan-300">{entry.strategyScore?.toFixed(1)}</div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <MetricBadge label="EV" value={`${entry.primaryEv >= 0 ? "+" : ""}${entry.primaryEv?.toFixed(1)}%`} tone="positive" />
                          <MetricBadge label="Confidence" value={`${entry.confidenceScore}/100`} tone="positive" />
                          <MetricBadge label="Proof" value={`${entry.proof?.proofScore || 0}/100`} tone={entry.proof?.historicalReady ? "positive" : "warning"} />
                          <MetricBadge label="Matchspel" value={entry.isBestBetForMatch ? "Bäst i matchen" : "Extra marknad"} tone={entry.isBestBetForMatch ? "accent" : "neutral"} />
                          <MetricBadge label="Loop" value={tracked ? "Spelad" : "Ej spelad"} tone={tracked ? "positive" : "neutral"} />
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => onOpenMatch?.(buildMatchLinkPayload(entry), "backtest")} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">Öppna</button>
                          <button type="button" onClick={() => toggleWatchlist(entry)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300">{watched ? "Bevakas" : "Bevaka"}</button>
                          <button type="button" onClick={() => toggleTaken(entry)} className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">{tracked ? "Spelad" : "Markera spelad"}</button>
                        </div>
                      </div>
                    );
                  }) : <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-3 text-sm text-slate-400">Inga fler kvalificerade spel över score {visibleMinScore} för vald körning.</div>}
                </div>
              </div>

              <div className="rounded-2xl border border-white/5 bg-[#050505] p-4 shadow-xl">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Proof thresholds</div>
                <div className="mt-3 space-y-2 text-sm text-slate-300">
                  <div>• Minst {strategyProfile.minSampleSize} matcher i sample för att få komma med.</div>
                  <div>• Minst {strategyProfile.minConfidence} i confidence och {strategyProfile.minAgreementPct}% modellkonsensus.</div>
                  <div>• Alla evaluerade spel sparas i databasen, även sådana som inte visas här.</div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
