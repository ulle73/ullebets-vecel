"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import LeagueTables from "@/components/LeagueTables";
import TeamCompare from "@/components/TeamCompare";
import Lineups from "@/components/Lineups";
import BacktestPage from "@/components/BacktestPage";
import { normalizeMatch } from "@/components/LeagueTable";

const DEBUG_TAG = "[MatchesClient]";
const debug = (...args) => console.log(DEBUG_TAG, ...args);
const debugError = (...args) => console.error(DEBUG_TAG, ...args);

const fetcher = (url) =>
  fetch(url).then((response) => {
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  });

const detailFetcher = async (url) => {
  const response = await fetch(url);
  if (response.status === 404) {
    debug("details:404", { url });
    return null;
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

const getTimestamp = (entry) =>
  Number(
    entry?.startTimestamp ??
      entry?.event?.startTimestamp ??
      entry?.timestamp ??
      entry?.kickoffTime ??
      0
  ) || 0;

function makeFormatter() {
  return new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Stockholm",
  });
}

function ymdSEFromTs(ts) {
  const date = new Date(ts * 1000);
  return date.toLocaleDateString("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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

export default function MatchesClient({ defaultDate }) {
  const [date, setDate] = useState(defaultDate);
  const [selectedMatchId, setSelectedMatchId] = useState(null);

  const { data, error, isLoading } = useSWR(
    date ? `/api/matches/by-date?date=${date}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
      keepPreviousData: true,
    }
  );

  useEffect(() => {
    if (!data) return;
    debug("matches:data", {
      date,
      items: data.items?.length ?? 0,
    });
  }, [data, date]);

  if (error) {
    debugError("matches:error", error);
  }

  const allItems = useMemo(() => data?.items ?? [], [data]);

  const items = useMemo(() => {
    return allItems.filter((entry) => {
      const ts = getTimestamp(entry);
      if (!ts) return false;
      return ymdSEFromTs(ts) === date;
    });
  }, [allItems, date]);

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

  const {
    data: matchDetails,
    error: matchError,
    isLoading: isMatchLoading,
  } = useSWR(
    selectedMatchId ? `/api/match/${selectedMatchId}` : null,
    detailFetcher,
    {
      shouldRetryOnError: false,
      revalidateOnFocus: false,
    }
  );

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