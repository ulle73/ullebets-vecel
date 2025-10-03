"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import LeagueTables from "@/components/LeagueTables";
import TeamCompare from "@/components/TeamCompare";
import Lineups from "@/components/Lineups";
import BacktestPage from "@/components/BacktestPage";
import { normalizeMatch } from "@/components/LeagueTable";

const fetcher = (url) =>
  fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  });

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

  const allItems = useMemo(() => data?.items ?? [], [data]);

  const items = useMemo(() => {
    return allItems.filter((entry) => {
      const ts = getTimestamp(entry);
      if (!ts) return false;
      return ymdSEFromTs(ts) === date;
    });
  }, [allItems, date]);

  const matches = useMemo(() => items.map(normalizeMatch), [items]);

  useEffect(() => {
    if (!selectedMatchId) return;
    const stillExists = matches.some((match) => match.id === selectedMatchId);
    if (!stillExists) {
      setSelectedMatchId(null);
    }
  }, [matches, selectedMatchId]);

  const formatter = useMemo(makeFormatter, []);
  const formatTime = (ts) => (ts ? formatter.format(new Date(ts * 1000)) : "—");

  const { data: matchDetails, error: matchError, isLoading: isMatchLoading } = useSWR(
    selectedMatchId ? `/api/match/${selectedMatchId}` : null,
    fetcher,
    {
      shouldRetryOnError: false,
      revalidateOnFocus: false,
    }
  );

  const selectedMatchSummary = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) ?? null,
    [matches, selectedMatchId]
  );

  const mergedMatch = useMemo(() => {
    if (!selectedMatchSummary) return null;
    return {
      ...selectedMatchSummary.raw,
      ...matchDetails,
      matchId: selectedMatchSummary.id,
      homeTeamName: matchDetails?.homeTeamName ?? selectedMatchSummary.homeTeamName,
      awayTeamName: matchDetails?.awayTeamName ?? selectedMatchSummary.awayTeamName,
      homeTeamId: matchDetails?.homeTeamId ?? selectedMatchSummary.homeTeamId,
      awayTeamId: matchDetails?.awayTeamId ?? selectedMatchSummary.awayTeamId,
    };
  }, [selectedMatchSummary, matchDetails]);

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
            onSelectMatch={setSelectedMatchId}
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
