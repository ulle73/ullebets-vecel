"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapUnibetOdds from "./backtest/unibetOddsMapper";
import { getStatPatterns } from "./backtest/statPatterns";
import { computeHistoryStats } from "./backtest/historyCalculator";
import { getFormulaConfig } from "@/lib/backtest/formulaConfig";

const translations = {
  title: "Backtest",
  load_odds: "Ladda Unibet-odds",
  calculate_all: "Kör backtest",
  neutral_ground: "Neutral plan",
  unibet_placeholder: "Klistra in Unibet-url eller event-id",
  scope_total: "Totalt",
  scope_home: "Hemmalag",
  scope_away: "Bortalag",
  period_match: "Hela matchen",
  period_first_half: "Första halvlek",
  period_second_half: "Andra halvlek",
  form_all: "Alla matcher",
  form_label: "Form (antal matcher eller 'all')",
  over: "Över",
  under: "Under",
  odds: "Odds",
  ev_percent: "EV%",
  stat: "Statistik",
  team: "Lag",
  period: "Period",
  direction: "Spel",
  value: "Värde",
  positive_ev_header: "Alla +EV",
  home_importance: "Hemmalagets importance",
  away_importance: "Bortalagets importance",
  loading: "Hämtar…",
  error_generic: "Något gick fel",
  error_missing_odds: "Fyll i odds innan du kör backtest",
  error_invalid_odds: "Ogiltigt odds",
  stat_total_shots: "Totala skott",
  stat_total_shots_on_target: "Skott på mål",
  stat_corner_kicks: "Hörnor",
  stat_yellow_cards: "Gula kort",
  stat_throw_ins: "Inkaster",
  stat_free_kicks: "Frisparkar",
  stat_fouls: "Fouls",
  stat_tackles: "Tacklingar",
  stat_offsides: "Offside",
  history: "Historik",
  ev_multiplier_label: "",
  ev_multifactor_label: "",
  ev_league_avg_label: "",
  ev_model_label: "",
  ev_legacy_label: "",
  conceded: "conceded",
};

const FORMULA_DEFINITIONS = {
  multiplier: { valueKey: "evPctWithMultiplier", labelKey: "ev_multiplier_label" },
  multifactor: { valueKey: "evPctMultifactor", labelKey: "ev_multifactor_label" },
  leagueAvg: { valueKey: "evPctLeagueAvg", labelKey: "ev_league_avg_label" },
  base: { valueKey: "evPct", labelKey: "ev_model_label" },
  legacy: { valueKey: "legacyEvPct", labelKey: "ev_legacy_label" },
};

const DEFAULT_RESULT_PRIORITY = ["multiplier", "multifactor", "leagueAvg", "base", "legacy"];

const PRIMARY_LABELS = {
  multiplier: "EV (multiplier)",
  multifactor: "EV (multifaktor)",
  leagueAvg: "EV (liga)",
  base: "EV (modell)",
  legacy: "EV (legacy)",
};

function getFormulaLabel(key, t) {
  if (!key) return "";
  const def = FORMULA_DEFINITIONS[key];
  if (!def) return "";
  const translated = t(def.labelKey);
  return translated || PRIMARY_LABELS[key] || "";
}

function useTranslation() {
  const t = useCallback((key) => translations[key] ?? key, []);
  return { t };
}

function createInitialForm(statPatterns, match) {
  const homeTeam = match?.homeTeamName || "";
  const awayTeam = match?.awayTeamName || "";
  return Object.keys(statPatterns).reduce((acc, statKey) => {
    acc[statKey] = {
      statKey,
      scope: "total",
      period: "ALL",
      formMatches: "all",
      homeTeam,
      awayTeam,
      home_importance: 5,
      away_importance: 5,
    };
    return acc;
  }, {});
}

function ensureThresholds(store, statPatterns, form, teamKey) {
  const next = { ...store };
  if (!next[teamKey]) next[teamKey] = {};

  for (const [statKey, config] of Object.entries(form)) {
    const pattern = statPatterns[statKey];
    if (!pattern) continue;
    const scope = config.scope;
    const period = config.period;
    const thresholds = pattern.thresholds(scope, period) || [];

    if (!next[teamKey][statKey]) next[teamKey][statKey] = {};
    if (!next[teamKey][statKey][scope]) next[teamKey][statKey][scope] = {};
    if (!next[teamKey][statKey][scope][period]) {
      next[teamKey][statKey][scope][period] = {};
    }

    const bucket = { ...next[teamKey][statKey][scope][period] };
    thresholds.forEach((line) => {
      if (!bucket[line]) bucket[line] = { over: "", under: "" };
    });
    next[teamKey][statKey][scope][period] = bucket;
  }


  return next;
}

function createBetKey({
  homeTeam,
  awayTeam,
  statKey,
  scope,
  period,
  line,
  direction,
  formMatches,
  neutralGround,
}) {
  return [
    homeTeam,
    awayTeam,
    statKey,
    scope,
    period,
    line,
    direction,
    formMatches,
    neutralGround,
  ]
    .map((part) => String(part ?? ""))
    .join("::");
}

function resolvePrimaryEv(result, statKey) {
  if (!result) return { primaryEv: null, primaryLabel: null };
  const config = getFormulaConfig(statKey);
  const displayOrder = Array.isArray(config?.display) ? config.display : [];
  const priority = [...new Set([...displayOrder, ...DEFAULT_RESULT_PRIORITY])];
  for (const key of priority) {
    const def = FORMULA_DEFINITIONS[key];
    if (!def) continue;
    const value = result[def.valueKey];
    if (typeof value === "number") {
      return { primaryEv: value, primaryLabel: PRIMARY_LABELS[key] || "" };
    }
  }
  return { primaryEv: null, primaryLabel: null };
}

function getEvEntries(result, t, statKey) {
  const config = getFormulaConfig(statKey);
  const order =
    Array.isArray(config?.display) && config.display.length
      ? config.display
      : ["base", "leagueAvg"];
  const limited = order.slice(0, 2);
  const entries = [];
  for (const key of limited) {
    const def = FORMULA_DEFINITIONS[key];
    if (!def) continue;
    const rawValue = result?.[def.valueKey];
    if (!Number.isFinite(rawValue)) continue;
    const value = rawValue;
    entries.push({
      key,
      value,
      label: getFormulaLabel(key, t),
    });
  }
  return entries;
}

function getHitSummary(result, direction, t, options = {}) {
  if (!result) return { label: "–", tooltip: "" };
  const { scope = "total", opponentLabel } = options;

  const formatEntry = (entry, labelText) => {
    if (!entry) return null;
    const made = Number(entry.hits ?? 0);
    const total = Number(entry.total ?? 0);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(made) && made >= 0) {
      const pct = ((made / total) * 100).toFixed(1);
      return {
        label: `${made}/${total} (${pct}%)`,
        tooltip: `${labelText}: ${made}/${total} matcher (${pct}%)`,
      };
    }
    if (Number.isFinite(made) && Number.isFinite(total)) {
      return {
        label: `${made}/${total}`,
        tooltip: `${labelText}: ${made}/${total} matcher`,
      };
    }
    return null;
  };

  if (result.history) {
    const labelText =
      direction === "over"
        ? t("over")
        : scope === "total"
          ? t("under")
          : opponentLabel || t("under");
    const entry =
      direction === "over"
        ? result.history.over
        : scope === "total"
          ? result.history.under ?? result.history.over
          : result.history.opponent ?? result.history.under;
    const formatted = formatEntry(entry, labelText);
    if (formatted) {
      return formatted;
    }
  }

  const rawLabel = direction === "over" ? t("over") : scope === "total" ? t("under") : opponentLabel || t("under");
  const raw = direction === "over" ? result.hitsOver : result.hitsUnder;
  if (!raw) return { label: "–", tooltip: "" };

  const [madeStr, totalStr] = String(raw).split("/");
  const made = Number(madeStr);
  const total = Number(totalStr);
  if (Number.isFinite(made) && Number.isFinite(total) && total > 0) {
    const pct = ((made / total) * 100).toFixed(1);
    return {
      label: `${made}/${total} (${pct}%)`,
      tooltip: `${rawLabel}: ${made}/${total} matcher (${pct}%)`,
    };
  }

  return {
    label: String(raw),
    tooltip: `${rawLabel}: ${raw}`,
  };
}

function pickHistory(...results) {
  for (const result of results) {
    if (result?.history) return result.history;
  }
  return null;
}

function resolveHistorySamples(history, scope, type) {
  if (!history?.samples) return [];
  if (scope === "total") {
    return history.samples.combined || history.samples.team || history.samples.opponent || [];
  }
  if (type === "team") return history.samples.team || [];
  if (type === "opponent") return history.samples.opponent || [];
  return history.samples.combined || [];
}

function formatHistoryValue(match) {
  if (match == null) return "";
  if (match.displayValue != null && match.displayValue !== "") {
    return String(match.displayValue);
  }
  const numeric = Number(match.value);
  if (!Number.isFinite(numeric)) return "";
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

function buildHistoryTooltipEntries({ history, scope, type, line, direction }) {
  if (!history) return [];
  const samples = resolveHistorySamples(history, scope, type);
  if (!Array.isArray(samples) || !samples.length) return [];
  const numericLine = Number(line);
  const hasLine = Number.isFinite(numericLine);
  return samples
    .map((match) => {
      const value = Number(match?.value);
      if (!Number.isFinite(value)) return null;
      const highlight = hasLine
        ? direction === "under"
          ? value < numericLine
          : value > numericLine
        : false;
      const home = (match?.homeTeam || "").trim();
      const away = (match?.awayTeam || "").trim();
      const date = (match?.date || "").trim();
      const teams = [home, away].filter(Boolean).join(" vs ");
      const label = [date, teams].filter(Boolean).join(" – ");
      const valueText = formatHistoryValue(match);
      return {
        label: label || "–",
        date: date || "–",
        teams: teams || "–",
        value: valueText || "–",
        highlight,
      };
    })
    .filter(Boolean);
}

function formatPeriodLabel(period, t) {
  if (period === "1ST") return t("period_first_half");
  if (period === "2ND") return t("period_second_half");
  return t("period_match");
}

function formatScope(scope, home, away, t) {
  if (scope === "home") return home || t("scope_home");
  if (scope === "away") return away || t("scope_away");
  return t("scope_total");
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

export default function BacktestPage({ match, onPositiveResults }) {
  const { t } = useTranslation();
  const statPatterns = useMemo(() => getStatPatterns(t), [t]);
  const [form, setForm] = useState(() => createInitialForm(statPatterns, match));
  const [unibetUrl, setUnibetUrl] = useState("");
  const [neutralGround, setNeutralGround] = useState(false);
  const [oddsStore, setOddsStore] = useState({ default: {} });
  const [resultsMap, setResultsMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRunToken, setAutoRunToken] = useState(0);
  const [initialRunComplete, setInitialRunComplete] = useState(false);
  const recalcTimers = useRef({});
  const autoLoadAbort = useRef(null);
  const lastAutoRunToken = useRef(0);

  const homeTeam = match?.homeTeamName || form[Object.keys(form)[0]]?.homeTeam || "";
  const awayTeam = match?.awayTeamName || form[Object.keys(form)[0]]?.awayTeam || "";
  const teamKey = homeTeam && awayTeam ? `${homeTeam}-${awayTeam}` : "default";

  useEffect(() => {
    setForm((prev) => {
      const next = { ...prev };
      for (const statKey of Object.keys(next)) {
        next[statKey] = {
          ...next[statKey],
          homeTeam: match?.homeTeamName || next[statKey].homeTeam,
          awayTeam: match?.awayTeamName || next[statKey].awayTeam,
        };
      }
      return next;
    });
  }, [match?.homeTeamName, match?.awayTeamName]);

  useEffect(() => {
    setOddsStore((prev) => ensureThresholds(prev, statPatterns, form, teamKey));
  }, [form, statPatterns, teamKey]);

  useEffect(() => {
    return () => {
      Object.values(recalcTimers.current).forEach((timeoutId) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });
      if (autoLoadAbort.current) {
        autoLoadAbort.current.abort();
        autoLoadAbort.current = null;
      }
    };
  }, []);

  const applyOddsTuples = useCallback(
    (tuples, bucketKey = teamKey) => {
      if (!Array.isArray(tuples) || !tuples.length) return;
      setOddsStore((prev) => {
        const next = { ...prev };
        if (!next[bucketKey]) next[bucketKey] = {};
        for (const tuple of tuples) {
          const { statKey, scope, period, line, odds } = tuple;
          const numericLine = Number(line);
          if (!Number.isFinite(numericLine)) {
            continue;
          }
          const pattern = statPatterns?.[statKey];
          if (!pattern || typeof pattern.thresholds !== "function") {
            continue;
          }
          const availableLines = pattern.thresholds(scope, period) || [];
          const matchesLine = availableLines.some(
            (available) => Number.isFinite(available) && Math.abs(available - numericLine) < 1e-6
          );
          if (!matchesLine) {
            continue;
          }
          if (!next[bucketKey][statKey]) next[bucketKey][statKey] = {};
          if (!next[bucketKey][statKey][scope]) next[bucketKey][statKey][scope] = {};
          if (!next[bucketKey][statKey][scope][period]) {
            next[bucketKey][statKey][scope][period] = {};
          }
          const lineStore = {
            ...(next[bucketKey][statKey][scope][period][numericLine] || {
              over: "",
              under: "",
            }),
          };
          if (odds.over != null) lineStore.over = odds.over;
          if (odds.under != null) lineStore.under = odds.under;
          next[bucketKey][statKey][scope][period][numericLine] = lineStore;
        }
        return next;
      });
    },
    [statPatterns, teamKey]
  );

  const autoMatchHome = match?.homeTeamName || "";
  const autoMatchAway = match?.awayTeamName || "";
  const autoMatchId =
    match?.matchId || match?.id || match?.eventId || match?.raw?.eventId || null;
  const autoEventId =
    match?.eventId ||
    match?.raw?.event?.id ||
    match?.raw?.eventId ||
    match?.raw?.match?.event?.id ||
    null;
  const autoLeagueName =
    match?.leagueName || match?.league?.name || match?.raw?.league?.name || null;
  const autoTimestamp =
    match?.timestamp ??
    match?.startTimestamp ??
    match?.raw?.startTimestamp ??
    match?.raw?.event?.startTimestamp ??
    null;
  const autoStart = match?.start || match?.raw?.event?.start || null;

  useEffect(() => {
    if (!autoMatchHome || !autoMatchAway) {
      return undefined;
    }

    const controller = new AbortController();
    if (autoLoadAbort.current) {
      autoLoadAbort.current.abort();
    }
    autoLoadAbort.current = controller;

    setLoading(true);
    setError(null);

    console.log("[BacktestPage] auto-unibet-odds payload:", {
      matchId: autoMatchId,
      homeTeam: autoMatchHome,
      awayTeam: autoMatchAway,
      leagueName: autoLeagueName,
      timestamp: autoTimestamp,
      start: autoStart,
      hasTimestamp: !!autoTimestamp,
      hasStart: !!autoStart,
    });

    const payload = {
      action: "auto-unibet-odds",
      matchId: autoMatchId,
      eventId: autoEventId,
      homeTeam: autoMatchHome,
      awayTeam: autoMatchAway,
      leagueName: autoLeagueName,
      timestamp: autoTimestamp,
      start: autoStart,
    };

    // Retry logic with exponential backoff
    const fetchWithRetry = async (maxRetries = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (controller.signal.aborted) {
          return { success: false, aborted: true };
        }

        try {
          console.log(
            `[BacktestPage] Attempt ${attempt}/${maxRetries} for ${autoMatchHome} vs ${autoMatchAway}`
          );
          const data = await postBacktest(payload, { signal: controller.signal });
          console.log(
            `[BacktestPage] Success on attempt ${attempt} for ${autoMatchHome} vs ${autoMatchAway}`
          );
          return { success: true, data };
        } catch (err) {
          lastError = err;
          console.warn(
            `[BacktestPage] Attempt ${attempt}/${maxRetries} failed for ${autoMatchHome} vs ${autoMatchAway}:`,
            err.message
          );

          if (attempt < maxRetries && !controller.signal.aborted) {
            const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            console.log(`[BacktestPage] Retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      console.error(
        `[BacktestPage] All ${maxRetries} attempts failed for ${autoMatchHome} vs ${autoMatchAway}:`,
        lastError?.message
      );
      return { success: false, error: lastError };
    };

    fetchWithRetry()
      .then((result) => {
        if (controller.signal.aborted || result.aborted) {
          return;
        }

        if (result.success && result.data) {
          const tuples = mapUnibetOdds(
            result.data?.odds,
            result.data?.matched?.home || autoMatchHome,
            result.data?.matched?.away || autoMatchAway
          );
          if (tuples.length) {
            applyOddsTuples(tuples);
            setAutoRunToken((token) => token + 1);
          }
          const url =
            result.data?.eventUrl ||
            (result.data?.eventId
              ? `https://www.unibet.se/betting/sports/event/${result.data.eventId}`
              : null);
          if (url) {
            setUnibetUrl(url);
          }
        } else {
          // Failed after all retries - set error but still notify completion
          const errorMsg = result.error?.message || t("error_generic");
          setError(errorMsg);

          // Notify with empty results so the match is marked as completed
          if (typeof onPositiveResults === "function") {
            onPositiveResults(match, [], null);
          }
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        console.error("[BacktestPage] Unexpected error:", err);
        setError(err.message || t("error_generic"));

        // Notify with empty results so the match is marked as completed
        if (typeof onPositiveResults === "function") {
          onPositiveResults(match, [], null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
        if (autoLoadAbort.current === controller) {
          autoLoadAbort.current = null;
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    applyOddsTuples,
    autoEventId,
    autoLeagueName,
    autoMatchAway,
    autoMatchHome,
    autoMatchId,
    autoStart,
    autoTimestamp,
    t,
    match,
    onPositiveResults,
  ]);

  const statNames = useMemo(
    () => ({
      totalShots: t("stat_total_shots"),
      totalShotsOnGoal: t("stat_total_shots"),
      shotsOnGoal: t("stat_total_shots_on_target"),
      cornerKicks: t("stat_corner_kicks"),
      yellowCards: t("stat_yellow_cards"),
      throwIns: t("stat_throw_ins"),
      freeKicks: t("stat_free_kicks"),
      fouls: t("stat_fouls"),
      totalTackle: t("stat_tackles"),
      offsides: t("stat_offsides"),
    }),
    [t]
  );

  const results = useMemo(
    () => Object.values(resultsMap[teamKey] ?? {}),
    [resultsMap, teamKey]
  );

  const positiveResults = useMemo(() => {
    return results
      .map((result) => {
        const statKey = result?.bet?.statKey;
        const { primaryEv, primaryLabel } = resolvePrimaryEv(result, statKey);
        return { ...result, primaryEv, primaryLabel };
      })
      .filter((r) => typeof r.primaryEv === "number" && r.primaryEv > 0)
      .sort((a, b) => b.primaryEv - a.primaryEv);
  }, [results]);

  useEffect(() => {
    if (!initialRunComplete) return;
    if (typeof onPositiveResults !== "function") {
      return;
    }
    onPositiveResults(match, positiveResults, unibetUrl);
  }, [initialRunComplete, match, onPositiveResults, positiveResults, unibetUrl]);

  const handleFormChange = useCallback((statKey, field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({
      ...prev,
      [statKey]: { ...prev[statKey], [field]: field.includes("importance") ? Number(value) : value },
    }));
  }, []);

  const recalculateBet = useCallback(
    async ({ statKey, line, direction, scope, period, oddsValue }) => {
      const config = form[statKey];
      if (!config?.homeTeam || !config?.awayTeam) {
        setError(t("error_generic"));
        return null;
      }
      const numericOdds =
        oddsValue === undefined || oddsValue === null || oddsValue === ""
          ? null
          : Number(oddsValue);
      if (!Number.isFinite(numericOdds) || numericOdds <= 1) {
        setError(t("error_invalid_odds"));
        return null;
      }
      const body = {
        action: "expected-value",
        homeTeam: config.homeTeam,
        awayTeam: config.awayTeam,
        over: direction === "over",
        line,
        scope,
        stat: statKey,
        period,
        form: config.formMatches,
        odds: numericOdds,
        neutralGround,
        home_importance: config.home_importance,
        away_importance: config.away_importance,
      };
      const betKey = createBetKey({
        homeTeam: config.homeTeam,
        awayTeam: config.awayTeam,
        statKey,
        scope,
        period,
        line,
        direction,
        formMatches: config.formMatches,
        neutralGround,
      });
      setLoading(true);
      setError(null);
      try {
        const data = await postBacktest(body);
        const history = computeHistoryStats({
          homeMatches: data.homeMatches,
          awayMatches: data.awayMatches,
          homeHistory: data.homeHistory,
          awayHistory: data.awayHistory,
          statPatterns,
          statKey,
          scope,
          period,
          line,
          formMatches: config.formMatches,
          neutralGround,
          homeTeam: config.homeTeam,
          awayTeam: config.awayTeam,
        });
        const result = {
          ...data,
          history,
          bet: {
            statKey,
            line,
            direction,
            scope,
            period,
            odds: numericOdds,
            homeTeam: config.homeTeam,
            awayTeam: config.awayTeam,
            key: betKey,
          },
        };
        setResultsMap((prev) => {
          const next = { ...prev };
          const prevTeamResults = next[teamKey] || {};
          next[teamKey] = { ...prevTeamResults, [betKey]: result };
          return next;
        });
        return result;
      } catch (err) {
        setError(err.message || t("error_generic"));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [form, neutralGround, statPatterns, t]
  );

  const scheduleRecalculate = useCallback(
    (statKey, scope, period, line, direction, rawValue) => {
      const timerKey = `${statKey}-${scope}-${period}-${line}-${direction}`;
      if (recalcTimers.current[timerKey]) {
        clearTimeout(recalcTimers.current[timerKey]);
      }

      if (rawValue === "" || rawValue === null) {
        delete recalcTimers.current[timerKey];
        return;
      }

      const numericOdds = Number(rawValue);
      if (!Number.isFinite(numericOdds) || numericOdds <= 1) {
        delete recalcTimers.current[timerKey];
        return;
      }

      recalcTimers.current[timerKey] = setTimeout(() => {
        recalculateBet({
          statKey,
          line,
          direction,
          scope,
          period,
          oddsValue: numericOdds,
        });
      }, 700);
    },
    [recalculateBet]
  );

  const handleOddsChange = useCallback(
    (statKey, scope, period, line, direction) => (event) => {
      const value = event.target.value;
      setOddsStore((prev) => {
        const next = { ...prev };
        if (!next[teamKey]) next[teamKey] = {};
        if (!next[teamKey][statKey]) next[teamKey][statKey] = {};
        if (!next[teamKey][statKey][scope]) next[teamKey][statKey][scope] = {};
        if (!next[teamKey][statKey][scope][period]) {
          next[teamKey][statKey][scope][period] = {};
        }
        const bucket = {
          ...(next[teamKey][statKey][scope][period][line] || { over: "", under: "" }),
        };
        bucket[direction] = value;
        next[teamKey][statKey][scope][period][line] = bucket;
        return next;
      });
      scheduleRecalculate(statKey, scope, period, line, direction, value);
    },
    [scheduleRecalculate, teamKey]
  );

  const handleCalculateAll = useCallback(async ({ suppressMissingOddsError = false } = {}) => {
    const bets = [];
    const current = oddsStore[teamKey] || {};
    for (const [statKey, scopes] of Object.entries(current)) {
      const cfg = form[statKey];
      if (!cfg) continue;
      for (const [scope, periods] of Object.entries(scopes)) {
        for (const [period, lines] of Object.entries(periods)) {
          for (const [line, odds] of Object.entries(lines)) {
            const numericLine = Number(line);
            if (odds?.over) {
              bets.push({
                statKey,
                scope,
                period,
                line: numericLine,
                direction: "over",
                oddsValue: Number(odds.over),
              });
            }
            if (odds?.under) {
              bets.push({
                statKey,
                scope,
                period,
                line: numericLine,
                direction: "under",
                oddsValue: Number(odds.under),
              });
            }
          }
        }
      }
    }
    if (!bets.length) {
      if (!suppressMissingOddsError) {
        setError(t("error_missing_odds"));
      }
      return;
    }
    setLoading(true);
    setError(null);
    setLoading(true);
    setError(null);
    try {
      const betParams = [];
      const current = oddsStore[teamKey] || {};
      for (const [statKey, scopes] of Object.entries(current)) {
        const cfg = form[statKey];
        if (!cfg) continue;
        for (const [scope, periods] of Object.entries(scopes)) {
          for (const [period, lines] of Object.entries(periods)) {
            for (const [line, odds] of Object.entries(lines)) {
              const numericLine = Number(line);
              if (odds?.over) {
                betParams.push({
                  homeTeam: cfg.homeTeam,
                  awayTeam: cfg.awayTeam,
                  over: true,
                  line: numericLine,
                  scope,
                  stat: statKey,
                  period,
                  form: cfg.formMatches,
                  odds: Number(odds.over),
                  neutralGround,
                  home_importance: cfg.home_importance,
                  away_importance: cfg.away_importance,
                });
              }
              if (odds?.under) {
                betParams.push({
                  homeTeam: cfg.homeTeam,
                  awayTeam: cfg.awayTeam,
                  over: false,
                  line: numericLine,
                  scope,
                  stat: statKey,
                  period,
                  form: cfg.formMatches,
                  odds: Number(odds.under),
                  neutralGround,
                  home_importance: cfg.home_importance,
                  away_importance: cfg.away_importance,
                });
              }
            }
          }
        }
      }

      if (!betParams.length) {
        if (!suppressMissingOddsError) {
          setError(t("error_missing_odds"));
        }
        return;
      }

      const results = await postBacktest({ action: "batch-expected-value", bets: betParams });

      const newResults = {};
      for (const result of results) {
        if (result && !result.error && result.params) {
          const betKey = createBetKey({
            homeTeam: result.params.home,
            awayTeam: result.params.away,
            statKey: result.params.stat,
            scope: result.params.scope,
            period: result.params.period,
            line: result.params.line,
            direction: result.params.over ? "over" : "under",
            formMatches: result.params.form,
            neutralGround: result.params.neutralGround,
          });
          const history = computeHistoryStats({
            homeMatches: result.homeMatches,
            awayMatches: result.awayMatches,
            homeHistory: result.homeHistory,
            awayHistory: result.awayHistory,
            statPatterns,
            statKey: result.params.stat,
            scope: result.params.scope,
            period: result.params.period,
            line: result.params.line,
            formMatches: result.params.form,
            neutralGround: result.params.neutralGround,
            homeTeam: result.params.home,
            awayTeam: result.params.away,
          });
          newResults[betKey] = {
            ...result,
            history,
            bet: {
              statKey: result.params.stat,
              line: result.params.line,
              direction: result.params.over ? "over" : "under",
              scope: result.params.scope,
              period: result.params.period,
              odds: result.params.odds,
              homeTeam: result.params.home,
              awayTeam: result.params.away,
              key: betKey,
            }
          };
        }
      }

      setResultsMap((prev) => {
        const next = { ...prev };
        next[teamKey] = { ...(next[teamKey] || {}), ...newResults };
        return next;
      });

    } catch (err) {
      setError(err.message || t("error_generic"));
    } finally {
      setLoading(false);
      setInitialRunComplete(true);
    }
  }, [form, oddsStore, recalculateBet, teamKey]);

  useEffect(() => {
    if (!autoRunToken) {
      return;
    }
    if (lastAutoRunToken.current === autoRunToken) {
      return;
    }
    lastAutoRunToken.current = autoRunToken;
    handleCalculateAll({ suppressMissingOddsError: true });
  }, [autoRunToken, handleCalculateAll]);

  const handleLoadOdds = useCallback(async () => {
    if (!unibetUrl) return;
    setLoading(true);
    setError(null);
    try {
      const data = await postBacktest({ action: "unibet-odds", url: unibetUrl });
      const tuples = mapUnibetOdds(data.odds, homeTeam, awayTeam);
      applyOddsTuples(tuples);
    } catch (err) {
      setError(err.message || t("error_generic"));
    } finally {
      setLoading(false);
    }
  }, [applyOddsTuples, homeTeam, awayTeam, t, unibetUrl]);

  const renderStatSections = () =>
    Object.keys(statPatterns).map((statKey) => {
      const cfg = form[statKey];
      if (!cfg) return null;
      const thresholds = statPatterns[statKey].thresholds(cfg.scope, cfg.period) || [];
      const statOdds = oddsStore[teamKey]?.[statKey]?.[cfg.scope]?.[cfg.period] || {};
      return (
        <div key={statKey} className="flex flex-col h-[600px] rounded-lg border border-white/10 bg-white/5 p-4 backdrop-blur-sm transition-all hover:border-white/20">
          <div className="flex-shrink-0 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-bold text-white tracking-wide">
              {statNames[statKey] || statKey}
            </h3>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={cfg.scope}
                onChange={handleFormChange(statKey, "scope")}
                className="rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
              >
                <option value="total">{t("scope_total")}</option>
                <option value="home">{homeTeam || t("scope_home")}</option>
                <option value="away">{awayTeam || t("scope_away")}</option>
              </select>
              <select
                value={cfg.period}
                onChange={handleFormChange(statKey, "period")}
                className="rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
              >
                <option value="ALL">{t("period_match")}</option>
                <option value="1ST">{t("period_first_half")}</option>
                <option value="2ND">{t("period_second_half")}</option>
              </select>
              <input
                value={cfg.formMatches}
                onChange={handleFormChange(statKey, "formMatches")}
                className="w-28 rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-white/30 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                placeholder={t("form_label")}
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto min-h-0 border-t border-white/5">
            <table className="min-w-full text-left text-xs text-slate-200">
              <thead className="sticky top-0 z-10 bg-slate-900 text-[10px] uppercase tracking-wider text-white font-bold shadow-sm">
                <tr>
                  <th className="w-16 px-2 py-3 bg-slate-900">Lina</th>
                  <th className="w-32 px-2 py-3 bg-slate-900">
                    {t("over")} ({t("odds")})
                  </th>
                  <th className="w-24 px-2 py-3 bg-slate-900">
                    EV % ({t("over")})
                  </th>
                  <th className="w-32 px-2 py-3 bg-slate-900">
                    {t("under")} ({t("odds")})
                  </th>
                  <th className="w-24 px-2 py-3 bg-slate-900">
                    EV % ({t("under")})
                  </th>
                  <th className="px-2 py-3 bg-slate-900">{t("history")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {thresholds.map((line) => {
                  const odds = statOdds[line] || { over: "", under: "" };
                  const overKey = createBetKey({
                    homeTeam,
                    awayTeam,
                    statKey,
                    scope: cfg.scope,
                    period: cfg.period,
                    line,
                    direction: "over",
                    formMatches: cfg.formMatches,
                    neutralGround,
                  });
                  const underKey = createBetKey({
                    homeTeam,
                    awayTeam,
                    statKey,
                    scope: cfg.scope,
                    period: cfg.period,
                    line,
                    direction: "under",
                    formMatches: cfg.formMatches,
                    neutralGround,
                  });
                  const teamResults = resultsMap[teamKey] || {};
                  const overResult = teamResults[overKey];
                  const underResult = teamResults[underKey];
                  const overEntries = getEvEntries(overResult, t, statKey);
                  const underEntries = getEvEntries(underResult, t, statKey);
                  const concededLabel = t("conceded");
                  const historyOpponentLabel =
                    cfg.scope === "home"
                      ? `${awayTeam || t("scope_away")} ${concededLabel}`.trim()
                      : cfg.scope === "away"
                        ? `${homeTeam || t("scope_home")} ${concededLabel}`.trim()
                        : t("under");
                  const overHistory = getHitSummary(overResult || underResult, "over", t, {
                    scope: cfg.scope,
                    opponentLabel: historyOpponentLabel,
                  });
                  const underHistory = getHitSummary(
                    cfg.scope === "total" ? underResult || overResult : overResult || underResult,
                    "under",
                    t,
                    {
                      scope: cfg.scope,
                      opponentLabel: historyOpponentLabel,
                    }
                  );
                  const historyForOver = pickHistory(overResult, underResult);
                  const historyForUnder =
                    cfg.scope === "total"
                      ? pickHistory(underResult, overResult)
                      : historyForOver;
                  const overTooltipEntries = buildHistoryTooltipEntries({
                    history: historyForOver,
                    scope: cfg.scope,
                    type: cfg.scope === "total" ? "combined" : "team",
                    line,
                    direction: "over",
                  });
                  const underTooltipEntries = buildHistoryTooltipEntries({
                    history: historyForUnder,
                    scope: cfg.scope,
                    type: cfg.scope === "total" ? "combined" : "opponent",
                    line,
                    direction: "under",
                  });
                  return (
                    <tr key={line} className="align-top hover:bg-white/5 transition-colors">
                      <td className="w-16 px-2 py-3 text-sm font-semibold text-white">{line}</td>
                      <td className="w-32 px-2 py-3">
                        <input
                          type="number"
                          className="w-24 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs font-semibold text-white focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all placeholder-white/20"
                          step="0.01"
                          value={odds.over}
                          placeholder={t("over")}
                          title={overHistory.tooltip || undefined}
                          onChange={handleOddsChange(statKey, cfg.scope, cfg.period, line, "over")}
                        />
                      </td>
                      <td className="w-24 px-2 py-3">
                        {overEntries.length ? (
                          <div className="flex flex-col gap-1.5">
                            {overEntries.map((entry, idx) => (
                              <div key={idx} className="flex items-baseline gap-2">
                                {entry.value != null ? (
                                  <span
                                    className={`font-bold ${entry.value >= 0 ? "text-emerald-400" : "text-rose-400"
                                      }`}
                                  >
                                    {entry.value.toFixed(1)}%
                                  </span>
                                ) : (
                                  <span className="text-slate-600">–</span>
                                )}
                                {/* EV LABEL REMOVED AS REQUESTED
                                <span className="text-[9px] uppercase tracking-wide text-slate-500 font-medium">
                                  {entry.label}
                                </span>
                                */}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-600">–</span>
                        )}
                      </td>
                      <td className="w-32 px-2 py-3">
                        <input
                          type="number"
                          className="w-24 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs font-semibold text-white focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all placeholder-white/20"
                          step="0.01"
                          value={odds.under}
                          placeholder={t("under")}
                          title={underHistory.tooltip || undefined}
                          onChange={handleOddsChange(statKey, cfg.scope, cfg.period, line, "under")}
                        />
                      </td>
                      <td className="w-24 px-2 py-3">
                        {underEntries.length ? (
                          <div className="flex flex-col gap-1.5">
                            {underEntries.map((entry, idx) => (
                              <div key={idx} className="flex items-baseline gap-2">
                                {entry.value != null ? (
                                  <span
                                    className={`font-bold ${entry.value >= 0 ? "text-emerald-400" : "text-rose-400"
                                      }`}
                                  >
                                    {entry.value.toFixed(1)}%
                                  </span>
                                ) : (
                                  <span className="text-slate-600">–</span>
                                )}
                                {/* EV LABEL REMOVED AS REQUESTED
                                <span className="text-[9px] uppercase tracking-wide text-slate-500 font-medium">
                                  {entry.label}
                                </span>
                                */}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-600">–</span>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-col gap-2 text-[10px] text-white font-semibold">
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              {/* REMOVED MAX-W CONSTRAINTS FOR HISTORY EXPANSION */}
                              <div className="group flex items-center justify-between gap-2 cursor-help rounded px-1.5 py-1 hover:bg-white/5 transition-colors">
                                <span className="text-emerald-400 font-black uppercase tracking-wider">{t("over")}</span>
                                <span className="font-mono font-bold text-white group-hover:text-emerald-300 transition-colors">{overHistory.label}</span>
                              </div>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Content
                                side="left"
                                sideOffset={10}
                                className="z-50 max-h-80 w-auto min-w-[32rem] overflow-y-auto rounded-xl bg-[#0A0A0B]/95 p-0 text-xs shadow-2xl border border-white/10 backdrop-blur-xl"
                              >
                                {/* Header */}
                                <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0A0A0B]/95 px-4 py-3 backdrop-blur-md">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500">
                                      {t("over")} {t("history")}
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-400 ml-4">{overHistory.label} matches</span>
                                  </div>
                                </div>

                                {overTooltipEntries.length ? (
                                  <div className="flex flex-col p-2">
                                    {overTooltipEntries.map((entry, idx) => (
                                      <div key={idx} className="grid grid-cols-[80px_1fr_60px] gap-4 items-center rounded p-2 hover:bg-white/5 transition-colors text-[11px]">
                                        <div className="font-mono text-slate-300 whitespace-nowrap">
                                          {entry.date}
                                        </div>
                                        <div className="text-white font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                                          {entry.teams}
                                        </div>
                                        <div
                                          className={`text-right font-mono font-bold ${entry.highlight ? "text-emerald-400" : "text-rose-400"
                                            }`}
                                        >
                                          {entry.value}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="p-6 text-center text-slate-500 italic text-xs">Ingen historik tillgänglig</div>
                                )}
                                <Tooltip.Arrow className="fill-[#0A0A0B]/95" />
                              </Tooltip.Content>
                            </Tooltip.Portal>
                          </Tooltip.Root>

                          {/* UNDER SECTION */}
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              {/* REMOVED MAX-W CONSTRAINTS FOR HISTORY EXPANSION */}
                              <div className="group flex items-center justify-between gap-2 cursor-help rounded px-1.5 py-1 hover:bg-white/5 transition-colors">
                                <span className="text-rose-400 font-black uppercase tracking-wider truncate" title={historyOpponentLabel}>{historyOpponentLabel}</span>
                                <span className="font-mono font-bold text-white group-hover:text-rose-300 transition-colors">{underHistory.label}</span>
                              </div>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Content
                                side="left"
                                sideOffset={10}
                                className="z-50 max-h-80 w-auto min-w-[32rem] overflow-y-auto rounded-xl bg-[#0A0A0B]/95 p-0 text-xs shadow-2xl border border-white/10 backdrop-blur-xl"
                              >
                                {/* Header */}
                                <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0A0A0B]/95 px-4 py-3 backdrop-blur-md">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-rose-500">
                                      {historyOpponentLabel} {t("history")}
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-400 ml-4">{underHistory.label} matches</span>
                                  </div>
                                </div>

                                {underTooltipEntries.length ? (
                                  <div className="flex flex-col p-2">
                                    {underTooltipEntries.map((entry, idx) => (
                                      <div key={idx} className="grid grid-cols-[80px_1fr_60px] gap-4 items-center rounded p-2 hover:bg-white/5 transition-colors text-[11px]">
                                        <div className="font-mono text-slate-300 whitespace-nowrap">
                                          {entry.date}
                                        </div>
                                        <div className="text-white font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                                          {entry.teams}
                                        </div>
                                        <div
                                          className={`text-right font-mono font-bold ${entry.highlight ? "text-emerald-400" : "text-rose-400"
                                            }`}
                                        >
                                          {entry.value}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="p-6 text-center text-slate-500 italic text-xs">Ingen historik tillgänglig</div>
                                )}
                                <Tooltip.Arrow className="fill-[#0A0A0B]/95" />
                              </Tooltip.Content>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    });

  return (
    <Tooltip.Provider delayDuration={150}>
      <section className="flex flex-col rounded-lg bg-slate-900 p-4 text-slate-100 shadow lg:h-full lg:min-h-0">
        <div className="flex-shrink-0">
          <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">{t("title")}</h2>
              {homeTeam && awayTeam ? (
                <p className="text-sm text-slate-300">
                  {homeTeam} vs {awayTeam}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={neutralGround}
                  onChange={(event) => setNeutralGround(event.target.checked)}
                />
                {t("neutral_ground")}
              </label>
            </div>
          </header>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              className="flex-1 rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
              placeholder={t("unibet_placeholder")}
              value={unibetUrl}
              onChange={(event) => setUnibetUrl(event.target.value)}
            />
            <button
              type="button"
              onClick={handleLoadOdds}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
              disabled={loading}
            >
              {t("load_odds")}
            </button>
          </div>

          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("home_importance")}</span>
              <input
                type="range"
                min={1}
                max={10}
                value={form[Object.keys(form)[0]]?.home_importance ?? 5}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setForm((prev) => {
                    const next = { ...prev };
                    for (const key of Object.keys(next)) {
                      next[key] = { ...next[key], home_importance: value };
                    }
                    return next;
                  });
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("away_importance")}</span>
              <input
                type="range"
                min={1}
                max={10}
                value={form[Object.keys(form)[0]]?.away_importance ?? 5}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setForm((prev) => {
                    const next = { ...prev };
                    for (const key of Object.keys(next)) {
                      next[key] = { ...next[key], away_importance: value };
                    }
                    return next;
                  });
                }}
              />
            </label>
          </div>

          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={() => handleCalculateAll()}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500"
              disabled={loading}
            >
              {loading ? t("loading") : t("calculate_all")}
            </button>
          </div>

          {error ? (
            <div className="mb-4 rounded border border-red-500/40 bg-red-900/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="overflow-auto pr-1 lg:flex-1 lg:min-h-0">
          {positiveResults.length ? (
            <div className="mb-8 rounded-xl border border-emerald-500/20 bg-gradient-to-br from-[#021810] to-black shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02]">
                <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                  {t("positive_ev_header")}
                </h3>
                <span className="text-xs text-emerald-500/60 font-mono">
                  {positiveResults.length} {positiveResults.length === 1 ? 'BET' : 'BETS'} FOUND
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/5 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-white/5">
                      <th className="px-6 py-4 font-semibold hover:text-white transition-colors cursor-default">{t("stat")}</th>
                      <th className="px-6 py-4 font-semibold hover:text-white transition-colors cursor-default">{t("team")}</th>
                      <th className="px-6 py-4 font-semibold hover:text-white transition-colors cursor-default">{t("period")}</th>
                      <th className="px-6 py-4 font-semibold hover:text-white transition-colors cursor-default">{t("direction")}</th>
                      <th className="px-6 py-4 font-semibold hover:text-white transition-colors cursor-default text-right">{t("odds")}</th>
                      <th className="px-6 py-4 font-semibold hover:text-white transition-colors cursor-default text-right">{t("value")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {positiveResults.map((result) => (
                      <tr key={result.bet.key} className="group hover:bg-emerald-500/5 transition-all duration-200">
                        <td className="px-6 py-4 text-xs font-semibold text-white">
                          {statNames[result.bet.statKey] || result.bet.statKey}
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-300 group-hover:text-white">
                          {formatScope(result.bet.scope, result.bet.homeTeam, result.bet.awayTeam, t)}
                        </td>
                        <td className="px-6 py-4 text-xs text-emerald-100/70 font-medium tracking-wide">
                          {formatPeriodLabel(result.bet.period, t)}
                        </td>
                        <td className="px-6 py-4 text-xs">
                          <span className={`
                            inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide
                            ${result.bet.direction === "over" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"}
                          `}>
                            {result.bet.direction === "over" ? t("over") : t("under")} {result.bet.line}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm font-mono text-right text-white font-bold group-hover:text-emerald-300 transition-colors">
                          {result.bet.odds}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-base font-bold text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]">
                            +{result.primaryEv?.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-1">
            {renderStatSections()}
          </div>
        </div>
      </section>
    </Tooltip.Provider>
  );
}
