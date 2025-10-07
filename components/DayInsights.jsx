  "use client";

  import { useMemo, useState } from "react";
  import { useSWRConfig } from "swr";
  import {
    buildMatchesByDateKey,
    buildTeamProfileKeyForMatch,
  } from "@/lib/utils/apiKeys";
  import { normalizeMatch } from "@/components/LeagueTable";
  import { PROFILE_STATS, formatValue } from "@/components/TeamCompare";

  // Ny konfig: map { key: "Svensk etikett" }
  const ENABLED_STAT_MAP = {
    shotsOnGoal: "Skott på mål",
    totalShotsOnGoal: "Totala skott",
    cornerKicks: "Hörnor",
    fouls: "Fouls",
    yellowCards: "Gula kort",
    throwIns: "Inkast",
    offsides: "Offsides",
    totalTackle: "Tacklingar",
    freeKicks: "Frisparkar"
  };

  // Härled STATS_FOR_VIEW -> [{ key, label }]
  const STATS_FOR_VIEW = Object.entries(ENABLED_STAT_MAP).map(([key, label]) => ({
    key,
    label,
  }));


  const PERIODS = [
    { value: "ALL", label: "Hela matchen" },
    { value: "1ST", label: "Första halvlek" },
    { value: "2ND", label: "Andra halvlek" },
  ];

  const TYPE_FILTERS = [
    { value: "all", label: "Alla" },
    { value: "for", label: "For" },
    { value: "against", label: "Against" },
  ];

  const STAT_TYPES = ["for", "against"];
  const STAT_PERIODS = ["ALL", "1ST", "2ND"];

  function toFiniteNumber(value) {
    if (value == null) return null;
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatStatValue(key, value) {
    return formatValue(value, { isPercentage: key === "ballPossession" });
  }

  function buildFilterChips(options, activeValue, onChange) {
    return options.map((option) => {
      const isActive = option.value === activeValue;
      return (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
            isActive
              ? "border-blue-500 bg-blue-500 text-white shadow"
              : "border-gray-300 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600"
          }`}
        >
          {option.label}
        </button>
      );
    });
  }

  export default function DayInsights({ date, items, profilesVersion = 0 }) {
    const { cache } = useSWRConfig();
    const [periodFilter, setPeriodFilter] = useState(PERIODS[0].value);
    const [typeFilter, setTypeFilter] = useState(TYPE_FILTERS[0].value);
    const [leagueFilter, setLeagueFilter] = useState("all");

    const matchesKey = date ? buildMatchesByDateKey(date) : null;

    const rawItems = useMemo(() => {
      if (Array.isArray(items)) {
        return items;
      }
      if (!matchesKey) {
        return [];
      }
      const state = cache.get(matchesKey);
      return state?.data?.items ?? [];
    }, [cache, items, matchesKey, profilesVersion]);

    const matches = useMemo(
      () => rawItems.map((item) => normalizeMatch(item)).filter(Boolean),
      [rawItems]
    );

    const { profiles, missingProfiles } = useMemo(() => {
      const collected = [];
      const missing = [];
      const seenKeys = new Set();

      for (const match of matches) {
        for (const side of ["home", "away"]) {
          const key = buildTeamProfileKeyForMatch(match, side);
          if (!key || seenKeys.has(key)) {
            continue;
          }
          seenKeys.add(key);

          const state = cache.get(key);
          const data = state?.data;
          const profile = data?.profile ?? null;

          if (!profile || !profile.statistics) {
            const fallbackTeamName =
              side === "home" ? match.homeTeamName : match.awayTeamName;
            missing.push({
              key,
              teamName: profile?.meta?.lagnamn ?? fallbackTeamName ?? "Okänt lag",
              leagueName: match.leagueName ?? profile?.meta?.leagueName ?? "Okänd liga",
            });
            continue;
          }

          collected.push({
            key,
            profile,
            teamName:
              profile.meta?.lagnamn ??
              (side === "home" ? match.homeTeamName : match.awayTeamName) ??
              "Lag",
            leagueName: match.leagueName ?? profile.meta?.leagueName ?? "Liga",
            leagueId: profile.meta?.ligaId ?? match.leagueId ?? null,
            matchType: profile.meta?.matchType ?? side,
          });
        }
      }

      return { profiles: collected, missingProfiles: missing };
    }, [cache, matches, profilesVersion]);

    const leagueOptions = useMemo(() => {
      const unique = new Map();
      for (const entry of profiles) {
        const label = entry.leagueName ?? "Liga";
        if (!unique.has(label)) {
          unique.set(label, { value: label, label });
        }
      }
      return [
        { value: "all", label: "Alla ligor" },
        ...Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label, "sv")),
      ];
    }, [profiles]);

    const dataPoints = useMemo(() => {
      const points = [];
      for (const entry of profiles) {
        for (const type of STAT_TYPES) {
          const statsRoot = entry.profile.statistics?.[type];
          if (!statsRoot || typeof statsRoot !== "object") {
            continue;
          }
          for (const { key, label } of STATS_FOR_VIEW) {
            const metricNode = statsRoot[key];
            if (!metricNode || typeof metricNode !== "object") {
              continue;
            }
            for (const period of STAT_PERIODS) {
              const periodNode = metricNode[period];
              const rawValue = periodNode?.value ?? periodNode?.Value ?? null;
              const rawRank = periodNode?.rank ?? periodNode?.Rank ?? null;
              const value = toFiniteNumber(rawValue);
              const rank = toFiniteNumber(rawRank);
              if (!Number.isFinite(value) || !Number.isFinite(rank)) {
                continue;
              }
              points.push({
                key: `${entry.key}:${key}:${type}:${period}`,
                metricKey: key,
                metricLabel: label,
                type,
                period,
                teamName: entry.teamName,
                leagueName: entry.leagueName,
                leagueId: entry.leagueId,
                matchType: entry.matchType,
                rank,
                value,
                displayValue: formatStatValue(key, value),
              });
            }
          }
        }
      }
      return points;
    }, [profiles]);

    const filteredPoints = useMemo(() => {
      return dataPoints.filter((point) => {
        if (point.period !== periodFilter) return false;
        if (typeFilter !== "all" && point.type !== typeFilter) {
          return false;
        }
        if (leagueFilter !== "all" && point.leagueName !== leagueFilter) {
          return false;
        }
        return true;
      });
    }, [dataPoints, leagueFilter, periodFilter, typeFilter]);

    const topPoints = useMemo(() => {
      return [...filteredPoints]
        .sort((a, b) => a.rank - b.rank || b.value - a.value)
        .slice(0, 10);
    }, [filteredPoints]);

    const bottomPoints = useMemo(() => {
      return [...filteredPoints]
        .sort((a, b) => b.rank - a.rank || b.value - a.value)
        .slice(0, 10);
    }, [filteredPoints]);

    const renderList = (points) => {
      if (!points.length) {
        return (
          <div className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
            Ingen data för valt filter.
          </div>
        );
      }

      return (
        <ol className="space-y-2">
          {points.map((point) => (
            <li
              key={point.key}
              className="flex items-start justify-between rounded border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm"
            >
              <div className="flex flex-col text-left">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  #{point.rank} · {point.metricLabel} · {point.period} ({point.type})
                </span>
                <span className="text-sm font-medium text-gray-900">
                  {point.teamName}
                  {point.leagueName ? (
                    <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                      {point.leagueName}
                    </span>
                  ) : null}
                </span>
              </div>
              <span className="text-sm font-semibold text-gray-900">{point.displayValue}</span>
            </li>
          ))}
        </ol>
      );
    };

    const profilesCount = profiles.length;
    const missingCount = missingProfiles.length;
    const isWarmup = profilesCount === 0;

    return (
      <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">Div2 – Dagens spaning</h2>
          <p className="mt-1 text-xs text-gray-500">
            Läste {profilesCount} lagprofiler från cache · Saknas i cache: {missingCount}
          </p>
          {isWarmup ? (
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-orange-500">
              Värmer cache…
            </p>
          ) : null}
          {missingCount > 0 ? (
            <details className="mt-2 text-xs text-gray-500">
              <summary className="cursor-pointer select-none font-medium text-gray-600">
                Saknas i cache ({missingCount})
              </summary>
              <ul className="mt-1 space-y-1">
                {missingProfiles.map((entry) => (
                  <li key={entry.key} className="truncate">
                    {entry.teamName} · {entry.leagueName}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {buildFilterChips(PERIODS, periodFilter, setPeriodFilter)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {buildFilterChips(TYPE_FILTERS, typeFilter, setTypeFilter)}
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Liga
            </label>
            <select
              className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={leagueFilter}
              onChange={(event) => setLeagueFilter(event.target.value)}
            >
              {leagueOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 border-t border-gray-100 px-4 py-4 lg:grid-cols-2">
          <div className="flex min-h-[200px] flex-col">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-green-600">
              Top 10 i dag
            </h3>
            <div className="flex-1 overflow-auto pr-1">{renderList(topPoints)}</div>
          </div>
          <div className="flex min-h-[200px] flex-col">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-600">
              Botten 10 i dag
            </h3>
            <div className="flex-1 overflow-auto pr-1">{renderList(bottomPoints)}</div>
          </div>
        </div>
      </div>
    );
  }

