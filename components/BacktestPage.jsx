"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PositiveEvTable from "./backtest/PositiveEvTable";
import OddsTable from "./backtest/OddsTable";
import RankingSummary from "./backtest/RankingSummary";
import HistoryTooltip from "./backtest/HistoryTooltip";
import { getStatPatterns } from "./backtest/statPatterns";
import {
  buildBackendUrl,
  buildBacktestApiUrl,
  createInitialForm,
  makeTeamKey,
  normalizeTeamName,
  replaceTeamsInForm,
} from "./backtest/utils";
import { mapUnibetOdds } from "./backtest/unibetOddsMapper";
import leaguesAndTeams from "@/data/leagues-and-teams.json";

const STRINGS = {
  backtest_title: "Backtest",
  select_match_placeholder: "Välj en match för att se backtest.",
  loading_placeholder: "Hämtar backtest…",
  backtest_description: "Analysera odds och EV för valda matcher.",
  stat_total_shots: "Totalt antal skott",
  stat_total_shots_on_target: "Skott på mål",
  stat_corner_kicks: "Hörnor",
  stat_yellow_cards: "Gula kort",
  stat_throw_ins: "Inkaster",
  stat_free_kicks: "Frisparkar",
  stat_fouls: "Fouls",
  stat_tackles: "Tacklingar",
  stat_offsides: "Offsides",
  scope_total: "Totalt",
  scope_home: "Hemma",
  scope_away: "Borta",
  period_match: "Hela matchen",
  period_first_half: "Första halvlek",
  period_second_half: "Andra halvlek",
  form_placeholder: "Form (\"all\" eller antal)",
  neutral_ground: "Neutral plan",
  load_odds: "Ladda odds",
  paste_unibet_url: "Klistra in Unibet URL",
  importance_home: "Hemmalagets importance",
  importance_away: "Bortalagets importance",
  submit_run: "Kör backtest",
  submit_running: "Kör…",
  over: "Över",
  under: "Under",
  home: "Hemma",
  away: "Borta",
  error_fill_teams: "Välj lag innan du kör backtest.",
  error_fill_odds: "Lägg till minst en lina med odds innan du kör backtest.",
  error_load_ranking: "Kunde inte ladda rankingdata: ",
  error_unibet_url: "Kunde inte läsa match-id från Unibet URL.",
  error_unibet_fetch: "Misslyckades hämta Unibet-odds.",
  error_unibet_map: "Inga odds kunde tolkas från Unibet-svaret.",
};

const translate = (key) => STRINGS[key] ?? key;

const LABELS = {
  over: translate("over"),
  under: translate("under"),
};

const TEAM_TO_LEAGUE = (() => {
  const map = new Map();
  Object.entries(leaguesAndTeams).forEach(([leagueName, leagueInfo]) => {
    (leagueInfo?.teams ?? []).forEach((team) => {
      if (team?.name) {
        map.set(team.name.toLowerCase(), leagueName);
      }
    });
  });
  return map;
})();

function resolveLeagueName(teamName, fallback) {
  if (!teamName) return fallback ?? null;
  const key = normalizeTeamName(teamName).toLowerCase();
  return TEAM_TO_LEAGUE.get(key) ?? fallback ?? null;
}

export default function BacktestPage({ match, className = "" }) {
  const statPatterns = useMemo(() => getStatPatterns(translate), []);
  const [form, setForm] = useState(() => createInitialForm(statPatterns));
  const [neutralGround, setNeutralGround] = useState(false);
  const [unibetUrl, setUnibetUrl] = useState("");
  const [oddsStore, setOddsStore] = useState({});
  const [resultsMap, setResultsMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [historyTooltip, setHistoryTooltip] = useState(null);
  const [historyPosition, setHistoryPosition] = useState({ x: 0, y: 0 });
  const [tooltipThreshold, setTooltipThreshold] = useState(null);
  const [teamProfiles, setTeamProfiles] = useState(null);
  const [rankingError, setRankingError] = useState(null);

  const firstStatKey = useMemo(() => Object.keys(statPatterns)[0], [statPatterns]);
  const homeTeamName = match?.homeTeamName ?? "";
  const awayTeamName = match?.awayTeamName ?? "";

  const homeLeagueName = useMemo(
    () => resolveLeagueName(homeTeamName, match?.leagueName),
    [homeTeamName, match?.leagueName]
  );
  const awayLeagueName = useMemo(
    () => resolveLeagueName(awayTeamName, match?.leagueName),
    [awayTeamName, match?.leagueName]
  );

  const currentTeamKey = useMemo(() => {
    const entry = form[firstStatKey];
    return entry ? makeTeamKey(entry.homeTeam, entry.awayTeam) : "default";
  }, [form, firstStatKey]);

  const statLabels = useMemo(() => {
    const labels = {};
    Object.entries(statPatterns).forEach(([key, config]) => {
      labels[key] = config.displayName;
    });
    return labels;
  }, [statPatterns]);

  const results = useMemo(() => Object.values(resultsMap), [resultsMap]);
  const resultsForTeam = useMemo(() => {
    if (!currentTeamKey) {
      return results;
    }
    return results.filter((result) => {
      const candidateKeys = [
        result?.teamKey,
        result?.bet?.teamKey,
      ].filter(Boolean);
      if (candidateKeys.some((key) => key === currentTeamKey)) {
        return true;
      }
      const legacyKey = result?.bet?.key;
      if (legacyKey && legacyKey.includes(currentTeamKey)) {
        return true;
      }
      return false;
    });
  }, [results, currentTeamKey]);

  useEffect(() => {
    if (!match) {
      console.log("[Backtest] reset state because no match is selected");
      setForm(createInitialForm(statPatterns));
      setResultsMap({});
      setHistoryTooltip(null);
      setTooltipThreshold(null);
      return;
    }
    const home = match.homeTeamName ?? "";
    const away = match.awayTeamName ?? "";
    console.log("[Backtest] match changed", {
      home,
      away,
      matchId: match?.id ?? match?.matchId ?? null,
      leagueName: match?.leagueName ?? null,
    });
    setForm((prev) => replaceTeamsInForm(prev, home, away));
    setResultsMap({});
    setHistoryTooltip(null);
    setTooltipThreshold(null);
  }, [match, statPatterns]);

  useEffect(() => {
    if (!currentTeamKey) return;
    setOddsStore((prev) => {
      if (!prev) return {};
      const next = { ...prev };
      const teamStore = { ...(next[currentTeamKey] ?? {}) };
      let hasChanges = false;

      Object.entries(statPatterns).forEach(([statKey, pattern]) => {
        const entry = form[statKey];
        if (!entry) return;
        const thresholds = pattern.thresholds(entry.scope, entry.period);
        const statStore = { ...(teamStore[statKey] ?? {}) };
        const scopeStore = { ...(statStore[entry.scope] ?? {}) };
        const periodStore = { ...(scopeStore[entry.period] ?? {}) };
        let statChanged = false;

        thresholds.forEach((line) => {
          if (!periodStore[line]) {
            periodStore[line] = { over: "", under: "" };
            statChanged = true;
          }
        });

        if (statChanged) {
          scopeStore[entry.period] = periodStore;
          statStore[entry.scope] = scopeStore;
          teamStore[statKey] = statStore;
          hasChanges = true;
        }
      });

      if (!hasChanges) return prev;
      next[currentTeamKey] = teamStore;
      return next;
    });
  }, [form, statPatterns, currentTeamKey]);

  useEffect(() => {
    if (!homeTeamName || !awayTeamName) {
      console.log("[Backtest] skipping team profile fetch – missing team names", {
        homeTeamName,
        awayTeamName,
      });
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;
    const tasks = [];

    const makeTask = ({ label, team, league, matchType }) => {
      if (!team || !matchType) return;
      tasks.push({ label, team, league, matchType });
    };

    makeTask({ label: "homeTeam:home", team: homeTeamName, league: homeLeagueName, matchType: "home" });
    makeTask({ label: "homeTeam:away", team: homeTeamName, league: homeLeagueName, matchType: "away" });
    makeTask({ label: "awayTeam:home", team: awayTeamName, league: awayLeagueName, matchType: "home" });
    makeTask({ label: "awayTeam:away", team: awayTeamName, league: awayLeagueName, matchType: "away" });

    if (!tasks.length) {
      console.log("[Backtest] no team profile fetch tasks created", {
        homeTeamName,
        awayTeamName,
      });
      return;
    }

    let cancelled = false;
    console.log("[Backtest] starting team profile fetch", { tasks });
    setRankingError(null);
    setTeamProfiles(null);

    const fetchProfile = async ({ label, team, league, matchType }) => {
      try {
        const params = new URLSearchParams();
        params.set("team", team);
        params.set("matchType", matchType);
        if (league) params.set("league", league);
        const url = `/api/teamprofiles?${params.toString()}`;
        console.log("[Backtest] fetching team profile", { label, url, team, league, matchType });
        const response = await fetch(url, { signal });
        if (!response.ok) {
          const error = new Error(`${response.status} ${response.statusText}`);
          error.response = response;
          throw error;
        }
        const payload = await response.json();
        console.log("[Backtest] fetched team profile", {
          label,
          team,
          league,
          matchType,
          hasProfile: Boolean(payload?.profile),
        });
        return { label, matchType, team, league, payload };
      } catch (err) {
        if (err.name === "AbortError") {
          console.log("[Backtest] team profile fetch aborted", { label, team, matchType });
        } else {
          console.error("[Backtest] team profile fetch failed", {
            label,
            team,
            league,
            matchType,
            error: err?.message,
          });
        }
        return { label, matchType, team, league, payload: null, error: err };
      }
    };

    Promise.all(tasks.map(fetchProfile))
      .then((entries) => {
        if (cancelled) {
          console.log("[Backtest] skipping team profile state update – component unmounted");
          return;
        }

        const summary = {
          homeTeam: { home: null, away: null },
          awayTeam: { home: null, away: null },
        };

        const errors = [];

        for (const entry of entries) {
          const role = entry.label.startsWith("homeTeam") ? "homeTeam" : "awayTeam";
          if (entry.error || !entry.payload?.profile) {
            errors.push({
              role,
              matchType: entry.matchType,
              team: entry.team,
              league: entry.league,
              error: entry.error?.message ?? "Missing profile",
            });
            continue;
          }
          summary[role][entry.matchType] = entry.payload.profile;
        }

        console.log("[Backtest] team profile fetch summary", { summary, errors });

        setTeamProfiles(summary);

        if (errors.length) {
          setRankingError(
            `${translate("error_load_ranking")}${errors
              .map((err) => `${err.team ?? "okänd"} (${err.matchType}): ${err.error}`)
              .join(", ")}`
          );
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        console.error("[Backtest] team profile fetch pipeline failed", err);
        setRankingError(translate("error_load_ranking") + (err?.message ?? ""));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [homeTeamName, awayTeamName, homeLeagueName, awayLeagueName]);

  const handleFormChange = useCallback(
    (statKey, field) => (event) => {
      const rawValue = event.target.value;
      console.log("[Backtest] form change", { statKey, field, rawValue });
      const value = field.includes("importance")
        ? (() => {
            const parsed = Number.parseInt(rawValue, 10);
            if (!Number.isFinite(parsed)) return form[statKey][field];
            return Math.min(10, Math.max(1, parsed));
          })()
        : rawValue;
      setForm((prev) => ({
        ...prev,
        [statKey]: {
          ...prev[statKey],
          [field]: value,
        },
      }));
    },
    [form]
  );

  const handleNeutralGround = (event) => {
    const checked = event.target.checked;
    console.log("[Backtest] neutral ground toggled", { checked });
    setNeutralGround(checked);
  };

  const saveBacktest = useCallback(
    async (lines, homeTeam, awayTeam, matchDate) => {
      if (!lines?.length) {
        console.log("[Backtest] skipping saveBacktest – no lines to persist");
        return;
      }
      console.log("[Backtest] persisting backtest", {
        lineCount: lines.length,
        homeTeam,
        awayTeam,
        matchDate,
      });
      try {
        await fetch(buildBackendUrl("/save-backtest"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            homeTeam,
            awayTeam,
            matchDate,
            lines,
            url: unibetUrl,
          }),
        });
        console.log("[Backtest] backtest persisted successfully");
      } catch (err) {
        console.error("[Backtest] Failed to persist backtest", err);
      }
    },
    [unibetUrl]
  );

  const recalculateBet = useCallback(
    async (statKey, line, direction, oddsValue, scopeOverride, periodOverride) => {
      const entry = form[statKey];
      console.log("[Backtest] recalculateBet called", {
        statKey,
        line,
        direction,
        oddsValue,
        scopeOverride,
        periodOverride,
        entry,
      });
      if (!entry?.homeTeam || !entry?.awayTeam) {
        setError(translate("error_fill_teams"));
        return null;
      }

      const body = {
        homeTeam: entry.homeTeam,
        awayTeam: entry.awayTeam,
        over: direction === "över",
        line,
        scope: scopeOverride || entry.scope,
        stat: statKey,
        period: periodOverride || entry.period,
        form: entry.formMatches,
        odds: oddsValue,
        neutralGround,
        home_importance: entry.home_importance,
        away_importance: entry.away_importance,
      };

      console.log("[Backtest] recalculateBet request payload", body);

      const endpointSlug =
        typeof window !== "undefined" && window.location.pathname.includes("backtest-copy")
          ? "expected-value-copy"
          : "expected-value";

      const url = buildBacktestApiUrl(endpointSlug);

      setLoading(true);
      setError(null);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error(`Serverfel för lina ${line} (${statKey})`);
        }
        const data = await response.json();
        console.log("[Backtest] recalculateBet response", { statKey, line, direction, data });
        const evSummary = {
          evPct: data?.evPct ?? null,
          evPctWithMultiplier: data?.evPctWithMultiplier ?? null,
          evPctMultifactor: data?.evPctMultifactor ?? null,
          evPctLeagueAvg: data?.evPctLeagueAvg ?? null,
          legacyEvPct: data?.legacyEvPct ?? null,
          edgePP: data?.edgePP ?? null,
          edgePPWithMultiplier: data?.edgePPWithMultiplier ?? null,
          modelProb: data?.modelProb ?? null,
          empiricalProb: data?.empiricalProb ?? null,
          blendedProb: data?.blendedProb ?? null,
          hitsOver: data?.hitsOver ?? null,
          hitsUnder: data?.hitsUnder ?? null,
          leagueAvg: data?.leagueAvg ?? null,
          leagueAvgHistory: data?.leagueAvgHistory ?? null,
        };
        const scopeUsed = scopeOverride || entry.scope;
        const periodUsed = periodOverride || entry.period;
        const teamKey = makeTeamKey(entry.homeTeam, entry.awayTeam);
        const teamKeySegment =
          teamKey && teamKey !== "default"
            ? teamKey
            : `${entry.homeTeam}-${entry.awayTeam}`.trim() || "default";
        const betKey = [
          teamKeySegment,
          statKey,
          line,
          direction,
          scopeUsed,
          periodUsed,
          entry.formMatches,
          neutralGround ? "neutral" : "regular",
        ].join("::");

        const updatedResult = {
          ...evSummary,
          hitsOver: evSummary.hitsOver || "0/0",
          hitsUnder: evSummary.hitsUnder || "0/0",
          teamKey,
          bet: {
            statKey,
            line,
            direction,
            odds: oddsValue,
            key: betKey,
            scope: scopeUsed,
            period: periodUsed,
            homeTeam: entry.homeTeam,
            awayTeam: entry.awayTeam,
            teamKey,
          },
        };

        setResultsMap((prev) => ({ ...prev, [betKey]: updatedResult }));
        console.log("[Backtest] recalculateBet stored result", updatedResult);
        return updatedResult;
      } catch (err) {
        console.error("[Backtest] recalc error", err);
        setError(err.message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [form, neutralGround]
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    console.log("[Backtest] submit triggered");
    if (!match) {
      setError(translate("error_fill_teams"));
      return;
    }
    const primary = form[firstStatKey];
    if (!primary?.homeTeam || !primary?.awayTeam) {
      setError(translate("error_fill_teams"));
      return;
    }

    const bets = Object.keys(statPatterns).flatMap((statKey) => {
      const entry = form[statKey];
      const statOdds =
        oddsStore[currentTeamKey]?.[statKey]?.[entry.scope]?.[entry.period] ?? {};
      return Object.entries(statOdds).flatMap(([lineKey, odds]) => {
        const line = Number.parseFloat(lineKey);
        if (!Number.isFinite(line)) return [];
        const candidates = [];
        if (odds.over) {
          candidates.push({
            statKey,
            line,
            direction: "över",
            odds: odds.over,
            scope: entry.scope,
            period: entry.period,
            formEntry: entry,
          });
        }
        if (odds.under) {
          candidates.push({
            statKey,
            line,
            direction: "under",
            odds: odds.under,
            scope: entry.scope,
            period: entry.period,
            formEntry: entry,
          });
        }
        return candidates;
      });
    });

    console.log("[Backtest] prepared bets", bets);

    if (!bets.length) {
      setError(translate("error_fill_odds"));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const responses = await Promise.all(
        bets.map((bet) =>
          recalculateBet(
            bet.statKey,
            bet.line,
            bet.direction,
            bet.odds,
            bet.scope,
            bet.period
          )
        )
      );
      const filtered = responses.filter(Boolean);
      console.log("[Backtest] submit responses", filtered);
      if (filtered.length) {
        setResultsMap((prev) => {
          const next = { ...prev };
          filtered.forEach((result) => {
            next[result.bet.key] = result;
          });
          return next;
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLoadUnibetOdds = async () => {
    console.log("[Backtest] loadUnibetOdds triggered", { unibetUrl });
    const matchIdMatch = unibetUrl.match(/event\/(\d+)/i);
    const matchId = matchIdMatch ? matchIdMatch[1] : null;
    if (!matchId) {
      setError(translate("error_unibet_url"));
      return;
    }
    const entry = form[firstStatKey];
    if (!entry?.homeTeam || !entry?.awayTeam) {
      setError(translate("error_fill_teams"));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(buildBackendUrl(`/unibet-odds/${matchId}`));
      if (!response.ok) {
        throw new Error(translate("error_unibet_fetch"));
      }
      const data = await response.json();
      console.log("[Backtest] loadUnibetOdds response", { data });
      const tuples = mapUnibetOdds(data.odds ?? data, entry.homeTeam, entry.awayTeam);
      if (!tuples.length) {
        throw new Error(translate("error_unibet_map"));
      }

      console.log("[Backtest] mapped Unibet odds", tuples);

      setOddsStore((prev) => {
        const next = { ...prev };
        const teamStore = { ...(next[currentTeamKey] ?? {}) };
        tuples.forEach(({ statKey, scope, period, line, odds }) => {
          if (!statPatterns[statKey]) return;
          const statStore = { ...(teamStore[statKey] ?? {}) };
          const scopeStore = { ...(statStore[scope] ?? {}) };
          const periodStore = { ...(scopeStore[period] ?? {}) };
          const existing = periodStore[line] ?? { over: "", under: "" };
          periodStore[line] = {
            over: odds?.over != null ? String(odds.over) : existing.over,
            under: odds?.under != null ? String(odds.under) : existing.under,
          };
          scopeStore[period] = periodStore;
          statStore[scope] = scopeStore;
          teamStore[statKey] = statStore;
        });
        next[currentTeamKey] = teamStore;
        console.log("[Backtest] updated odds store", { teamKey: currentTeamKey, teamStore });
        return next;
      });

      const matchDate = data.meta?.eventDate
        ? new Date(data.meta.eventDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const linesToSave = [];

      for (const { statKey, scope, period, line, odds } of tuples) {
        if (odds?.over) {
          const result = await recalculateBet(statKey, line, "över", odds.over, scope, period);
          if (result) {
            linesToSave.push({
              statKey: result.bet.statKey,
              line: result.bet.line,
              condition: result.bet.direction,
              period: result.bet.period,
              scope: result.bet.scope,
              odds: result.bet.odds,
              value: result.evPctLeagueAvg ?? null,
              evPctLeagueAvg: result.evPctLeagueAvg ?? null,
              evPctMultifactor: result.evPctMultifactor ?? null,
              evPctWithMultiplier: result.evPctWithMultiplier ?? null,
              evPct: result.evPct ?? null,
              legacyEvPct: result.legacyEvPct ?? null,
              homeTeam: result.bet.homeTeam,
              awayTeam: result.bet.awayTeam,
            });
          }
        }
        if (odds?.under) {
          const result = await recalculateBet(statKey, line, "under", odds.under, scope, period);
          if (result) {
            linesToSave.push({
              statKey: result.bet.statKey,
              line: result.bet.line,
              condition: result.bet.direction,
              period: result.bet.period,
              scope: result.bet.scope,
              odds: result.bet.odds,
              value: result.evPctLeagueAvg ?? null,
              evPctLeagueAvg: result.evPctLeagueAvg ?? null,
              evPctMultifactor: result.evPctMultifactor ?? null,
              evPctWithMultiplier: result.evPctWithMultiplier ?? null,
              evPct: result.evPct ?? null,
              legacyEvPct: result.legacyEvPct ?? null,
              homeTeam: result.bet.homeTeam,
              awayTeam: result.bet.awayTeam,
            });
          }
        }
      }

      await saveBacktest(linesToSave, entry.homeTeam, entry.awayTeam, matchDate);
    } catch (err) {
      console.error("[Backtest] loadUnibetOdds", err);
      setError(err.message ?? translate("error_unibet_fetch"));
    } finally {
      setLoading(false);
    }
  };

  const containerClass = [
    "flex h-full flex-col rounded-lg border border-gray-800 bg-gray-950 text-gray-100 shadow-lg",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const bodyContent = match ? (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="mb-6 flex flex-col gap-2">
        <h2 className="text-2xl font-semibold text-gray-100">
          {match.homeTeamName} vs {match.awayTeamName}
        </h2>
        <p className="text-sm text-gray-400">{translate("backtest_description")}</p>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <label className="flex flex-col gap-2 text-sm text-gray-300">
          <span className="font-medium text-gray-200">{translate("paste_unibet_url")}</span>
          <input
            type="url"
            value={unibetUrl}
            onChange={(event) => setUnibetUrl(event.target.value)}
            placeholder="https://www.unibet.com/betting/sports/event/..."
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <button
          type="button"
          onClick={handleLoadUnibetOdds}
          className="inline-flex items-center justify-center rounded-md border border-blue-500 px-4 py-2 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/10"
          disabled={loading}
        >
          {translate("load_odds")}
        </button>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-md border border-gray-800 bg-gray-900 px-4 py-3">
        <label className="flex items-center gap-3 text-sm text-gray-200">
          <input
            type="checkbox"
            checked={neutralGround}
            onChange={handleNeutralGround}
            className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
          />
          <span>{translate("neutral_ground")}</span>
        </label>

        <div className="flex flex-wrap items-center gap-6 text-sm text-gray-200">
          <label className="flex flex-col gap-1">
            <span>{translate("importance_home")}</span>
            <input
              type="range"
              min="1"
              max="10"
              value={form[firstStatKey].home_importance}
              onChange={handleFormChange(firstStatKey, "home_importance")}
              className="h-2 w-48 cursor-pointer appearance-none rounded bg-gradient-to-r from-blue-900 to-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>{translate("importance_away")}</span>
            <input
              type="range"
              min="1"
              max="10"
              value={form[firstStatKey].away_importance}
              onChange={handleFormChange(firstStatKey, "away_importance")}
              className="h-2 w-48 cursor-pointer appearance-none rounded bg-gradient-to-r from-blue-900 to-blue-500"
            />
          </label>
        </div>
      </div>

      {rankingError ? (
        <div className="mb-4 rounded-md border border-red-700 bg-red-950/60 px-4 py-3 text-sm text-red-200">
          {rankingError}
        </div>
      ) : null}

      <PositiveEvTable results={resultsForTeam} statLabels={statLabels} />

      <form onSubmit={handleSubmit} className="mt-6 space-y-10">
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center rounded-md border border-blue-500 px-5 py-2 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? translate("submit_running") : translate("submit_run")}
        </button>

        {Object.keys(statPatterns).map((statKey) => {
          const entry = form[statKey];
          const statResults = resultsForTeam.filter(
            (result) =>
              result.bet.statKey === statKey &&
              result.bet.scope === entry.scope &&
              result.bet.period === entry.period
          );

          return (
            <section key={statKey} className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-5 shadow-inner">
              <header className="mb-4">
                <h3 className="text-lg font-semibold text-gray-100">
                  {statPatterns[statKey].displayName}
                </h3>
              </header>

              <RankingSummary
                statKey={statKey}
                formEntry={entry}
                teamProfiles={teamProfiles}
                homeLeagueName={homeLeagueName}
                awayLeagueName={awayLeagueName}
              />

              <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-gray-200">
                <select
                  value={entry.scope}
                  onChange={handleFormChange(statKey, "scope")}
                  className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="total">{translate("scope_total")}</option>
                  <option value="home">{entry.homeTeam || translate("home")}</option>
                  <option value="away">{entry.awayTeam || translate("away")}</option>
                </select>
                <select
                  value={entry.period}
                  onChange={handleFormChange(statKey, "period")}
                  className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ALL">{translate("period_match")}</option>
                  <option value="1ST">{translate("period_first_half")}</option>
                  <option value="2ND">{translate("period_second_half")}</option>
                </select>
                <input
                  value={entry.formMatches}
                  onChange={handleFormChange(statKey, "formMatches")}
                  placeholder={translate("form_placeholder")}
                  className="w-48 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <OddsTable
                statKey={statKey}
                scope={entry.scope}
                period={entry.period}
                teamKey={currentTeamKey}
                homeTeam={entry.homeTeam}
                awayTeam={entry.awayTeam}
                oddsStore={oddsStore}
                setOddsStore={setOddsStore}
                results={statResults}
                onRecalculate={recalculateBet}
                neutralGround={neutralGround}
                setHistoryTooltip={setHistoryTooltip}
                setHistoryPosition={setHistoryPosition}
                setTooltipThreshold={setTooltipThreshold}
                statPatterns={statPatterns}
                labels={LABELS}
              />
            </section>
          );
        })}
      </form>

      {error ? (
        <div className="mt-6 rounded-md border border-red-700 bg-red-950/60 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}
    </div>
  ) : (
    <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-400">
      {translate("select_match_placeholder")}
    </div>
  );

  return (
    <div className={containerClass}>
      <div className="border-b border-gray-800 px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-300">
          {translate("backtest_title")}
        </h2>
      </div>
      {bodyContent}
      <HistoryTooltip
        content={historyTooltip}
        position={historyPosition}
        threshold={tooltipThreshold}
      />
    </div>
  );
}

