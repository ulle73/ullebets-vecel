"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import LeagueTables from "@/components/LeagueTables";
import DayInsightsLegacy from "@/components/DayInsights-copy";
import MatchDetailsTabs from "@/components/MatchDetailsTabs";
import DailyAutoAnalysis from "@/components/DailyAutoAnalysis";
import AutoAnalysisHistory from "@/components/AutoAnalysisHistory";
import DashboardCockpit from "@/components/DashboardCockpit";
import WatchlistPanel from "@/components/WatchlistPanel";
import { normalizeMatch } from "@/lib/core/matchups";
import {
  buildMatchesByDateKey,
  buildMatchDetailsKey,
  buildTeamProfileKeyForMatch,
} from "@/lib/utils/apiKeys";
import {
  fetchJson,
  fetchJsonAllow404,
  fetchTeamProfile,
} from "@/lib/utils/fetchers";

const DEBUG_TAG = "[MatchesClient]";
const debug = (...args) => console.log(DEBUG_TAG, ...args);
const debugError = (...args) => console.error(DEBUG_TAG, ...args);

const RIGHT_PANE_TABS = [
  { id: "overview", label: "Översikt" },
  { id: "auto", label: "Auto" },
  { id: "watchlist", label: "Watchlist" },
  { id: "history", label: "Historik" },
];

function makeFormatter() {
  return new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Stockholm",
  });
}

function getNextDateString(currentDate) {
  if (!currentDate) return null;
  const parsed = new Date(currentDate);
  if (!Number.isFinite(parsed.getTime())) return null;
  parsed.setDate(parsed.getDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function toMatchId(value) {
  if (!value) return null;
  if (typeof value === "string" || typeof value === "number") {
    const str = String(value).trim();
    return str ? str : null;
  }
  if (typeof value === "object") {
    return toMatchId(
      value.matchId ??
        value.id ??
        value._id ??
        value.eventId ??
        value.event_id ??
        value.event?.id ??
        value.raw?.matchId ??
        value.raw?.id ??
        value.raw?.eventId ??
        null
    );
  }
  return null;
}

function HeaderBadge({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "positive"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : tone === "accent"
        ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
        : tone === "warning"
          ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
          : "border-white/10 bg-white/[0.04] text-slate-300";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${toneClass}`}
    >
      {label}: {value}
    </span>
  );
}

function RightPaneWorkspace({
  activeTab,
  onTabChange,
  autoState,
  watchlistAlertCount,
  onOpenMatch,
  date,
  matches,
  formatTime,
  setAutoState,
  setWatchlistAlertCount,
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/5 bg-[#030304] shadow-2xl">
      <div className="sticky top-0 z-20 border-b border-white/5 bg-[#030304]/95 backdrop-blur-xl">
        <div className="px-4 py-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Workspace
              </div>
              <h2 className="mt-1 text-sm font-black uppercase tracking-[0.18em] text-slate-100">
                Högerpanel
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Kompakt överblick över dagens signaler. Flikarna håller ytan ren och låter bara högersidan scrolla.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <HeaderBadge label="Datum" value={date || "—"} tone="accent" />
              <HeaderBadge label="Shortlist" value={autoState?.summary?.shortlistCount || 0} tone={(autoState?.summary?.shortlistCount || 0) > 0 ? "positive" : "neutral"} />
              <HeaderBadge label="Proof-klara" value={autoState?.summary?.provenCount || 0} tone={(autoState?.summary?.provenCount || 0) > 0 ? "positive" : "warning"} />
              <HeaderBadge label="Alerts" value={watchlistAlertCount || 0} tone={(watchlistAlertCount || 0) > 0 ? "positive" : "neutral"} />
            </div>
          </div>
        </div>

        <div className="border-t border-white/5 px-4 py-3">
          <div className="inline-flex items-center rounded-full border border-white/10 bg-black/30 p-1">
            {RIGHT_PANE_TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] transition ${
                    active
                      ? "bg-cyan-500/15 text-cyan-300"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {activeTab === "overview" ? (
          <div className="space-y-4">
            <DashboardCockpit
              autoState={autoState}
              watchlistAlertCount={watchlistAlertCount}
              onOpenMatch={onOpenMatch}
            />
            <DayInsightsLegacy date={date} items={matches.map((match) => match.raw || match)} />
          </div>
        ) : null}

        {activeTab === "auto" ? (
          <DailyAutoAnalysis
            date={date}
            matches={matches}
            formatTime={formatTime}
            onOpenMatch={onOpenMatch}
            onAutoStateChange={setAutoState}
          />
        ) : null}

        {activeTab === "watchlist" ? (
          <WatchlistPanel
            currentShortlist={autoState.shortlist}
            onOpenMatch={onOpenMatch}
            onAlertCountChange={setWatchlistAlertCount}
          />
        ) : null}

        {activeTab === "history" ? (
          <AutoAnalysisHistory onOpenMatch={onOpenMatch} />
        ) : null}
      </div>
    </div>
  );
}

export default function MatchesClient({ defaultDate, initialFallback = {} }) {
  const [date, setDate] = useState(defaultDate);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [detailTab, setDetailTab] = useState("stats");
  const [workspaceTab, setWorkspaceTab] = useState("overview");
  const [autoState, setAutoState] = useState({ shortlist: [], bestOverall: null, summary: {} });
  const [watchlistAlertCount, setWatchlistAlertCount] = useState(0);
  const { cache, mutate: globalMutate } = useSWRConfig();
  const fallbackRef = useRef(initialFallback);

  useEffect(() => {
    Object.entries(fallbackRef.current || {}).forEach(([key, value]) => {
      if (!key) return;
      const state = cache.get(key);
      if (!state || state.data === undefined) {
        globalMutate(key, value, { revalidate: false, populateCache: true });
      }
    });
  }, [cache, globalMutate]);

  const prefetchTeamProfiles = useCallback(
    async (matchesToPrefetch) => {
      if (!Array.isArray(matchesToPrefetch) || !matchesToPrefetch.length) return;
      const keys = new Set();
      for (const match of matchesToPrefetch) {
        const homeKey = buildTeamProfileKeyForMatch(match, "home");
        const awayKey = buildTeamProfileKeyForMatch(match, "away");
        if (homeKey) keys.add(homeKey);
        if (awayKey) keys.add(awayKey);
      }
      if (!keys.size) return;

      const queue = [];
      keys.forEach((key) => {
        const state = cache.get(key);
        const hasCache = Boolean(state && state.data !== undefined);
        debug("teamprofiles:prefetch:key", { key, hasCache });
        if (!hasCache) queue.push(key);
      });

      let pointer = 0;
      const concurrency = Math.min(6, queue.length);
      const worker = async () => {
        while (pointer < queue.length) {
          const key = queue[pointer++];
          if (!key) continue;
          try {
            const data = await fetchTeamProfile(key);
            await globalMutate(key, data, { revalidate: false, populateCache: true });
          } catch (prefetchError) {
            debugError("teamprofiles:prefetch:error", { key, message: prefetchError?.message });
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, worker));
    },
    [cache, globalMutate]
  );

  const matchesKey = date ? buildMatchesByDateKey(date) : null;
  const tomorrowDate = useMemo(() => getNextDateString(date), [date]);
  const tomorrowMatchesKey = tomorrowDate ? buildMatchesByDateKey(tomorrowDate) : null;

  const { data, error, isLoading } = useSWR(matchesKey, fetchJson, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60_000,
    keepPreviousData: true,
  });

  const { data: tomorrowData } = useSWR(tomorrowMatchesKey, fetchJson, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60_000,
    keepPreviousData: true,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const matches = useMemo(() => items.map(normalizeMatch).filter(Boolean), [items]);
  const tomorrowItems = useMemo(() => tomorrowData?.items ?? [], [tomorrowData]);

  useEffect(() => {
    if (data) debug("matches:data", { date, items: data.items?.length ?? 0 });
  }, [data, date]);

  const prefetchInFlightRef = useRef(Promise.resolve());

  useEffect(() => {
    if (!matchesKey || !matches.length) {
      prefetchInFlightRef.current = Promise.resolve();
      return;
    }
    let cancelled = false;
    prefetchInFlightRef.current = Promise.resolve(prefetchTeamProfiles(matches))
      .catch((prefetchError) => {
        if (!cancelled) {
          debugError("teamprofiles:prefetch:failure", {
            key: matchesKey,
            message: prefetchError?.message,
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          debug("teamprofiles:prefetch:cycle-complete", { key: matchesKey });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [matchesKey, matches, prefetchTeamProfiles]);

  useEffect(() => {
    if (!tomorrowItems.length) return;
    Promise.resolve(prefetchTeamProfiles(tomorrowItems)).catch((prefetchError) => {
      debugError("teamprofiles:prefetch:tomorrow", {
        key: tomorrowMatchesKey,
        message: prefetchError?.message,
      });
    });
  }, [tomorrowItems, tomorrowMatchesKey, prefetchTeamProfiles]);

  useEffect(() => {
    if (selectedMatchId && !matches.some((match) => match.id === selectedMatchId)) {
      setSelectedMatchId(null);
      setDetailTab("stats");
    }
  }, [matches, selectedMatchId]);

  const formatter = useMemo(makeFormatter, []);
  const formatTime = (ts) => (ts ? formatter.format(new Date(ts * 1000)) : "—");

  const matchDetailsKey = selectedMatchId ? buildMatchDetailsKey(selectedMatchId) : null;
  const {
    data: matchDetails,
    error: matchError,
    isLoading: isMatchLoading,
  } = useSWR(matchDetailsKey, fetchJsonAllow404, {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
  });

  const selectedMatchSummary = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) ?? null,
    [matches, selectedMatchId]
  );

  const mergedMatch = useMemo(() => {
    if (!selectedMatchSummary) return null;
    return {
      leagueId: selectedMatchSummary.leagueId,
      leagueName: selectedMatchSummary.leagueName,
      ...selectedMatchSummary.raw,
      ...(matchDetails ?? {}),
      matchId: selectedMatchSummary.id,
      homeTeamName: matchDetails?.homeTeamName ?? selectedMatchSummary.homeTeamName,
      awayTeamName: matchDetails?.awayTeamName ?? selectedMatchSummary.awayTeamName,
      homeTeamId: matchDetails?.homeTeamId ?? selectedMatchSummary.homeTeamId,
      awayTeamId: matchDetails?.awayTeamId ?? selectedMatchSummary.awayTeamId,
    };
  }, [selectedMatchSummary, matchDetails]);

  const handlePrefetchMatch = useCallback(
    (match) => {
      if (!match) return;
      void prefetchTeamProfiles([match]).catch((prefetchError) => {
        debugError("teamprofiles:prefetch:on-hover", {
          matchId: match.id ?? match.matchId ?? null,
          message: prefetchError?.message,
        });
      });
    },
    [prefetchTeamProfiles]
  );

  const handleSelectMatch = useCallback(
    (payload, preferredTab = "stats") => {
      const resolvedId = toMatchId(payload);
      if (!resolvedId) {
        debugError("selection:invalid", { payload });
        return;
      }
      const matchForSelection = matches.find((match) => match.id === resolvedId);
      if (matchForSelection) {
        void prefetchTeamProfiles([matchForSelection]).catch((prefetchError) => {
          debugError("teamprofiles:prefetch:on-select", {
            matchId: resolvedId,
            message: prefetchError?.message,
          });
        });
      }
      setDetailTab(preferredTab || "stats");
      setSelectedMatchId(resolvedId);
    },
    [matches, prefetchTeamProfiles]
  );

  const showDetails = Boolean(selectedMatchSummary);
  const containerWidthClass = showDetails ? "max-w-full" : "md:max-w-[92vw]";
  const containerPaddingClass = showDetails ? "px-3 sm:px-6 lg:px-8" : "px-4 sm:px-6";
  const gridColumnsClass = showDetails
    ? "grid-cols-1 md:[grid-template-columns:500px_1fr] xl:[grid-template-columns:550px_1fr]"
    : "grid-cols-1 md:[grid-template-columns:1fr_2fr] xl:[grid-template-columns:1fr_2fr]";

  return (
    <div className="flex w-full flex-col overflow-x-hidden lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div
        className={`mx-auto flex w-full flex-1 flex-col overflow-x-hidden pb-6 ${containerPaddingClass} ${containerWidthClass} lg:h-full lg:min-h-0 lg:overflow-hidden`}
      >
        <div
          className={`grid w-full gap-4 ${gridColumnsClass} auto-rows-auto md:h-full md:min-h-0 lg:h-full lg:min-h-0`}
        >
          <LeagueTables
            date={date}
            onDateChange={setDate}
            items={items}
            formatTime={formatTime}
            onSelectMatch={(match) => handleSelectMatch(match, "stats")}
            onPrefetchMatch={handlePrefetchMatch}
            selectedMatchId={selectedMatchId}
            isLoading={isLoading}
            error={error}
            matchesCount={matches.length}
          />

          {showDetails ? (
            <div className="min-h-0 md:h-full lg:h-full lg:overflow-hidden">
              <MatchDetailsTabs
                match={mergedMatch}
                isLoading={isMatchLoading}
                error={matchError}
                preferredTab={detailTab}
              />
            </div>
          ) : (
            <div className="min-h-0 md:h-full lg:h-full lg:overflow-hidden">
              <RightPaneWorkspace
                activeTab={workspaceTab}
                onTabChange={setWorkspaceTab}
                autoState={autoState}
                watchlistAlertCount={watchlistAlertCount}
                onOpenMatch={handleSelectMatch}
                date={date}
                matches={matches}
                formatTime={formatTime}
                setAutoState={setAutoState}
                setWatchlistAlertCount={setWatchlistAlertCount}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
