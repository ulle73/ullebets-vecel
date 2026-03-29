"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
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
    // snapshot persistence is best effort
  }
}

function MetricBadge({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "positive"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : tone === "accent"
        ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
        : "border-white/10 bg-white/5 text-slate-300";

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] ${toneClass}`}>
      {label}: {value}
    </span>
  );
}

export default function DailyAutoAnalysis({
  date,
  matches = [],
  formatTime,
  onOpenMatch,
}) {
  const [strategyId, setStrategyId] = useState("balanced");
  const [analysisEntries, setAnalysisEntries] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const abortRef = useRef(null);
  const lastPersistKeyRef = useRef("");

  const { data: rankingFeedback } = useSWR("/api/ranking-feedback?days=120&limit=500", fetcher, {
    revalidateOnFocus: false,
  });

  useEffect(() => {
    setAnalysisEntries([]);
    setError(null);
    setProgress({ completed: 0, total: 0 });
  }, [date]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  const analyzeSingleMatch = useCallback(async (match, signal) => {
    const lookup = await postBacktest(buildMatchLookupPayload(match), signal);
    const tuples = mapUnibetOdds(
      lookup?.odds,
      match?.homeTeamName,
      match?.awayTeamName
    );

    if (!tuples.length) {
      return {
        match,
        candidates: [],
        unibetUrl: lookup?.eventUrl || null,
        status: "no-markets",
        marketCount: 0,
      };
    }

    const bets = buildBatchBets(match, tuples);
    if (!bets.length) {
      return {
        match,
        candidates: [],
        unibetUrl: lookup?.eventUrl || null,
        status: "no-bets",
        marketCount: 0,
      };
    }

    const batchResults = await postBacktest(
      { action: "batch-expected-value", bets },
      signal
    );

    const normalized = (Array.isArray(batchResults) ? batchResults : [])
      .filter((entry) => entry && !entry.error)
      .map((entry) => normalizeBatchResult(entry))
      .filter((entry) => entry && (entry.primaryEv || 0) > 0);

    const summary = buildPositiveResultsSummary(normalized, lookup?.eventUrl || null, {
      strategyId: "balanced",
      learningProfile: rankingFeedback || null,
    });

    return {
      match,
      candidates: summary.items,
      unibetUrl: summary.unibetUrl,
      status: summary.count ? "ok" : "no-positive-edges",
      marketCount: bets.length,
    };
  }, [rankingFeedback]);

  const runAnalysis = useCallback(async () => {
    if (!Array.isArray(matches) || matches.length === 0) {
      setAnalysisEntries([]);
      setError("Inga matcher att analysera för valt datum.");
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }

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
        const currentIndex = pointer;
        pointer += 1;
        const match = matches[currentIndex];

        try {
          results[currentIndex] = await analyzeSingleMatch(match, controller.signal);
        } catch (err) {
          if (controller.signal.aborted) {
            return;
          }
          results[currentIndex] = {
            match,
            candidates: [],
            unibetUrl: null,
            status: "error",
            error: err?.message || "Kunde inte analysera matchen",
          };
        } finally {
          completed += 1;
          setProgress({ completed, total: matches.length });
        }
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENCY, matches.length) }, worker)
      );

      if (!controller.signal.aborted) {
        setAnalysisEntries(results.filter(Boolean));
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err?.message || "Autoanalysen misslyckades.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsRunning(false);
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [analyzeSingleMatch, matches]);

  const strategyProfile = getStrategyProfile(strategyId);

  const derived = useMemo(() => {
    const perMatch = (Array.isArray(analysisEntries) ? analysisEntries : [])
      .map((entry) => {
        const scored = (entry?.candidates || [])
          .filter((candidate) => matchesStrategyFilters(candidate, strategyId))
          .map((candidate) => scoreResultForStrategy(candidate, strategyId, rankingFeedback || null))
          .sort((a, b) => {
            if (b.strategyScore !== a.strategyScore) {
              return b.strategyScore - a.strategyScore;
            }
            return (b.primaryEv || 0) - (a.primaryEv || 0);
          });

        return {
          ...entry,
          strategyCandidates: scored,
          bestBet: scored[0] || null,
        };
      })
      .filter((entry) => entry.bestBet)
      .sort((a, b) => b.bestBet.strategyScore - a.bestBet.strategyScore);

    return {
      shortlist: perMatch,
      bestOverall: perMatch[0]?.bestBet || null,
    };
  }, [analysisEntries, strategyId, rankingFeedback]);

  useEffect(() => {
    if (!derived.shortlist.length || isRunning) {
      return;
    }

    const persistKey = `${date}:${strategyId}:${derived.shortlist[0]?.bestBet?.bet?.key || "none"}:${derived.shortlist.length}`;
    if (lastPersistKeyRef.current === persistKey) {
      return;
    }
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
        bet: entry.bestBet?.bet,
      })),
    });
  }, [analysisEntries.length, date, derived.shortlist, isRunning, strategyId, strategyProfile.label]);

  const helperText = useMemo(() => {
    if (isRunning) {
      return `Analyserar ${progress.completed}/${progress.total} matcher och bygger en shortlist enligt ${strategyProfile.label.toLowerCase()}-profilen.`;
    }
    if (derived.bestOverall) {
      return `Bästa spelet just nu är ${derived.bestOverall.headline.toLowerCase()} med EV +${derived.bestOverall.primaryEv?.toFixed(1)}% och confidence ${derived.bestOverall.confidenceScore}/100.`;
    }
    return "Kör dagens autoanalys för att låta appen loopa igenom matcherna, hämta odds och ranka bästa spelen automatiskt.";
  }, [derived.bestOverall, isRunning, progress.completed, progress.total, strategyProfile.label]);

  return (
    <section className="rounded-2xl border border-white/5 bg-[#09090b] shadow-2xl overflow-hidden">
      <div className="border-b border-white/5 bg-white/[0.02] px-4 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <MetricBadge label="Datum" value={date || "—"} tone="accent" />
              <MetricBadge label="Matcher" value={matches.length} />
              <MetricBadge label="Shortlist" value={derived.shortlist.length} tone={derived.shortlist.length ? "positive" : "neutral"} />
              {derived.bestOverall ? (
                <MetricBadge label="Top edge" value={`+${derived.bestOverall.primaryEv?.toFixed(1)}%`} tone="positive" />
              ) : null}
              {derived.bestOverall && Math.abs(derived.bestOverall?.ranking?.learningAdjustment || 0) >= 1 ? (
                <MetricBadge
                  label="Lärande"
                  value={`${derived.bestOverall.ranking.learningAdjustment > 0 ? "+" : ""}${derived.bestOverall.ranking.learningAdjustment}`}
                  tone={derived.bestOverall.ranking.learningAdjustment >= 0 ? "positive" : "neutral"}
                />
              ) : null}
            </div>

            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.18em] text-slate-100">
                Dagens autoanalys
              </h2>
              <p className="mt-2 max-w-4xl text-sm text-slate-300">
                {helperText}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={runAnalysis}
            disabled={isRunning || !matches.length}
            className="inline-flex items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10 px-5 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300 transition hover:bg-cyan-500/15 disabled:opacity-40"
          >
            {isRunning ? "Kör analys…" : analysisEntries.length ? "Kör om dagens autoanalys" : "Kör dagens autoanalys"}
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
                className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] transition ${
                  active
                    ? "border-cyan-500/20 bg-cyan-500/15 text-cyan-300"
                    : "border-white/10 bg-white/5 text-slate-400 hover:text-slate-200"
                }`}
              >
                {profile.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4">
        {error ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {isRunning ? (
          <div className="mb-4 overflow-hidden rounded-full border border-white/10 bg-black/30">
            <div
              className="h-2 bg-cyan-400/70 transition-all"
              style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }}
            />
          </div>
        ) : null}

        {!analysisEntries.length && !isRunning ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
            Profilen <span className="font-semibold text-slate-200">{strategyProfile.label}</span> kräver minst {strategyProfile.minConfidence} i confidence, {strategyProfile.minAgreementPct}% modellkonsensus och minst {strategyProfile.minSampleSize} matcher i sample innan ett spel får komma med i shortlistan.
          </div>
        ) : null}

        {derived.shortlist.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {derived.shortlist.slice(0, 12).map((entry) => {
              const bet = entry.bestBet;
              const timeLabel = Number.isFinite(entry.match?.timestamp)
                ? formatTime(entry.match.timestamp)
                : "—";

              return (
                <article
                  key={`${entry.match?.id}:${bet?.bet?.key}`}
                  className="rounded-2xl border border-white/5 bg-[#050505] p-4 shadow-xl"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        {entry.match?.leagueName || "Liga"} · {timeLabel}
                      </div>
                      <h3 className="mt-1 text-base font-semibold text-white">
                        {entry.match?.homeTeamName} vs {entry.match?.awayTeamName}
                      </h3>
                      <p className="mt-2 text-sm text-slate-300">
                        {bet?.headline} · {bet?.scopeLabel} · {bet?.periodLabel}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Ranking</div>
                      <div className="mt-1 text-lg font-black text-cyan-300">{bet?.strategyScore?.toFixed(1)}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <MetricBadge label="EV" value={`+${bet?.primaryEv?.toFixed(1)}%`} tone="positive" />
                    <MetricBadge label="Confidence" value={`${bet?.confidenceScore}/100`} tone="positive" />
                    <MetricBadge label="Konsensus" value={`${bet?.agreementPct}%`} tone="accent" />
                    <MetricBadge label="Odds" value={bet?.bet?.odds?.toFixed ? bet.bet.odds.toFixed(2) : bet?.bet?.odds} />
                    {Math.abs(bet?.ranking?.learningAdjustment || 0) >= 1 ? (
                      <MetricBadge
                        label="Lärande"
                        value={`${bet.ranking.learningAdjustment > 0 ? "+" : ""}${bet.ranking.learningAdjustment}`}
                        tone={bet.ranking.learningAdjustment >= 0 ? "positive" : "neutral"}
                      />
                    ) : null}
                  </div>

                  {bet?.rankReasons?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {bet.rankReasons.map((reason) => (
                        <span
                          key={reason.id}
                          className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                            reason.tone === "warning"
                              ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
                              : "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
                          }`}
                        >
                          {reason.label}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <p className="mt-3 text-sm leading-6 text-slate-300">{bet?.rationale}</p>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Edge score</div>
                      <div className="mt-1 text-sm font-semibold text-white">{bet?.ranking?.edgeScore}/100</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Price score</div>
                      <div className="mt-1 text-sm font-semibold text-white">{bet?.ranking?.priceScore}/100</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Market score</div>
                      <div className="mt-1 text-sm font-semibold text-white">{bet?.ranking?.marketScore}/100</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Lärande confidence</div>
                      <div className="mt-1 text-sm font-semibold text-white">{bet?.ranking?.learningConfidencePct || 0}%</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {(bet?.riskFlags || []).length ? (
                      bet.riskFlags.map((flag) => (
                        <span
                          key={flag.id}
                          className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-200"
                        >
                          {flag.label}
                        </span>
                      ))
                    ) : (
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200">
                        Ren riskbild
                      </span>
                    )}
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {(bet?.entries || []).map((formula) => (
                      <div
                        key={formula.key}
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                      >
                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{formula.label}</div>
                        <div className={`mt-1 text-sm font-semibold ${formula.value >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {formula.value >= 0 ? "+" : ""}{formula.value.toFixed(1)}%
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenMatch?.(entry.match, "backtest")}
                      className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300"
                    >
                      Öppna i backtest
                    </button>
                    {entry.unibetUrl ? (
                      <a
                        href={entry.unibetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300"
                      >
                        Öppna odds
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : analysisEntries.length && !isRunning ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
            Autoanalysen kördes klart, men inga spel klarade just nu filtren för {strategyProfile.label.toLowerCase()}.
          </div>
        ) : null}
      </div>
    </section>
  );
}
