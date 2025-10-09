"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import {
  buildMatchesByDateKey,
  buildTeamProfileKeyForMatch,
} from "@/lib/utils/apiKeys";
import { normalizeMatch } from "@/components/LeagueTable";
import { formatValue } from "@/components/TeamCompare";

/* ----------------------------- Konfiguration ----------------------------- */

const ENABLED_STAT_MAP = {
  shotsOnGoal: "Skott på mål",
  totalShotsOnGoal: "Totala skott",
  cornerKicks: "Hörnor",
  fouls: "Fouls",
  yellowCards: "Gula kort",
  throwIns: "Inkast",
  offsides: "Offsides",
  totalTackle: "Tacklingar",
  freeKicks: "Frisparkar",
};
const STATS_FOR_VIEW = Object.entries(ENABLED_STAT_MAP).map(([key, label]) => ({
  key,
  label,
}));

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

/* -------------------------------- Helpers -------------------------------- */

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function getPeriodNode(metricNode, period) {
  if (!metricNode || typeof metricNode !== "object") return null;
  return metricNode[period] ?? metricNode.ALL ?? null;
}
function readRank(profile, type, statKey, period) {
  const node = profile?.statistics?.[type]?.[statKey];
  const p = node && getPeriodNode(node, period);
  return toNum(p?.rank ?? p?.Rank);
}
function readValue(profile, type, statKey, period) {
  const node = profile?.statistics?.[type]?.[statKey];
  const p = node && getPeriodNode(node, period);
  return toNum(p?.value ?? p?.Value);
}
function formatStatValue(statKey, value) {
  const isPercentage = statKey === "ballPossession";
  return formatValue(value, { isPercentage });
}
function leagueSizeFromMeta(profile) {
  return (
    toNum(profile?.meta?.leagueTeamCount) ??
    toNum(profile?.meta?.leagueSize) ??
    toNum(profile?.meta?.teamsInLeague) ??
    null
  );
}

// Normalisering 0–100 mot parens min/max:
// Ett “par” (FOR+AGAINST) har range 2..2*L. Vi tar medel av två par ⇒ samma range.
function normalizePairScore(avgPair, leagueMax, mode) {
  const L = toNum(leagueMax) ?? 20;
  const min = 2;
  const max = 2 * L;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const s = clamp(avgPair, min, max);
  let raw;
  if (mode === "over") raw = (max - s) / (max - min); // lägre medelpar bättre
  else raw = (s - min) / (max - min); // högre medelpar bättre
  return Math.round(raw * 1000) / 10; // 1 decimal
}

function adjustSinglePairForComparison(pairSum, leagueMax) {
  if (!Number.isFinite(pairSum)) return null;
  const L = toNum(leagueMax) ?? 20;
  const mean = L + 1;
  const adjusted = mean + (pairSum - mean) / Math.SQRT2;
  const min = 2;
  const max = 2 * L;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  return clamp(adjusted, min, max);
}

function badgeForAvgPair(avgPair, leagueMax, mode) {
  const L = toNum(leagueMax) ?? 20;
  const min = 2;
  const max = 2 * L;
  if (mode === "over") {
    if (avgPair === 2) return { label: "Perfekt", tone: "perfect" }; // 1+1 i båda par
    if (avgPair <= 3) return { label: "Nästan", tone: "almost" };
    if (avgPair <= 5) return { label: "Stark", tone: "strong" };
    return null;
  } else {
    if (avgPair === max) return { label: "Perfekt", tone: "perfect" }; // max+max i båda par
    if (avgPair >= max - 1) return { label: "Nästan", tone: "almost" };
    if (avgPair >= max - 3) return { label: "Stark", tone: "strong" };
    return null;
  }
}

/* --------------------------------- UI --------------------------------- */

function ScoreChip({ score, mode }) {
  const base = "rounded px-2 py-0.5 text-xs font-bold";
  const tone =
    mode === "over"
      ? "bg-emerald-100 text-emerald-800"
      : "bg-purple-100 text-purple-800";
  return <span className={`${base} ${tone}`}>{score.toFixed(1)}/100</span>;
}
function Badge({ badge }) {
  if (!badge) return null;
  const base = "ml-2 rounded px-2 py-0.5 text-[8.25px] font-semibold";
  const tone =
    badge.tone === "perfect"
      ? "bg-yellow-200 text-yellow-900"
      : badge.tone === "almost"
        ? "bg-amber-100 text-amber-800"
        : "bg-blue-100 text-blue-800";
  return <span className={`${base} ${tone}`}>{badge.label}</span>;
}
function FilterChips({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${active
                ? "border-blue-500 bg-blue-500 text-white shadow"
                : "border-gray-300 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600"
              }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function RowAvg({ r, mode }) {
  const hf = r.homePair.forValue != null ? formatStatValue(r.statKey, r.homePair.forValue) : "—";
  const ha = r.homePair.againstValue != null ? formatStatValue(r.statKey, r.homePair.againstValue) : "—";
  const af = r.awayPair.forValue != null ? formatStatValue(r.statKey, r.awayPair.forValue) : "—";
  const aa = r.awayPair.againstValue != null ? formatStatValue(r.statKey, r.awayPair.againstValue) : "—";

  const highlightHome = r.primaryPair === "home" || r.primaryPair === "both";
  const highlightAway = r.primaryPair === "away" || r.primaryPair === "both";

  const decimals = r.scope === "total" ? 2 : 0;
  const baseValue = Number.isFinite(r.basisValue) ? r.basisValue : null;
  const basisDisplay = baseValue == null
    ? "—"
    : mode === "under" && r.leagueMax
      ? `${baseValue.toFixed(decimals)}/${(2 * r.leagueMax).toFixed(0)}`
      : baseValue.toFixed(decimals);
  const adjustedDisplay =
    r.scope !== "total" && Number.isFinite(r.scoreBasis)
      ? r.scoreBasis.toFixed(1)
      : null;

  return (
    <li className="flex items-start justify-between rounded border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm">
      <div className="min-w-0">
        <div className="flex items-center">
          <span className="truncate text-sm font-medium text-gray-900">
            {r.matchLabel}
          </span>
          <Badge badge={r.badge} />
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <span>
            {r.statLabel} · {r.period}
          </span>
          <span className="rounded bg-blue-50 px-2 py-0.5 text-[8.25px] font-semibold text-blue-700">
            {r.scopeLabel}
          </span>
          {r.leagueName ? (
            <span className="rounded bg-gray-100 px-2 py-0.5">{r.leagueName}</span>
          ) : null}
          {mode === "under" && r.leagueMax ? (
            <span className="text-[8.25px] text-gray-400">maxrank={r.leagueMax}</span>
          ) : null}
        </div>

        <div className="mt-1 space-y-0.5 text-[8.25px] text-gray-600">
          <div className={highlightHome ? "font-semibold text-gray-900" : undefined}>
            H-par: FOR <b>#{r.homePair.forRank}</b> ({hf}) + AGAINST <b>#{r.homePair.againstRank}</b> ({ha}) = <b>{r.homePair.sum}</b>
          </div>
          <div className={highlightAway ? "font-semibold text-gray-900" : undefined}>
            B-par: FOR <b>#{r.awayPair.forRank}</b> ({af}) + AGAINST <b>#{r.awayPair.againstRank}</b> ({aa}) = <b>{r.awayPair.sum}</b>
          </div>
          <div>
            {r.basisLabel}: <b>{basisDisplay}</b>
            {adjustedDisplay ? (
              <span className="ml-2 text-[7.5px] font-normal text-gray-500">
                (justerad för total-jämförelse: {adjustedDisplay})
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="ml-3 shrink-0 text-right">
        <ScoreChip score={r.score} mode={mode} />
      </div>
    </li>
  );
}

/* ------------------------------ Huvudkomponent ------------------------------ */

export default function BestMatchups({ date, items, profilesVersion = 0 }) {
  const { cache } = useSWRConfig();
  const [periodFilter, setPeriodFilter] = useState(PERIOD_FILTERS[0].value);
  const [scopeFilter, setScopeFilter] = useState(SCOPE_FILTERS[0].value);
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [onlyTopBadges, setOnlyTopBadges] = useState(false);

  // matcher
  const matchesKey = date ? buildMatchesByDateKey(date) : null;
  const rawItems = useMemo(() => {
    if (Array.isArray(items)) return items;
    if (!matchesKey) return [];
    return cache.get(matchesKey)?.data?.items ?? [];
  }, [cache, items, matchesKey, profilesVersion]);

  const matches = useMemo(
    () => rawItems.map(normalizeMatch).filter(Boolean),
    [rawItems]
  );

  // para ihop profiler (samma liga)
  const pairs = useMemo(() => {
    const out = [];
    for (const m of matches) {
      const leagueName = m.leagueName ?? m.raw?.leagueName ?? null;
      const homeKey = buildTeamProfileKeyForMatch(m, "home");
      const awayKey = buildTeamProfileKeyForMatch(m, "away");
      if (!homeKey || !awayKey) continue;
      const home = cache.get(homeKey)?.data?.profile ?? null;
      const away = cache.get(awayKey)?.data?.profile ?? null;
      if (!home || !away) continue;

      const hId = toNum(home?.meta?.ligaId) ?? toNum(m.leagueId);
      const aId = toNum(away?.meta?.ligaId) ?? toNum(m.leagueId);
      const sameId = hId && aId ? hId === aId : true;

      const hName = home?.meta?.leagueName ?? leagueName;
      const aName = away?.meta?.leagueName ?? leagueName;
      const sameName = hName && aName ? hName === aName : true;

      if (!sameId || !sameName) continue;

      out.push({
        matchId: m.id ?? m.matchId,
        leagueId: hId ?? aId ?? m.leagueId ?? null,
        leagueName: hName ?? aName ?? leagueName,
        home: { name: home?.meta?.lagnamn ?? m.homeTeamName ?? "Hemma", profile: home },
        away: { name: away?.meta?.lagnamn ?? m.awayTeamName ?? "Borta", profile: away },
      });
    }
    return out;
  }, [cache, matches]);

  // league size
  const leagueSizeMap = useMemo(() => {
    const map = new Map();
    for (const p of pairs) {
      const sH = leagueSizeFromMeta(p.home.profile);
      const sA = leagueSizeFromMeta(p.away.profile);
      const best = sH ?? sA ?? null;
      if (best) map.set(String(p.leagueId ?? p.leagueName), best);
    }
    return map;
  }, [pairs]);

  // liga-filter
  const leagueOptions = useMemo(() => {
    const uniq = new Map();
    for (const p of pairs) {
      const label = p.leagueName ?? "Liga";
      if (!uniq.has(label)) uniq.set(label, { value: label, label });
    }
    return [{ value: "all", label: "Alla ligor" }, ...uniq.values()];
  }, [pairs]);

  // bygg rader med BÅDA riktningar → medelpar
  const { overRows, underRows } = useMemo(() => {
    const accOver = [];
    const accUnder = [];

    for (const p of pairs) {
      const lgKey = String(p.leagueId ?? p.leagueName);
      const leagueMax = toNum(leagueSizeMap.get(lgKey)) ?? 20;

      for (const { key: statKey, label } of STATS_FOR_VIEW) {
        for (const { value: periodKey } of PERIODS) {
          const hf = readRank(p.home.profile, "for", statKey, periodKey);
          const ha = readRank(p.home.profile, "against", statKey, periodKey);
          const af = readRank(p.away.profile, "for", statKey, periodKey);
          const aa = readRank(p.away.profile, "against", statKey, periodKey);
          if (![hf, ha, af, aa].every(Number.isFinite)) continue;

          const sumHome = hf + aa;
          const sumAway = af + ha;
          const avgPair = (sumHome + sumAway) / 2;

          const rowCommon = {
            matchId: p.matchId,
            leagueName: p.leagueName,
            statKey,
            statLabel: label,
            period: periodKey,
            leagueMax,
            matchLabel: `${p.home.name} vs ${p.away.name}`,
            homePair: {
              forRank: hf,
              forValue: readValue(p.home.profile, "for", statKey, periodKey),
              againstRank: aa,
              againstValue: readValue(p.away.profile, "against", statKey, periodKey),
              sum: sumHome,
            },
            awayPair: {
              forRank: af,
              forValue: readValue(p.away.profile, "for", statKey, periodKey),
              againstRank: ha,
              againstValue: readValue(p.home.profile, "against", statKey, periodKey),
              sum: sumAway,
            },
          };

          const pushRows = (
            scope,
            basisValue,
            basisLabel,
            scopeLabel,
            primaryPair,
            scoreBasisOverride = null,
          ) => {
            const scoreBasis =
              scope === "total"
                ? basisValue
                : scoreBasisOverride ?? adjustSinglePairForComparison(basisValue, leagueMax);
            const overScore = normalizePairScore(scoreBasis, leagueMax, "over");
            const underScore = normalizePairScore(scoreBasis, leagueMax, "under");
            const overBadge = badgeForAvgPair(scoreBasis, leagueMax, "over");
            const underBadge = badgeForAvgPair(scoreBasis, leagueMax, "under");

            const shared = {
              ...rowCommon,
              scope,
              scopeLabel,
              basisValue,
              scoreBasis,
              basisLabel,
              primaryPair,
            };

            accOver.push({ ...shared, score: overScore, badge: overBadge });
            accUnder.push({ ...shared, score: underScore, badge: underBadge });
          };

          pushRows("total", avgPair, "Medelpar", "Totalt", "both");
          pushRows("home", sumHome, "Parsumma", `Hemmalag – ${p.home.name}`, "home");
          pushRows("away", sumAway, "Parsumma", `Bortalag – ${p.away.name}`, "away");
        }
      }
    }

    const byLeague = (r) => leagueFilter === "all" || r.leagueName === leagueFilter;
    const byBadge =
      (r) =>
        !onlyTopBadges ||
        (r.badge && (r.badge.tone === "perfect" || r.badge.tone === "almost"));
    const byScope = (r) => scopeFilter === "all" || r.scope === scopeFilter;
    const byPeriod = (r) => periodFilter === "any" || r.period === periodFilter;

    const over = accOver
      .filter((r) => byLeague(r) && byBadge(r) && byScope(r) && byPeriod(r))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    const under = accUnder
      .filter((r) => byLeague(r) && byBadge(r) && byScope(r) && byPeriod(r))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return { overRows: over, underRows: under };
  }, [
    pairs,
    leagueSizeMap,
    leagueFilter,
    onlyTopBadges,
    scopeFilter,
    periodFilter,
  ]);

  /* ---------------------------------- UI ---------------------------------- */
  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-lg font-semibold text-gray-900">Div2 – Bästa matchups</h2>
        <p className="mt-1 text-xs text-gray-500">
          Beräkning använder <b>båda riktningarna</b> (H_for+A_against & A_for+H_against) och tar
          <b> medelvärdet</b>. För renodlade hemma-/bortalagsscope dras parsumman ihop mot samma
          spridning som totalen så att poängen går att jämföra rättvist. Över: minimera medelparet.
          Under: maximera medelparet.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <FilterChips
            options={SCOPE_FILTERS}
            value={scopeFilter}
            onChange={setScopeFilter}
          />
          <FilterChips
            options={PERIOD_FILTERS}
            value={periodFilter}
            onChange={setPeriodFilter}
          />

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

      <div className="grid flex-1 grid-cols-1 gap-3 border-t border-gray-100 px-4 py-4 lg:grid-cols-2">
        {/* Över */}
        <div className="flex min-h-[150px] flex-col">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-700">
            Över – topp 20
          </h3>
          <div className="flex-1 overflow-auto pr-1">
            {overRows.length ? (
              <ol className="space-y-2">
                {overRows.map((r) => (
                  <RowAvg key={`o:${r.matchId}:${r.statKey}:${r.period}:${r.scope}`} r={r} mode="over" />
                ))}
              </ol>
            ) : (
              <div className="rounded border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                Ingen data.
              </div>
            )}
          </div>
        </div>

        {/* Under */}
        <div className="flex min-h-[150px] flex-col">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-purple-700">
            Under – topp 20
          </h3>
          <div className="flex-1 overflow-auto pr-1">
            {underRows.length ? (
              <ol className="space-y-2">
                {underRows.map((r) => (
                  <RowAvg key={`u:${r.matchId}:${r.statKey}:${r.period}:${r.scope}`} r={r} mode="under" />
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
