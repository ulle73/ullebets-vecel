"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { extractClosingOdds } from "@/lib/utils/closingOdds";

const TEAM_STATS_ENDPOINT = "/api/backtest";
const TEAM_MATCH_LIMIT = 5;

async function requestTeamMatches(teamName, matchType) {
  console.log(`[requestTeamMatches] Fetching for team: '${teamName}', type: '${matchType}'`);
  const res = await fetch(TEAM_STATS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "team-stats", teamName, matchType }),
  });

  console.log(`[requestTeamMatches] API response status for '${teamName}': ${res.status}`);
  const payload = await res.json().catch(() => ({}));
  console.log(`[requestTeamMatches] API payload for '${teamName}':`, payload);

  if (!res.ok) {
    const message = payload?.message || `Failed to fetch matches for ${teamName}`;
    console.error(`[requestTeamMatches] Error for '${teamName}':`, message);
    throw new Error(message);
  }

  return Array.isArray(payload?.matches) ? payload.matches : [];
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

function resolvePerspective(match, teamName) {
  const homeTeamCandidates = [match?.homeTeamName, match?.homeTeam?.name].filter(Boolean);
  const normalizedTeamName = (teamName || "").toLowerCase();

  const isHome = homeTeamCandidates.some(
    (candidate) => (candidate || "").toLowerCase() === normalizedTeamName
  );
  if (isHome) {
    return "home";
  }
  return "away";
}

function normalizeMatchEntry(match, perspective) {
   // console.log(`[normalizeMatchEntry] Normalizing match for perspective '${perspective}':`, match);
   const timestamp = toTimestamp(match);
   const closingInfo = extractClosingOdds(match) || null;
   const closing = closingInfo?.values || null;
   const winner = closingInfo?.winner || null;

   // Debug logging for Genoa
   if (match?.homeTeamName?.toLowerCase().includes('genoa') || match?.awayTeamName?.toLowerCase().includes('genoa')) {
     console.log(`[normalizeMatchEntry] Genoa match found:`, {
       homeTeam: match?.homeTeamName,
       awayTeam: match?.awayTeamName,
       hasClosingOdds: !!closing,
       closingOdds: closing,
       matchStructure: Object.keys(match).slice(0, 10)
     });
   }

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
     closingWinner: winner,
   };
 }

function formatOddsValue(value) {
  if (typeof value === "number") {
    return value.toFixed(2);
  }
  return value ? String(value) : "–";
}

function useTeamOdds(teamName) {
  console.log(`[useTeamOdds] SWR hook initialized for team: '${teamName}'`);
  return useSWR(teamName ? ["team-odds-history", teamName] : null, ([, team]) => requestTeamMatches(team, "all"), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60 * 1000,
    onSuccess: (data) => {
      console.log(`[useTeamOdds] API success for '${teamName}': ${data?.length || 0} matches`);
      if (data && data.length > 0) {
        const matchesWithOdds = data.filter(match => extractClosingOdds(match));
        console.log(`[useTeamOdds] '${teamName}' matches with closing odds: ${matchesWithOdds.length}/${data.length}`);
        if (matchesWithOdds.length === 0) {
          console.log(`[useTeamOdds] Sample match structure for '${teamName}':`, JSON.stringify(data[0], null, 2).slice(0, 1000));
        }
      }
    },
    onError: (error) => {
      console.error(`[useTeamOdds] API error for '${teamName}':`, error);
    }
  });
}

function TeamOddsTable({ teamName, data, loading, error }) {
  console.log(`[TeamOddsTable] Rendering for team: '${teamName}'`, { data, loading, error });

  const items = useMemo(() => {
    if (!Array.isArray(data) || !data.length) {
      console.log(`[TeamOddsTable] No data for '${teamName}', returning empty items.`);
      return [];
    }

    // Felsäker sortering: placera matcher utan giltigt timestamp sist.
    const normalized = data
      .map((match) => normalizeMatchEntry(match, resolvePerspective(match, teamName)))
      .sort((a, b) => {
        const tsA = a.timestamp || 0;
        const tsB = b.timestamp || 0;
        if (tsA === 0 && tsB > 0) return 1; // a (utan ts) ska komma efter b
        if (tsB === 0 && tsA > 0) return -1; // b (utan ts) ska komma efter a
        return tsB - tsA; // Sortera normalt efter timestamp
      });
    console.log(`[TeamOddsTable] Normalized and sorted data for '${teamName}':`, normalized);
    return normalized.slice(0, TEAM_MATCH_LIMIT);
  }, [data, teamName]);

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
        <table className="min-w-full table-fixed text-left text-[8.25px] text-gray-600">
          <thead className="sticky top-0 bg-gray-50 text-[7.5px] uppercase tracking-wide text-gray-500">
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
                <td className="px-2 py-1 text-right text-xs font-semibold">
                  <span
                    className={[
                      "inline-flex min-w-[2rem] justify-end rounded px-1 py-0.5",
                      item.closingWinner === "home"
                        ? "bg-emerald-100 text-emerald-700"
                        : "text-gray-700",
                    ].join(" ")}
                  >
                    {formatOddsValue(item.closingOdds?.home)}
                  </span>
                </td>
                <td className="px-2 py-1 text-right text-xs font-semibold">
                  <span
                    className={[
                      "inline-flex min-w-[2rem] justify-end rounded px-1 py-0.5",
                      item.closingWinner === "draw"
                        ? "bg-emerald-100 text-emerald-700"
                        : "text-gray-700",
                    ].join(" ")}
                  >
                    {formatOddsValue(item.closingOdds?.draw)}
                  </span>
                </td>
                <td className="px-2 py-1 text-right text-xs font-semibold">
                  <span
                    className={[
                      "inline-flex min-w-[2rem] justify-end rounded px-1 py-0.5",
                      item.closingWinner === "away"
                        ? "bg-emerald-100 text-emerald-700"
                        : "text-gray-700",
                    ].join(" ")}
                  >
                    {formatOddsValue(item.closingOdds?.away)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:h-full lg:min-h-0">
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-[8.25px] font-semibold uppercase tracking-wide text-gray-500">
          {teamName || "Ingen match"}
        </p>
      </div>
      {content}
    </div>
  );
}

export default function TeamOddsHistory({
  match,
  className = "",
  showHeader = true,
  contentClassName = "",
}) {
  console.log("--- TeamOddsHistory Render ---");
  console.log("Received match object:", match);
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

  console.log(`Requesting odds for HOME: '${homeTeamName}' and AWAY: '${awayTeamName}'`);
  const homeOdds = useTeamOdds(homeTeamName);
  const awayOdds = useTeamOdds(awayTeamName);

  const containerClass = [
    "flex flex-col bg-gray-50/60",
    "lg:h-full lg:min-h-0",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const contentWrapperClass = [
    "flex flex-col gap-3 overflow-hidden",
    "px-4 py-3",
    "lg:flex-1 lg:flex-row lg:min-h-0",
    contentClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClass}>
      {showHeader ? (
        <div className="border-b border-gray-200 px-4 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            Senaste 5 closing odds
          </h3>
          <p className="text-[8.25px] text-gray-500">
            Hämtar hem- och bortastatistik från databasen.
          </p>
        </div>
      ) : null}
      <div className={contentWrapperClass}>
        <div className="flex w-full flex-col rounded-lg border border-gray-200 bg-gray-50 p-2 shadow-sm lg:min-h-0 lg:flex-1">
          <TeamOddsTable
            teamName={homeTeamName}
            data={homeOdds.data}
            loading={homeOdds.isLoading}
            error={homeOdds.error}
          />
        </div>
        <div className="flex w-full flex-col rounded-lg border border-gray-200 bg-gray-50 p-2 shadow-sm lg:min-h-0 lg:flex-1">
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
