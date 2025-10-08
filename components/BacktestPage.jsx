"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import mapUnibetOdds from "./backtest/unibetOddsMapper";
import { getStatPatterns } from "./backtest/statPatterns";

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

async function postBacktest(body) {
  const res = await fetch("/api/backtest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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

  const results = useMemo(() => Object.values(resultsMap), [resultsMap]);

  const positiveResults = useMemo(() => {
    return results
      .map((result) => {
        const { primaryEv, primaryLabel } = resolvePrimaryEv(result);
        return { ...result, primaryEv, primaryLabel };
      })
      .filter((r) => typeof r.primaryEv === "number" && r.primaryEv > 0)
      .sort((a, b) => b.primaryEv - a.primaryEv);
  }, [results]);

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
    },
    [teamKey]
  );

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
        const result = {
          ...data,
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
        setResultsMap((prev) => ({ ...prev, [betKey]: result }));
        return result;
      } catch (err) {
        setError(err.message || t("error_generic"));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [form, neutralGround, t]
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
      setOddsStore((prev) => {
        const next = { ...prev };
        if (!next[teamKey]) next[teamKey] = {};
        for (const tuple of tuples) {
          const { statKey, scope, period, line, odds } = tuple;
          if (!next[teamKey][statKey]) next[teamKey][statKey] = {};
          if (!next[teamKey][statKey][scope]) next[teamKey][statKey][scope] = {};
          const lineStore = {
            ...(next[teamKey][statKey][scope][period]?.[line] || {
              over: "",
              under: "",
            }),
          };
          if (odds.over != null) lineStore.over = odds.over;
          if (odds.under != null) lineStore.under = odds.under;
          if (!next[teamKey][statKey][scope][period]) {
            next[teamKey][statKey][scope][period] = {};
          }
          next[teamKey][statKey][scope][period][line] = lineStore;
        }
        return next;
      });
    } catch (err) {
      setError(err.message || t("error_generic"));
    } finally {
      setLoading(false);
    }
  }, [homeTeam, awayTeam, teamKey, t, unibetUrl]);

  return (
    <section className="rounded-lg bg-slate-900 p-4 text-slate-100 shadow">
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
                      {result.primaryLabel ? ` (${result.primaryLabel})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="space-y-6">
        {Object.keys(statPatterns).map((statKey) => {
          const cfg = form[statKey];
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
                <table className="min-w-full text-left text-xs">
                  <thead className="text-slate-300">
                    <tr>
                      <th className="px-2 py-1">Lina</th>
                      <th className="px-2 py-1">{t("over")}</th>
                      <th className="px-2 py-1">{t("ev_percent")}</th>
                      <th className="px-2 py-1">{t("under")}</th>
                      <th className="px-2 py-1">{t("ev_percent")}</th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
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
                      const overResult = resultsMap[overKey];
                      const underResult = resultsMap[underKey];
                      const overEv = resolvePrimaryEv(overResult).primaryEv;
                      const underEv = resolvePrimaryEv(underResult).primaryEv;
                      return (
                        <tr key={line} className="border-t border-slate-700/60">
                          <td className="px-2 py-1">{line}</td>
                          <td className="px-2 py-1">
                            <input
                              type="number"
                              className="w-20 rounded border border-slate-600 bg-slate-950 px-2 py-1"
                              step="0.01"
                              value={odds.over}
                              onChange={handleOddsChange(statKey, cfg.scope, cfg.period, line, "over")}
                            />
                          </td>
                          <td className="px-2 py-1 text-emerald-300">
                            {typeof overEv === "number" ? `${overEv.toFixed(1)}%` : "–"}
                          </td>
                          <td className="px-2 py-1">
                            <input
                              type="number"
                              className="w-20 rounded border border-slate-600 bg-slate-950 px-2 py-1"
                              step="0.01"
                              value={odds.under}
                              onChange={handleOddsChange(statKey, cfg.scope, cfg.period, line, "under")}
                            />
                          </td>
                          <td className="px-2 py-1 text-emerald-300">
                            {typeof underEv === "number" ? `${underEv.toFixed(1)}%` : "–"}
                          </td>
                          <td className="px-2 py-1">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="rounded bg-blue-700 px-2 py-1 text-[11px] hover:bg-blue-600"
                                onClick={() =>
                                  recalculateBet({
                                    statKey,
                                    line,
                                    direction: "over",
                                    scope: cfg.scope,
                                    period: cfg.period,
                                    oddsValue: odds.over ? Number(odds.over) : null,
                                  })
                                }
                              >
                                {t("over")}
                              </button>
                              <button
                                type="button"
                                className="rounded bg-blue-700 px-2 py-1 text-[11px] hover:bg-blue-600"
                                onClick={() =>
                                  recalculateBet({
                                    statKey,
                                    line,
                                    direction: "under",
                                    scope: cfg.scope,
                                    period: cfg.period,
                                    oddsValue: odds.under ? Number(odds.under) : null,
                                  })
                                }
                              >
                                {t("under")}
                              </button>
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
        })}
      </div>
    </section>
  );
}
