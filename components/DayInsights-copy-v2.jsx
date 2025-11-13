"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toNum } from "@/lib/utils/matchups";
import { FilterChips, RowAvg } from "@/components/MatchupsListUI";

const PERIODS = [
  { value: "ALL", label: "Hela matchen" },
  { value: "1ST", label: "Första halvlek" },
  { value: "2ND", label: "Andra halvlek" },
];

const PERIOD_FILTERS = [
  { value: "any", label: "Alla perioder" },
  ...PERIODS,
];

const SCOPE_FILTERS = [
  { value: "all", label: "Alla" },
  { value: "total", label: "Totalt" },
  { value: "home", label: "Hemmalaget" },
  { value: "away", label: "Bortalaget" },
];

const LEAGUE_SCORE_THRESHOLDS = { high: 4, medium: 3 };

const fetcher = async (input) => {
  const response = await fetch(input);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Fetch error");
  }
  return response.json();
};

function badgeForLeagueAvg(sortKey) {
  if (!Number.isFinite(sortKey)) return null;
  if (sortKey >= 4) return { label: "Perfekt", tone: "perfect" };
  if (sortKey >= 3) return { label: "Nästan", tone: "almost" };
  return null;
}

function mapLeagueAvgEntry(entry) {
  const matchLabel = entry.match ?? "Match";
  const score = toNum(entry.score) ?? 0;
  const sortKey = toNum(entry.sortKey ?? entry.score) ?? score;
  const scope = entry.scope ?? "total";
  return {
    matchId: entry.matchId ?? matchLabel,
    leagueName: entry.league ?? null,
    statKey: entry.statKey ?? entry.statLabel ?? null,
    statLabel: entry.statLabel ?? entry.statKey ?? "Stat",
    period: entry.period ?? "ALL",
    scope,
    scopeLabel: entry.scopeLabel ?? null,
    matchLabel,
    score,
    sortKey,
    badge: badgeForLeagueAvg(sortKey),
    scoreFormat: (value) => value.toFixed(2),
    scoreThresholds: LEAGUE_SCORE_THRESHOLDS,
  };
}

function toSortKey(row) {
  if (Number.isFinite(row.sortKey)) return row.sortKey;
  if (Number.isFinite(row.score)) return row.score;
  return -Infinity;
}

function applyFilters(rows, leagueFilter, scopeFilter, periodFilter, onlyTopBadges) {
  return rows
    .filter((row) => leagueFilter === "all" || row.leagueName === leagueFilter)
    .filter((row) => scopeFilter === "all" || row.scope === scopeFilter)
    .filter((row) => periodFilter === "any" || row.period === periodFilter)
    .filter(
      (row) =>
        !onlyTopBadges ||
        (row.badge && (row.badge.tone === "perfect" || row.badge.tone === "almost"))
    )
    .sort((a, b) => toSortKey(b) - toSortKey(a))
    .slice(0, 30);
}

export default function BestMatchups({ date, items, profilesVersion = 0 }) {
  const [periodFilter, setPeriodFilter] = useState(PERIOD_FILTERS[0].value);
  const [scopeFilter, setScopeFilter] = useState(SCOPE_FILTERS[0].value);
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [onlyTopBadges, setOnlyTopBadges] = useState(false);

  const queryKey = date
    ? `/api/matchups-league-avg?date=${encodeURIComponent(date)}&v=${profilesVersion}`
    : null;

  const { data, error } = useSWR(queryKey, fetcher, { revalidateOnFocus: false });
  const isLoading = !data && !error;

  const rawOver = data?.top50?.over ?? [];
  const rawUnder = data?.top50?.under ?? [];

  const mappedOver = useMemo(() => rawOver.map(mapLeagueAvgEntry), [rawOver]);
  const mappedUnder = useMemo(() => rawUnder.map(mapLeagueAvgEntry), [rawUnder]);

  const leagueOptions = useMemo(() => {
    const uniq = new Map();
    [...mappedOver, ...mappedUnder].forEach((row) => {
      const label = row.leagueName ?? "Liga";
      if (!uniq.has(label)) {
        uniq.set(label, { value: label, label });
      }
    });
    return [{ value: "all", label: "Alla ligor" }, ...uniq.values()];
  }, [mappedOver, mappedUnder]);

  const overRows = useMemo(
    () => applyFilters(mappedOver, leagueFilter, scopeFilter, periodFilter, onlyTopBadges),
    [mappedOver, leagueFilter, scopeFilter, periodFilter, onlyTopBadges]
  );
  const underRows = useMemo(
    () =>
      applyFilters(mappedUnder, leagueFilter, scopeFilter, periodFilter, onlyTopBadges),
    [mappedUnder, leagueFilter, scopeFilter, periodFilter, onlyTopBadges]
  );

  const generatedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleString("sv-SE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    })
    : null;

  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white shadow-sm lg:h-full lg:min-h-0">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-lg font-semibold text-gray-900">Div2 – Bästa matchups</h2>
        {generatedAt ? (
          <p className="mt-1 text-xs text-gray-500">
            Senast genererat: {generatedAt} (UTC)
          </p>
        ) : isLoading ? (
          <p className="mt-1 text-xs text-gray-500">Laddar matchups…</p>
        ) : error ? (
          <p className="mt-1 text-xs text-red-600">Misslyckades hämta matchups.</p>
        ) : (
          <p className="mt-1 text-xs text-gray-500">Ingen data för valt datum.</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <FilterChips options={SCOPE_FILTERS} value={scopeFilter} onChange={setScopeFilter} />
          <FilterChips options={PERIOD_FILTERS} value={periodFilter} onChange={setPeriodFilter} />

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Liga
            </label>
            <select
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={leagueFilter}
              onChange={(e) => setLeagueFilter(e.target.value)}
            >
              {leagueOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              checked={onlyTopBadges}
              onChange={(e) => setOnlyTopBadges(e.target.checked)}
            />
            Visa endast Perfekt/Nästan
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 border-t border-gray-100 px-4 py-4 lg:grid-cols-2 lg:flex-1 lg:min-h-0">
        <div className="flex min-h-[150px] flex-col">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-700">
            Över – topp 20
          </h3>
          <div className="flex-1 overflow-auto pr-1">
            {!data && isLoading ? (
              <div className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                Laddar matchups…
              </div>
            ) : error ? (
              <div className="rounded border border-dashed border-gray-300 p-4 text-sm text-red-600">
                Misslyckades hämta över-matchups.
              </div>
            ) : overRows.length ? (
              <ol className="space-y-2">
                {overRows.map((r) => (
                  <RowAvg key={`o:${r.matchId}:${r.statKey}:${r.period}:${r.scope}`} r={r} />
                ))}
              </ol>
            ) : (
              <div className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                Ingen data.
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-[150px] flex-col">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-purple-700">
            Under – topp 20
          </h3>
          <div className="flex-1 overflow-auto pr-1">
            {!data && isLoading ? (
              <div className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                Laddar matchups…
              </div>
            ) : error ? (
              <div className="rounded border border-dashed border-gray-300 p-4 text-sm text-red-600">
                Misslyckades hämta under-matchups.
              </div>
            ) : underRows.length ? (
              <ol className="space-y-2">
                {underRows.map((r) => (
                  <RowAvg key={`u:${r.matchId}:${r.statKey}:${r.period}:${r.scope}`} r={r} />
                ))}
              </ol>
            ) : (
              <div className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                Ingen data.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
