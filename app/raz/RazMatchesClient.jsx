"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import LeagueTables from "@/components/LeagueTables";
import TeamCompare from "@/components/TeamCompare";
import DayInsightsLegacy from "@/components/DayInsights-copy";
import DayInsights from "@/components/DayInsights-copy-v2";
import Lineups from "@/components/Lineups";
import BacktestPage from "@/components/BacktestPage";
import ClosingOddsCard from "@/components/ClosingOddsCard";
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

const DEBUG_TAG = "[RazMatchesClient]";
const debug = (...args) => console.log(DEBUG_TAG, ...args);
const debugError = (...args) => console.error(DEBUG_TAG, ...args);

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
      return toMatchId(value.matchId ?? value.id ?? value._id ?? null);
    }
    return null;
  }

export default function RazMatchesClient({
  defaultDate,
  initialFallback = {},
  activeTab = "home",
  resetKeys = [],
}) {
  const [date, setDate] = useState(defaultDate);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const { cache, mutate: globalMutate } = useSWRConfig();
  const fallbackRef = useRef(initialFallback);
  const boundaryResetKeys = resetKeys.filter(Boolean);

  useEffect(() => {
    const entries = Object.entries(fallbackRef.current || {});
    if (!entries.length) return;
    entries.forEach(([key, value]) => {
      if (!key) return;
      const state = cache.get(key);
      if (!state || state.data === undefined) {
        globalMutate(key, value, {
          revalidate: false,
          populateCache: true,
        });
      }
    });
  }, [cache, globalMutate]);

  const prefetchTeamProfiles = useCallback(
    async (matchesToPrefetch) => {
      if (!Array.isArray(matchesToPrefetch) || !matchesToPrefetch.length) {
        return;
      }

      const keys = new Set();
      for (const match of matchesToPrefetch) {
        const homeKey = buildTeamProfileKeyForMatch(match, "home");
        const awayKey = buildTeamProfileKeyForMatch(match, "away");
        if (homeKey) keys.add(homeKey);
        if (awayKey) keys.add(awayKey);
      }

      if (!keys.size) {
        return;
      }

      const queue = [];
      keys.forEach((key) => {
        const state = cache.get(key);
        const hasCache = Boolean(state && state.data !== undefined);
        debug("teamprofiles:prefetch:key", { key, hasCache });
        if (!hasCache) {
          queue.push(key);
        }
      });

      if (!queue.length) {
        debug("teamprofiles:prefetch:all-cached", { total: keys.size });
        return;
      }

      debug("teamprofiles:prefetch:start", { total: queue.length });

      let pointer = 0;
      const concurrency = Math.min(6, queue.length);

      const worker = async () => {
        while (pointer < queue.length) {
          const currentIndex = pointer;
          pointer += 1;
          const key = queue[currentIndex];
          if (!key) continue;
          try {
            const data = await fetchTeamProfile(key);
            await globalMutate(key, data, {
              revalidate: false,
              populateCache: true,
            });
          } catch (prefetchError) {
            debugError("teamprofiles:prefetch:error", {
              key,
              message: prefetchError?.message,
            });
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, worker));
      debug("teamprofiles:prefetch:done", { total: queue.length });
    },
    [cache, globalMutate]
  );

  const matchesKey = date ? buildMatchesByDateKey(date) : null;
  const tomorrowDate = useMemo(() => getNextDateString(date), [date]);
  const tomorrowMatchesKey = tomorrowDate ? buildMatchesByDateKey(tomorrowDate) : null;

  // const { data, error, isLoading } = useSWR(matchesKey, fetchJson, {
  //   revalidateOnFocus: false,
  //   revalidateIfStale: false,
  //   revalidateOnReconnect: false,
  //   dedupingInterval: 60_000,
  //   keepPreviousData: true,
  // });

  //   useEffect(() => {
  //     if (!data) return;
  //     debug("matches:data", {
  //       date,
  //       items: data.items?.length ?? 0,
  //     });
  //   }, [data, date]);

  //   useEffect(() => {
  //     if (!matchesKey) return;
  //     if (!matches.length) return;
  //     let cancelled = false;
  //     prefetchTeamProfiles(matches).catch((prefetchError) => {
  //       if (cancelled) return;
  //       debugError("teamprofiles:prefetch:failure", {
  //         key: matchesKey,
  //         message: prefetchError?.message,
  //       });
  //     });
  //     return () => {
  //       cancelled = true;
  //     };
  //   }, [matchesKey, matches, prefetchTeamProfiles]);

  //   if (error) {
  //     debugError("matches:error", error);
  //   }
  
  
  const {
    data,
    error,
    isLoading,
  } = useSWR(matchesKey, fetchJson, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60_000,
    keepPreviousData: true,
  });

  const {
    data: tomorrowData,
  } = useSWR(tomorrowMatchesKey, fetchJson, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60_000,
    keepPreviousData: true,
  });

  // ⬇️ Flytta UPP dessa två så de kommer innan effekter
  const items = useMemo(() => data?.items ?? [], [data]);

  const matches = useMemo(() => {
    const normalized = items.map(normalizeMatch);
    debug("matches:normalized", {
      count: normalized.length,
      sample: normalized.slice(0, 3).map((match) => ({
        matchId: match.id,
        leagueId: match.leagueId,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
      })),
    });
    return normalized;
  }, [items]);

  const tomorrowItems = useMemo(() => tomorrowData?.items ?? [], [tomorrowData]);

  // Nu kan effekterna tryggt referera till matches
  useEffect(() => {
    if (!data) return;
    debug("matches:data", {
      date,
      items: data.items?.length ?? 0,
    });
  }, [data, date]);

  const prefetchInFlightRef = useRef(Promise.resolve());

  useEffect(() => {
    if (!matchesKey || !matches.length) {
      prefetchInFlightRef.current = Promise.resolve();
      return;
    }
    let cancelled = false;
    const basePromise = prefetchTeamProfiles(matches);
    if (basePromise instanceof Promise) {
      prefetchInFlightRef.current = basePromise
        .catch((prefetchError) => {
          if (cancelled) return;
          debugError("teamprofiles:prefetch:failure", {
            key: matchesKey,
            message: prefetchError?.message,
          });
        })
        .finally(() => {
          if (!cancelled) {
            debug("teamprofiles:prefetch:cycle-complete", { key: matchesKey });
          }
        });
    } else {
      prefetchInFlightRef.current = Promise.resolve();
    }

    return () => {
      cancelled = true;
    };
  }, [matchesKey, matches, prefetchTeamProfiles]);

  useEffect(() => {
    if (!tomorrowItems.length) return;
    const promise = prefetchTeamProfiles(tomorrowItems);
    Promise.resolve(promise)
      .catch((prefetchError) => {
        debugError("teamprofiles:prefetch:tomorrow", {
          key: tomorrowMatchesKey,
          message: prefetchError?.message,
        });
      });
  }, [tomorrowItems, tomorrowMatchesKey, prefetchTeamProfiles]);

  if (error) {
    debugError("matches:error", error);
  }


    // const allItems = useMemo(() => data?.items ?? [], [data]);

    // const items = useMemo(() => {
    //   return allItems.filter((entry) => {
    //     const ts = getTimestamp(entry);
    //     if (!ts) return false;
    //     return ymdSEFromTs(ts) === date;
    //   });
    // }, [allItems, date]);
    
    // const items = useMemo(() => data?.items ?? [], [data]);

    // const matches = useMemo(() => {
    //   const normalized = items.map(normalizeMatch);
    //   debug("matches:normalized", {
    //     count: normalized.length,
    //     sample: normalized.slice(0, 3).map((match) => ({
    //       matchId: match.id,
    //       leagueId: match.leagueId,
    //       homeTeamId: match.homeTeamId,
    //       awayTeamId: match.awayTeamId,
    //     })),
    //   });
    //   return normalized;
    // }, [items]);

    useEffect(() => {
      if (!selectedMatchId) return;
      const stillExists = matches.some((match) => match.id === selectedMatchId);
      if (!stillExists) {
        debug("selection:cleared", {
          reason: "match not in current list",
          selectedMatchId,
        });
        setSelectedMatchId(null);
      }
    }, [matches, selectedMatchId]);

    const formatter = useMemo(makeFormatter, []);
    const formatTime = (ts) => (ts ? formatter.format(new Date(ts * 1000)) : "—");

    const matchDetailsKey = selectedMatchId
      ? buildMatchDetailsKey(selectedMatchId)
      : null;

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

    useEffect(() => {
      if (!selectedMatchId) return;
      debug("details:fetch", {
        selectedMatchId,
        isMatchLoading,
        hasDetails: Boolean(matchDetails),
        error: matchError ? matchError.message : null,
      });
    }, [selectedMatchId, matchDetails, isMatchLoading, matchError]);

    const selectedMatchSummary = useMemo(
      () => matches.find((match) => match.id === selectedMatchId) ?? null,
      [matches, selectedMatchId]
    );

    useEffect(() => {
      if (!selectedMatchId) return;
      debug("selection:update", {
        selectedMatchId,
        summary: selectedMatchSummary
          ? {
              leagueId: selectedMatchSummary.leagueId,
              homeTeamId: selectedMatchSummary.homeTeamId,
              awayTeamId: selectedMatchSummary.awayTeamId,
            }
          : null,
      });
    }, [selectedMatchId, selectedMatchSummary]);

    useEffect(() => {
      if (!resetKeys.length) return;
      setSelectedMatchId(null);
    }, [resetKeys]);

    const mergedMatch = useMemo(() => {
      if (!selectedMatchSummary) return null;
      const merged = {
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
      debug("match:merged", {
        matchId: merged.matchId,
        leagueId: merged.leagueId,
        homeTeamId: merged.homeTeamId,
        awayTeamId: merged.awayTeamId,
        hasDetails: Boolean(matchDetails),
      });
      return merged;
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

    const handleSelectMatch = useCallback((payload) => {
      const resolvedId = toMatchId(payload);
      if (!resolvedId) {
        debugError("selection:invalid", { payload });
        return;
      }
      debug("selection:requested", {
        payload,
        resolvedId,
      });
      const matchForSelection = matches.find((match) => match.id === resolvedId);
      if (matchForSelection) {
        void prefetchTeamProfiles([matchForSelection]).catch((prefetchError) => {
          debugError("teamprofiles:prefetch:on-select", {
            matchId: resolvedId,
            message: prefetchError?.message,
          });
        });
      } else {
        void Promise.resolve(prefetchInFlightRef.current);
      }

      setSelectedMatchId(resolvedId);
    }, [matches, prefetchTeamProfiles]);

    const showDetails = Boolean(selectedMatchSummary);
    const homeActive = activeTab === "home";
    const favoritesActive = activeTab === "favorites";
    const addActive = activeTab === "add";
    const backtestActive = activeTab === "backtest";

    return (
      <div className="flex w-full flex-col gap-5">
        {homeActive && (
          <div className="flex flex-col gap-5 pb-16">
            <LeagueTables
              date={date}
              onDateChange={setDate}
              items={items}
              formatTime={formatTime}
              onSelectMatch={handleSelectMatch}
              onPrefetchMatch={handlePrefetchMatch}
              selectedMatchId={selectedMatchId}
              isLoading={isLoading}
              error={error}
              matchesCount={matches.length}
            />
            <div className="grid gap-4 md:grid-cols-2">
                <DayInsightsLegacy date={date} items={items} />
                <DayInsights date={date} items={items} />
            </div>
          </div>
        )}

        {favoritesActive && (
          <div className="flex flex-col gap-4 pb-16">
            {showDetails ? (
              <TeamCompare
                match={mergedMatch}
                isLoading={isMatchLoading}
                error={matchError}
              />
            ) : (
              <div className="rounded-2xl border border-gray-200 bg-white px-6 py-8 text-sm text-gray-500 shadow-sm">
                Välj en match för att visa lagprofiler.
              </div>
            )}
          </div>
        )}

        {addActive && (
          <div className="grid gap-4 md:grid-cols-2 pb-16">
            {showDetails ? (
              <>
                <ClosingOddsCard match={mergedMatch} />
                <Lineups match={mergedMatch} isLoading={isMatchLoading} />
              </>
            ) : (
              <div className="rounded-2xl border border-gray-200 bg-white px-6 py-8 text-sm text-gray-500 shadow-sm md:col-span-2">
                Välj en match för att visa odds och laguppställning.
              </div>
            )}
          </div>
        )}

        {backtestActive && (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-6 shadow-sm">
            {showDetails ? (
              <BacktestPage match={mergedMatch} />
            ) : (
              <p className="text-sm text-gray-500">
                Välj en match för att köra backtest.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }
