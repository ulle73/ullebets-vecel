"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import LeagueTables from "@/components/LeagueTables";
import TeamCompare from "@/components/TeamCompare";
import Lineups from "@/components/Lineups";
import BacktestPage from "@/components/BacktestPage";
import { normalizeMatch } from "@/components/LeagueTable";
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

function makeFormatter() {
  return new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Stockholm",
  });
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

export default function MatchesClient({ defaultDate, initialFallback = {} }) {
  const [date, setDate] = useState(defaultDate);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const { cache, mutate: globalMutate } = useSWRConfig();
  const fallbackRef = useRef(initialFallback);

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
      if (!Array.isArray(matchesToPrefetch) || !matchesToPrefetch.length) return;

      const keys = new Set();
      for (const match of matchesToPrefetch) {
        const homeKey = buildTeamProfileKeyForMatch(match, "home");
        const awayKey = buildTeamProfileKeyForMatch(match, "away");
        if (homeKey) keys.add(homeKey);
        if (awayKey) keys.add(awayKey);
      }

      const queue = Array.from(keys).filter((key) => {
        const state = cache.get(key);
        return !(state && state.data !== undefined);
      });

      if (!queue.length) return;

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

  const { data, error, isLoading } = useSWR(matchesKey, fetchJson, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60_000,
    keepPreviousData: true,
  });

    useEffect(() => {
      if (!data) return;
      debug("matches:data", {
        date,
        items: data.items?.length ?? 0,
      });
    }, [data, date]);

    useEffect(() => {
      if (!matchesKey) return;
      if (!matches.length) return;
      let cancelled = false;
      prefetchTeamProfiles(matches).catch((prefetchError) => {
        if (cancelled) return;
        debugError("teamprofiles:prefetch:failure", {
          key: matchesKey,
          message: prefetchError?.message,
        });
      });
      return () => {
        cancelled = true;
      };
    }, [matchesKey, matches, prefetchTeamProfiles]);

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

    const handleSelectMatch = (payload) => {
      const resolvedId = toMatchId(payload);
      if (!resolvedId) {
        debugError("selection:invalid", { payload });
        return;
      }
      debug("selection:requested", {
        payload,
        resolvedId,
      });
      setSelectedMatchId(resolvedId);
    };

    const showDetails = Boolean(selectedMatchSummary);

    const containerWidthClass = showDetails ? "max-w-full" : "md:max-w-[70vw]";
    const containerPaddingClass = showDetails ? "px-3 sm:px-6 lg:px-8" : "px-4 sm:px-6";
    const gridColumnsClass = showDetails
      ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
      : "grid-cols-1 md:grid-cols-2";
    const gridRowClass = "auto-rows-[minmax(0,1fr)]";

    return (
      <div className="w-full">
        <div
          className={`mx-auto w-full ${containerPaddingClass} pb-6 ${containerWidthClass}`}
        >
          <div className={`grid gap-4 ${gridColumnsClass} ${gridRowClass}`}>
            <LeagueTables
              date={date}
              onDateChange={setDate}
              items={items}
              formatTime={formatTime}
              onSelectMatch={handleSelectMatch}
              selectedMatchId={selectedMatchId}
              isLoading={isLoading}
              error={error}
              matchesCount={matches.length}
            />

            <TeamCompare
              match={mergedMatch}
              isLoading={isMatchLoading}
              error={matchError}
            />

            {showDetails ? (
              <Lineups match={mergedMatch} isLoading={isMatchLoading} />
            ) : null}

            {showDetails ? <BacktestPage match={mergedMatch} /> : null}
          </div>
        </div>
      </div>
    );
  }