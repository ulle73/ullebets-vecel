"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { buildRecentTeamOddsKey } from "@/lib/utils/apiKeys";
import { fetchJson } from "@/lib/utils/fetchers";
import { formatOddsValue, resolveOddsWinnerLabel } from "@/lib/utils/odds";

const swrOptions = {
  revalidateOnFocus: false,
  revalidateIfStale: false,
  revalidateOnReconnect: false,
};

function formatDate(value, formatter) {
  if (!value) return "–";
  const timestamp = Number(value);
  if (Number.isFinite(timestamp)) {
    if (timestamp > 1e12) {
      return formatter.format(new Date(timestamp));
    }
    if (timestamp > 1e9) {
      return formatter.format(new Date(timestamp * 1000));
    }
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return formatter.format(new Date(parsed));
  }
  return String(value);
}

function VenueBadge({ venue }) {
  if (venue === "home") {
    return <span className="inline-flex items-center justify-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">H</span>;
  }
  if (venue === "away") {
    return <span className="inline-flex items-center justify-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700">B</span>;
  }
  return <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-500">?</span>;
}

function OddsCell({ value, highlight }) {
  const textClass = highlight ? "font-semibold text-gray-900" : "text-gray-600";
  return <span className={textClass}>{formatOddsValue(value)}</span>;
}

function TeamOddsList({ title, data, dateFormatter }) {
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  const sources = data?.sources ?? {};

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">{title ?? "—"}</p>
        <p className="mt-1 line-clamp-2 text-[10px] text-gray-400">
          Hemmafil: {sources.home ?? "saknas"} • Bortafil: {sources.away ?? "saknas"}
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-auto">
          <table className="min-w-full divide-y divide-gray-100 text-xs">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Datum</th>
                <th className="px-3 py-2 text-left">Motståndare</th>
                <th className="px-2 py-2 text-center">V</th>
                <th className="px-2 py-2 text-center">1</th>
                <th className="px-2 py-2 text-center">X</th>
                <th className="px-2 py-2 text-center">2</th>
                <th className="px-2 py-2 text-center">Segrare</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white text-[11px] text-gray-700">
              {matches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-xs text-gray-500">
                    Ingen oddsdata hittades.
                  </td>
                </tr>
              ) : (
                matches.map((match, index) => {
                  const odds = match?.closingOdds ?? {};
                  const winner = match?.closingWinner ?? null;
                  const winnerLabel = resolveOddsWinnerLabel(winner);
                  const rowKey = match?.matchId ?? `${match?.homeTeamName ?? "?"}-${match?.awayTeamName ?? "?"}-${match?.timestamp ?? index}-${index}`;
                  return (
                    <tr key={rowKey} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        {formatDate(match?.date ?? match?.timestamp, dateFormatter)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{match?.opponentName ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <VenueBadge venue={match?.venue ?? null} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <OddsCell value={odds.home} highlight={winner === "home"} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <OddsCell value={odds.draw} highlight={winner === "draw"} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <OddsCell value={odds.away} highlight={winner === "away"} />
                      </td>
                      <td className="px-2 py-2 text-center text-xs font-semibold text-gray-600">
                        {winnerLabel ?? "–"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function RecentClosingOdds({ match, className = "", style }) {
  const requestKey = useMemo(() => buildRecentTeamOddsKey(match, { limit: 5 }), [match]);
  const { data, error, isLoading } = useSWR(requestKey, fetchJson, swrOptions);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("sv-SE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    []
  );

  let content = null;

  if (!requestKey) {
    content = (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
        Välj en match för att se senaste closing odds.
      </div>
    );
  } else if (isLoading) {
    content = (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-200 p-4 text-xs text-gray-500">
        Hämtar oddsdata…
      </div>
    );
  } else if (error) {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
        <p>Kunde inte hämta closing odds.</p>
        <p className="text-[11px] text-gray-400">{error?.message ?? "Försök igen senare."}</p>
      </div>
    );
  } else {
    const homeTeam = data?.homeTeam ?? null;
    const awayTeam = data?.awayTeam ?? null;

    content = (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2">
        <TeamOddsList title={homeTeam?.teamName ?? match?.homeTeamName ?? "Hemma"} data={homeTeam} dateFormatter={dateFormatter} />
        <TeamOddsList title={awayTeam?.teamName ?? match?.awayTeamName ?? "Borta"} data={awayTeam} dateFormatter={dateFormatter} />
      </div>
    );
  }

  const containerClass = [
    "flex h-full flex-col overflow-hidden bg-white",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClass} style={style}>
      <div className="px-4 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          Closing odds – senaste 5 matcher
        </h3>
        <p className="text-[11px] text-gray-400">
          Inkluderar både hemma- och bortamatcher från teamens senaste importfiler.
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
        {content}
      </div>
    </div>
  );
}
