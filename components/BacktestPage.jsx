"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR from "swr";

import { getStatPatterns } from "./backtest/statPatterns";
import mapUnibetOdds from "./backtest/unibetOddsMapper";
import { buildTeamProfileKeyForMatch } from "@/lib/utils/apiKeys";
import { fetchTeamProfile } from "@/lib/utils/fetchers";

const TRANSLATIONS = {
  over: "Över",
  under: "Under",
  home: "Hemmalag",
  away: "Bortalag",
  scope_total: "Totalt",
  period_match: "Hela matchen",
  period_first_half: "Första halvlek",
  period_second_half: "Andra halvlek",
  paste_unibet_url: "Klistra in Unibet-URL",
  load_odds: "Hämta odds",
  table_statistic: "Statistik",
  table_team: "Lag",
  table_period: "Period",
  table_odds: "Odds",
  backtest_results_bet: "Spel",
  value: "Värde",
  ev_multiplier_label: "Multiplikator-modell",
  ev_multifactor_label: "Multifaktor",
  ev_league_avg_label: "Ligasnitt",
  ev_model_label: "Modell",
  ev_legacy_label: "Legacy",
  ev_multiplier_short: "Mult.",
  ev_multifactor_short: "Multi",
  ev_league_avg_short: "Liga",
  stat_total_shots: "Totala skott",
  stat_total_shots_on_target: "Skott på mål",
  stat_corner_kicks: "Hörnor",
  stat_yellow_cards: "Gula kort",
  stat_throw_ins: "Inkasts",
  stat_free_kicks: "Frisparkar",
  stat_fouls: "Fouls",
  stat_tackles: "Tacklingar",
  stat_offsides: "Offsider",
  error_fill_teams: "Välj lag innan du kör backtest.",
  error_fill_odds: "Fyll i odds för minst en rad.",
  backtest_submit_label: "Kör backtest",
  neutral_ground: "Neutral plan",
  importance_home: "Vikt hemmalag",
  importance_away: "Vikt bortalag",
};

function useTranslations() {
  return useCallback((key) => TRANSLATIONS[key] ?? key, []);
}

function readProfileMetric(profile, sectionKey, statKey, periodKey) {
  const section = profile?.statistics?.[sectionKey];
  if (!section) return { value: null, rank: null };
  const statNode = section?.[statKey];
  if (!statNode) return { value: null, rank: null };
  const entry = statNode?.[periodKey] ?? statNode?.ALL ?? null;
  if (!entry) return { value: null, rank: null };
  const value = Number(entry.value ?? entry.avg ?? entry.mean);
  const rank = Number(entry.rank ?? entry.position);
  return {
    value: Number.isFinite(value) ? value : null,
    rank: Number.isFinite(rank) ? rank : null,
  };
}

function formatNumber(value, decimals = 2) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(decimals);
}

function formatRank(rank) {
  if (!Number.isFinite(rank)) return "-";
  return `#${rank}`;
}

function OddsTable({
  statKey,
  scope,
  period,
  teamKey = "default",
  homeTeam,
  awayTeam,
  oddsStore,
  setOddsStore,
  results,
  onRecalculate,
  setHistoryTooltip,
  setHistoryPos,
  neutralGround,
  setTooltipThreshold,
  t,
  STAT_PATTERNS,
}) {
  const timeouts = useRef({});

  const opponentName =
    scope === "home" ? awayTeam : scope === "away" ? homeTeam : "Under";

  const handleOddsChange = (line, dir) => (e) => {
    const val = e.target.value;

    setOddsStore((prev) => {
      const currentOdds = prev[teamKey]?.[statKey]?.[scope]?.[period] || {};
      return {
        ...prev,
        [teamKey]: {
          ...prev[teamKey],
          [statKey]: {
            ...prev[teamKey]?.[statKey],
            [scope]: {
              ...prev[teamKey]?.[statKey]?.[scope],
              [period]: {
                ...currentOdds,
                [line]: {
                  ...currentOdds[line],
                  [dir]: val,
                },
              },
            },
          },
        },
      };
    });

    const key = `${line}-${dir}`;
    clearTimeout(timeouts.current[key]);
    timeouts.current[key] = setTimeout(() => {
      const direction = dir === "over" ? "över" : "under";
      onRecalculate(statKey, line, direction, val);
    }, 400);
  };

  const getEvForLineAndDirection = (line, direction) => {
    const result = results.find(
      (res) =>
        res.bet.statKey === statKey &&
        res.bet.line === line &&
        res.bet.direction === direction &&
        res.bet.scope === scope &&
        res.bet.period === period &&
        res.bet.key.includes(teamKey)
    );
    if (!result)
      return [
        {
          raw: null,
          text: "-",
          tooltip: "",
        },
      ];

    const fmt = (v, label) =>
      (v >= 0 ? "+" : "") + v.toFixed(1) + "%" + (label ? ` (${label})` : "");

    const leagueFormulaTooltip = (() => {
      const formulas = result.leagueAvg?.details?.formulas;
      if (!Array.isArray(formulas) || !formulas.length) return "";
      const periodFormula =
        formulas.find((f) => f.period === period) || formulas[0];
      if (!periodFormula) return "";
      const lines = [];
      if (scope === "home" && periodFormula.home?.formula) {
        lines.push(`${result.bet.homeTeam}: ${periodFormula.home.formula}`);
      } else if (scope === "away" && periodFormula.away?.formula) {
        lines.push(`${result.bet.awayTeam}: ${periodFormula.away.formula}`);
      } else {
        if (periodFormula.home?.formula) {
          lines.push(`${result.bet.homeTeam}: ${periodFormula.home.formula}`);
        }
        if (periodFormula.away?.formula) {
          lines.push(`${result.bet.awayTeam}: ${periodFormula.away.formula}`);
        }
        if (periodFormula.total?.formula) {
          lines.push(`Total: ${periodFormula.total.formula}`);
        }
      }
      return lines.join("\n");
    })();

    const values = [];
    const addValue = (value, label, tooltip = "") => {
      if (typeof value === "number") {
        values.push({ raw: value, text: fmt(value, label), tooltip });
      }
    };

    addValue(result.evPctWithMultiplier, t("ev_multiplier_label"));
    addValue(result.evPctMultifactor, t("ev_multifactor_label"));
    addValue(result.evPctLeagueAvg, t("ev_league_avg_label"), leagueFormulaTooltip);
    addValue(result.evPct, t("ev_model_label"));
    addValue(result.legacyEvPct, t("ev_legacy_label"));

    return values.length
      ? values
      : [
          {
            raw: null,
            text: "-",
            tooltip: "",
          },
        ];
  };

  const getMatchesForLineAndDirection = (line, direction) => {
    const result = results.find(
      (res) =>
        res.bet.statKey === statKey &&
        res.bet.line === line &&
        res.bet.scope === scope &&
        res.bet.period === period &&
        res.bet.key.includes(teamKey)
    );
    if (!result) return "-";
    if (scope === "total") {
      const hits = direction === "över" ? result.hitsOver : result.hitsUnder;
      return hits ? `${hits} matcher` : "-";
    }
    const hitsFor = direction === "över" ? result.hitsOver : result.hitsUnder;
    const hitsAgainst = result.hitsAgainst || "0/0";
    if (direction === "under") {
      return hitsAgainst ? `${hitsAgainst}` : "-";
    }
    return hitsFor ? `${hitsFor} matcher` : "-";
  };

  const getOffsidesForSide = (match, side) => {
    if (!match?.stat?.offsides) return null;
    return match.stat.offsides[side];
  };

  const formatStatValue = (match, stat, teamType) => {
    if (!stat) return "-";
    const value = stat[teamType];
    if (value == null) return "-";
    if (statKey === "freeKicks" && typeof value === "number") {
      const opponentSide = teamType === "home" ? "away" : "home";
      const opponentOffsides = getOffsidesForSide(match, opponentSide);
      if (typeof opponentOffsides === "number") {
        const baseFreeKicks = value - opponentOffsides;
        if (Number.isFinite(baseFreeKicks)) {
          return `${value} (${baseFreeKicks} + ${opponentOffsides} offsides)`;
        }
      }
      return `${value}`;
    }

    if (
      statKey === "shotsOnGoal" &&
      match.totalShots &&
      typeof value === "number"
    ) {
      const total = match.totalShots[teamType];
      if (typeof total === "number" && total > 0) {
        const pct = Math.round((value / total) * 100);
        return `${value} (${pct}%)`;
      }
    }
    return value;
  };

  const getTooltipForOver = (line) => {
    const result = results.find(
      (res) =>
        res.bet.statKey === statKey &&
        res.bet.line === line &&
        res.bet.scope === scope &&
        res.bet.period === period &&
        res.bet.key.includes(teamKey)
    );
    if (!result) return "";
    if (scope === "total") {
      const matches = result.homeMatches.concat(result.awayMatches);
      return matches
        .map(
          (m) =>
            `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
              m,
              m.stat.total,
              "total"
            )}`
        )
        .join("\n");
    }
    if (scope === "home") {
      return result.homeMatches
        .map(
          (m) =>
            `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
              m,
              neutralGround ? m.stat.away : m.stat.home,
              neutralGround ? "away" : "home"
            )}`
        )
        .join("\n");
    }
    return result.awayMatches
      .map(
        (m) =>
          `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
            m,
            neutralGround ? m.stat.home : m.stat.away,
            neutralGround ? "home" : "away"
          )}`
      )
      .join("\n");
  };

  const getTooltipForUnder = (line) => {
    const result = results.find(
      (res) =>
        res.bet.statKey === statKey &&
        res.bet.line === line &&
        res.bet.scope === scope &&
        res.bet.period === period &&
        res.bet.key.includes(teamKey)
    );
    if (!result) return "";
    if (scope === "total") {
      const matches = result.homeMatches.concat(result.awayMatches);
      return matches
        .map(
          (m) =>
            `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
              m,
              m.stat.total,
              "total"
            )}`
        )
        .join("\n");
    }
    if (scope === "home") {
      return result.awayMatches
        .map(
          (m) =>
            `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
              m,
              m.stat.home,
              "home"
            )}`
        )
        .join("\n");
    }
    return result.homeMatches
      .map(
        (m) =>
          `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
            m,
            m.stat.away,
            "away"
          )}`
      )
      .join("\n");
  };

  const thresholds = STAT_PATTERNS[statKey].thresholds(scope, period);

  const getHistoryContent = (line, isOver) => {
    const result = results.find(
      (res) =>
        res.bet.statKey === statKey &&
        res.bet.line === line &&
        res.bet.scope === scope &&
        res.bet.period === period &&
        res.bet.key.includes(teamKey)
    );
    if (!result) return "";

    if (scope === "total") {
      const matches = result.homeMatches.concat(result.awayMatches);
      return matches
        .map(
          (m) =>
            `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
              m,
              m.stat.total,
              "total"
            )}`
        )
        .join("\n");
    }

    if (scope === "home") {
      if (isOver) {
        return result.homeMatches
          .map(
            (m) =>
              `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
                m,
                neutralGround ? m.stat.away : m.stat.home,
                neutralGround ? "away" : "home"
              )}`
          )
          .join("\n");
      }
      return result.awayMatches
        .map(
          (m) =>
            `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
              m,
              m.stat.home,
              "home"
            )}`
        )
        .join("\n");
    }

    if (scope === "away") {
      if (isOver) {
        return result.awayMatches
          .map(
            (m) =>
              `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
                m,
                neutralGround ? m.stat.home : m.stat.away,
                neutralGround ? "home" : "away"
              )}`
          )
          .join("\n");
      }
      return result.homeMatches
        .map(
          (m) =>
            `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
              m,
              m.stat.away,
              "away"
            )}`
        )
        .join("\n");
    }

    return "";
  };

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
      <thead>
        <tr>
          <th>Lina</th>
          <th>{t("over")} (odds)</th>
          <th>EV % ({t("over")})</th>
          <th>{t("under")} (odds)</th>
          <th>EV % ({t("under")})</th>
          <th>Historik</th>
        </tr>
      </thead>
      <tbody>
        {thresholds.map((line) => (
          <tr key={line}>
            <td>{line}</td>
            <td title={getTooltipForOver(line)}>
              <input
                type="number"
                step="0.01"
                placeholder={t("over")}
                value={
                  oddsStore[teamKey]?.[statKey]?.[scope]?.[period]?.[line]?.over || ""
                }
                onChange={handleOddsChange(line, "over")}
                style={{ width: "80px" }}
              />
            </td>
            {(() => {
              const evs = getEvForLineAndDirection(line, "över");
              const first = evs[0];
              const color =
                first && typeof first.raw === "number"
                  ? first.raw >= 0
                    ? "green"
                    : "red"
                  : "inherit";
              const tooltip = evs
                .map((ev) => ev.tooltip)
                .filter(Boolean)
                .join("\n\n");
              return (
                <td
                  style={{ color }}
                  title={tooltip || undefined}
                >
                  {evs.map((ev, idx) => (
                    <div key={idx} title={ev.tooltip || undefined}>
                      {ev.text}
                    </div>
                  ))}
                </td>
              );
            })()}
            <td title={getTooltipForUnder(line)}>
              <input
                type="number"
                step="0.01"
                placeholder={t("under")}
                value={
                  oddsStore[teamKey]?.[statKey]?.[scope]?.[period]?.[line]?.under || ""
                }
                onChange={handleOddsChange(line, "under")}
                style={{ width: "80px" }}
              />
            </td>
            {(() => {
              const evs = getEvForLineAndDirection(line, "under");
              const first = evs[0];
              const color =
                first && typeof first.raw === "number"
                  ? first.raw >= 0
                    ? "green"
                    : "red"
                  : "inherit";
              const tooltip = evs
                .map((ev) => ev.tooltip)
                .filter(Boolean)
                .join("\n\n");
              return (
                <td
                  style={{ color }}
                  title={tooltip || undefined}
                >
                  {evs.map((ev, idx) => (
                    <div key={idx} title={ev.tooltip || undefined}>
                      {ev.text}
                    </div>
                  ))}
                </td>
              );
            })()}
            <td>
              <div
                onMouseEnter={(e) => {
                  const content = getHistoryContent(line, true);
                  if (content) {
                    setHistoryTooltip(content);
                    setTooltipThreshold(line);
                    setHistoryPos({ x: e.clientX, y: e.clientY });
                  }
                }}
                onMouseLeave={() => setHistoryTooltip(null)}
                style={{ cursor: "help" }}
              >
                {t("over")}: {getMatchesForLineAndDirection(line, "över")}
              </div>
              <div
                onMouseEnter={(e) => {
                  const content = getHistoryContent(line, false);
                  if (content) {
                    setHistoryTooltip(content);
                    setTooltipThreshold(line);
                    setHistoryPos({ x: e.clientX, y: e.clientY });
                  }
                }}
                onMouseLeave={() => setHistoryTooltip(null)}
                style={{ cursor: "help" }}
              >
                {opponentName}
                {opponentName !== "Under" && " conceded"}: {getMatchesForLineAndDirection(line, "under")}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function BacktestPage({ match }) {
  const t = useTranslations();
  const STAT_PATTERNS = useMemo(() => getStatPatterns(t), [t]);

  const [form, setForm] = useState(() =>
    Object.keys(STAT_PATTERNS).reduce((acc, statKey) => {
      acc[statKey] = {
        homeTeam: "",
        awayTeam: "",
        scope: "total",
        statKey,
        period: "ALL",
        formMatches: "all",
        home_importance: 5,
        away_importance: 5,
      };
      return acc;
    }, {})
  );
  const [neutralGround, setNeutralGround] = useState(false);
  const [unibetUrl, setUnibetUrl] = useState("");

  const [oddsStore, setOddsStore] = useState({
    default: Object.keys(STAT_PATTERNS).reduce((acc, statKey) => {
      acc[statKey] = { total: { ALL: {} } };
      return acc;
    }, {}),
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resultsMap, setResultsMap] = useState({});
  const [initData, setInitData] = useState(null);
  const [initLoading, setInitLoading] = useState(false);

  const results = useMemo(() => Object.values(resultsMap), [resultsMap]);
  const positiveResults = useMemo(() => {
    return results
      .map((r) => {
        let primaryEv = null;
        let primaryLabel = null;
        if (typeof r.evPctWithMultiplier === "number") {
          primaryEv = r.evPctWithMultiplier;
          primaryLabel = t("ev_multiplier_short");
        } else if (typeof r.evPctMultifactor === "number") {
          primaryEv = r.evPctMultifactor;
          primaryLabel = t("ev_multifactor_short");
        } else if (typeof r.evPctLeagueAvg === "number") {
          primaryEv = r.evPctLeagueAvg;
          primaryLabel = t("ev_league_avg_short");
        } else if (typeof r.evPct === "number") {
          primaryEv = r.evPct;
          primaryLabel = t("ev_model_label");
        } else if (typeof r.legacyEvPct === "number") {
          primaryEv = r.legacyEvPct;
          primaryLabel = t("ev_legacy_label");
        }
        return { ...r, primaryEv, primaryLabel };
      })
      .filter((r) => typeof r.primaryEv === "number" && r.primaryEv > 0)
      .sort((a, b) => b.primaryEv - a.primaryEv);
  }, [results, t]);

  const firstForm = useMemo(() => Object.values(form)[0] || {}, [form]);

  const teamKey = useMemo(() => {
    if (firstForm?.homeTeam && firstForm?.awayTeam) {
      return `${firstForm.homeTeam}-${firstForm.awayTeam}`;
    }
    if (match?.matchId) {
      return String(match.matchId);
    }
    return "default";
  }, [firstForm, match]);

  const [historyTooltip, setHistoryTooltip] = useState(null);
  const [historyPos, setHistoryPos] = useState({ x: 0, y: 0 });
  const [tooltipThreshold, setTooltipThreshold] = useState(null);

  useEffect(() => {
    Object.keys(STAT_PATTERNS).forEach((statKey) => {
      const currentScope = form[statKey].scope;
      const currentPeriod = form[statKey].period;
      const thresholds = STAT_PATTERNS[statKey].thresholds(
        currentScope,
        currentPeriod
      );

      setOddsStore((prev) => {
        const currentTeamStore = prev[teamKey] || {};
        const currentStatStore = currentTeamStore[statKey] || {};
        const currentScopeStore = currentStatStore[currentScope] || {};
        const currentPeriodStore = currentScopeStore[currentPeriod] || {};

        const updatedOdds = { ...currentPeriodStore };
        thresholds.forEach((line) => {
          if (!updatedOdds[line]) {
            updatedOdds[line] = { over: "", under: "" };
          }
        });

        return {
          ...prev,
          [teamKey]: {
            ...currentTeamStore,
            [statKey]: {
              ...currentStatStore,
              [currentScope]: {
                ...currentScopeStore,
                [currentPeriod]: updatedOdds,
              },
            },
          },
        };
      });
    });
  }, [form, teamKey, STAT_PATTERNS]);

  const handleTeams = useCallback(({ homeTeam, awayTeam }, cb) => {
    setForm((prev) => {
      const updated = Object.keys(prev).reduce((acc, statKey) => {
        acc[statKey] = {
          ...prev[statKey],
          homeTeam: homeTeam || prev[statKey].homeTeam,
          awayTeam: awayTeam || prev[statKey].awayTeam,
        };
        return acc;
      }, {});
      if (cb) setTimeout(() => cb(updated), 0);
      return updated;
    });
  }, []);

  useEffect(() => {
    const homeTeam = match?.homeTeamName;
    const awayTeam = match?.awayTeamName;
    if (!homeTeam || !awayTeam) return;

    setError(null);
    handleTeams({ homeTeam, awayTeam });

    setInitLoading(true);
    fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "initialize",
        homeTeam,
        awayTeam,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Kunde inte initiera backtest-data");
        return res.json();
      })
      .then((data) => {
        setInitData(data || null);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => setInitLoading(false));
  }, [match, handleTeams]);

  const handle = (statKey, field) => (e) => {
    const value = field.includes("importance")
      ? parseInt(e.target.value, 10)
      : e.target.value;
    setForm((prev) => ({
      ...prev,
      [statKey]: { ...prev[statKey], [field]: value },
    }));
  };

  const handleNeutralGround = (e) => {
    setNeutralGround(e.target.checked);
  };

  const recalculateBet = useCallback(
    async (statKey, line, direction, odds, scopeOverride, periodOverride) => {
      const formForStat = form[statKey];
      if (!formForStat.homeTeam || !formForStat.awayTeam) {
        setError(t("error_fill_teams"));
        return null;
      }
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "expectedValue",
            homeTeam: formForStat.homeTeam,
            awayTeam: formForStat.awayTeam,
            over: direction === "över",
            line,
            scope: scopeOverride || formForStat.scope,
            stat: statKey,
            period: periodOverride || formForStat.period,
            form: formForStat.formMatches,
            odds,
            neutralGround,
            home_importance: formForStat.home_importance,
            away_importance: formForStat.away_importance,
          }),
        });
        if (!res.ok) throw new Error(`Serverfel för lina ${line} (${statKey})`);
        const data = await res.json();
        const betKey = `${formForStat.homeTeam}-${formForStat.awayTeam}-${statKey}-${line}-${direction}-${
          scopeOverride || formForStat.scope
        }-${periodOverride || formForStat.period}-${formForStat.formMatches}-${neutralGround}`;

        const updatedResult = {
          ...data,
          hitsOver: data.hitsOver || "0/0",
          hitsUnder: data.hitsUnder || "0/0",
          bet: {
            statKey,
            line,
            direction,
            odds,
            key: betKey,
            scope: scopeOverride || formForStat.scope,
            period: periodOverride || formForStat.period,
            homeTeam: formForStat.homeTeam,
            awayTeam: formForStat.awayTeam,
          },
        };

        setResultsMap((prev) => ({ ...prev, [betKey]: updatedResult }));
        return updatedResult;
      } catch (err) {
        setError(err.message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [form, neutralGround, t]
  );

  const loadUnibetOdds = useCallback(async () => {
    const matchIdMatch = unibetUrl.match(/event\/(\d+)/);
    if (!matchIdMatch) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unibetOdds",
          url: unibetUrl,
        }),
      });
      if (!res.ok) throw new Error("Kunde inte hämta odds från Unibet");
      const data = await res.json();
      const homeTeam = firstForm.homeTeam;
      const awayTeam = firstForm.awayTeam;
      const tuples = mapUnibetOdds(data.odds, homeTeam, awayTeam);
      setOddsStore((prev) => {
        const updated = { ...prev };
        tuples.forEach(({ statKey, scope, period, line, odds }) => {
          if (!updated[teamKey]) updated[teamKey] = {};
          if (!updated[teamKey][statKey]) updated[teamKey][statKey] = {};
          if (!updated[teamKey][statKey][scope])
            updated[teamKey][statKey][scope] = {};
          if (!updated[teamKey][statKey][scope][period])
            updated[teamKey][statKey][scope][period] = {};
          updated[teamKey][statKey][scope][period][line] = odds;
        });
        return updated;
      });

      for (const { statKey, scope, period, line, odds } of tuples) {
        if (odds.over) {
          await recalculateBet(statKey, line, "över", odds.over, scope, period);
        }
        if (odds.under) {
          await recalculateBet(statKey, line, "under", odds.under, scope, period);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [unibetUrl, form, teamKey, recalculateBet]);

  async function onSubmit(e) {
    e.preventDefault();

    const home = firstForm.homeTeam;
    const away = firstForm.awayTeam;
    if (!home || !away) {
      setError(t("error_fill_teams"));
      return;
    }

    const currentBets = Object.keys(STAT_PATTERNS).flatMap((statKey) => {
      const thresholds = STAT_PATTERNS[statKey].thresholds(
        form[statKey].scope,
        form[statKey].period
      );
      return thresholds.flatMap((line) => {
        const oddsEntry =
          oddsStore[teamKey]?.[statKey]?.[form[statKey].scope]?.[form[statKey].period]?.[line] || {};
        return [
          oddsEntry.over && {
            statKey,
            line,
            direction: "över",
            odds: oddsEntry.over,
            scope: form[statKey].scope,
            period: form[statKey].period,
          },
          oddsEntry.under && {
            statKey,
            line,
            direction: "under",
            odds: oddsEntry.under,
            scope: form[statKey].scope,
            period: form[statKey].period,
          },
        ].filter(Boolean);
      });
    });

    if (!currentBets.length) {
      setError(t("error_fill_odds"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const responses = await Promise.all(
        currentBets.map((bet) =>
          fetch("/api/backtest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "expectedValue",
              homeTeam: form[bet.statKey].homeTeam,
              awayTeam: form[bet.statKey].awayTeam,
              over: bet.direction === "över",
              line: bet.line,
              scope: bet.scope,
              stat: bet.statKey,
              period: bet.period,
              form: form[bet.statKey].formMatches,
              odds: bet.odds,
              neutralGround,
              home_importance: form[bet.statKey].home_importance,
              away_importance: form[bet.statKey].away_importance,
            }),
          }).then((r) => {
            if (!r.ok) throw new Error(`Serverfel för lina ${bet.line}`);
            return r.json().then((data) => ({
              ...data,
              hitsOver: data.hitsOver || "0/0",
              hitsUnder: data.hitsUnder || "0/0",
              bet,
            }));
          })
        )
      );

      setResultsMap((prev) => {
        const updated = { ...prev };
        responses.forEach((res) => {
          const key = `${form[res.bet.statKey].homeTeam}-${form[res.bet.statKey].awayTeam}-${res.bet.statKey}-${res.bet.line}-${
            res.bet.direction
          }-${res.bet.scope}-${res.bet.period}-${form[res.bet.statKey].formMatches}-${neutralGround}`;
          updated[key] = {
            ...res,
            bet: {
              ...res.bet,
              key,
              homeTeam: form[res.bet.statKey].homeTeam,
              awayTeam: form[res.bet.statKey].awayTeam,
            },
          };
        });
        return updated;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const homeProfileKey = buildTeamProfileKeyForMatch(match, "home");
  const awayProfileKey = buildTeamProfileKeyForMatch(match, "away");

  const { data: homeProfileData } = useSWR(homeProfileKey, fetchTeamProfile);
  const { data: awayProfileData } = useSWR(awayProfileKey, fetchTeamProfile);

  const homeProfile = homeProfileData?.profile ?? null;
  const awayProfile = awayProfileData?.profile ?? null;

  const homeHomeCount = initData?.matches?.home?.home?.length ?? 0;
  const homeAwayCount = initData?.matches?.home?.away?.length ?? 0;
  const awayHomeCount = initData?.matches?.away?.home?.length ?? 0;
  const awayAwayCount = initData?.matches?.away?.away?.length ?? 0;
  const homeTeamLabel = firstForm.homeTeam || t("home");
  const awayTeamLabel = firstForm.awayTeam || t("away");

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: 24 }}>
      <h1 style={{ textAlign: "center", marginBottom: 24 }}>
        Backtest – {match?.homeTeamName} vs {match?.awayTeamName}
      </h1>
      <form onSubmit={onSubmit}>
        <div className="input-group" style={{ marginBottom: 16 }}>
          <label>🔗 Unibet URL:</label>
          <input
            type="text"
            placeholder={t("paste_unibet_url")}
            value={unibetUrl}
            onChange={(e) => setUnibetUrl(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", marginTop: 4 }}
          />
        </div>
        <button type="button" onClick={loadUnibetOdds} disabled={loading}>
          {t("load_odds")}
        </button>
        <div style={{ marginTop: 16, marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={neutralGround}
              onChange={handleNeutralGround}
            />
            {t("neutral_ground")}
          </label>
        </div>

        {Object.keys(STAT_PATTERNS).map((statKey) => {
          const chosenPeriod = form[statKey].period;
          const homeMetrics = readProfileMetric(
            homeProfile,
            "for",
            STAT_PATTERNS[statKey].rankKey || statKey,
            chosenPeriod
          );
          const homeAgainstMetrics = readProfileMetric(
            homeProfile,
            "against",
            STAT_PATTERNS[statKey].rankKey || statKey,
            chosenPeriod
          );
          const awayMetrics = readProfileMetric(
            awayProfile,
            "for",
            STAT_PATTERNS[statKey].rankKey || statKey,
            chosenPeriod
          );
          const awayAgainstMetrics = readProfileMetric(
            awayProfile,
            "against",
            STAT_PATTERNS[statKey].rankKey || statKey,
            chosenPeriod
          );

          let homeShotPct = null;
          let awayShotPct = null;
          if (statKey === "shotsOnGoal") {
            const totalHome = readProfileMetric(
              homeProfile,
              "for",
              "totalShotsOnGoal",
              chosenPeriod
            );
            const totalAway = readProfileMetric(
              awayProfile,
              "for",
              "totalShotsOnGoal",
              chosenPeriod
            );
            if (Number.isFinite(homeMetrics.value) && Number.isFinite(totalHome.value)) {
              homeShotPct = Math.round((homeMetrics.value / totalHome.value) * 100);
            }
            if (Number.isFinite(awayMetrics.value) && Number.isFinite(totalAway.value)) {
              awayShotPct = Math.round((awayMetrics.value / totalAway.value) * 100);
            }
          }

          return (
            <div key={statKey} style={{ marginBottom: 32 }}>
              <h2 style={{ marginBottom: 16 }}>
                {STAT_PATTERNS[statKey].displayName}
              </h2>
              <div
                style={{
                  fontSize: "0.9rem",
                  color: "#cccccc",
                  marginTop: "-4px",
                  marginBottom: "12px",
                  lineHeight: 1.4,
                  fontStyle: "italic",
                  textAlign: "center",
                }}
              >
                {form[statKey].homeTeam} rank {formatRank(homeMetrics.rank)} •
                {" "}
                {form[statKey].awayTeam} rank {formatRank(awayMetrics.rank)}
                {homeShotPct != null && ` • ${homeShotPct}% av totala skotten`}
                {awayShotPct != null && ` • ${awayShotPct}% av totala skotten`}
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <label>
                  {t("table_team")} ({t("home")}):
                  <input
                    type="text"
                    value={form[statKey].homeTeam}
                    onChange={handle(statKey, "homeTeam")}
                    style={{ width: "100%" }}
                  />
                </label>
                <label>
                  {t("table_team")} ({t("away")}):
                  <input
                    type="text"
                    value={form[statKey].awayTeam}
                    onChange={handle(statKey, "awayTeam")}
                    style={{ width: "100%" }}
                  />
                </label>
                <label>
                  Scope:
                  <select
                    value={form[statKey].scope}
                    onChange={handle(statKey, "scope")}
                  >
                    <option value="total">{t("scope_total")}</option>
                    <option value="home">{form[statKey].homeTeam || t("home")}</option>
                    <option value="away">{form[statKey].awayTeam || t("away")}</option>
                  </select>
                </label>
                <label>
                  {t("table_period")}:
                  <select
                    value={form[statKey].period}
                    onChange={handle(statKey, "period")}
                  >
                    <option value="ALL">{t("period_match")}</option>
                    <option value="1ST">{t("period_first_half")}</option>
                    <option value="2ND">{t("period_second_half")}</option>
                  </select>
                </label>
                <label>
                  {t("importance_home")}:
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={form[statKey].home_importance}
                    onChange={handle(statKey, "home_importance")}
                  />
                </label>
                <label>
                  {t("importance_away")}:
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={form[statKey].away_importance}
                    onChange={handle(statKey, "away_importance")}
                  />
                </label>
              </div>
              <OddsTable
                statKey={statKey}
                scope={form[statKey].scope}
                period={form[statKey].period}
                teamKey={teamKey}
                homeTeam={form[statKey].homeTeam}
                awayTeam={form[statKey].awayTeam}
                oddsStore={oddsStore}
                setOddsStore={setOddsStore}
                results={results}
                onRecalculate={recalculateBet}
                setHistoryTooltip={setHistoryTooltip}
                setHistoryPos={setHistoryPos}
                neutralGround={neutralGround}
                setTooltipThreshold={setTooltipThreshold}
                t={t}
                STAT_PATTERNS={STAT_PATTERNS}
              />
            </div>
          );
        })}

        <button type="submit" disabled={loading}>
          {loading ? "Kör…" : t("backtest_submit_label")}
        </button>
        {error && (
          <div style={{ color: "red", marginTop: 12 }}>{error}</div>
        )}
      </form>

      {initLoading && <p>Hämtar data…</p>}

      {!initLoading && initData && (
        <div
          style={{
            marginTop: 12,
            marginBottom: 24,
            fontSize: "0.85rem",
            color: "#cccccc",
          }}
        >
          {homeTeamLabel} hemma: {homeHomeCount} matcher · borta: {homeAwayCount}
          {" • "}
          {awayTeamLabel} hemma: {awayHomeCount} matcher · borta: {awayAwayCount}
        </div>
      )}

      {positiveResults.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2>Positiva EV-spel</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>{t("table_statistic")}</th>
                <th>{t("table_team")}</th>
                <th>{t("table_period")}</th>
                <th>{t("backtest_results_bet")}</th>
                <th>{t("table_odds")}</th>
                <th>{t("value")}</th>
              </tr>
            </thead>
            <tbody>
              {positiveResults.map((r) => {
                const periodKey = r.bet.period;
                const betDirectionLabel =
                  r.bet.direction === "över" ? t("over") : t("under");
                return (
                  <tr key={r.bet.key}>
                    <td>{STAT_PATTERNS[r.bet.statKey]?.displayName ?? r.bet.statKey}</td>
                    <td>
                      {r.bet.scope === "total"
                        ? "Total"
                        : r.bet.scope === "home"
                        ? r.bet.homeTeam
                        : r.bet.awayTeam}
                    </td>
                    <td>{t(periodKey)}</td>
                    <td>
                      {betDirectionLabel} {r.bet.line.toFixed(1)}
                    </td>
                    <td>{formatNumber(Number(r.bet.odds) || 0, 2)}</td>
                    <td>
                      {r.primaryLabel}: {r.primaryEv.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {historyTooltip && (
        <div
          style={{
            position: "fixed",
            top: historyPos.y + 12,
            left: historyPos.x + 12,
            background: "rgba(0,0,0,0.85)",
            color: "#fff",
            padding: "12px 16px",
            borderRadius: 8,
            maxWidth: 360,
            zIndex: 1000,
            whiteSpace: "pre-line",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: 4 }}>
            Historik för lina {tooltipThreshold}
          </div>
          {historyTooltip}
        </div>
      )}
    </div>
  );
}
