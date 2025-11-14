"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import LeagueTables from "@/components/LeagueTables";
import BacktestPage from "@/components/BacktestPage";
import DayInsightsLegacy from "@/components/DayInsights-copy";
import DayInsights from "@/components/DayInsights-copy-v2";
import { normalizeMatch } from "@/components/LeagueTable";
import { buildMatchesByDateKey } from "@/lib/utils/apiKeys";
import { fetchJson } from "@/lib/utils/fetchers";
import AIComboControls from "@/ai/components/AIComboControls";
import AIComboList from "@/ai/components/AIComboList";
import AIInsightsList from "@/ai/components/AIInsightsList";
import AIPositiveLinesPanel from "@/ai/components/AIPositiveLinesPanel";
import { buildCombos } from "@/ai/utils/comboBuilder";
import { buildLineKey, buildMatchLookup, buildMatchupKey } from "@/ai/utils/matchupUtils";
import { mapBacktestResultToLine } from "@/ai/utils/positiveLineMapper";

const MAX_BACKGROUND_MATCHES = 16;

const SWR_OPTIONS = {
  revalidateOnFocus: false,
  revalidateIfStale: false,
  revalidateOnReconnect: false,
  dedupingInterval: 60000,
  keepPreviousData: true,
};

function makeFormatter() {
  return new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Stockholm",
  });
}

export default function AIWorkspace({ defaultDate }) {
  const [date, setDate] = useState(defaultDate);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [runToken, setRunToken] = useState(0);
  const [positiveLineMap, setPositiveLineMap] = useState({});
  const [comboLegs, setComboLegs] = useState(2);
  const [oddsRange, setOddsRange] = useState({ min: 1.8, max: 2.2 });

  const formatter = useMemo(makeFormatter, []);
  const formatTime = useCallback(
    (ts) => (ts ? formatter.format(new Date(ts * 1000)) : "—"),
    [formatter]
  );

  const matchesKey = date ? buildMatchesByDateKey(date) : null;
  const { data, error, isLoading } = useSWR(matchesKey, fetchJson, SWR_OPTIONS);

  const items = useMemo(() => data?.items ?? [], [data]);
  const matches = useMemo(() => items.map(normalizeMatch), [items]);
  const matchLookup = useMemo(() => buildMatchLookup(matches), [matches]);

  useEffect(() => {
    if (!selectedMatchId) {
      return;
    }
    const found = matches.some((match) => match.id === selectedMatchId);
    if (!found) {
      setSelectedMatchId(null);
    }
  }, [matches, selectedMatchId]);

  const handleSelectMatch = useCallback(
    (match) => {
      const targetId = match?.id ?? match?.matchId ?? null;
      setSelectedMatchId(targetId);
    },
    [setSelectedMatchId]
  );

  const insightsActive = runToken > 0;
  const matchupsKey =
    insightsActive && date
      ? `/api/matchups-score?date=${encodeURIComponent(date)}&run=${runToken}`
      : null;

  const {
    data: matchupsData,
    error: matchupsError,
    isLoading: matchupsLoading,
  } = useSWR(matchupsKey, fetchJson, { ...SWR_OPTIONS, revalidateOnMount: insightsActive });

  const topOverRows = useMemo(
    () => matchupsData?.top50?.over?.slice(0, 20) ?? [],
    [matchupsData]
  );

  const topUnderRows = useMemo(
    () => matchupsData?.top50?.under?.slice(0, 20) ?? [],
    [matchupsData]
  );

  const allRankedRows = useMemo(() => [...topOverRows, ...topUnderRows], [topOverRows, topUnderRows]);

  const insightKeySet = useMemo(() => {
    const set = new Set();
    allRankedRows.forEach((row) => {
      set.add(buildMatchupKey(row));
    });
    return set;
  }, [allRankedRows]);

  const buildLineKeyFromRow = useCallback(
    (row) => {
      if (!row) return null;
      const direction =
        (row.condition ?? row.direction ?? "")
          .toString()
          .toLowerCase()
          .startsWith("u")
          ? "under"
          : "over";
      return buildLineKey({
        matchId: row.matchId,
        statKey: row.statKey ?? row.statLabel,
        period: row.period,
        scope: row.scope,
        direction,
      });
    },
    []
  );

  const targetMatches = useMemo(() => {
    if (!insightsActive) return [];
    const buffer = [];
    const seen = new Set();
    const rows = [...topOverRows, ...topUnderRows];
    for (const entry of rows) {
      const entryKey = entry.matchId ? String(entry.matchId) : null;
      if (!entryKey) continue;
      const match = matchLookup.get(entryKey);
      if (!match) continue;
      const matchKey = match.id ?? match.matchId ?? `${match.homeTeamName}-${match.awayTeamName}`;
      if (seen.has(matchKey)) continue;
      seen.add(matchKey);
      buffer.push(match);
      if (buffer.length >= MAX_BACKGROUND_MATCHES) {
        break;
      }
    }
    return buffer;
  }, [insightsActive, topOverRows, topUnderRows, matchLookup]);

  const positiveLines = useMemo(() => Object.values(positiveLineMap).flat(), [positiveLineMap]);

  const insightTargetedLines = useMemo(() => {
    if (!insightsActive) return [];
    return positiveLines.filter((line) => insightKeySet.has(buildLineKey(line)));
  }, [insightKeySet, positiveLines, insightsActive]);

  const priorityMap = useMemo(() => {
    const map = {};
    allRankedRows.forEach((row) => {
      const key = buildLineKeyFromRow(row);
      if (!key) return;
      const score = Number(row.score ?? row.normalizedScore ?? 0);
      if (!Number.isFinite(score)) return;
      map[key] = Math.max(map[key] ?? 0, score);
    });
    return map;
  }, [allRankedRows, buildLineKeyFromRow]);

  const combos = useMemo(
    () =>
      buildCombos(insightTargetedLines, {
        legs: comboLegs,
        minOdds: oddsRange.min,
        maxOdds: oddsRange.max,
        priorityMap,
      }),
    [comboLegs, insightTargetedLines, oddsRange, priorityMap]
  );

  const handleOddsRangeChange = useCallback(
    (nextRange) => {
      const minVal = Math.min(nextRange.min, nextRange.max);
      const maxVal = Math.max(nextRange.min, nextRange.max);
      setOddsRange({ min: minVal, max: maxVal });
    },
    [setOddsRange]
  );

  const handlePositiveResults = useCallback((match, results) => {
    if (!match || !results) {
      return;
    }
    const matchKey = match.id ?? match.matchId ?? `${match.homeTeamName}-${match.awayTeamName}`;
    const mapped = results
      .map((result) => mapBacktestResultToLine(match, result))
      .filter((line) => line && typeof line.primaryEv === "number");
    setPositiveLineMap((prev) => {
      const next = { ...prev };
      if (mapped.length) {
        next[matchKey] = mapped;
      } else {
        delete next[matchKey];
      }
      return next;
    });
  }, []);

  const handleGenerate = useCallback(() => {
    setPositiveLineMap({});
    setRunToken((token) => token + 1);
  }, []);

  const positiveMatchesCount = Object.keys(positiveLineMap).length;
  const totalBacktests = targetMatches.length;
  const hasCombos = combos.length > 0;
  const positiveLineCount = positiveLines.length;
  const processing =
    insightsActive &&
    (matchupsLoading || positiveMatchesCount < totalBacktests || !matchupsData);

  const statusLabel = processing
    ? `Genererar (${positiveMatchesCount}/${totalBacktests} matcher klar)`
    : insightsActive
    ? "Klart, justera inställningarna eller kör igen"
    : "Klicka för att starta AI-generering";

  return (
    <div className="flex w-full flex-col overflow-x-hidden lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className="mx-auto flex w-full flex-1 flex-col overflow-x-hidden pb-6 px-4 sm:px-6 lg:px-8">
        <div className="grid w-full gap-4 grid-cols-1 md:[grid-template-columns:1fr_2fr] xl:[grid-template-columns:1fr_2fr] auto-rows-auto">
          <LeagueTables
            date={date}
            onDateChange={setDate}
            items={items}
            formatTime={formatTime}
            onSelectMatch={handleSelectMatch}
            onPrefetchMatch={() => undefined}
            selectedMatchId={selectedMatchId}
            isLoading={isLoading}
            error={error}
            matchesCount={matches.length}
          />

          <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-slate-900/50">
            <header className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">AI Generator</p>
                  <h2 className="text-lg font-semibold text-white">Smarta kombinationer</h2>
                </div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={processing}
                  className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-emerald-400 via-emerald-200 to-indigo-500 px-5 py-2 text-sm font-semibold text-slate-900 shadow-lg shadow-emerald-900/30 transition hover:translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-900 animate-pulse"
                >
                  Generate best bets for tyoday
                </button>
              </div>
              <p className="text-xs text-slate-400">{statusLabel}</p>
            </header>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded border border-slate-800/60 bg-slate-950/70 p-3 text-xs uppercase text-slate-400">
                <p className="text-2xl font-semibold text-emerald-300">{totalBacktests}</p>
                <p>Matcher att analysera</p>
              </div>
              <div className="rounded border border-slate-800/60 bg-slate-950/70 p-3 text-xs uppercase text-slate-400">
                <p className="text-2xl font-semibold text-emerald-300">{positiveMatchesCount}</p>
                <p>Backtests klara</p>
              </div>
              <div className="rounded border border-slate-800/60 bg-slate-950/70 p-3 text-xs uppercase text-slate-400">
                <p className="text-2xl font-semibold text-emerald-300">{positiveLineCount}</p>
                <p>+EV-linor sparade</p>
              </div>
            </div>

            <AIComboControls
              legs={comboLegs}
              onLegChange={setComboLegs}
              oddsRange={oddsRange}
              onOddsRangeChange={handleOddsRangeChange}
              disabled={!insightsActive}
            />

            <div>
              <AIComboList combos={combos} />
            </div>

            <AIInsightsList
              overRows={topOverRows}
              underRows={topUnderRows}
              generatedAt={matchupsData?.generatedAt ?? null}
              isLoading={matchupsLoading}
              error={matchupsError}
            />

            <AIPositiveLinesPanel lines={positiveLines} />
          </section>
        </div>
      </div>

      {insightsActive ? (
        <div className="sr-only" aria-hidden="true">
          <DayInsightsLegacy date={date} items={items} />
          <DayInsights date={date} items={items} />
          {targetMatches.length ? (
            <div>
              {targetMatches.map((match) => {
                const key = `${match.id ?? match.matchId}-${runToken}`;
                return (
                  <BacktestPage
                    key={key}
                    match={match}
                    onPositiveResults={handlePositiveResults}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
