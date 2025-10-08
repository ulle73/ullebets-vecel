"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { extractClosingOdds } from "@/lib/utils/closingOdds";

const TEAM_STATS_ENDPOINT = "/api/backtest";
const TEAM_MATCH_LIMIT = 5;

async function requestTeamMatches(teamName, matchType) {
  const res = await fetch(TEAM_STATS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "team-stats",
      teamName,
      matchType,
    }),
  });

  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = payload?.message || `Failed to fetch ${matchType} matches`;
    throw new Error(message);
  }

  return Array.isArray(payload?.matches) ? payload.matches : [];
}

async function fetchTeamOddsHistory([, teamName]) {
  const results = await Promise.allSettled([
    requestTeamMatches(teamName, "home"),
    requestTeamMatches(teamName, "away"),
  ]);

  const matches = [];
  const errors = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const perspective = index === 0 ? "home" : "away";
      matches.push(
        ...result.value.map((match) => ({
          match,
          perspective,
        }))
      );
    } else if (result.status === "rejected") {
      errors.push(result.reason);
    }
  });

  if (!matches.length && errors.length) {
    throw errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]));
  }

  return {
    matches,
    partialErrors: errors,
  };
}

function toTimestamp(match) {
  const rawTimestamp = match?.timestamp;
  if (typeof rawTimestamp === "number") {
    return rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000;
  }
  if (typeof rawTimestamp === "string" && rawTimestamp) {
    const parsed = Number(rawTimestamp);
    if (Number.isFinite(parsed)) {
      return parsed > 1e12 ? parsed : parsed * 1000;
    }
  }
  const dateValue = match?.date || match?.matchDate || match?.savedAt;
  if (dateValue) {
    const parsed = Date.parse(dateValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function resolveMatchDate(match) {
  if (match?.date) {
    return match.date;
  }
  const timestamp = toTimestamp(match);
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toISOString().slice(0, 10);
}

function resolveOpponent(match, perspective) {
  if (perspective === "home") {
    return (
      match?.awayTeamName ||
      match?.awayTeam?.name ||
      match?.awayTeam?.teamName ||
      match?.awayTeam ||
      null
    );
  }
  return (
    match?.homeTeamName ||
    match?.homeTeam?.name ||
    match?.homeTeam?.teamName ||
    match?.homeTeam ||
    null
  );
}

function normalizeMatchEntry(match, perspective) {
  const timestamp = toTimestamp(match);
  const closing = extractClosingOdds(match)?.values || null;
  return {
    id:
      match?.matchId ||
      match?.id ||
      match?.gameId ||
      match?.eventId ||
      `${match?.date || ""}-${match?.homeTeamName || ""}-${match?.awayTeamName || ""}`,
    timestamp: timestamp ?? 0,
    date: resolveMatchDate(match),
    opponent: resolveOpponent(match, perspective),
    venue: perspective,
    closingOdds: closing,
  };
}

function formatOddsValue(value) {
  if (typeof value === "number") {
    return value.toFixed(2);
  }
  return value ? String(value) : "–";
}

function useTeamOdds(teamName) {
  return useSWR(teamName ? ["team-odds-history", teamName] : null, fetchTeamOddsHistory, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60 * 1000,
  });
}

function TeamOddsTable({ teamName, data, loading, error }) {
  const items = useMemo(() => {
    if (!data?.matches?.length) {
      return [];
    }

    const normalized = data.matches
      .map(({ match, perspective }) => normalizeMatchEntry(match, perspective))
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    return normalized.slice(0, TEAM_MATCH_LIMIT);
  }, [data]);

  const partialError = data?.partialErrors?.length ? data.partialErrors[0] : null;

  let content = null;

  if (!teamName) {
    content = (
      <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
        Välj en match för att se odds.
      </div>
    );
  } else if (loading) {
    content = (
      <div className="flex flex-1 items-center justify-center text-xs text-gray-500">
        Hämtar odds…
      </div>
    );
  } else if (error) {
    content = (
      <div className="flex flex-1 items-center justify-center px-2 text-center text-xs text-gray-500">
        Kunde inte hämta oddsdata.
      </div>
    );
  } else if (!items.length) {
    content = (
      <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
        Inga tidigare matcher hittades.
      </div>
    );
  } else {
    content = (
      <div className="flex-1 overflow-auto">
        <table className="min-w-full table-fixed text-left text-[11px] text-gray-600">
          <thead className="sticky top-0 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-20 px-2 py-1 font-semibold">Datum</th>
              <th className="px-2 py-1 font-semibold">Motstånd</th>
              <th className="w-10 px-2 py-1 text-right font-semibold">1</th>
              <th className="w-10 px-2 py-1 text-right font-semibold">X</th>
              <th className="w-10 px-2 py-1 text-right font-semibold">2</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-gray-100 last:border-b-0">
                <td className="px-2 py-1 align-middle text-xs font-medium text-gray-700">
                  {item.date || "–"}
                </td>
                <td className="px-2 py-1 align-middle text-xs text-gray-600">
                  <span className="font-medium text-gray-700">
                    {item.venue === "home" ? "vs" : "@"}
                  </span>{" "}
                  {item.opponent || "Okänd"}
                </td>
                <td className="px-2 py-1 text-right text-xs font-semibold text-gray-700">
                  {formatOddsValue(item.closingOdds?.home)}
                </td>
                <td className="px-2 py-1 text-right text-xs font-semibold text-gray-700">
                  {formatOddsValue(item.closingOdds?.draw)}
                </td>
                <td className="px-2 py-1 text-right text-xs font-semibold text-gray-700">
                  {formatOddsValue(item.closingOdds?.away)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {teamName || "Ingen match"}
        </p>
        {partialError ? (
          <span className="text-[10px] text-amber-600">Delvis data</span>
        ) : null}
      </div>
      {content}
    </div>
  );
}

export default function TeamOddsHistory({ match, className = "" }) {
  const homeTeamName =
    match?.homeTeamName ||
    match?.homeTeam?.name ||
    match?.homeTeam?.teamName ||
    null;
  const awayTeamName =
    match?.awayTeamName ||
    match?.awayTeam?.name ||
    match?.awayTeam?.teamName ||
    null;

  const homeOdds = useTeamOdds(homeTeamName);
  const awayOdds = useTeamOdds(awayTeamName);

  const containerClass = [
    "flex h-full flex-col bg-gray-50/60",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClass}>
      <div className="border-b border-gray-200 px-4 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          Senaste 5 closing odds
        </h3>
        <p className="text-[11px] text-gray-500">
          Hämtar hem- och bortastatistik från databasen.
        </p>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden px-4 py-3 md:grid-cols-2">
        <div className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
          <TeamOddsTable
            teamName={homeTeamName}
            data={homeOdds.data}
            loading={homeOdds.isLoading}
            error={homeOdds.error}
          />
        </div>
        <div className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
          <TeamOddsTable
            teamName={awayTeamName}
            data={awayOdds.data}
            loading={awayOdds.isLoading}
            error={awayOdds.error}
          />
        </div>
      </div>
    </div>
  );
}
