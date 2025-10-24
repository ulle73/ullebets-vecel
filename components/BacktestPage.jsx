"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapUnibetOdds from "./backtest/unibetOddsMapper";
import { getStatPatterns } from "./backtest/statPatterns";
import { computeHistoryStats } from "./backtest/historyCalculator";

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

function resolvePrimaryEv(result) {
  if (!result) return { primaryEv: null, primaryLabel: null };
  const order = [
    ["evPctWithMultiplier", "EV (multiplier)"],
    ["evPctMultifactor", "EV (multifaktor)"],
    ["evPctLeagueAvg", "EV (liga)"],
    ["evPct", "EV (modell)"],
    ["legacyEvPct", "EV (legacy)"],
  ];
  for (const [key, label] of order) {
    const value = result[key];
    if (typeof value === "number") {
      return { primaryEv: value, primaryLabel: label };
    }
  }
  return { primaryEv: null, primaryLabel: null };
}

function getEvEntries(result, t) {
  if (!result) return [];
  const entries = [];
  const add = (value, label) => {
    if (typeof value === "number") {
      entries.push({ value, label });
    }
  };
  add(result.evPctWithMultiplier, t("ev_multiplier_label"));
  add(result.evPctMultifactor, t("ev_multifactor_label"));
  add(result.evPctLeagueAvg, t("ev_league_avg_label"));
  add(result.evPct, t("ev_model_label"));
  add(result.legacyEvPct, t("ev_legacy_label"));
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

export default function BacktestPage({ match }) {
  const { t } = useTranslation();
  const statPatterns = useMemo(() => getStatPatterns(t), [t]);
  const [form, setForm] = useState(() => createInitialForm(statPatterns, match));
  const [unibetUrl, setUnibetUrl] = useState("");
  const [neutralGround, setNeutralGround] = useState(false);
  const [oddsStore, setOddsStore] = useState({ default: {} });
  const [resultsMap, setResultsMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const recalcTimers = useRef({});
  const autoLoadAbort = useRef(null);

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

    postBacktest(payload, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) {
          return;
        }
        const tuples = mapUnibetOdds(
          data?.odds,
          data?.matched?.home || autoMatchHome,
          data?.matched?.away || autoMatchAway
        );
        if (tuples.length) {
          applyOddsTuples(tuples);
        }
        const url =
          data?.eventUrl ||
          (data?.eventId
            ? `https://www.unibet.se/betting/sports/event/${data.eventId}`
            : null);
        if (url) {
          setUnibetUrl(url);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(err.message || t("error_generic"));
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
        const { primaryEv, primaryLabel } = resolvePrimaryEv(result);
        return { ...result, primaryEv, primaryLabel };
      })
      .filter((r) => typeof r.primaryEv === "number" && r.primaryEv > 0)
      .sort((a, b) => b.primaryEv - a.primaryEv);
  }, [results]);

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

  const handleCalculateAll = useCallback(async () => {
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
      setError(t("error_missing_odds"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const promises = bets.map((bet) =>
        recalculateBet(bet).catch(() => null)
      );
      await Promise.all(promises);
    } finally {
      setLoading(false);
    }
  }, [form, oddsStore, recalculateBet, teamKey]);

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
        <div key={statKey} className="rounded border border-slate-700/60 p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-semibold">
              {statNames[statKey] || statKey}
            </h3>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={cfg.scope}
                onChange={handleFormChange(statKey, "scope")}
                className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs"
              >
                <option value="total">{t("scope_total")}</option>
                <option value="home">{homeTeam || t("scope_home")}</option>
                <option value="away">{awayTeam || t("scope_away")}</option>
              </select>
              <select
                value={cfg.period}
                onChange={handleFormChange(statKey, "period")}
                className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs"
              >
                <option value="ALL">{t("period_match")}</option>
                <option value="1ST">{t("period_first_half")}</option>
                <option value="2ND">{t("period_second_half")}</option>
              </select>
              <input
                value={cfg.formMatches}
                onChange={handleFormChange(statKey, "formMatches")}
                className="w-28 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs"
                placeholder={t("form_label")}
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs text-slate-200">
              <thead className="bg-slate-900/40 text-[8.25px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium text-slate-300">Lina</th>
                  <th className="px-3 py-2 font-medium text-slate-300">
                    {t("over")} ({t("odds")})
                  </th>
                  <th className="px-3 py-2 font-medium text-slate-300">
                    EV % ({t("over")})
                  </th>
                  <th className="px-3 py-2 font-medium text-slate-300">
                    {t("under")} ({t("odds")})
                  </th>
                  <th className="px-3 py-2 font-medium text-slate-300">
                    EV % ({t("under")})
                  </th>
                  <th className="px-3 py-2 font-medium text-slate-300">{t("history")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
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
                  const overEntries = getEvEntries(overResult, t);
                  const underEntries = getEvEntries(underResult, t);
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
                  return (
                    <tr key={line} className="align-top">
                      <td className="px-3 py-3 text-sm font-medium text-slate-100">{line}</td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs font-medium text-slate-100 focus:border-slate-400 focus:outline-none focus:ring-0"
                          step="0.01"
                          value={odds.over}
                          placeholder={t("over")}
                          title={overHistory.tooltip || undefined}
                          onChange={handleOddsChange(statKey, cfg.scope, cfg.period, line, "over")}
                        />
                      </td>
                      <td className="px-3 py-3">
                        {overEntries.length ? (
                          <div className="flex flex-col gap-1">
                            {overEntries.map((entry, idx) => (
                              <div key={idx} className="flex items-baseline gap-2">
                                <span
                                  className={`font-semibold ${
                                    entry.value >= 0 ? "text-emerald-300" : "text-rose-300"
                                  }`}
                                >
                                  {entry.value.toFixed(1)}%
                                </span>
                                <span className="text-[7.5px] uppercase tracking-wide text-slate-400">
                                  {entry.label}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500">–</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs font-medium text-slate-100 focus:border-slate-400 focus:outline-none focus:ring-0"
                          step="0.01"
                          value={odds.under}
                          placeholder={t("under")}
                          title={underHistory.tooltip || undefined}
                          onChange={handleOddsChange(statKey, cfg.scope, cfg.period, line, "under")}
                        />
                      </td>
                      <td className="px-3 py-3">
                        {underEntries.length ? (
                          <div className="flex flex-col gap-1">
                            {underEntries.map((entry, idx) => (
                              <div key={idx} className="flex items-baseline gap-2">
                                <span
                                  className={`font-semibold ${
                                    entry.value >= 0 ? "text-emerald-300" : "text-rose-300"
                                  }`}
                                >
                                  {entry.value.toFixed(1)}%
                                </span>
                                <span className="text-[7.5px] uppercase tracking-wide text-slate-400">
                                  {entry.label}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500">–</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="space-y-1 text-[8.25px] text-slate-300">
                          <div className="cursor-help" title={overHistory.tooltip || undefined}>
                            {t("over")}:
                            <span className="ml-1 font-medium text-slate-100">{overHistory.label}</span>
                          </div>
                          <div className="cursor-help" title={underHistory.tooltip || undefined}>
                            {historyOpponentLabel}:
                            <span className="ml-1 font-medium text-slate-100">{underHistory.label}</span>
                          </div>
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
            onClick={handleCalculateAll}
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
          <div className="mb-6 rounded border border-emerald-500/30 bg-emerald-900/20 p-3">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-200">
              {t("positive_ev_header")}
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="text-slate-300">
                  <tr>
                    <th className="px-2 py-1">{t("stat")}</th>
                    <th className="px-2 py-1">{t("team")}</th>
                    <th className="px-2 py-1">{t("period")}</th>
                    <th className="px-2 py-1">{t("direction")}</th>
                    <th className="px-2 py-1">{t("odds")}</th>
                    <th className="px-2 py-1">{t("value")}</th>
                  </tr>
                </thead>
                <tbody>
                  {positiveResults.map((result) => (
                    <tr key={result.bet.key} className="border-t border-slate-700">
                      <td className="px-2 py-1">{statNames[result.bet.statKey] || result.bet.statKey}</td>
                      <td className="px-2 py-1">
                        {formatScope(result.bet.scope, result.bet.homeTeam, result.bet.awayTeam, t)}
                      </td>
                      <td className="px-2 py-1">
                        {formatPeriodLabel(result.bet.period, t)}
                      </td>
                      <td className="px-2 py-1">
                        {result.bet.direction === "over" ? t("over") : t("under")} {result.bet.line}
                      </td>
                      <td className="px-2 py-1">{result.bet.odds}</td>
                      <td className="px-2 py-1">
                        {result.primaryEv?.toFixed(1)}%
                        
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="space-y-6 pb-1">{renderStatSections()}</div>
      </div>
    </section>
  );
}
