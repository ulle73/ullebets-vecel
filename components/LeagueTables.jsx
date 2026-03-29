"use client";

import { useMemo, useState } from "react";
import DatePicker from "@/components/DatePicker";
import LeagueTable from "@/components/LeagueTable";
import { normalizeMatch } from "@/lib/core/matchups";

function getMatchStatus(match, nowSeconds) {
  const hasScore =
    Number.isFinite(match?.homeScore) && Number.isFinite(match?.awayScore);
  if (hasScore) return "results";
  if (Number.isFinite(match?.timestamp) && match.timestamp < nowSeconds) {
    return "live";
  }
  return "upcoming";
}

export default function LeagueTables({
  date,
  onDateChange,
  items,
  formatTime,
  onSelectMatch,
  selectedMatchId,
  isLoading,
  error,
  onPrefetchMatch,
  matchesCount = 0,
  className = "",
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [leagueFilter, setLeagueFilter] = useState("all");

  const nowSeconds = Math.floor(Date.now() / 1000);
  const normalizedMatches = useMemo(
    () => (Array.isArray(items) ? items.map(normalizeMatch).filter(Boolean) : []),
    [items]
  );

  const leagueOptions = useMemo(() => {
    const unique = new Map();
    normalizedMatches.forEach((match) => {
      const leagueName = match?.leagueName || "Liga";
      if (!unique.has(leagueName)) {
        unique.set(leagueName, leagueName);
      }
    });
    return ["all", ...unique.values()];
  }, [normalizedMatches]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return normalizedMatches
      .filter((match) => {
        if (!query) return true;
        const haystack = [match?.homeTeamName, match?.awayTeamName, match?.leagueName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .filter((match) => {
        if (leagueFilter === "all") return true;
        return (match?.leagueName || "Liga") === leagueFilter;
      })
      .filter((match) => {
        if (statusFilter === "all") return true;
        return getMatchStatus(match, nowSeconds) === statusFilter;
      })
      .map((match) => match.raw || match);
  }, [leagueFilter, normalizedMatches, nowSeconds, searchQuery, statusFilter]);

  const statusLabel = error
    ? "Fel vid hämtning."
    : isLoading
      ? "Laddar…"
      : `Matcher: ${filteredItems.length}/${matchesCount}`;

  const containerClass = [
    "flex flex-col rounded-lg border border-gray-200 bg-gray-50",
    "lg:h-full lg:min-h-0",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClass}>
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
          Dagens matcher
        </h2>
      </div>
      <div className="flex flex-col overflow-hidden p-4 lg:flex-1 lg:min-h-0">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <DatePicker value={date} onChange={onDateChange} />
            <div className="text-xs text-gray-500">{statusLabel}</div>
          </div>

          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Sök lag eller liga"
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-cyan-500 xl:max-w-[220px]"
            />

            <div className="flex flex-wrap gap-2">
              {[
                { id: "all", label: "Alla" },
                { id: "upcoming", label: "Kommande" },
                { id: "live", label: "Pågår" },
                { id: "results", label: "Resultat" },
              ].map((option) => {
                const active = statusFilter === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setStatusFilter(option.id)}
                    className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition ${
                      active
                        ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-700"
                        : "border-gray-200 bg-white text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <select
              value={leagueFilter}
              onChange={(event) => setLeagueFilter(event.target.value)}
              className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-cyan-500 xl:ml-auto xl:max-w-[220px]"
            >
              {leagueOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "Alla ligor" : option}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-hidden lg:flex-1 lg:min-h-0">
          <div className="overflow-auto pr-1 lg:h-full">
            <LeagueTable
              items={filteredItems}
              formatTime={formatTime}
              onSelectMatch={onSelectMatch}
              onPrefetchMatch={onPrefetchMatch}
              selectedMatchId={selectedMatchId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
