"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DayInsightsLegacy from "@/components/DayInsights-copy";
import DayInsights from "@/components/DayInsights-copy-v2";
import mapUnibetOdds from "@/components/backtest/unibetOddsMapper";
import { getStatKeyLabel } from "@/lib/utils/statKeyLabels";
import { useMatchups } from "../hooks/useMatchups";
import { mapMatchupEntries } from "../services/matchupMapper";
import {
  postBacktest,
  buildAutoPayload,
  buildExpectedValuePayload,
} from "../services/backtestClient";
import { resolvePrimaryEv } from "../services/evUtils";
import { buildCombos } from "../services/comboBuilder";

const COMBO_OPTIONS = [
  { value: "singel", label: "Singel" },
  { value: "dubblar", label: "Dubblar" },
  { value: "tripplar", label: "Tripplar" },
];

const MAX_MATCHES = 8;
const MAX_BETS = 60;

function formatStatLabel(statKey, fallback) {
  return getStatKeyLabel(statKey) || fallback || "Stat";
}

function buildMatchLabel(matchPayload) {
  const home = matchPayload?.homeTeam ?? "Hemmalaget";
  const away = matchPayload?.awayTeam ?? "Bortalaget";
  return `${home} vs ${away}`;
}

async function ensureTeamStats(teamName, signal) {
  if (!teamName) return null;
  try {
    return await postBacktest(
      { action: "team-stats", teamName, matchType: "all" },
      { signal }
    );
  } catch (error) {
    return null;
  }
}

export default function AIWorkspace({ date, matches = [] }) {
  const { data: matchupsData, error: matchupsError, isLoading: matchupsLoading } =
    useMatchups(date);

  const overRows = useMemo(
    () => mapMatchupEntries(matchupsData?.top50?.over, "over"),
    [matchupsData]
  );
  const underRows = useMemo(
    () => mapMatchupEntries(matchupsData?.top50?.under, "under"),
    [matchupsData]
  );

  const [positiveBets, setPositiveBets] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Redo att generera best bets.");
  const [errorMessage, setErrorMessage] = useState(null);
  const [comboType, setComboType] = useState("singel");
  const [rangeMin, setRangeMin] = useState(1.6);
  const [rangeMax, setRangeMax] = useState(2.4);
  const abortRef = useRef(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setPositiveBets([]);
    setStatusMessage("Matchdag ändrad, generera på nytt.");
    setErrorMessage(null);
  }, [date]);

  const combos = useMemo(
    () => buildCombos(positiveBets, comboType, rangeMin, rangeMax),
    [positiveBets, comboType, rangeMin, rangeMax]
  );

  const handleGenerate = useCallback(async () => {
    const todaysMatches = (matches || []).slice(0, MAX_MATCHES);
    if (!todaysMatches.length) {
      setErrorMessage("Ingen matchdata för valt datum.");
      setStatusMessage("Matcher saknas.");
      return;
    }
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setErrorMessage(null);
    setPositiveBets([]);
    setStatusMessage("Förbereder matchlista...");

    try {
      const collected = [];
      const seenBets = new Set();

      for (let index = 0; index < todaysMatches.length; index += 1) {
        if (controller.signal.aborted) break;
        const match = todaysMatches[index];
        let payloadMatch;
        try {
          payloadMatch = buildAutoPayload(match);
        } catch (error) {
          continue;
        }
        const matchLabel = buildMatchLabel(payloadMatch);
        const matchId =
          payloadMatch.matchId ??
          payloadMatch.id ??
          match.matchId ??
          match.id ??
          `${payloadMatch.homeTeam}-${payloadMatch.awayTeam}`;

        setStatusMessage(
          `(${index + 1}/${todaysMatches.length}) Hämtar statistik för ${matchLabel}…`
        );
        await ensureTeamStats(payloadMatch.homeTeam, controller.signal);
        if (controller.signal.aborted) break;
        await ensureTeamStats(payloadMatch.awayTeam, controller.signal);
        if (controller.signal.aborted) break;

        setStatusMessage(`Hämtar odds för ${matchLabel}…`);
        const autoOdds = await postBacktest(payloadMatch, { signal: controller.signal });
        if (controller.signal.aborted) break;

        const tuples = mapUnibetOdds(
          autoOdds?.odds,
          payloadMatch.homeTeam,
          payloadMatch.awayTeam
        );
        if (!tuples.length) continue;

        for (const tuple of tuples) {
          if (controller.signal.aborted) break;
          const tupleScope = tuple.scope || "total";
          const tuplePeriod = tuple.period || "ALL";
          const statLabel = formatStatLabel(tuple.statKey);

          for (const direction of ["over", "under"]) {
            if (controller.signal.aborted) break;
            const oddsValue = tuple.odds?.[direction];
            if (!Number.isFinite(oddsValue)) continue;

            setStatusMessage(
              `Analyserar ${matchLabel} · ${statLabel} · ${direction}`
            );

            const evPayload = buildExpectedValuePayload({
              match: payloadMatch,
              tuple,
              direction,
              odds: oddsValue,
              fallbackLabel: matchLabel,
            });
            const result = await postBacktest(evPayload, { signal: controller.signal });
            if (controller.signal.aborted) break;
            const { primaryEv, primaryLabel } = resolvePrimaryEv(
              result,
              tuple.statKey
            );
            if (!Number.isFinite(primaryEv) || primaryEv <= 0) continue;

            const betKey = `${matchId}:${tuple.statKey}:${tupleScope}:${tuplePeriod}:${tuple.line}:${direction}:${oddsValue}`;
            if (seenBets.has(betKey)) continue;
            seenBets.add(betKey);

            collected.push({
              matchId,
              matchLabel,
              leagueName: payloadMatch.leagueName ?? match.leagueName,
              statKey: tuple.statKey,
              statLabel,
              direction,
              scope: tupleScope,
              period: tuplePeriod,
              line: Number(tuple.line),
              odds: Number(oddsValue),
              primaryEv,
              primaryLabel,
              unibetUrl:
                autoOdds?.eventUrl ||
                (autoOdds?.eventId
                  ? `https://www.unibet.se/betting/sports/event/${autoOdds.eventId}`
                  : null),
            });

            if (collected.length >= MAX_BETS) break;
          }
        }
        if (collected.length >= MAX_BETS) break;
      }

      const sorted = [...collected].sort((a, b) => b.primaryEv - a.primaryEv);
      setPositiveBets(sorted.slice(0, MAX_BETS));
      setStatusMessage(
        sorted.length
          ? `Klar – hittade ${sorted.length} +EV-bets från dagens matchlista.`
          : "Klar – inga +EV på dagens matcher."
      );
    } catch (error) {
      if (error.name !== "AbortError") {
        setErrorMessage(error.message || "Kunde inte generera best bets.");
        setStatusMessage("Misslyckades – försök igen.");
      }
    } finally {
      setIsGenerating(false);
    }
  }, [matches]);

  const positivePreview = useMemo(() => positiveBets.slice(0, 1000), [positiveBets]);

  const statusTone =
    matchupsError || errorMessage
      ? "text-red-500"
      : isGenerating
      ? "text-emerald-600"
      : "text-gray-500";

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm overflow-y-auto max-h-[calc(100vh-4rem)]">
      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-auto p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI-baserade best bets</h2>
              <p className="text-xs uppercase text-gray-500">Top 20 över/under · +EV</p>
            </div>
            <span className={`text-xs font-semibold ${statusTone}`}>{statusMessage}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span>Over-data: {overRows.length}</span>
            <span>Under-data: {underRows.length}</span>
            <span>{matchupsLoading ? "Laddar matchups…" : matchupsError ? "Matchups fel" : "Uppdaterad"}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-emerald-500 via-lime-500 to-amber-400 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ animation: isGenerating ? "pulse 1.5s infinite" : undefined }}
          >
            Generate best bets for tyoday
          </button>
          {matchupsError || errorMessage ? (
            <p className="text-xs text-red-600">{matchupsError?.message || errorMessage}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-t border-dashed border-gray-200 pt-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {COMBO_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setComboType(option.value)}
                className={`rounded-full border px-3 py-1 font-semibold transition ${
                  comboType === option.value
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-700"
                    : "border-gray-300 text-gray-600 hover:border-emerald-400"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
            <div className="flex items-center gap-1">
              <label className="font-semibold uppercase tracking-wide text-gray-500">Odds range</label>
              <input
                type="number"
                step="0.1"
                min="1"
                value={rangeMin}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  setRangeMin(value);
                  if (value > rangeMax) {
                    setRangeMax(value + 0.2);
                  }
                }}
                className="w-16 rounded border border-gray-300 px-2 py-0.5 text-xs"
              />
              <span>–</span>
              <input
                type="number"
                step="0.1"
                min="1"
                value={rangeMax}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  setRangeMax(value);
                  if (value < rangeMin) {
                    setRangeMin(Math.max(1, value - 0.2));
                  }
                }}
                className="w-16 rounded border border-gray-300 px-2 py-0.5 text-xs"
              />
            </div>
            <span className="text-gray-400">
              {positiveBets.length ? `${Math.min(positiveBets.length, 20)} positiva linor` : "Hittar +EV efter generation"}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              +EV-bets (visa {positivePreview.length})
            </h3>
            <div className="mt-2 grid gap-2 text-xs">
              {positivePreview.length ? (
                positivePreview.map((bet) => (
                  <div
                    key={`${bet.matchId}:${bet.statKey}:${bet.direction}:${bet.line}`}
                    className="rounded border border-gray-200 bg-gray-50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between text-[11px] font-semibold text-gray-700">
                      <span>{bet.matchLabel}</span>
                      <span className="text-emerald-600">{bet.primaryEv.toFixed(1)}% EV</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                      <span>{bet.leagueName}</span>
                      <span>
                        {formatStatLabel(bet.statKey, bet.statLabel)} · {bet.direction} {bet.scope} · {bet.period}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 font-mono text-emerald-700">
                        Lina {bet.line?.toFixed(2) ?? "N/A"}
                      </span>
                      <span>Odds {bet.odds.toFixed(2)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded border border-dashed border-gray-200 px-3 py-2 text-[11px] text-gray-500">
                  Generera best bets för att börja samla +EV.
                </p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Föreslagna kombinationer</h3>
            <div className="mt-2 space-y-3">
              {combos.length ? (
                combos.map((combo, index) => (
                  <div
                    key={`combo-${index}`}
                    className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-sm"
                  >
                    <div className="flex items-center justify-between text-gray-700">
                      <span className="font-semibold">Totalt odds {combo.totalOdds.toFixed(2)}</span>
                      <span className="text-emerald-600">EV {combo.totalEv.toFixed(1)}%</span>
                    </div>
                    <ol className="space-y-2">
                      {combo.bets.map((bet) => (
                        <li key={`${bet.matchId}-${bet.statKey}-${bet.direction}-${bet.line}-${bet.odds}`} className="flex flex-col gap-0.5">
                          <span className="font-semibold text-[11px] text-gray-700">
                            {bet.matchLabel} · {formatStatLabel(bet.statKey, bet.statLabel)}
                          </span>
                          <span className="text-[10px] text-gray-500">
                            {bet.direction} {bet.scope} · {bet.period} · Lina {bet.line?.toFixed(2)} · Odds {bet.odds.toFixed(2)} · EV {bet.primaryEv.toFixed(1)}%
                            {bet.primaryLabel ? ` (${bet.primaryLabel})` : ""}
                          </span>
                          {bet.unibetUrl ? (
                            <a
                              href={bet.unibetUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-blue-500 underline"
                            >
                              Se på Unibet
                            </a>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))
              ) : positiveBets.length ? (
                <div className="rounded border border-dashed border-gray-200 px-3 py-4 text-[11px] text-gray-500">
                  Inga kombinationer matchar den valda odds-range:n. Justera intervallet eller välj annat kombotyp.
                </div>
              ) : (
                <div className="rounded border border-dashed border-gray-200 px-3 py-4 text-[11px] text-gray-500">
                  Generera best bets för att se kombinationer.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="sr-only pointer-events-none" aria-hidden="true">
          <DayInsightsLegacy date={date} items={matches} />
          <DayInsights date={date} items={matches} />
        </div>
      </div>
    </div>
  );
}
