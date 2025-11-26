"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import useSWR from "swr";
import clsx from "clsx";
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
import AIUserDatePicker from "@/ai/components/AIUserDatePicker";
import AIHeroInput from "@/ai/components/AIHeroInput";
import AISpinner from "@/ai/components/AISpinner";
import { buildCombos } from "@/ai/utils/comboBuilder";
import {
  buildLineKey,
  buildMatchLookup,
  buildMatchupKey,
  buildMatchLabelSignature,
} from "@/ai/utils/matchupUtils";
import { mapBacktestResultToLine } from "@/ai/utils/positiveLineMapper";
import { saveGeneratedResults, loadGeneratedResults } from "@/ai/utils/aiStorageUtils";

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

function useWorkspaceController(defaultDate) {
  const [date, setDate] = useState(defaultDate);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [runToken, setRunToken] = useState(0);
  const [positiveLineMap, setPositiveLineMap] = useState({});
  const [completedMatches, setCompletedMatches] = useState({});
  const [comboLegs, setComboLegs] = useState(2);
  const [oddsRange, setOddsRange] = useState({ min: 1.8, max: 2.2 });
  const [isLoadingFromStorage, setIsLoadingFromStorage] = useState(false);

  const formatter = useMemo(makeFormatter, []);
  const formatTime = useCallback(
    (ts) => (ts ? formatter.format(new Date(ts * 1000)) : "—"),
    [formatter]
  );

  const matchesKey = date ? buildMatchesByDateKey(date) : null;
  const { data, error, isLoading } = useSWR(matchesKey, fetchJson, SWR_OPTIONS);

  const items = useMemo(() => {
    const result = data?.items ?? [];
    console.log("[AIWorkspace] items from SWR:", {
      date,
      matchesKey,
      dataDate: data?.date,
      itemsCount: result.length,
      sampleIds: result.slice(0, 3).map(i => i.id),
    });
    return result;
  }, [data, date, matchesKey]);

  const matches = useMemo(() => items.map(normalizeMatch), [items]);
  const matchLookup = useMemo(() => buildMatchLookup(matches), [matches]);

  // Load saved results from localStorage when date changes
  useEffect(() => {
    if (!date) return;

    setIsLoadingFromStorage(true);
    const savedResults = loadGeneratedResults(date);

    if (savedResults) {
      // Restore saved state
      setPositiveLineMap(savedResults.positiveLineMap || {});
      setCompletedMatches(savedResults.completedMatches || {});
      setRunToken((token) => token + 1);
    } else {
      // No saved results, clear previous state
      setPositiveLineMap({});
      setCompletedMatches({});
      setRunToken(0);
    }

    setIsLoadingFromStorage(false);
  }, [date]);

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
    () => matchupsData?.top50?.over?.slice(0, 50) ?? [],
    [matchupsData]
  );

  const topUnderRows = useMemo(
    () => matchupsData?.top50?.under?.slice(0, 50) ?? [],
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
    }
    return buffer;
  }, [insightsActive, topOverRows, topUnderRows, matchLookup]);

  const positiveLines = useMemo(() => Object.values(positiveLineMap).flat(), [positiveLineMap]);

  // Save results to localStorage when generation is complete
  useEffect(() => {
    if (!date || !insightsActive || matchupsLoading || !matchupsData) {
      return;
    }

    const totalBacktests = targetMatches.length;
    const completedCount = Object.keys(completedMatches).length;

    // Only save when all backtests are complete
    if (totalBacktests > 0 && completedCount >= totalBacktests) {
      saveGeneratedResults(date, {
        positiveLineMap,
        completedMatches,
        topOverRows,
        topUnderRows,
        matchupsData,
      });
    }
  }, [date, insightsActive, matchupsLoading, matchupsData, targetMatches, completedMatches, positiveLineMap, topOverRows, topUnderRows]);

  const lineCounts = useMemo(() => {
    const map = new Map();
    positiveLines.forEach((line) => {
      const idKey = buildLineKey(line);
      if (idKey) {
        map.set(idKey, (map.get(idKey) ?? 0) + 1);
      }
      const labelKey = buildMatchLabelSignature(line);
      if (labelKey) {
        map.set(labelKey, (map.get(labelKey) ?? 0) + 1);
      }
    });
    return map;
  }, [positiveLines]);

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

  const handlePositiveResults = useCallback((match, results, unibetUrl = null) => {
    if (!match || !results) {
      return;
    }
    const matchKey = match.id ?? match.matchId ?? `${match.homeTeamName}-${match.awayTeamName}`;
    const safeResults = Array.isArray(results) ? results : [];
    const mapped = safeResults
      .map((result) => mapBacktestResultToLine(match, result, unibetUrl))
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
    setCompletedMatches((prev) => {
      if (prev[matchKey]) return prev;
      return { ...prev, [matchKey]: true };
    });
  }, []);

  const handleGenerate = useCallback(() => {
    // Clear current state and start fresh generation
    setPositiveLineMap({});
    setCompletedMatches({});
    setRunToken((token) => token + 1);
  }, []);

  const totalBacktests = targetMatches.length;
  const completedMatchesCount = useMemo(
    () => Object.keys(completedMatches).length,
    [completedMatches]
  );
  const hasCombos = combos.length > 0;
  const positiveLineCount = positiveLines.length;
  const processing =
    insightsActive &&
    (matchupsLoading || completedMatchesCount < totalBacktests || !matchupsData);

  const generatingLabel =
    totalBacktests > 0
      ? `Genererar (${completedMatchesCount}/${totalBacktests} matcher klar)`
      : "Genererar matchups…";
  const statusLabel = processing
    ? generatingLabel
    : insightsActive
      ? "Klart, justera inställningarna eller kör igen"
      : "Klicka för att starta AI-generering";

  return {
    date,
    setDate,
    items,
    matches,
    matchesCount: matches.length,
    formatTime,
    selectedMatchId,
    handleSelectMatch,
    isLoading,
    error,
    combos,
    comboLegs,
    setComboLegs,
    oddsRange,
    handleOddsRangeChange,
    topOverRows,
    topUnderRows,
    matchupsData,
    matchupsLoading,
    matchupsError,
    lineCounts,
    positiveLines,
    insightsActive,
    targetMatches,
    runToken,
    handlePositiveResults,
    handleGenerate,
    statusLabel,
    totalBacktests,
    completedMatchesCount,
    positiveLineCount,
    processing,
    hasCombos,
    priorityMap,
  };
}

function WorkspaceEngines({
  insightsActive,
  date,
  items,
  targetMatches,
  runToken,
  handlePositiveResults,
}) {
  if (!insightsActive) {
    return null;
  }
  return (
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
  );
}

export default function AIWorkspace({ defaultDate }) {
  const workspace = useWorkspaceController(defaultDate);
  const {
    date,
    setDate,
    items,
    matches,
    formatTime,
    handleSelectMatch,
    selectedMatchId,
    isLoading,
    error,
    handleGenerate,
    statusLabel,
    totalBacktests,
    completedMatchesCount,
    positiveLineCount,
    combos,
    comboLegs,
    setComboLegs,
    oddsRange,
    handleOddsRangeChange,
    topOverRows,
    topUnderRows,
    matchupsData,
    matchupsLoading,
    matchupsError,
    lineCounts,
    positiveLines,
    insightsActive,
    priorityMap,
  } = workspace;

  return (
    <div
      className="flex w-full flex-col overflow-x-hidden overflow-y-auto lg:h-full lg:min-h-0"
      style={{ maxHeight: "calc(100vh - 4rem)" }}
    >
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
                  disabled={workspace.processing}
                  className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-emerald-400 via-emerald-200 to-indigo-500 px-5 py-2 text-sm font-semibold text-slate-900 shadow-lg shadow-emerald-900/30 transition hover:translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-900"
                >
                  Generate best bets for today
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
                <p className="text-2xl font-semibold text-emerald-300">{completedMatchesCount}</p>
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
              <AIComboList combos={combos} priorityMap={priorityMap} />
            </div>

            <AIInsightsList
              overRows={topOverRows}
              underRows={topUnderRows}
              generatedAt={matchupsData?.generatedAt ?? null}
              isLoading={matchupsLoading}
              error={matchupsError}
              lineCounts={lineCounts}
            />

            <AIPositiveLinesPanel lines={positiveLines} />
          </section>
        </div>
      </div>

      <WorkspaceEngines {...workspace} />
    </div>
  );
}

export function AIUserWorkspace({ defaultDate }) {
  const workspace = useWorkspaceController(defaultDate);
  const {
    date,
    setDate,
    handleGenerate,
    statusLabel,
    processing,
    insightsActive,
    combos,
    hasCombos,
    totalBacktests,
    completedMatchesCount,
    comboLegs,
    setComboLegs,
    oddsRange,
    handleOddsRangeChange,
    priorityMap,
    topOverRows,
    topUnderRows,
    matchupsData,
    matchupsLoading,
    matchupsError,
    lineCounts,
  } = workspace;

  const [isScrolled, setIsScrolled] = useState(false);
  const scrollContainerRef = useRef(null);

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const scrollTop = scrollContainerRef.current.scrollTop;
      setIsScrolled(scrollTop > 50);
    }
  };

  const isBusy = processing;
  const canEvaluateCombos =
    insightsActive && !isBusy && totalBacktests > 0 && completedMatchesCount >= totalBacktests;
  const showResults = canEvaluateCombos;

  const handleUserGenerate = useCallback(() => {
    handleGenerate();
  }, [handleGenerate]);

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="flex min-h-screen flex-col bg-black text-white overflow-y-auto relative"
      style={{ maxHeight: "calc(100vh - 4rem)" }}
    >
      {/* Hero Section */}
      <div
        className={clsx(
          "flex flex-col items-center transition-all duration-500 ease-in-out",
          isScrolled ? "pt-32 pb-8" : "min-h-[60vh] justify-center pt-20 pb-12"
        )}
      >
        <h1
          className={clsx(
            "font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-500 transition-all duration-500",
            isScrolled
              ? "opacity-0 h-0 overflow-hidden scale-90"
              : "text-[10rem] leading-none mb-16 opacity-100 scale-100"
          )}
        >
          Ullebets
        </h1>

        <AIHeroInput
          date={date}
          setDate={setDate}
          onGenerate={handleUserGenerate}
          isBusy={isBusy}
          statusLabel={statusLabel}
          isScrolled={isScrolled}
        />
      </div>

      {/* Results Section */}
      {showResults && (
        <section className="w-full px-4 pb-24 animate-in fade-in slide-in-from-bottom-8 duration-700 fill-mode-forwards">
          <div className="mx-auto max-w-[1760px] flex flex-col gap-16">

            {/* Combos Section */}
            {hasCombos && (
              <div className="space-y-6 max-w-[1500px] mx-auto w-full">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-bold text-slate-200">Bästa Kombinationerna</h3>
                </div>
                <AIComboControls
                  legs={comboLegs}
                  onLegChange={setComboLegs}
                  oddsRange={oddsRange}
                  onOddsRangeChange={handleOddsRangeChange}
                  disabled={!showResults}
                />
                <AIComboList combos={combos} priorityMap={priorityMap} />
              </div>
            )}

            {/* All Matches List (2 Columns) - Header Hidden */}
            <div className="space-y-6 w-full">
              {/* Header removed as requested */}

              {/* AIInsightsList removed as requested */}
            </div>
          </div>
        </section>
      )}

      <WorkspaceEngines {...workspace} />
    </div>
  );
}
