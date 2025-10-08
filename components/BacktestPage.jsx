"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getStatPatterns } from "@/components/backtest/statPatterns";
import {
  logClientBacktestError,
  logClientBacktestStep,
  resetClientBacktestSteps,
} from "@/lib/backtest/logger";

const TRANSLATIONS = {
  sv: {
    stat_total_shots: "Totala skott",
    stat_total_shots_on_target: "Skott på mål",
    stat_corner_kicks: "Hörnor",
    stat_yellow_cards: "Gula kort",
    stat_throw_ins: "Inkaster",
    stat_free_kicks: "Frisparkar",
    stat_fouls: "Fouls",
    stat_tackles: "Tacklingar",
    stat_offsides: "Offsider",
    table_statistic: "Statistik",
    table_team: "Scope",
    table_period: "Period",
    table_odds: "Odds",
    over: "Över",
    under: "Under",
    home: "Hemma",
    away: "Borta",
    scope_total: "Total",
    period_match: "Hela matchen",
    period_first_half: "Första halvlek",
    period_second_half: "Andra halvlek",
    paste_unibet_url: "Klistra in Unibet-url eller match-ID",
    load_odds: "Hämta Unibet-odds",
    recalculate_all: "Räkna om alla",
    neutral_ground_label: "Neutral plan",
    error_fill_teams: "Välj lag innan du backtestar.",
    error_fill_odds: "Fyll i odds innan du räknar.",
    ev_multiplier_label: "EV (Multiplikator)",
    ev_multifactor_label: "EV (Multifaktor)",
    ev_league_avg_label: "EV (Liga)",
    ev_model_label: "EV (Modell)",
    ev_legacy_label: "EV (Legacy)",
    ev_multiplier_short: "Mult",
    ev_multifactor_short: "Multi",
    ev_league_avg_short: "Liga",
    ev_model_short: "Modell",
    ev_legacy_short: "Legacy",
    backtest_results_bet: "Backtest-resultat",
    matches_loaded: "Matcher laddade",
    loading: "Laddar...",
    match_data_loading: "Hämtar matchdata...",
    importance_home: "Vikt hemmalag",
    importance_away: "Vikt bortalag",
    form_matches: "Form (matcher)",
    form_all: "Alla",
    no_results_yet: "Inga beräkningar ännu.",
    match_summary: "Match",
    bet_direction_over: "Över",
    bet_direction_under: "Under",
    hits_label: "Träffar",
    implied_probability: "Implicerad sannolikhet",
    model_probability: "Modellsannolikhet",
    edge_points: "Edge (p.p)",
    ev_percent: "EV %",
    last_updated: "Senast uppdaterad",
    home_matches_label: "Hemmasiffror",
    away_matches_label: "Bortasiffror",
    matches_count: "Antal matcher",
  },
};

function useTranslation() {
  const language = "sv";
  const dictionary = TRANSLATIONS[language] || {};
  const t = useCallback((key) => dictionary[key] ?? key, [dictionary]);
  return { t, language };
}

const FORM_MATCH_OPTIONS = [
  { value: "3", label: "3" },
  { value: "5", label: "5" },
  { value: "10", label: "10" },
  { value: "all", label: "Alla" },
];

function createInitialForm(homeTeam, awayTeam, statKeys) {
  const base = {};
  const keys = Array.isArray(statKeys) ? statKeys : [];
  for (const key of keys) {
    base[key] = {
      homeTeam: homeTeam ?? "",
      awayTeam: awayTeam ?? "",
      scope: "total",
      period: "ALL",
      formMatches: "all",
      home_importance: 5,
      away_importance: 5,
    };
  }
  return base;
}

function buildBetKey({
  homeTeam,
  awayTeam,
  statKey,
  scope,
  period,
  line,
  direction,
  formMatches,
  neutralGround,
  homeImportance,
  awayImportance,
}) {
  const normalizedLine = Number.isFinite(line) ? line.toFixed(3) : String(line ?? "");
  return [
    homeTeam || "",
    awayTeam || "",
    statKey,
    scope,
    period,
    normalizedLine,
    direction,
    formMatches ?? "all",
    neutralGround ? "neutral" : "regular",
    homeImportance ?? 5,
    awayImportance ?? 5,
  ].join("|");
}

function getPrimaryEv(result) {
  if (!result) return null;
  const candidates = [
    result.evPctWithMultiplier,
    result.evPctMultifactor,
    result.evPctLeagueAvg,
    result.evPct,
    result.legacyEvPct,
  ];
  for (const val of candidates) {
    if (Number.isFinite(val)) {
      return val;
    }
  }
  return null;
}

function formatEvSummary(result, t) {
  if (!result) return "-";
  const entries = [];
  if (Number.isFinite(result.evPctWithMultiplier)) {
    entries.push(`${result.evPctWithMultiplier.toFixed(1)}% (${t("ev_multiplier_short")})`);
  }
  if (Number.isFinite(result.evPctMultifactor)) {
    entries.push(`${result.evPctMultifactor.toFixed(1)}% (${t("ev_multifactor_short")})`);
  }
  if (Number.isFinite(result.evPctLeagueAvg)) {
    entries.push(`${result.evPctLeagueAvg.toFixed(1)}% (${t("ev_league_avg_short")})`);
  }
  if (Number.isFinite(result.evPct)) {
    entries.push(`${result.evPct.toFixed(1)}% (${t("ev_model_short")})`);
  }
  if (Number.isFinite(result.legacyEvPct)) {
    entries.push(`${result.legacyEvPct.toFixed(1)}% (${t("ev_legacy_short")})`);
  }
  return entries.length ? entries.join(" • ") : "-";
}

function scopeLabel(scope, t) {
  if (scope === "home") return t("home");
  if (scope === "away") return t("away");
  return t("scope_total");
}

function periodLabel(period, t) {
  if (period === "1ST") return t("period_first_half");
  if (period === "2ND") return t("period_second_half");
  return t("period_match");
}

function findLeagueName(teamName, leagues) {
  if (!teamName || !leagues) return null;
  for (const [leagueName, data] of Object.entries(leagues)) {
    const teams = data?.teams;
    if (!Array.isArray(teams)) continue;
    if (teams.some((team) => team?.name === teamName)) {
      return leagueName;
    }
  }
  return null;
}
function StatCard({
  statKey,
  config,
  formData,
  onFormChange,
  onOddsChange,
  oddsStore,
  getResult,
  neutralGround,
  t,
}) {
  const scope = formData?.scope ?? "total";
  const period = formData?.period ?? "ALL";
  const lines = useMemo(
    () => (typeof config?.thresholds === "function" ? config.thresholds(scope, period) : []),
    [config, scope, period]
  );

  const currentOddsBlock = oddsStore?.[statKey]?.[scope]?.[period] ?? {};

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
          {config?.displayName ?? statKey}
        </h3>
      </div>
      <div className="space-y-3 px-4 py-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">{t("table_team")}</span>
            <select
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={scope}
              onChange={(event) => onFormChange(statKey, "scope", event.target.value)}
            >
              <option value="total">{t("scope_total")}</option>
              <option value="home">{t("home")}</option>
              <option value="away">{t("away")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">{t("table_period")}</span>
            <select
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={period}
              onChange={(event) => onFormChange(statKey, "period", event.target.value)}
            >
              <option value="ALL">{t("period_match")}</option>
              <option value="1ST">{t("period_first_half")}</option>
              <option value="2ND">{t("period_second_half")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">{t("form_matches")}</span>
            <select
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={formData?.formMatches ?? "all"}
              onChange={(event) => onFormChange(statKey, "formMatches", event.target.value)}
            >
              {FORM_MATCH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-500">{t("importance_home")}</span>
              <input
                type="number"
                min={1}
                max={10}
                value={formData?.home_importance ?? 5}
                onChange={(event) => onFormChange(statKey, "home_importance", Number(event.target.value))}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-500">{t("importance_away")}</span>
              <input
                type="number"
                min={1}
                max={10}
                value={formData?.away_importance ?? 5}
                onChange={(event) => onFormChange(statKey, "away_importance", Number(event.target.value))}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </label>
          </div>
        </div>

        <table className="w-full table-fixed text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="w-16">Line</th>
              <th className="w-24 text-center">{t("over")}</th>
              <th className="w-24 text-center">{t("under")}</th>
              <th className="text-left">{t("ev_percent")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const lineKey = String(line);
              const oddsEntry = currentOddsBlock?.[lineKey] ?? {};
              const resultOver = getResult(statKey, scope, period, line, "over", formData, neutralGround);
              const resultUnder = getResult(statKey, scope, period, line, "under", formData, neutralGround);
              const overPrimary = getPrimaryEv(resultOver);
              const underPrimary = getPrimaryEv(resultUnder);
              return (
                <tr key={lineKey} className="border-t border-gray-100 align-top">
                  <td className="py-2 pr-2 font-semibold text-gray-700">{line}</td>
                  <td className="py-2 text-center">
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      value={oddsEntry.over ?? ""}
                      onChange={onOddsChange(statKey, scope, period, line, "over")}
                      className="w-full rounded border border-gray-300 px-1 py-1 text-xs"
                    />
                    <div
                      className={`mt-1 text-[11px] ${
                        Number.isFinite(overPrimary)
                          ? overPrimary > 0
                            ? "text-green-600"
                            : overPrimary < 0
                            ? "text-red-600"
                            : "text-gray-600"
                          : "text-gray-400"
                      }`}
                    >
                      {formatEvSummary(resultOver, t)}
                    </div>
                    <div className="mt-1 text-[11px] text-gray-400">
                      {t("hits_label")}: {resultOver?.hitsOver ?? "-"}
                    </div>
                  </td>
                  <td className="py-2 text-center">
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      value={oddsEntry.under ?? ""}
                      onChange={onOddsChange(statKey, scope, period, line, "under")}
                      className="w-full rounded border border-gray-300 px-1 py-1 text-xs"
                    />
                    <div
                      className={`mt-1 text-[11px] ${
                        Number.isFinite(underPrimary)
                          ? underPrimary > 0
                            ? "text-green-600"
                            : underPrimary < 0
                            ? "text-red-600"
                            : "text-gray-600"
                          : "text-gray-400"
                      }`}
                    >
                      {formatEvSummary(resultUnder, t)}
                    </div>
                    <div className="mt-1 text-[11px] text-gray-400">
                      {t("hits_label")}: {resultUnder?.hitsUnder ?? "-"}
                    </div>
                  </td>
                  <td className="py-2 pl-2 text-[11px] text-gray-600">
                    {neutralGround && <div className="text-[10px] text-blue-600">Neutral</div>}
                    <div>{resultOver?.timestamp ? new Date(resultOver.timestamp).toLocaleString("sv-SE") : ""}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultSummary({ results, t }) {
  if (!results.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
        {t("no_results_yet")}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
          {t("backtest_results_bet")}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100 text-xs">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left">{t("table_statistic")}</th>
              <th className="px-3 py-2 text-left">{t("table_team")}</th>
              <th className="px-3 py-2 text-left">{t("table_period")}</th>
              <th className="px-3 py-2 text-right">Line</th>
              <th className="px-3 py-2 text-left">{t("table_odds")}</th>
              <th className="px-3 py-2 text-right">{t("ev_percent")}</th>
              <th className="px-3 py-2 text-right">{t("model_probability")}</th>
              <th className="px-3 py-2 text-right">{t("implied_probability")}</th>
              <th className="px-3 py-2 text-right">{t("edge_points")}</th>
              <th className="px-3 py-2 text-right">{t("hits_label")}</th>
              <th className="px-3 py-2 text-left">{t("last_updated")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {results.map((entry) => {
              const primaryEv = getPrimaryEv(entry);
              const implied = Number.isFinite(entry.bet?.odds)
                ? (100 / entry.bet.odds).toFixed(1)
                : null;
              const modelProb = Number.isFinite(entry.modelProb)
                ? (entry.modelProb * 100).toFixed(1)
                : Number.isFinite(entry.modelProbWithMultiplier)
                ? (entry.modelProbWithMultiplier * 100).toFixed(1)
                : null;
              const edge =
                Number.isFinite(entry.edgePPWithMultiplier)
                  ? entry.edgePPWithMultiplier
                  : Number.isFinite(entry.edgePP)
                  ? entry.edgePP
                  : null;
              const hits = entry.bet?.direction === "over" ? entry.hitsOver : entry.hitsUnder;
              return (
                <tr key={entry.bet?.key ?? `${entry.params?.stat}-${entry.params?.line}-${entry.params?.scope}`} className="bg-white">
                  <td className="px-3 py-2 font-medium text-gray-700">{entry.params?.stat ?? entry.bet?.statKey}</td>
                  <td className="px-3 py-2 text-gray-600">{scopeLabel(entry.bet?.scope, t)}</td>
                  <td className="px-3 py-2 text-gray-600">{periodLabel(entry.bet?.period, t)}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">{entry.bet?.line}</td>
                  <td className="px-3 py-2 text-left text-gray-600">
                    {entry.bet?.direction === "over" ? t("bet_direction_over") : t("bet_direction_under")} @
                    {entry.bet?.odds?.toFixed ? ` ${entry.bet.odds.toFixed(2)}` : ` ${entry.bet?.odds ?? "-"}`}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${
                      Number.isFinite(primaryEv)
                        ? primaryEv > 0
                          ? "text-green-600"
                          : primaryEv < 0
                          ? "text-red-600"
                          : "text-gray-600"
                        : "text-gray-400"
                    }`}
                  >
                    {Number.isFinite(primaryEv) ? `${primaryEv.toFixed(1)}%` : "-"}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{modelProb ? `${modelProb}%` : "-"}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{implied ? `${implied}%` : "-"}</td>
                  <td className="px-3 py-2 text-right text-gray-600">
                    {Number.isFinite(edge) ? edge.toFixed(1) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{hits ?? "-"}</td>
                  <td className="px-3 py-2 text-left text-gray-500">
                    {entry.timestamp ? new Date(entry.timestamp).toLocaleString("sv-SE") : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export default function BacktestPage({ match }) {
  const { t } = useTranslation();
  const statPatterns = useMemo(() => getStatPatterns(t), [t]);
  const statKeys = useMemo(() => Object.keys(statPatterns), [statPatterns]);

  const homeTeamName =
    match?.homeTeamName ?? match?.homeTeam?.name ?? match?.homeTeam ?? "";
  const awayTeamName =
    match?.awayTeamName ?? match?.awayTeam?.name ?? match?.awayTeam ?? "";
  const matchId = match?.matchId ?? match?.id ?? null;

  const [form, setForm] = useState(() =>
    createInitialForm(homeTeamName, awayTeamName, statKeys)
  );
  const [oddsStore, setOddsStore] = useState({});
  const [resultMap, setResultMap] = useState({});
  const [unibetUrl, setUnibetUrl] = useState("");
  const [neutralGround, setNeutralGround] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [matchData, setMatchData] = useState({
    homeMatches: [],
    awayMatches: [],
    leagues: {},
  });
  const [matchDataLoading, setMatchDataLoading] = useState(false);

  const timersRef = useRef(new Map());
  const pendingRequestsRef = useRef(0);

  const setBusy = useCallback((delta) => {
    pendingRequestsRef.current += delta;
    setLoading(pendingRequestsRef.current > 0);
  }, []);

  const resetForTeams = useCallback(
    (home, away) => {
      setForm(createInitialForm(home, away, statKeys));
      setOddsStore({});
      setResultMap({});
      setError(null);
      setUnibetUrl("");
    },
    [statKeys]
  );

  const fetchMatchData = useCallback(
    async (home, away) => {
      if (!home || !away) return;
      setMatchDataLoading(true);
      try {
        const response = await fetch("/api/backtest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "match-data", homeTeam: home, awayTeam: away }),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        setMatchData({
          homeMatches: payload?.homeMatches ?? [],
          awayMatches: payload?.awayMatches ?? [],
          leagues: payload?.leagues ?? {},
        });
      } catch (err) {
        logClientBacktestError("Misslyckades att hämta matchdata", {
          message: err?.message,
        });
        setError(err?.message ?? "Misslyckades att hämta matchdata");
      } finally {
        setMatchDataLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!homeTeamName || !awayTeamName) return;
    resetClientBacktestSteps(
      `Match ${homeTeamName} vs ${awayTeamName}`,
      { homeTeam: homeTeamName, awayTeam: awayTeamName }
    );
    resetForTeams(homeTeamName, awayTeamName);
    fetchMatchData(homeTeamName, awayTeamName);
  }, [homeTeamName, awayTeamName, resetForTeams, fetchMatchData]);

  const getResult = useCallback(
    (statKey, scope, period, line, direction, formDataForStat, isNeutral) => {
      if (!formDataForStat) return null;
      const key = buildBetKey({
        homeTeam: formDataForStat.homeTeam,
        awayTeam: formDataForStat.awayTeam,
        statKey,
        scope,
        period,
        line: Number(line),
        direction,
        formMatches: formDataForStat.formMatches,
        neutralGround: isNeutral,
        homeImportance: formDataForStat.home_importance,
        awayImportance: formDataForStat.away_importance,
      });
      return resultMap[key] ?? null;
    },
    [resultMap]
  );

  const updateResultMap = useCallback((betKey, result) => {
    setResultMap((prev) => ({ ...prev, [betKey]: result }));
  }, []);

  const removeResult = useCallback((betKey) => {
    setResultMap((prev) => {
      if (!prev[betKey]) return prev;
      const next = { ...prev };
      delete next[betKey];
      return next;
    });
  }, []);

  const recalculateBet = useCallback(
    async ({ statKey, scope, period, line, direction, oddsValue, formForStat }) => {
      if (!formForStat?.homeTeam || !formForStat?.awayTeam) {
        setError(t("error_fill_teams"));
        return;
      }
      if (!Number.isFinite(oddsValue) || oddsValue <= 1) {
        return;
      }

      const betKey = buildBetKey({
        homeTeam: formForStat.homeTeam,
        awayTeam: formForStat.awayTeam,
        statKey,
        scope,
        period,
        line,
        direction,
        formMatches: formForStat.formMatches,
        neutralGround,
        homeImportance: formForStat.home_importance,
        awayImportance: formForStat.away_importance,
      });

      setBusy(1);
      setError(null);
      logClientBacktestStep("Beräknar expected value", {
        statKey,
        scope,
        period,
        line,
        direction,
      });

      try {
        const response = await fetch("/api/backtest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "expected-value",
            homeTeam: formForStat.homeTeam,
            awayTeam: formForStat.awayTeam,
            over: direction === "over",
            line,
            scope,
            stat: statKey,
            period,
            form: formForStat.formMatches,
            odds: oddsValue,
            neutralGround,
            home_importance: formForStat.home_importance,
            away_importance: formForStat.away_importance,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        const enriched = {
          ...payload,
          bet: {
            key: betKey,
            statKey,
            scope,
            period,
            line,
            direction,
            odds: oddsValue,
            homeTeam: formForStat.homeTeam,
            awayTeam: formForStat.awayTeam,
          },
        };
        updateResultMap(betKey, enriched);
      } catch (err) {
        logClientBacktestError("Beräkning misslyckades", {
          message: err?.message,
          statKey,
          line,
          direction,
        });
        setError(err?.message ?? "Serverfel vid beräkning");
      } finally {
        setBusy(-1);
      }
    },
    [neutralGround, setBusy, t, updateResultMap]
  );

  const handleFormChange = useCallback((statKey, field, value) => {
    setForm((prev) => ({
      ...prev,
      [statKey]: {
        ...prev[statKey],
        [field]: value,
      },
    }));
  }, []);

  const handleOddsChange = useCallback(
    (statKey, scope, period, line, direction) => (event) => {
      const rawValue = event.target.value;
      const lineKey = String(line);
      setOddsStore((prev) => {
        const next = { ...prev };
        const statBlock = next[statKey] ? { ...next[statKey] } : {};
        const scopeBlock = statBlock[scope] ? { ...statBlock[scope] } : {};
        const periodBlock = scopeBlock[period] ? { ...scopeBlock[period] } : {};
        const lineBlock = periodBlock[lineKey] ? { ...periodBlock[lineKey] } : {};

        if (rawValue === "" || rawValue === null) {
          delete lineBlock[direction];
        } else {
          lineBlock[direction] = rawValue;
        }

        if (Object.keys(lineBlock).length === 0) {
          delete periodBlock[lineKey];
        } else {
          periodBlock[lineKey] = lineBlock;
        }

        if (Object.keys(periodBlock).length === 0) {
          delete scopeBlock[period];
        } else {
          scopeBlock[period] = periodBlock;
        }

        if (Object.keys(scopeBlock).length === 0) {
          delete statBlock[scope];
        } else {
          statBlock[scope] = scopeBlock;
        }

        if (Object.keys(statBlock).length === 0) {
          delete next[statKey];
        } else {
          next[statKey] = statBlock;
        }

        return next;
      });

      const timers = timersRef.current;
      const timerKey = [statKey, scope, period, line, direction].join("|");
      if (timers.has(timerKey)) {
        clearTimeout(timers.get(timerKey));
        timers.delete(timerKey);
      }

      if (rawValue === "" || rawValue === null) {
        const formForStat = form[statKey];
        const betKey = buildBetKey({
          homeTeam: formForStat?.homeTeam,
          awayTeam: formForStat?.awayTeam,
          statKey,
          scope,
          period,
          line,
          direction,
          formMatches: formForStat?.formMatches,
          neutralGround,
          homeImportance: formForStat?.home_importance,
          awayImportance: formForStat?.away_importance,
        });
        removeResult(betKey);
        return;
      }

      const parsedOdds = Number.parseFloat(rawValue);
      timers.set(
        timerKey,
        setTimeout(() => {
          const formForStat = form[statKey];
          recalculateBet({
            statKey,
            scope,
            period,
            line,
            direction,
            oddsValue: parsedOdds,
            formForStat,
          });
        }, 800)
      );
    },
    [form, neutralGround, recalculateBet, removeResult]
  );

  const handleRecalculateAll = useCallback(async () => {
    const jobs = [];
    for (const statKey of statKeys) {
      const formForStat = form[statKey];
      const statOdds = oddsStore[statKey] ?? {};
      for (const scope of Object.keys(statOdds)) {
        const scopeBlock = statOdds[scope] ?? {};
        for (const period of Object.keys(scopeBlock)) {
          const periodBlock = scopeBlock[period] ?? {};
          for (const lineKey of Object.keys(periodBlock)) {
            const directions = periodBlock[lineKey] ?? {};
            for (const [direction, rawOdds] of Object.entries(directions)) {
              const numericOdds = Number.parseFloat(rawOdds);
              if (!Number.isFinite(numericOdds) || numericOdds <= 1) continue;
              jobs.push(
                recalculateBet({
                  statKey,
                  scope,
                  period,
                  line: Number(lineKey),
                  direction,
                  oddsValue: numericOdds,
                  formForStat,
                })
              );
            }
          }
        }
      }
    }

    if (!jobs.length) {
      setError(t("error_fill_odds"));
      return;
    }

    await Promise.allSettled(jobs);
  }, [form, oddsStore, recalculateBet, statKeys, t]);

  const handleLoadUnibet = useCallback(async () => {
    const target = unibetUrl?.trim() || (matchId ? String(matchId) : "");
    if (!target) {
      setError("Unibet-url eller match-id saknas.");
      return;
    }

    setBusy(1);
    setError(null);

    try {
      const response = await fetch("/api/backtest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "unibet-odds", url: target, matchId }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const tuples = payload?.tuples ?? [];

      setOddsStore((prev) => {
        const next = { ...prev };
        for (const tuple of tuples) {
          const { statKey, scope, period, line, odds } = tuple;
          if (!statKey || !form[statKey]) continue;
          const statBlock = next[statKey] ? { ...next[statKey] } : {};
          const scopeBlock = statBlock[scope] ? { ...statBlock[scope] } : {};
          const periodBlock = scopeBlock[period] ? { ...scopeBlock[period] } : {};
          const lineKey = String(line);
          const lineBlock = periodBlock[lineKey] ? { ...periodBlock[lineKey] } : {};
          if (odds?.over) lineBlock.over = Number(odds.over).toFixed(2);
          if (odds?.under) lineBlock.under = Number(odds.under).toFixed(2);
          periodBlock[lineKey] = lineBlock;
          scopeBlock[period] = periodBlock;
          statBlock[scope] = scopeBlock;
          next[statKey] = statBlock;
        }
        return next;
      });

      const recalcJobs = [];
      for (const tuple of tuples) {
        const { statKey, scope, period, line, odds } = tuple;
        const formForStat = form[statKey];
        if (!formForStat) continue;
        if (odds?.over) {
          recalcJobs.push(
            recalculateBet({
              statKey,
              scope,
              period,
              line,
              direction: "over",
              oddsValue: Number(odds.over),
              formForStat,
            })
          );
        }
        if (odds?.under) {
          recalcJobs.push(
            recalculateBet({
              statKey,
              scope,
              period,
              line,
              direction: "under",
              oddsValue: Number(odds.under),
              formForStat,
            })
          );
        }
      }
      await Promise.allSettled(recalcJobs);
    } catch (err) {
      logClientBacktestError("Misslyckades att hämta Unibet-odds", {
        message: err?.message,
        target,
      });
      setError(err?.message ?? "Kunde inte hämta Unibet-odds");
    } finally {
      setBusy(-1);
    }
  }, [form, matchId, recalculateBet, setBusy, t, unibetUrl]);

  const results = useMemo(() => Object.values(resultMap), [resultMap]);
  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => {
      const aEv = getPrimaryEv(a);
      const bEv = getPrimaryEv(b);
      if (Number.isFinite(aEv) && Number.isFinite(bEv)) {
        return bEv - aEv;
      }
      if (Number.isFinite(bEv)) return 1;
      if (Number.isFinite(aEv)) return -1;
      return 0;
    });
  }, [results]);

  const homeLeague = useMemo(
    () => findLeagueName(form[statKeys?.[0]]?.homeTeam ?? homeTeamName, matchData.leagues),
    [form, homeTeamName, matchData.leagues, statKeys]
  );
  const awayLeague = useMemo(
    () => findLeagueName(form[statKeys?.[0]]?.awayTeam ?? awayTeamName, matchData.leagues),
    [form, awayTeamName, matchData.leagues, statKeys]
  );

  return (
    <section className="col-span-full space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">
              {homeTeamName} vs {awayTeamName}
            </h2>
            <div className="text-xs text-gray-500">
              {homeLeague ? `${homeLeague} • ` : ""}
              {awayLeague ?? ""}
            </div>
            <div className="text-xs text-gray-400">
              {t("matches_loaded")}: {matchData.homeMatches.length + matchData.awayMatches.length}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={neutralGround}
                onChange={(event) => setNeutralGround(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              {t("neutral_ground_label")}
            </label>
            <button
              type="button"
              onClick={handleRecalculateAll}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow hover:bg-indigo-500"
            >
              {t("recalculate_all")}
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="sm:col-span-2">
            <span className="block text-xs font-medium text-gray-500">
              {t("paste_unibet_url")}
            </span>
            <input
              type="text"
              value={unibetUrl}
              onChange={(event) => setUnibetUrl(event.target.value)}
              placeholder="https://www.unibet.se/..."
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleLoadUnibet}
              className="w-full rounded bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-green-500"
            >
              {t("load_odds")}
            </button>
          </div>
        </div>
        {matchDataLoading ? (
          <div className="mt-3 text-xs text-blue-600">{t("match_data_loading")}</div>
        ) : null}
        {error ? (
          <div className="mt-3 text-sm text-red-600">{error}</div>
        ) : null}
        {loading ? (
          <div className="mt-3 text-xs text-gray-500">{t("loading")}</div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {statKeys.map((statKey) => (
          <StatCard
            key={statKey}
            statKey={statKey}
            config={statPatterns[statKey]}
            formData={form[statKey]}
            onFormChange={handleFormChange}
            onOddsChange={handleOddsChange}
            oddsStore={oddsStore}
            getResult={getResult}
            neutralGround={neutralGround}
            t={t}
          />
        ))}
      </div>

      <ResultSummary results={sortedResults} t={t} />
    </section>
  );
}
