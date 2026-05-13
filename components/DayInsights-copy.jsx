"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toNum } from "@/lib/utils/matchups";
import { getStatKeyLabel } from "@/lib/utils/statKeyLabels";
import { FilterChips, RowAvg, DEFAULT_SCORE_THRESHOLDS } from "@/components/MatchupsListUI";
import {
  buildHistoricalPredictionSummary,
  isDateBeforeTodayLocal,
} from "@/lib/dayInsightsSummary";

const PERIODS = [
  { value: "ALL", label: "Hela matchen" },
  { value: "1ST", label: "Första halvlek" },
  { value: "2ND", label: "Andra halvlek" },
];

const PERIOD_FILTERS = [
  { value: "any", label: "Alla perioder" },
  ...PERIODS,
];

const SCOPE_FILTERS = [
  { value: "all", label: "Alla" },
  { value: "total", label: "Totalt" },
  { value: "home", label: "Hemmalaget" },
  { value: "away", label: "Bortalaget" },
];

function deriveOutcomeForScope(outcome, scope) {
  if (!outcome) {
    return {
      outcomeValue: null,
      outcomeHomeValue: null,
      outcomeAwayValue: null,
    };
  }

  const home = toNum(outcome.homeValue ?? outcome.home ?? null);
  const away = toNum(outcome.awayValue ?? outcome.away ?? null);
  const hasHome = Number.isFinite(home);
  const hasAway = Number.isFinite(away);

  let value = null;
  if (scope === "home" && hasHome) {
    value = home;
  } else if (scope === "away" && hasAway) {
    value = away;
  } else if (scope === "total" && (hasHome || hasAway)) {
    const sum = (hasHome ? home : 0) + (hasAway ? away : 0);
    if (Number.isFinite(sum)) {
      value = sum;
    }
  }

  return {
    outcomeValue: Number.isFinite(value) ? value : null,
    outcomeHomeValue: hasHome ? home : null,
    outcomeAwayValue: hasAway ? away : null,
  };
}

const fetcher = async (input) => {
  const response = await fetch(input);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Fetch error");
  }
  return response.json();
};

function badgeForNormalizedScore(score) {
  if (!Number.isFinite(score)) return null;
  if (score >= 95) return { label: "Perfekt", tone: "perfect" };
  if (score >= 90) return { label: "Nästan", tone: "almost" };
  if (score >= 85) return { label: "Stark", tone: "strong" };
  return null;
}

function mapScoreEntry(entry) {
  const matchLabel = entry.match ?? "Match";
  const score = toNum(entry.score) ?? toNum(entry.sortKey) ?? 0;
  const scope = entry.scope ?? "total";
  const outcomeInfo = deriveOutcomeForScope(entry.outcome, scope);
  const leagueBaseline = toNum(entry?.forecast?.leagueBaseline);
  const marketBias = entry.marketBias ?? null;
  const homeBehaviour = entry.homeBehaviour ?? null;
  const awayBehaviour = entry.awayBehaviour ?? null;
  return {
    matchId: entry.matchId ?? matchLabel,
    leagueName: entry.league ?? null,
    homeTeamId: entry.homeTeamId ?? entry.homeId ?? null,
    awayTeamId: entry.awayTeamId ?? entry.awayId ?? null,
    statKey: entry.statKey ?? entry.statLabel ?? null,
    statLabel: entry.statLabel ?? entry.statKey ?? "Stat",
    period: entry.period ?? "ALL",
    scope,
    scopeLabel: entry.scopeLabel ?? null,
    condition: entry.condition ?? entry.direction ?? null,
    matchLabel,
    score,
    sortKey: toNum(entry.sortKey ?? entry.score) ?? score,
    badge: badgeForNormalizedScore(score),
    scoreFormat: (value) => value.toFixed(1), // Removed /100 suffix for cleaner look
    scoreThresholds: DEFAULT_SCORE_THRESHOLDS,
    leagueBaseline,
    marketBias,
    homeBehaviour,
    awayBehaviour,
    ...outcomeInfo,
  };
}

function toSortKey(row) {
  if (Number.isFinite(row.sortKey)) return row.sortKey;
  if (Number.isFinite(row.score)) return row.score;
  return -Infinity;
}

function applyFilters(rows, leagueFilter, statFilter, scopeFilter, periodFilter, onlyTopBadges) {
  return rows
    .filter((row) => leagueFilter === "all" || row.leagueName === leagueFilter)
    .filter((row) => {
      const filterKey = row.statKey ?? row.statLabel ?? null;
      return statFilter === "all" || filterKey === statFilter;
    })
    .filter((row) => scopeFilter === "all" || row.scope === scopeFilter)
    .filter((row) => periodFilter === "any" || row.period === periodFilter)
    .filter(
      (row) =>
        !onlyTopBadges ||
        (row.badge && (row.badge.tone === "perfect" || row.badge.tone === "almost"))
    )
    .sort((a, b) => toSortKey(b) - toSortKey(a))
    .slice(0, 30);
}

export default function BestMatchups({ date, items }) {
  const [periodFilter, setPeriodFilter] = useState(PERIOD_FILTERS[0].value);
  const [scopeFilter, setScopeFilter] = useState(SCOPE_FILTERS[0].value);
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [statFilter, setStatFilter] = useState("all");
  const [onlyTopBadges, setOnlyTopBadges] = useState(false);
  const [highlightPct, setHighlightPct] = useState(20);
  const showHistoricalOutcome = useMemo(() => isDateBeforeTodayLocal(date), [date]);

  const queryKey = date ? `/api/matchups-score?date=${encodeURIComponent(date)}` : null;

  const { data, error } = useSWR(queryKey, fetcher, { revalidateOnFocus: false });
  const isLoading = !data && !error;

  const rawOver = data?.top50?.over ?? [];
  const rawUnder = data?.top50?.under ?? [];

  const mappedOver = useMemo(() => rawOver.map(mapScoreEntry), [rawOver]);
  const mappedUnder = useMemo(() => rawUnder.map(mapScoreEntry), [rawUnder]);

  const leagueOptions = useMemo(() => {
    const uniq = new Map();
    [...mappedOver, ...mappedUnder].forEach((row) => {
      const label = row.leagueName ?? "Liga";
      if (!uniq.has(label)) {
        uniq.set(label, { value: label, label });
      }
    });
    return [{ value: "all", label: "Alla ligor" }, ...uniq.values()];
  }, [mappedOver, mappedUnder]);

  const statOptions = useMemo(() => {
    const uniq = new Map();
    [...mappedOver, ...mappedUnder].forEach((row) => {
      const statKey = row.statKey ?? row.statLabel ?? null;
      if (!statKey || uniq.has(statKey)) return;
      uniq.set(statKey, { value: statKey, label: getStatKeyLabel(statKey) });
    });
    return [{ value: "all", label: "Alla stattyper" }, ...uniq.values()];
  }, [mappedOver, mappedUnder]);

  const overRows = useMemo(
    () =>
      applyFilters(
        mappedOver,
        leagueFilter,
        statFilter,
        scopeFilter,
        periodFilter,
        onlyTopBadges
      ),
    [mappedOver, leagueFilter, statFilter, scopeFilter, periodFilter, onlyTopBadges]
  );
  const underRows = useMemo(
    () =>
      applyFilters(
        mappedUnder,
        leagueFilter,
        statFilter,
        scopeFilter,
        periodFilter,
        onlyTopBadges
      ),
    [mappedUnder, leagueFilter, statFilter, scopeFilter, periodFilter, onlyTopBadges]
  );

  // Calculate summary statistics for historical outcomes (only visible rows)
  const overSummary = useMemo(
    () => buildHistoricalPredictionSummary(overRows, "over", showHistoricalOutcome),
    [overRows, showHistoricalOutcome]
  );

  const underSummary = useMemo(
    () => buildHistoricalPredictionSummary(underRows, "under", showHistoricalOutcome),
    [underRows, showHistoricalOutcome]
  );


  const generatedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleString("sv-SE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    })
    : null;

  return (
    <div className="flex flex-col rounded-lg border border-white/5 bg-[#09090b] shadow-2xl lg:h-full lg:min-h-0 overflow-hidden">
      <div className="border-b border-white/5 px-4 py-4 backdrop-blur-sm bg-white/[0.02]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-3">
              Div2 – Bästa matchups
              <span className="text-[10px] uppercase tracking-wider font-semibold text-cyan-400 bg-cyan-950/30 px-2 py-1 rounded border border-cyan-800/30">
                PRO TIPS
              </span>
            </h2>
            {generatedAt ? (
              <p className="mt-1 text-xs text-slate-500 font-mono">
                Senast genererat: {generatedAt} (UTC)
              </p>
            ) : isLoading ? (
              <p className="mt-1 text-xs text-cyan-400 animate-pulse">Laddar matchups…</p>
            ) : error ? (
              <p className="mt-1 text-xs text-rose-500">Misslyckades hämta data.</p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">Ingen data för valt datum.</p>
            )}
          </div>

          {/* Highlight Threshold Input */}
          <label className="flex items-center gap-2 text-xs text-slate-400 bg-black/40 px-3 py-1.5 rounded-lg border border-white/5">
            <span className="font-semibold uppercase tracking-wide">
              Diff % (±)
            </span>
            <input
              type="number"
              min="0"
              className="w-14 rounded bg-white/5 border border-white/10 px-2 py-1 text-center text-slate-200 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-colors"
              value={highlightPct}
              onChange={(e) => {
                const v = Number(e.target.value);
                setHighlightPct(Number.isFinite(v) && v >= 0 ? v : 0);
              }}
            />
          </label>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <FilterChips options={SCOPE_FILTERS} value={scopeFilter} onChange={setScopeFilter} />
            <FilterChips options={PERIOD_FILTERS} value={periodFilter} onChange={setPeriodFilter} />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mr-2">
              Advanced Filters
            </span>

            <select
              aria-label="Välj liga"
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-medium text-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              value={leagueFilter}
              onChange={(e) => setLeagueFilter(e.target.value)}
            >
              {leagueOptions.map((o) => (
                <option key={o.value} value={o.value} className="bg-slate-900 text-slate-200">
                  {o.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Välj stattyp"
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-medium text-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              value={statFilter}
              onChange={(e) => setStatFilter(e.target.value)}
            >
              {statOptions.map((o) => (
                <option key={o.value} value={o.value} className="bg-slate-900 text-slate-200">
                  {o.label}
                </option>
              ))}
            </select>

            <label className="ml-auto inline-flex cursor-pointer items-center gap-2 group select-none">
              <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${onlyTopBadges ? "bg-cyan-500 border-cyan-500" : "bg-transparent border-slate-600 group-hover:border-slate-500"}`}>
                {onlyTopBadges && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
              </div>
              <input
                type="checkbox"
                className="hidden"
                checked={onlyTopBadges}
                onChange={(e) => setOnlyTopBadges(e.target.checked)}
              />
              <span className={`text-xs font-medium transition-colors ${onlyTopBadges ? "text-cyan-400" : "text-slate-500 group-hover:text-slate-400"}`}>
                Endast Top Tier
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:flex-1 lg:min-h-0 overflow-hidden bg-[#050505]">

        {/* Over Column */}
        <div className="flex flex-col min-h-0 border-r border-white/5 last:border-0">
          <div className="px-4 py-3 sticky top-0 bg-[#09090b]/95 backdrop-blur z-10 border-b border-white/5">
            <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-black uppercase tracking-widest text-emerald-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                Över – topp 20
              </h3>
              <span className={`text-xs font-medium ${overSummary.toneClass}`}>
                {overSummary.label}
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {!data && isLoading ? (
              <div className="flex flex-col gap-4 animate-pulse">
                {[1, 2, 3].map(i => <div key={i} className="h-32 rounded-xl bg-white/5" />)}
              </div>
            ) : error ? (
              <div className="p-4 text-sm text-rose-500 text-center">Misslyckades hämta data.</div>
            ) : overRows.length ? (
              <ul className="flex flex-col gap-4 pb-8">
                {overRows.map((r) => (
                  <RowAvg
                    key={`o:${r.matchId}:${r.statKey}:${r.period}:${r.scope}`}
                    r={r}
                    showHistoricalOutcome={showHistoricalOutcome}
                    highlightPct={highlightPct}
                  />
                ))}
              </ul>
            ) : (
              <div className="p-8 text-center text-sm text-slate-600 italic">Ingen data matchar filtren.</div>
            )}
          </div>
        </div>

        {/* Under Column */}
        <div className="flex flex-col min-h-0">
          <div className="px-4 py-3 sticky top-0 bg-[#09090b]/95 backdrop-blur z-10 border-b border-white/5">
            <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-black uppercase tracking-widest text-rose-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"></span>
                Under – topp 20
              </h3>
              <span className={`text-xs font-medium ${underSummary.toneClass}`}>
                {underSummary.label}
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {!data && isLoading ? (
              <div className="flex flex-col gap-4 animate-pulse">
                {[1, 2, 3].map(i => <div key={i} className="h-32 rounded-xl bg-white/5" />)}
              </div>
            ) : error ? (
              <div className="p-4 text-sm text-rose-500 text-center">Misslyckades hämta data.</div>
            ) : underRows.length ? (
              <ul className="flex flex-col gap-4 pb-8">
                {underRows.map((r) => (
                  <RowAvg
                    key={`u:${r.matchId}:${r.statKey}:${r.period}:${r.scope}`}
                    r={r}
                    showHistoricalOutcome={showHistoricalOutcome}
                    highlightPct={highlightPct}
                  />
                ))}
              </ul>
            ) : (
              <div className="p-8 text-center text-sm text-slate-600 italic">Ingen data matchar filtren.</div>
            )}
          </div>
        </div>

      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 99px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
