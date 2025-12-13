  "use client";

  import { useMemo, useState } from "react";
  import { useSWRConfig } from "swr";
  import {
    buildMatchesByDateKey,
    buildTeamProfileKeyForMatch,
  } from "@/lib/utils/apiKeys";
  import { normalizeMatch } from "@/lib/core/matchups";
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

  const STAT_ALIASES = new Map([
    ["totalshotsongoal", "totalShotsOnGoal"],
    ["total_shots_on_goal", "totalShotsOnGoal"],
    ["totalshots_on_goal", "totalShotsOnGoal"],
    ["totalshots", "totalShotsOnGoal"],
    ["total_shots", "totalShotsOnGoal"],
    ["totalshotsontarget", "totalShotsOnGoal"],
    ["total_shots_on_target", "totalShotsOnGoal"],
  ]);

  function normalizeStatKeyForScew(statKey) {
    if (!statKey) return null;
    const raw = String(statKey).trim();
    const alias = STAT_ALIASES.get(raw.toLowerCase());
    return alias || raw;
  }

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

  function getPeriodNode(metricNode, period) {
    if (!metricNode || typeof metricNode !== "object") return null;
    return metricNode[period] ?? metricNode.ALL ?? null;
  }

  function readMarketBias(profile, statKey, period) {
    if (!profile || !statKey || !period) return null;
    const primary = normalizeStatKeyForScew(statKey);
    const candidates = [];
    const node = profile.statistics?.for?.[statKey];
    const aliasNode =
      primary && primary !== statKey ? profile.statistics?.for?.[primary] : null;
    if (node) candidates.push(node);
    if (aliasNode) candidates.push(aliasNode);
    for (const cand of candidates) {
      const p = getPeriodNode(cand, period);
      if (p?.marketBias) return p.marketBias;
    }
    return null;
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
              : "border-gray-300 bg-gray-50 text-gray-600 hover:border-blue-300 hover:text-blue-600"
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
              const scewScore = (() => {
                if (type !== "for") return null;
                const primary = toFiniteNumber(periodNode?.scew?.scewScore ?? periodNode?.scew?.score);
                if (Number.isFinite(primary)) return primary;
                // Try canonical alias if we stored scew under totalShots
                const canonicalKey = normalizeStatKeyForScew(key);
                if (canonicalKey && canonicalKey !== key) {
                  const aliasNode = entry.profile.statistics?.for?.[canonicalKey]?.[period];
                  return toFiniteNumber(aliasNode?.scew?.scewScore ?? aliasNode?.scew?.score);
                }
                return null;
              })();
              const marketBias = type === "for" ? readMarketBias(entry.profile, key, period) : null;
              const behaviour = entry.profile?.behaviour ?? null;
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
                scewScore,
                marketBias,
                behaviour,
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
              className="flex items-start justify-between rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm shadow-sm"
            >
              <div className="flex flex-col text-left">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  #{point.rank} · {point.metricLabel} · {point.period} ({point.type})
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{point.teamName}</span>
                  {point.leagueName ? (
                    <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                      {point.leagueName}
                    </span>
                  ) : null}
                  {Number.isFinite(point.scewScore) ? (
                    <span
                      className={`ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        point.scewScore > 0
                          ? "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/40"
                          : point.scewScore < 0
                          ? "bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/40"
                          : "bg-slate-100 text-slate-700 ring-1 ring-slate-300/60"
                      }`}
                    >
                      SCEW {(point.scewScore > 0 ? "+" : "") + point.scewScore.toFixed(1)}
                    </span>
                  ) : null}
                  {point.marketBias ? (
                    <span
                      className={`ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        point.marketBias.direction === "over"
                          ? "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/30"
                          : point.marketBias.direction === "under"
                          ? "bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/30"
                          : "bg-slate-100 text-slate-700 ring-1 ring-slate-300/60"
                      }`}
                    >
                      MB {point.marketBias.direction ?? "–"}
                      {Number.isFinite(point.marketBias.bias)
                        ? ` ${point.marketBias.bias.toFixed(2)}`
                        : ""}
                      {Number.isFinite(point.marketBias.sampleSize)
                        ? ` · n=${point.marketBias.sampleSize}`
                        : ""}
                    </span>
                  ) : null}
                  {point.behaviour?.label ? (
                    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-300/60">
                      {point.behaviour.emoji ?? "•"} {point.behaviour.label}
                    </span>
                  ) : null}
                </div>
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
      <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-gray-50 shadow-sm">
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
              className="mt-1 w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
          <div className="flex min-h-[150px] flex-col">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-green-600">
              Top 10 i dag
            </h3>
            <div className="flex-1 overflow-auto pr-1">{renderList(topPoints)}</div>
          </div>
          <div className="flex min-h-[150px] flex-col">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-600">
              Botten 10 i dag
            </h3>
            <div className="flex-1 overflow-auto pr-1">{renderList(bottomPoints)}</div>
          </div>
        </div>
      </div>
    );
  }
