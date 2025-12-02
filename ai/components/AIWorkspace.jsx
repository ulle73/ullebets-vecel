"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import useSWR from "swr";
import clsx from "clsx";
import LeagueTables from "@/components/LeagueTables";
import BacktestPage from "@/components/BacktestPage";
import DayInsightsLegacy from "@/components/DayInsights-copy";
import DayInsights from "@/components/DayInsights-copy-v2";
import { normalizeMatch } from "@/lib/core/matchups";
import { buildMatchesByDateKey } from "@/lib/utils/apiKeys";
import { fetchJson } from "@/lib/utils/fetchers";
import AIComboControls from "@/ai/components/AIComboControls";
import AIComboList from "@/ai/components/AIComboList";
import AIHistoryList from "@/ai/components/AIHistoryList";
import AIInsightsList from "@/ai/components/AIInsightsList";
import AIPositiveLinesPanel from "@/ai/components/AIPositiveLinesPanel";
import AIUserDatePicker from "@/ai/components/AIUserDatePicker";
import AIHeroInput from "@/ai/components/AIHeroInput";
import AISpinner from "@/ai/components/AISpinner";
import { buildCombos } from "@/ai/utils/comboBuilder";
import { buildLineKey, buildBetKey } from "@/lib/core/keys";
import { buildMatchLookup, buildMatchupKey, buildMatchLabelSignature } from "@/ai/utils/matchupUtils";
import { mapBacktestResultToLine } from "@/ai/utils/positiveLineMapper";

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
  const [selectedDates, setSelectedDates] = useState([defaultDate].filter(Boolean));
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [runToken, setRunToken] = useState(0);
  const [positiveLineMap, setPositiveLineMap] = useState({});
  const [completedMatches, setCompletedMatches] = useState({});
  const [backendTotalMatches, setBackendTotalMatches] = useState(null);
  const [comboLegs, setComboLegs] = useState(2);
  // Bredare default så kombos inte filtreras bort direkt
  const [oddsRange, setOddsRange] = useState({ min: 1.1, max: 25 });
  const [isLoadingFromStorage, setIsLoadingFromStorage] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // History State
  const [historyBets, setHistoryBets] = useState([]);
  const [isHistoryMode, setIsHistoryMode] = useState(false);

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

  // DISABLED: We now use backend API, no need to load from localStorage
  /*
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
  */

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

  const positiveLinesRaw = useMemo(() => Object.values(positiveLineMap).flat(), [positiveLineMap]);
  // Show only +EV lines
  const positiveLines = useMemo(
    () =>
      positiveLinesRaw.filter((line) => {
        const ev = Number(line.primaryEv ?? line.value ?? 0);
        return Number.isFinite(ev) && ev > 0;
      }),
    [positiveLinesRaw]
  );

  // DISABLED: API now handles persistence to MongoDB
  /*
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
  */

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
    // Backend already filters by insights for all selected dates.
    // We should use all positiveLines returned by the backend.
    return positiveLines;
  }, [positiveLines, insightsActive]);

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
    () => {
      const generated = buildCombos(insightTargetedLines, {
        legs: comboLegs,
        minOdds: oddsRange.min,
        maxOdds: oddsRange.max,
        priorityMap,
        maxCombos: 200,
        maxLines: 200,
      });

      // If no combos found with requested legs (and legs > 1), try generating singles
      if (generated.length === 0 && comboLegs > 1) {
        // Generate singles but keep the same odds filter
        const singles = buildCombos(insightTargetedLines, {
          legs: 1,
          minOdds: 1.01, // Allow all odds for singles fallback, or use oddsRange.min if strict
          maxOdds: 100,
          priorityMap,
          maxCombos: 200,
          maxLines: 200,
        });
        return singles;
      }

      return generated;
    },
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

  const handleGenerate = useCallback(async () => {
    // Clear current state
    setPositiveLineMap({});
    setCompletedMatches({});
    setBackendTotalMatches(null);
    setIsGenerating(true);

    try {
      console.log('[AI Generate] Calling backend API...');

      const datesToRun = selectedDates.length ? selectedDates : [date];

      // Check if ANY date is in the past (before today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isPast = datesToRun.some(d => new Date(d) < today);

      if (isPast) {
        setIsHistoryMode(true);
        setHistoryBets([]);

        const allHistory = [];
        for (const runDate of datesToRun) {
          const res = await fetch('/api/ai/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: runDate })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.bets) {
              allHistory.push(...data.bets);
            }
          }
        }
        setHistoryBets(allHistory);
        console.log('[AI Generate] Loaded', allHistory.length, 'historical bets');
        return;
      } else {
        setIsHistoryMode(false);
        // Only increment runToken for live generation
        setRunToken((token) => token + 1);
      }

      const aggregateLineMap = {};
      const allProcessedIds = new Set();
      let totalBackendMatches = 0;

      for (const runDate of datesToRun) {
        console.log('[AI Generate] Calling backend API for date', runDate);
        const response = await fetch('/api/ai/generate-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: runDate }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to generate bets');
        }

        const result = await response.json();
        console.log('[AI Generate] API response:', result);

        if (result.bets && Array.isArray(result.bets)) {
          result.bets.forEach(bet => {
            const matchKey = String(bet.matchId);
            if (!aggregateLineMap[matchKey]) {
              aggregateLineMap[matchKey] = [];
            }
            if (bet.lines && Array.isArray(bet.lines)) {
              aggregateLineMap[matchKey].push(...bet.lines);
            }
          });

          const backendIds = Array.isArray(result.matchIdsProcessed)
            ? result.matchIdsProcessed.map((id) => String(id))
            : [];

          backendIds.forEach(id => allProcessedIds.add(id));
          totalBackendMatches += backendIds.length || Object.keys(aggregateLineMap).length || 0;
        }
      }

      setPositiveLineMap(aggregateLineMap);

      const completed = {};
      // Mark all processed matches as completed, even if they have no bets
      allProcessedIds.forEach(id => {
        completed[id] = true;
      });
      // Fallback: ensure matches with bets are also marked
      Object.keys(aggregateLineMap).forEach(key => {
        completed[key] = true;
      });

      setCompletedMatches(completed);
      if (totalBackendMatches > 0) {
        setBackendTotalMatches(totalBackendMatches);
      }

      console.log('[AI Generate] Success! Loaded', Object.keys(aggregateLineMap).length, 'matches across dates');
    } catch (error) {
      console.error('[AI Generate] Error:', error);
      alert(`Failed to generate bets: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  }, [date, selectedDates, targetMatches]);

  const totalBacktests = targetMatches.length;
  const totalBacktestsResolved =
    backendTotalMatches != null && backendTotalMatches > 0
      ? backendTotalMatches
      : totalBacktests;
  const completedMatchesCount = useMemo(
    () => Object.keys(completedMatches).length,
    [completedMatches]
  );
  const hasCombos = combos.length > 0;
  const positiveLineCount = positiveLines.length;
  const hasBackendTotals = backendTotalMatches != null && backendTotalMatches > 0;
  const matchupsReady = !!matchupsData || hasBackendTotals;
  const processing =
    isGenerating ||
    (!isHistoryMode &&
      insightsActive &&
      ((matchupsLoading && !hasBackendTotals) ||
        completedMatchesCount < totalBacktestsResolved ||
        !matchupsReady));

  const generatingLabel = isHistoryMode
    ? "Hämtar historiska spel..."
    : totalBacktestsResolved > 0
      ? `Genererar (${completedMatchesCount}/${totalBacktestsResolved} matcher klar)`
      : "Genererar matchups…";
  const statusLabel = processing
    ? generatingLabel
    : isHistoryMode
      ? `Hämtade ${historyBets.length} historiska spel`
      : insightsActive
        ? "Klart, justera inställningarna eller kör igen"
        : "Klicka för att starta AI-generering";

  return {
    date,
    setDate,
    selectedDates,
    setSelectedDates,
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
    totalBacktests: totalBacktestsResolved,
    totalBacktestsResolved,
    completedMatchesCount,
    positiveLineCount,
    processing,
    hasCombos,
    priorityMap,
    historyBets,
    isHistoryMode,
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
  const SHOW_POSITIVE_PANEL = false; // Toggle to true to show all +EV lines panel
  const workspace = useWorkspaceController(defaultDate);
  const {
    date,
    setDate,
    selectedDates,
    setSelectedDates,
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
    totalBacktestsResolved,
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

      {/* DISABLED: We now use backend /api/ai/generate-user instead of client-side backtesting */}
      {/* <WorkspaceEngines {...workspace} /> */}
    </div>
  );
}

export function AIUserWorkspace({ defaultDate }) {
  const SHOW_POSITIVE_PANEL = false; // Toggle to true to show +EV lines panel
  const workspace = useWorkspaceController(defaultDate);
  const {
    date,
    setDate,
    selectedDates,
    setSelectedDates,
    handleGenerate,
    statusLabel,
    processing,
    insightsActive,
    combos,
    hasCombos,
    totalBacktests,
    totalBacktestsResolved,
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
    positiveLines,
    positiveLineCount,
    historyBets,
    isHistoryMode,
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
  const totalResolved = totalBacktestsResolved ?? totalBacktests ?? 0;
  const canEvaluateCombos =
    (insightsActive &&
      !isBusy &&
      totalResolved > 0 &&
      completedMatchesCount >= totalResolved) || isHistoryMode;
  const showResults = canEvaluateCombos;

  const handleUserGenerate = useCallback(() => {
    handleGenerate();
  }, [handleGenerate]);

  const hasLines = (positiveLines?.length ?? 0) > 0;

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
          "flex flex-col items-center transition-[padding] duration-500 ease-in-out min-h-[50vh]",
          isScrolled ? "pt-20 pb-10" : "pt-28 pb-16"
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
          selectedDates={selectedDates}
          setSelectedDates={setSelectedDates}
          onGenerate={handleUserGenerate}
          isBusy={isBusy}
          statusLabel={statusLabel}
          isScrolled={isScrolled}
          isHistoryMode={isHistoryMode}
        />
      </div>

      {/* Results Section */}
      {showResults && (
        <section className="w-full px-4 pb-24 animate-in fade-in slide-in-from-bottom-8 duration-700 fill-mode-forwards">
          <div className="mx-auto max-w-[1760px] flex flex-col gap-16">

            {/* Combos Section */}
            {(hasCombos || hasLines || isHistoryMode) && (
              <div className="space-y-6 max-w-4xl mx-auto w-full">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-bold text-slate-200">
                    {isHistoryMode ? "Historiska Spel" : "Bästa Kombinationerna"}
                  </h3>
                </div>

                {!isHistoryMode && (
                  <AIComboControls
                    legs={comboLegs}
                    onLegChange={setComboLegs}
                    oddsRange={oddsRange}
                    onOddsRangeChange={handleOddsRangeChange}
                    disabled={!showResults}
                  />
                )}

                {isHistoryMode ? (
                  <AIHistoryList bets={historyBets} />
                ) : hasCombos ? (
                  <AIComboList combos={combos} priorityMap={priorityMap} />
                ) : (
                  <div className="rounded border border-slate-800/60 bg-slate-950/60 px-4 py-3 text-sm text-slate-400">
                    Inga kombinationer inom oddsintervallet — justera filter eller använd enskilda spel nedan.
                  </div>
                )}
              </div>
            )}

            {/* Always show selected linor */}
            {hasLines && SHOW_POSITIVE_PANEL && !isHistoryMode && (
              <div className="space-y-3 max-w-4xl mx-auto w-full">
                {!hasCombos && (
                  <p className="text-sm text-slate-400">
                    Inga kombinationer inom oddsintervallet — visar valda linor i stället.
                  </p>
                )}
                <AIPositiveLinesPanel lines={positiveLines} />
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

      {/* DISABLED: We now use backend API, no need for client-side backtesting */}
      {/* <WorkspaceEngines {...workspace} /> */}
    </div>
  );
}

