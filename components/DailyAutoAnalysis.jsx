"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import mapUnibetOdds from "@/components/backtest/unibetOddsMapper";
import {
  STRATEGY_PROFILES,
  buildPositiveResultsSummary,
  getStrategyProfile,
  matchesStrategyFilters,
  normalizeBatchResult,
  scoreResultForStrategy,
} from "@/lib/backtest/resultSummary";

const MAX_CONCURRENCY = 2;
const MAX_BETS_PER_MATCH = 120;

const fetcher = async (input) => {
  const response = await fetch(input);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || `HTTP ${response.status}`);
  }
  return response.json();
};

async function postBacktest(body, signal) {
  const response = await fetch("/api/backtest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || `HTTP ${response.status}`);
  }

  return response.json();
}

function buildTrackingKey(matchId, bet) {
  return `${matchId}:${bet?.key || `${bet?.statKey}:${bet?.scope}:${bet?.period}:${bet?.line}:${bet?.direction}`}`;
}

function buildMatchLookupPayload(match) {
  return {
    action: "auto-unibet-odds",
    matchId: match?.matchId || match?.id || null,
    eventId: match?.eventId || match?.raw?.event?.id || match?.raw?.eventId || null,
    homeTeam: match?.homeTeamName,
    awayTeam: match?.awayTeamName,
    leagueName: match?.leagueName,
    timestamp: match?.timestamp,
    start: match?.raw?.event?.start || null,
  };
}

function buildBatchBets(match, tuples) {
  const unique = new Map();

  for (const tuple of Array.isArray(tuples) ? tuples : []) {
    const base = {
      homeTeam: match?.homeTeamName,
      awayTeam: match?.awayTeamName,
      line: tuple.line,
      scope: tuple.scope,
      stat: tuple.statKey,
      period: tuple.period,
      form: "all",
      neutralGround: false,
      home_importance: 5,
      away_importance: 5,
    };

    if (Number.isFinite(tuple?.odds?.over) && tuple.odds.over > 1) {
      const key = `${base.homeTeam}|${base.awayTeam}|${base.stat}|${base.scope}|${base.period}|${base.line}|over`;
      unique.set(key, { ...base, over: true, odds: tuple.odds.over });
    }

    if (Number.isFinite(tuple?.odds?.under) && tuple.odds.under > 1) {
      const key = `${base.homeTeam}|${base.awayTeam}|${base.stat}|${base.scope}|${base.period}|${base.line}|under`;
      unique.set(key, { ...base, over: false, odds: tuple.odds.under });
    }
  }

  return Array.from(unique.values()).slice(0, MAX_BETS_PER_MATCH);
}

async function persistSnapshot(payload) {
  try {
    await fetch("/api/analysis-snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // best effort
  }
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

export default function DailyAutoAnalysis({ date, matches = [], formatTime, onOpenMatch, onAutoStateChange }) {
  const [strategyId, setStrategyId] = useState("balanced");
  const [analysisEntries, setAnalysisEntries] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const abortRef = useRef(null);
  const lastPersistKeyRef = useRef("");
  const { mutate } = useSWRConfig();

  const { data: rankingFeedback } = useSWR("/api/ranking-feedback?days=120&limit=500", fetcher, { revalidateOnFocus: false });
  const { data: watchlistData } = useSWR("/api/watchlist", fetcher, { revalidateOnFocus: false });
  const watchlistKeys = new Set((watchlistData?.items || []).map((item) => item.trackingKey));

  useEffect(() => {
    setAnalysisEntries([]);
    setError(null);
    setProgress({ completed: 0, total: 0 });
  }, [date]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const analyzeSingleMatch = useCallback(async (match, signal) => {
    const lookup = await postBacktest(buildMatchLookupPayload(match), signal);
    const tuples = mapUnibetOdds(lookup?.odds, match?.homeTeamName, match?.awayTeamName);
    if (!tuples.length) return { match, candidates: [], unibetUrl: lookup?.eventUrl || null, status: "no-markets", marketCount: 0 };

    const bets = buildBatchBets(match, tuples);
    if (!bets.length) return { match, candidates: [], unibetUrl: lookup?.eventUrl || null, status: "no-bets", marketCount: 0 };

    const batchResults = await postBacktest({ action: "batch-expected-value", bets }, signal);
    const normalized = (Array.isArray(batchResults) ? batchResults : [])
      .filter((entry) => entry && !entry.error)
      .map((entry) => normalizeBatchResult(entry))
      .filter((entry) => entry && (entry.primaryEv || 0) > 0);

    const summary = buildPositiveResultsSummary(normalized, lookup?.eventUrl || null, {
      strategyId: "balanced",
      learningProfile: rankingFeedback || null,
    });

    return { match, candidates: summary.items, unibetUrl: summary.unibetUrl, status: summary.count ? "ok" : "no-positive-edges", marketCount: bets.length };
  }, [rankingFeedback]);

  const runAnalysis = useCallback(async () => {
    if (!matches.length) {
      setAnalysisEntries([]);
      setError("Inga matcher att analysera för valt datum.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setError(null);
    setProgress({ completed: 0, total: matches.length });

    const results = new Array(matches.length);
    let pointer = 0;
    let completed = 0;

    const worker = async () => {
      while (pointer < matches.length) {
        const currentIndex = pointer++;
        const match = matches[currentIndex];
        try {
          results[currentIndex] = await analyzeSingleMatch(match, controller.signal);
        } catch (err) {
          if (controller.signal.aborted) return;
          results[currentIndex] = { match, candidates: [], unibetUrl: null, status: "error", error: err?.message || "Kunde inte analysera matchen" };
        } finally {
          completed += 1;
          setProgress({ completed, total: matches.length });
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, matches.length) }, worker));
      if (!controller.signal.aborted) setAnalysisEntries(results.filter(Boolean));
    } catch (err) {
      if (!controller.signal.aborted) setError(err?.message || "Autoanalysen misslyckades.");
    } finally {
      if (!controller.signal.aborted) setIsRunning(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [analyzeSingleMatch, matches]);

  const strategyProfile = getStrategyProfile(strategyId);

  const derived = useMemo(() => {
    const perMatch = (analysisEntries || [])
      .map((entry) => {
        const scored = (entry?.candidates || [])
          .filter((candidate) => matchesStrategyFilters(candidate, strategyId))
          .map((candidate) => scoreResultForStrategy(candidate, strategyId, rankingFeedback || null))
          .sort((a, b) => (b.strategyScore !== a.strategyScore ? b.strategyScore - a.strategyScore : (b.primaryEv || 0) - (a.primaryEv || 0)));
        const bestBet = scored[0] || null;
        return {
          ...entry,
          strategyCandidates: scored,
          bestBet: bestBet ? { ...bestBet, matchId: entry.match?.id } : null,
        };
      })
      .filter((entry) => entry.bestBet)
      .sort((a, b) => b.bestBet.strategyScore - a.bestBet.strategyScore);

    return {
      shortlist: perMatch,
      bestOverall: perMatch[0]?.bestBet || null,
      summary: {
        shortlistCount: perMatch.length,
        provenCount: perMatch.filter((entry) => entry.bestBet?.proof?.historicalReady).length,
      },
    };
  }, [analysisEntries, strategyId, rankingFeedback]);

  useEffect(() => {
    onAutoStateChange?.(derived);
  }, [derived, onAutoStateChange]);

  useEffect(() => {
    if (!derived.shortlist.length || isRunning) return;
    const persistKey = `${date}:${strategyId}:${derived.shortlist[0]?.bestBet?.bet?.key || "none"}:${derived.shortlist.length}`;
    if (lastPersistKeyRef.current === persistKey) return;
    lastPersistKeyRef.current = persistKey;

    void persistSnapshot({
      date,
      strategyId,
      strategyLabel: strategyProfile.label,
      analyzedMatches: analysisEntries.length,
      shortlist: derived.shortlist.slice(0, 20).map((entry) => ({
        matchId: entry.match?.id,
        homeTeamName: entry.match?.homeTeamName,
        awayTeamName: entry.match?.awayTeamName,
        leagueName: entry.match?.leagueName,
        headline: entry.bestBet?.headline,
        primaryEv: entry.bestBet?.primaryEv,
        confidenceScore: entry.bestBet?.confidenceScore,
        agreementPct: entry.bestBet?.agreementPct,
        strategyScore: entry.bestBet?.strategyScore,
        scopeLabel: entry.bestBet?.scopeLabel,
        periodLabel: entry.bestBet?.periodLabel,
        rationale: entry.bestBet?.rationale,
        riskFlags: entry.bestBet?.riskFlags,
        entries: entry.bestBet?.entries,
        rankReasons: entry.bestBet?.rankReasons,
        ranking: entry.bestBet?.ranking,
        proof: entry.bestBet?.proof,
        bet: entry.bestBet?.bet,
      })),
    });
  }, [analysisEntries.length, date, derived.shortlist, isRunning, strategyId, strategyProfile.label]);

  const toggleWatchlist = async (entry) => {
    const trackingKey = buildTrackingKey(entry.matchId, entry.bet);
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
        }),
      });
    }
    mutate("/api/watchlist");
  };

  const helperText = useMemo(() => {
    if (isRunning) return `Analyserar ${progress.completed}/${progress.total} matcher enligt ${strategyProfile.label.toLowerCase()}-profilen.`;
    if (derived.bestOverall) return `Snabbläge: ett toppspel, några sekundära chanser och tydliga proof/risk-signaler först. Öppna avancerat först när något ser värt ut.`;
    return "Kör dagens autoanalys för att få ett rent beslutsläge med toppspel, proof-status och watchlist-knappar.";
  }, [derived.bestOverall, isRunning, progress.completed, progress.total, strategyProfile.label]);

  const bestOverall = derived.bestOverall;
  const secondary = derived.shortlist.slice(1, 4);

  return (
    <section className="rounded-2xl border border-white/5 bg-[#09090b] shadow-2xl overflow-hidden">
      <div className="border-b border-white/5 bg-white/[0.02] px-4 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <MetricBadge label="Datum" value={date || "—"} tone="accent" />
              <MetricBadge label="Matcher" value={matches.length} />
              <MetricBadge label="Shortlist" value={derived.summary.shortlistCount} tone={derived.summary.shortlistCount ? "positive" : "neutral"} />
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
        {isRunning ? <div className="mb-4 overflow-hidden rounded-full border border-white/10 bg-black/30"><div className="h-2 bg-cyan-400/70 transition-all" style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }} /></div> : null}

        {!derived.shortlist.length && !isRunning ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
            Auto-läget väntar på analys. När det finns kandidater får du ett toppspel, proof-status, riskflaggor och bevakningsknapp direkt här.
          </div>
        ) : null}

        {bestOverall ? (
          <div className="grid gap-4 xl:grid-cols-[1.35fr_0.95fr]">
            <article className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.06] p-5 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/80">Dagens toppspel</div>
                  <div className="mt-1 text-xl font-semibold text-white">{bestOverall.headline}</div>
                  <div className="mt-2 text-sm text-slate-300">{bestOverall.rationale}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Ranking</div>
                  <div className="mt-1 text-2xl font-black text-cyan-300">{bestOverall.strategyScore?.toFixed(1)}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <MetricBadge label="EV" value={`+${bestOverall.primaryEv?.toFixed(1)}%`} tone="positive" />
                <MetricBadge label="Confidence" value={`${bestOverall.confidenceScore}/100`} tone="positive" />
                <MetricBadge label="Proof" value={`${bestOverall.proof?.proofScore || 0}/100`} tone={bestOverall.proof?.historicalReady ? "positive" : "warning"} />
                <MetricBadge label="Historik" value={bestOverall.proof?.historicalReady ? "Verifierad" : "Byggs upp"} tone={bestOverall.proof?.historicalReady ? "positive" : "warning"} />
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
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Lärande</div>
                  <div className="mt-1 text-sm font-semibold text-white">{bestOverall.ranking?.learningAdjustment > 0 ? "+" : ""}{bestOverall.ranking?.learningAdjustment || 0}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(bestOverall.rankReasons || []).map((reason) => (
                  <span key={reason.id} className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${reason.tone === "warning" ? "border-amber-500/20 bg-amber-500/10 text-amber-200" : "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"}`}>{reason.label}</span>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => onOpenMatch?.({ id: bestOverall.matchId, matchId: bestOverall.matchId }, "backtest")} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300">Öppna full analys</button>
                <button type="button" onClick={() => toggleWatchlist(bestOverall)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300">{watchlistKeys.has(buildTrackingKey(bestOverall.matchId, bestOverall.bet)) ? "Ta bort bevakning" : "Bevaka spel"}</button>
              </div>
            </article>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/5 bg-[#050505] p-4 shadow-xl">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Sekundära chanser</div>
                <div className="mt-3 space-y-3">
                  {secondary.length ? secondary.map((entry) => {
                    const bet = entry.bestBet;
                    return (
                      <div key={bet.bet.key} className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white">{bet.headline}</div>
                            <div className="mt-1 text-xs text-slate-400">{entry.match?.homeTeamName} vs {entry.match?.awayTeamName}</div>
                          </div>
                          <div className="text-sm font-black text-cyan-300">{bet.strategyScore?.toFixed(1)}</div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <MetricBadge label="EV" value={`+${bet.primaryEv?.toFixed(1)}%`} tone="positive" />
                          <MetricBadge label="Proof" value={`${bet.proof?.proofScore || 0}/100`} tone={bet.proof?.historicalReady ? "positive" : "warning"} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => onOpenMatch?.(entry.match, "backtest")} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">Öppna</button>
                          <button type="button" onClick={() => toggleWatchlist(bet)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300">{watchlistKeys.has(buildTrackingKey(bet.matchId, bet.bet)) ? "Bevakas" : "Bevaka"}</button>
                        </div>
                      </div>
                    );
                  }) : <div className="text-sm text-slate-400">Inga tydliga sekundära chanser ännu.</div>}
                </div>
              </div>

              <div className="rounded-2xl border border-white/5 bg-[#050505] p-4 shadow-xl">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Proof thresholds</div>
                <div className="mt-3 space-y-2 text-sm text-slate-300">
                  <div>• Minst {strategyProfile.minSampleSize} matcher i sample för att få komma med.</div>
                  <div>• Minst {strategyProfile.minConfidence} i confidence och {strategyProfile.minAgreementPct}% modellkonsensus.</div>
                  <div>• Historik räknas först fullt när marknaden faktiskt är verifierad.</div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
