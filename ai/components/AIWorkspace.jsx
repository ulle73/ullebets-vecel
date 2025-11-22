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
import AIUserDatePicker from "@/ai/components/AIUserDatePicker";
import AISpinner from "@/ai/components/AISpinner";
import { buildCombos } from "@/ai/utils/comboBuilder";
import {
  buildLineKey,
  buildMatchLookup,
  buildMatchupKey,
  buildMatchLabelSignature,
} from "@/ai/utils/matchupUtils";
import { mapBacktestResultToLine } from "@/ai/utils/positiveLineMapper";
import mapUnibetOdds from "../../components/backtest/unibetOddsMapper"; // Import mapUnibetOdds

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

async function postBacktest(body, options = {}) {
  const { signal } = options;
  const res = await fetch("/api/backtest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const message = payload?.message || `${res.status}`;
    throw new Error(message);
  }
  return res.json();
}

function useWorkspaceController(defaultDate) {
  const [date, setDate] = useState(defaultDate);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [runToken, setRunToken] = useState(0);
  const [positiveLineMap, setPositiveLineMap] = useState({});
  const [completedMatches, setCompletedMatches] = useState({});
  const [comboLegs, setComboLegs] = useState(2);
  const [oddsRange, setOddsRange] = useState({ min: 1.8, max: 2.2 });
  const [matchOddsMap, setMatchOddsMap] = useState({}); // New state for batch odds

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

  const handleGenerate = useCallback(async () => {
    setPositiveLineMap({});
    setCompletedMatches({});
    setMatchOddsMap({}); // Clear previous odds
    setRunToken((token) => token + 1);

    // Fetch odds for all target matches in batch
    if (!targetMatches.length) return;

    const matchInfos = targetMatches.map(match => ({
        matchId: match.matchId,
        eventId: match.eventId,
        homeTeam: match.homeTeamName,
        awayTeam: match.awayTeamName,
        leagueName: match.leagueName,
        timestamp: match.timestamp,
        start: match.start,
    }));

    try {
        const batchOddsResponse = await postBacktest({
            action: 'batch-auto-unibet-odds',
            matches: matchInfos,
        });
       
        const newMatchOddsMap = {};
        for (const item of batchOddsResponse) {
            if (item.error) {
                console.error(`Error fetching odds for match ${item.matchInfo?.matchId || item.matchInfo?.eventId}: ${item.error}`);
                continue;
            }
            const matchId = item.matchInfo?.matchId || item.matchInfo?.eventId;
            if (matchId) {
                const tuples = mapUnibetOdds(
                    item.odds,
                    item.matched?.home || item.matchInfo?.homeTeam,
                    item.matched?.away || item.matchInfo?.awayTeam
                );
                // Convert tuples to the oddsStore format expected by BacktestPage
                const oddsStoreForMatch = {};
                if(tuples.length > 0) { // Only process if there are actual odds
                  const teamKey = `${item.matchInfo?.homeTeam}-${item.matchInfo?.awayTeam}`; // Reconstruct teamKey
                  for (const tuple of tuples) {
                      const { statKey, scope, period, line, odds } = tuple;
                      if (!oddsStoreForMatch[statKey]) oddsStoreForMatch[statKey] = {};
                      if (!oddsStoreForMatch[statKey][scope]) oddsStoreForMatch[statKey][scope] = {};
                      if (!oddsStoreForMatch[statKey][scope][period]) oddsStoreForMatch[statKey][scope][period] = {};
                      
                      const numericLine = Number(line);
                      const lineStore = {
                          ...(oddsStoreForMatch[statKey][scope][period][numericLine] || { over: "", under: "" }),
                      };
                      if (odds.over != null) lineStore.over = odds.over;
                      if (odds.under != null) lineStore.under = odds.under;
                      oddsStoreForMatch[statKey][scope][period][numericLine] = lineStore;
                  }
                  newMatchOddsMap[matchId] = { [teamKey]: oddsStoreForMatch }; // Wrap in the actual teamKey
                }
            }
        }
        setMatchOddsMap(newMatchOddsMap);
        // After fetching odds, we can proceed to trigger backtests
        // The BacktestPage instances will receive these odds via initialOdds prop
    } catch (error) {
        console.error("Error in batch odds fetching:", error);
        // Handle error, e.g., set an error state in the workspace
    }

  }, [targetMatches]);

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
  };
}

function WorkspaceEngines({
  insightsActive,
  date,
  items,
  targetMatches,
  runToken,
  handlePositiveResults,
  matchOddsMap, // Receive the new state
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
            const matchId = match.matchId ?? match.eventId; // Use matchId or eventId to key into matchOddsMap
            const initialOdds = matchId ? matchOddsMap[matchId] : undefined;
            return (
              <BacktestPage
                key={key}
                match={match}
                onPositiveResults={handlePositiveResults}
                initialOdds={initialOdds} // Pass initial odds
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
    matchOddsMap, // Destructure matchOddsMap here
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
              <AIComboList combos={combos} />
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

      <WorkspaceEngines {...workspace} matchOddsMap={matchOddsMap} />
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
  } = workspace;

  const [showEmptyState, setShowEmptyState] = useState(false);

  const isBusy = processing;
  const canEvaluateCombos =
    insightsActive && !isBusy && totalBacktests > 0 && completedMatchesCount >= totalBacktests;
  const showResults = canEvaluateCombos && hasCombos;
  const readyForCombos = canEvaluateCombos;

  const handleUserGenerate = useCallback(() => {
    setShowEmptyState(false);
    handleGenerate();
  }, [handleGenerate]);

  return (
    <>
      <div
        className="flex min-h-screen flex-col bg-black text-white overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 4rem)" }}
      >
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <div className="w-full max-w-xl space-y-6">
            <AIUserDatePicker value={date} onChange={setDate} />
            <button
              type="button"
              onClick={handleUserGenerate}
              disabled={isBusy}
              className="ai-user-button group relative isolate flex w-full items-center justify-center overflow-hidden rounded-full bg-slate-950/80 p-[3px] text-lg font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span
                className="ai-border-spinner pointer-events-none absolute inset-0 bg-[conic-gradient(at_top,_#0ea5e9,_#34d399,_#a78bfa,_#0ea5e9)] opacity-80 blur-sm"
                aria-hidden="true"
              />
              <span
                className="pointer-events-none absolute inset-0 rounded-full border border-white/10 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.35),transparent_55%),radial-gradient(circle_at_80%_0%,rgba(14,165,233,0.35),transparent_35%)] opacity-70 mix-blend-screen"
                aria-hidden="true"
              />
              <span
                className="ai-flow pointer-events-none absolute inset-y-0 -left-1/4 w-1/2 rounded-full bg-gradient-to-r from-white/40 via-emerald-200/40 to-transparent opacity-50 blur-2xl"
                aria-hidden="true"
              />
              <span className="relative flex w-full items-center justify-center rounded-full bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 px-6 py-4 text-slate-100 shadow-[0_25px_70px_-30px_rgba(34,197,94,0.9)] transition-all duration-300 group-hover:translate-y-0.5 group-hover:shadow-[0_35px_90px_-25px_rgba(59,130,246,0.7)] group-active:scale-[0.99]">
                <span className="ai-flicker flex items-center justify-center gap-3 text-emerald-100">
                  <span className="ai-sparkles relative inline-flex h-10 w-10 items-center justify-center" aria-hidden="true">
                    <span className="ai-sparkle-star absolute right-1 top-1/2 -translate-y-1/2 text-2xl">✦</span>
                    <span className="ai-sparkle-star absolute left-1 top-0 text-base opacity-80 -rotate-12">✦</span>
                    <span className="ai-sparkle-star ai-sparkle-star--small absolute left-1.5 bottom-0 text-sm opacity-60 rotate-6">✦</span>
                  </span>
                  <span className="tracking-[0.16em]">Ai generate bets</span>
                </span>
              </span>
            </button>
            <p className="text-sm text-slate-400">{statusLabel}</p>
            {isBusy ? <AISpinner label="Analyserar matcher" /> : null}
          </div>
        </div>

        {showResults ? (
          <section className="w-full bg-black px-4 pb-12">
            <div className="mx-auto flex max-w-4xl flex-col gap-6">
              <AIComboControls
                legs={comboLegs}
                onLegChange={setComboLegs}
                oddsRange={oddsRange}
                onOddsRangeChange={handleOddsRangeChange}
                disabled={!showResults}
              />
              <AIComboList combos={combos} />
            </div>
          </section>
        ) : null}



        {/* {isBusy && insightsActive ? (
          <section className="w-full px-4 pb-12">
            <div className="mx-auto max-w-md text-center text-sm text-slate-400">
              <p>Vi jobbar på saken… Dina matcher analyseras i bakgrunden.</p>
            </div>
          </section>
        ) : null} */}

        <WorkspaceEngines {...workspace} />
      </div>
      <style jsx>{`
        .ai-border-spinner {
          animation: aiBorderSpin 12s linear infinite;
        }

        .ai-flow {
          animation: aiFlow 6s ease-in-out infinite;
        }

        .ai-flicker {
          animation: aiFlicker 3.5s linear infinite;
        }

        .ai-sparkle-star {
          display: inline-block;
          animation-name: aiSparkle;
          animation-duration: 4.2s;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
          text-shadow: 0 0 10px rgba(14, 165, 233, 0.35);
        }

        .ai-sparkle-star--small {
          animation-name: aiSparkleSmall;
        }

        .ai-sparkle-star:nth-child(2) {
          animation-delay: 0.6s;
        }

        .ai-sparkle-star:nth-child(3) {
          animation-delay: 1.1s;
        }

        @keyframes aiBorderSpin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        @keyframes aiFlow {
          0% {
            transform: translateX(-150%);
            opacity: 0;
          }
          45% {
            opacity: 0.6;
          }
          100% {
            transform: translateX(180%);
            opacity: 0;
          }
        }

        @keyframes aiFlicker {
          0%,
          16%,
          18%,
          42%,
          100% {
            opacity: 1;
            text-shadow: 0 0 12px rgba(16, 185, 129, 0.6), 0 0 24px rgba(14, 165, 233, 0.45);
          }
          17%,
          40%,
          60% {
            opacity: 0.7;
            text-shadow: 0 0 6px rgba(79, 70, 229, 0.5), 0 0 14px rgba(14, 165, 233, 0.35);
          }
          20%,
          55%,
          72% {
            opacity: 0.9;
          }
        }

        @keyframes aiSparkle {
          0%,
          100% {
            opacity: 0.4;
            transform: scale(0.8) rotate(0deg);
          }
          50% {
            opacity: 1;
            transform: scale(1.1) rotate(8deg);
          }
        }

        @keyframes aiSparkleSmall {
          0%,
          100% {
            opacity: 0.45;
            transform: scale(0.6) rotate(0deg);
          }
          50% {
            opacity: 0.95;
            transform: scale(0.85) rotate(8deg);
          }
        }
      `}</style>
    </>
  );
}
