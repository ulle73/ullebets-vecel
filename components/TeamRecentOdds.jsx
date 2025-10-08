"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { buildTeamRecentMatchesKey } from "@/lib/utils/apiKeys";
import { fetchJson } from "@/lib/utils/fetchers";

const DATE_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatDate(value) {
  if (!value) return "";
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return DATE_FORMATTER.format(date);
}

function formatOdds(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  return "–";
}

function EmptyState({ title }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white/40 px-4 py-6 text-center text-xs text-gray-500">
      <p>{title}</p>
    </div>
  );
}

function OddsRow({ match, highlight }) {
  const odds = match?.closingOdds ?? {};
  const items = [
    { key: "home", label: "1", value: odds.home, isHighlight: highlight === "home" },
    { key: "draw", label: "X", value: odds.draw, isHighlight: false },
    { key: "away", label: "2", value: odds.away, isHighlight: highlight === "away" },
  ];

  return (
    <div className="flex items-end gap-2 font-mono text-[0.75rem]">
      {items.map((item) => (
        <div
          key={item.key}
          className={`flex min-w-[3.5rem] flex-col rounded-md border px-2 py-1 text-right ${
            item.isHighlight
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-gray-400">
            {item.label}
          </span>
          <span className="text-sm font-semibold">{formatOdds(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

function MatchCard({ match }) {
  if (!match) return null;
  const venueLabel = match.venue === "home" ? "Hemma" : "Borta";
  const opponent = match.opponentName ?? "Motstånd saknas";
  const highlight = match.venue === "home" ? "home" : "away";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white/60 p-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{venueLabel}</p>
          <p className="text-sm font-semibold text-gray-900">{opponent}</p>
        </div>
        <p className="text-xs font-medium text-gray-500">{formatDate(match.timestamp ?? match.date)}</p>
      </div>
      <OddsRow match={match} highlight={highlight} />
    </div>
  );
}

function TeamOddsColumn({ title, matches, isLoading, error }) {
  let content = null;

  if (isLoading) {
    content = <EmptyState title="Hämtar odds…" />;
  } else if (error) {
    content = <EmptyState title="Kunde inte hämta odds just nu." />;
  } else if (!matches?.length) {
    content = <EmptyState title="Inga odds hittades för laget." />;
  } else {
    content = (
      <div className="custom-scrollbar h-full overflow-y-auto pr-1">
        <div className="flex flex-col gap-3">
          {matches.map((match) => (
            <MatchCard key={match.matchId ?? `${match.timestamp}:${match.venue}`} match={match} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600">{title}</h4>
      <div className="flex-1 overflow-hidden">{content}</div>
    </div>
  );
}

export default function TeamRecentOdds({
  match,
  limit = 5,
  className = "",
  style,
}) {
  const homeKey = useMemo(
    () => buildTeamRecentMatchesKey(match, "home", { limit }),
    [match, limit]
  );
  const awayKey = useMemo(
    () => buildTeamRecentMatchesKey(match, "away", { limit }),
    [match, limit]
  );

  const swrOptions = useMemo(
    () => ({
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    }),
    []
  );

  const {
    data: homeData,
    error: homeError,
    isLoading: isHomeLoading,
  } = useSWR(homeKey, fetchJson, swrOptions);

  const {
    data: awayData,
    error: awayError,
    isLoading: isAwayLoading,
  } = useSWR(awayKey, fetchJson, swrOptions);

  const hasMatch = Boolean(match);
  const containerClasses = [
    "flex flex-col gap-3 bg-white px-4 py-3",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  let body = null;

  if (!hasMatch) {
    body = <EmptyState title="Välj en match för att se closing odds." />;
  } else {
    body = (
      <div className="grid h-full gap-4 overflow-hidden md:grid-cols-2">
        <TeamOddsColumn
          title={homeData?.teamName ?? match?.homeTeamName ?? "Hemma"}
          matches={homeData?.matches ?? []}
          isLoading={isHomeLoading && !homeData}
          error={homeError}
        />
        <TeamOddsColumn
          title={awayData?.teamName ?? match?.awayTeamName ?? "Borta"}
          matches={awayData?.matches ?? []}
          isLoading={isAwayLoading && !awayData}
          error={awayError}
        />
      </div>
    );
  }

  return (
    <div className={containerClasses} style={style}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          Senaste closing odds
        </h3>
        <p className="text-[0.65rem] text-gray-400">Senaste {limit} matcher</p>
      </div>
      <div className="flex-1 overflow-hidden">
        {body}
      </div>
    </div>
  );
}
