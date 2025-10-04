


import {
  useState,
  useContext,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { LeaguesAndTeamsContext } from "../LeaguesAndTeamsContext.js";
import TeamSelector from "../components/TeamSelector.js";
import { useTranslation } from "../LanguageContext.js";
import "../BacktestPage.css";
import mapUnibetOdds from "../utils/unibetOddsMapper.js";

const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

const getStatPatterns = (t) => ({
  totalShots: {
    displayName: t("stat_total_shots"),
    rankKey: "totalShotsOnGoal",
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL")
          return [20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5];
        if (period === "1ST") return [8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5];  
        if (period === "2ND") return [8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5];
      } else {
        if (period === "ALL") return [8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5];
        if (period === "1ST") return [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5];
        if (period === "2ND") return [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5];
      }
      return [];
    },
  },
  shotsOnGoal: {
    displayName: t("stat_total_shots_on_target"),
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL") return [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5];
        if (period === "1ST") return [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
        if (period === "2ND") return [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
      } else {
        if (period === "ALL") return [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
        if (period === "1ST") return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
        if (period === "2ND") return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
      }
      return [];
    },
  },
  cornerKicks: {
    displayName: t("stat_corner_kicks"),
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL") return [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5];
        if (period === "1ST") return [4.5, 5.5, 6.5, 7.5, 8.5, 9.5];
        if (period === "2ND") return [4.5, 5.5, 6.5, 7.5, 8.5, 9.5];
      } else {
        if (period === "ALL") return [4.5, 5.5, 6.5, 7.5, 8.5, 9.5];
        if (period === "1ST") return [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
        if (period === "2ND") return [2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
      }
      return [];
    },
  },
  yellowCards: {
    displayName: t("stat_yellow_cards"),
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL") return [3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
        if (period === "1ST") return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
        if (period === "2ND") return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
      } else {
        if (period === "ALL") return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
        if (period === "1ST") return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
        if (period === "2ND") return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
      }
      return [];
    },
  },
  throwIns: {
    displayName: t("stat_throw_ins"),
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL") return [25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5];
        if (period === "1ST") return [15.5, 16.5, 17.5, 18.5, 19.5, 20.5];
        if (period === "2ND") return [15.5, 16.5, 17.5, 18.5, 19.5, 20.5];
      } else {
        if (period === "ALL") return [15.5, 16.5, 17.5, 18.5, 19.5, 20.5];
        if (period === "1ST") return [7.5, 8.5, 9.5, 10.5, 11.5, 12.5];
        if (period === "2ND") return [7.5, 8.5, 9.5, 10.5, 11.5, 12.5];
      }
      return [];
    },
  },
  freeKicks: {
    displayName: t("stat_free_kicks"),
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL")
          return [
            20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5,
          ];
        if (period === "1ST") return [10.5, 11.5, 12.5, 13.5, 14.5, 15.5];
        if (period === "2ND") return [10.5, 11.5, 12.5, 13.5, 14.5, 15.5];
      } else {
        if (period === "ALL") return [10.5, 11.5, 12.5, 13.5, 14.5, 15.5];
        if (period === "1ST") return [5.5, 6.5, 7.5, 8.5, 9.5, 10.5];
        if (period === "2ND") return [5.5, 6.5, 7.5, 8.5, 9.5, 10.5];
      }
      return [];
    },
  },
  fouls: {
    displayName: t("stat_fouls"),
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL")
          return [19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5];
        if (period === "1ST") return [9.5, 10.5, 11.5, 12.5, 13.5];
        if (period === "2ND") return [9.5, 10.5, 11.5, 12.5, 13.5];
      } else {
        if (period === "ALL") return [9.5, 10.5, 11.5, 12.5, 13.5, 14.5];
        if (period === "1ST") return [4.5, 5.5, 6.5, 7.5, 8.5];
        if (period === "2ND") return [4.5, 5.5, 6.5, 7.5, 8.5];
      }
      return [];
    },
  },
  totalTackle: {
    displayName: t("stat_tackles"),
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL")
          return [21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5];
        if (period === "1ST") return [10.5, 11.5, 12.5, 13.5, 14.5];
        if (period === "2ND") return [10.5, 11.5, 12.5, 13.5, 14.5];
      } else {
        if (period === "ALL") return [9.5, 10.5, 11.5, 12.5, 13.5, 14.5];
        if (period === "1ST") return [4.5, 5.5, 6.5, 7.5, 8.5];
        if (period === "2ND") return [4.5, 5.5, 6.5, 7.5, 8.5];
      }
      return [];
    },
  },
  offsides: {
    displayName: t("stat_offsides"),
    thresholds: (scope, period) => {
      if (scope === "total") {
        if (period === "ALL") return [2.5, 3.5, 4.5, 5.5, 6.5];
        if (period === "1ST") return [0.5, 1.5, 2.5, 3.5];
        if (period === "2ND") return [0.5, 1.5, 2.5, 3.5];
      } else {
        if (period === "ALL") return [1.5, 2.5, 3.5, 4.5];
        if (period === "1ST") return [0.5, 1.5, 2.5];
        if (period === "2ND") return [0.5, 1.5, 2.5];
      }
      return [];
    },
  },
});

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
  STAT_PATTERNS
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
    }, 2000);
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
    } else {
      const hitsFor = direction === "över" ? result.hitsOver : result.hitsUnder;
      const hitsAgainst = result.hitsAgainst || "0/0";
      if (direction === "under") {
        return hitsAgainst ? ` ${hitsAgainst}` : "-";
      }
      return hitsFor ? `${hitsFor} matcher` : "-";
    }
  };

  const getOffsidesForSide = (match, side) => {
    if (!match || !side) return null;
    const candidates = [
      match.offsides,
      match.offside,
      match.stats?.offsides,
      match.extraStats?.offsides,
      match.additionalStats?.offsides,
      match.allStats?.offsides,
    ];

    for (const candidate of candidates) {
      if (candidate == null) continue;
      if (typeof candidate === "number") {
        return candidate;
      }
      if (typeof candidate === "object") {
        const value = candidate[side];
        if (typeof value === "number") {
          return value;
        }
      }
    }

    return null;
  };

  const formatStatValue = (match, value, teamType) => {
    if (statKey === "freeKicks" && typeof value === "number") {
      if (teamType === "total") {
        const homeValue = match?.stat?.home;
        const awayValue = match?.stat?.away;
        if (typeof homeValue === "number" && typeof awayValue === "number") {
          return `${value}`;
        }
        return `${value}`;
      }

      const opponentSide = teamType === "home" ? "away" : "home";
      const opponentOffsides = getOffsidesForSide(match, opponentSide);
      if (typeof opponentOffsides === "number") {
        const baseFreeKicks = value - opponentOffsides;
        if (Number.isFinite(baseFreeKicks)) {
          return `${value} (${baseFreeKicks} + ${opponentOffsides} offsides)`;
        }
        return `${value}`;
      }
      return `${value}`;
    }

    let adjustedValue = value;

    if (
      statKey === "shotsOnGoal" &&
      match.totalShots &&
      typeof adjustedValue === "number"
    ) {
      const total = match.totalShots[teamType];
      if (typeof total === "number" && total > 0) {
        const pct = Math.round((adjustedValue / total) * 100);
        return `${adjustedValue} (${pct}%)`;
      }
    }
    return adjustedValue;
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
    } else if (scope === "home") {
      return result.homeMatches
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
    return "";
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
    } else if (scope === "home") {
      return result.awayMatches
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

  const thresholds = STAT_PATTERNS[statKey].thresholds(scope, period);

  const getHistoryContent = (line, isOver, neutralGround) => {
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
      if (neutralGround) {
        if (isOver) {
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
        } else {
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
      } else {
        if (isOver) {
          return result.homeMatches
            .map(
              (m) =>
                `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
                  m,
                  m.stat.home,
                  "home"
                )}`
            )
            .join("\n");
        } else {
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
      }
    }

    if (scope === "away") {
      if (neutralGround) {
        if (isOver) {
          return result.awayMatches
            .map(
              (m) =>
                `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
                  m,
                  m.stat.away,
                  "away"
                )}`
            )
            .join("\n");
        } else {
          return result.homeMatches
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
      } else {
        if (isOver) {
          return result.awayMatches
            .map(
              (m) =>
                `${m.homeTeam} vs ${m.awayTeam}: ${formatStatValue(
                  m,
                  m.stat.away,
                  "away"
                )}`
            )
            .join("\n");
        } else {
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
      }
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
          <tr key={line} style={{ borderTop: "1px solid #444" }}>
            <td>{line}</td>
            <td title={getTooltipForOver(line)}>
              <input
                type="number"
                step="0.01"
                placeholder={t("over")}
                value={
                  oddsStore[teamKey]?.[statKey]?.[scope]?.[period]?.[line]
                    ?.over || ""
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
                  oddsStore[teamKey]?.[statKey]?.[scope]?.[period]?.[line]
                    ?.under || ""
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
                  const content = getHistoryContent(line, true, neutralGround);
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
                  const content = getHistoryContent(line, false, neutralGround);
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
                {opponentName !== "Under" && " conceded"}:
                {getMatchesForLineAndDirection(line, "under")}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function BacktestPage() {
  const leagues = useContext(LeaguesAndTeamsContext);
  const teamSelectorRef = useRef();
  const { t, language } = useTranslation();
  const STAT_PATTERNS = getStatPatterns(t);

  const [form, setForm] = useState(
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

  // Håller rankingdata för alla ligor och valda lagens liganamn
  const [leagueRankings, setLeagueRankings] = useState(null);
  const [homeLeagueName, setHomeLeagueName] = useState(null);
  const [awayLeagueName, setAwayLeagueName] = useState(null);

  const teamKey =
    Object.values(form)[0].homeTeam && Object.values(form)[0].awayTeam
      ? `${Object.values(form)[0].homeTeam}-${Object.values(form)[0].awayTeam}`
      : "default";

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
  }, [form, teamKey]);

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

  const saveBacktest = async (lines, homeTeam, awayTeam, matchDate) => {
    const isLocal = window.location.hostname === "localhost";
    const backendUrl = isLocal
      ? "http://localhost:5000/save-backtest"
      : "https://bettingmodel-backend.onrender.com/save-backtest";
    try {
      await fetch(backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeTeam, awayTeam, matchDate, lines, url: unibetUrl }),
      });
      console.log("Backtest saved");
    } catch (err) {
      console.error("Failed to save backtest", err);
    }
  };

  const loadUnibetOdds = async () => {
    const matchIdMatch = unibetUrl.match(/event\/(\d+)/);
    const matchId = matchIdMatch ? matchIdMatch[1] : null;
    if (!matchId) return;
    const isLocal = window.location.hostname === "localhost";
    const backendUrl = isLocal
      ? `http://localhost:5000/unibet-odds/${matchId}`
      : `https://bettingmodel-backend.onrender.com/unibet-odds/${matchId}`;
    try {
      setLoading(true);
      const res = await fetch(backendUrl);
      if (!res.ok) throw new Error("Failed to load odds");
      const data = await res.json();
      const homeTeam = Object.values(form)[0].homeTeam;
      const awayTeam = Object.values(form)[0].awayTeam;
      const matchDate = data.meta?.eventDate
        ? new Date(data.meta.eventDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
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
      const linesToSave = [];
      const collectEvDetails = (result) => ({
        evPctWithMultiplier:
          typeof result.evPctWithMultiplier === "number"
            ? result.evPctWithMultiplier
            : null,
        evPctMultifactor:
          typeof result.evPctMultifactor === "number"
            ? result.evPctMultifactor
            : null,
        evPctLeagueAvg:
          typeof result.evPctLeagueAvg === "number"
            ? result.evPctLeagueAvg
            : null,
        evPct: typeof result.evPct === "number" ? result.evPct : null,
        legacyEvPct:
          typeof result.legacyEvPct === "number"
            ? result.legacyEvPct
            : null,
      });

      const resolvePrimaryEvValue = (evDetails) => {
        if (!evDetails) return null;
        const preferredOrder = [
          "evPctWithMultiplier",
          "evPctMultifactor",
          "evPctLeagueAvg",
          "evPct",
          "legacyEvPct",
        ];
        for (const key of preferredOrder) {
          const value = evDetails[key];
          if (typeof value === "number") {
            return value;
          }
        }
        return null;
      };

      for (const { statKey, scope, period, line, odds } of tuples) {
        if (odds.over) {
          const r = await recalculateBet(
            statKey,
            line,
            "över",
            odds.over,
            scope,
            period
          );
          if (r) {
            const evDetails = collectEvDetails(r);
            linesToSave.push({
              statKey: r.bet.statKey,
              line: r.bet.line,
              condition: r.bet.direction,
              period: r.bet.period,
              scope: r.bet.scope,
              odds: r.bet.odds,
              value: resolvePrimaryEvValue(evDetails),
              ...evDetails,
              evDetails,
              homeTeam,
              awayTeam,
            });
          }
        }
        if (odds.under) {
          const r = await recalculateBet(
            statKey,
            line,
            "under",
            odds.under,
            scope,
            period
          );
          if (r) {
            const evDetails = collectEvDetails(r);
            linesToSave.push({
              statKey: r.bet.statKey,
              line: r.bet.line,
              condition: r.bet.direction,
              period: r.bet.period,
              scope: r.bet.scope,
              odds: r.bet.odds,
              value: resolvePrimaryEvValue(evDetails),
              ...evDetails,
              evDetails,
              homeTeam,
              awayTeam,
            });
          }
        }
      }
      await saveBacktest(linesToSave, homeTeam, awayTeam, matchDate);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const recalculateBet = async (
    statKey,
    line,
    direction,
    odds,
    scopeOverride,
    periodOverride
  ) => {
    const formForStat = form[statKey];
    if (!formForStat.homeTeam || !formForStat.awayTeam) {
      setError(t("error_fill_teams"));
      return;
    }
    setLoading(true);
    setError(null);

    const isLocal = window.location.hostname === "localhost";
    const pathSeg2 = window.location.pathname.includes("backtest-copy")
      ? "expected-value-copy"
      : "expected-value";
    const backendUrl = isLocal
      ? `http://localhost:5000/${pathSeg2}`
      : `https://bettingmodel-backend.onrender.com/${pathSeg2}`;
      
      
    try {
      const res = await fetch(backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Serverfel för lina ${line} (${statKey})`);
      const data = await res.json();
      const betKey = `${formForStat.homeTeam}-${formForStat.awayTeam}-${statKey}-${line}-${direction}-${scopeOverride || formForStat.scope}-${
        periodOverride || formForStat.period
      }-${formForStat.formMatches}-${neutralGround}`;

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
    } finally {
      setLoading(false);
    }
  };

  async function onSubmit(e) {
    e.preventDefault();
    if (!teamSelectorRef.current?.submitTeams()) return;

    handleTeams({}, async (updatedForm) => {
      const home = updatedForm[Object.keys(updatedForm)[0]].homeTeam;
      const away = updatedForm[Object.keys(updatedForm)[0]].awayTeam;
      if (!home || !away) {
        setError(t("error_fill_teams"));
        return;
      }

      // 1) Identifiera vilken liga varje lag tillhör
      const findLeagueForTeam = (team) => {
        for (const [leagueName, leagueInfo] of Object.entries(leagues)) {
          const teamNames = leagueInfo.teams.map((t) => t.name);
          if (teamNames.includes(team)) {
            return leagueName;
          }
        }
        return null;
      };

      const homeLeague = findLeagueForTeam(home);
      const awayLeague = findLeagueForTeam(away);

      if (!homeLeague || !awayLeague) {
        setError(t("error_no_league"));
        return;
      }

      setHomeLeagueName(homeLeague);
      setAwayLeagueName(awayLeague);

      const isLocal = window.location.hostname === "localhost";

      const rankings = isLocal
        ? "http://localhost:5000/league_ranking.json"
        : "https://bettingmodel-backend.onrender.com/league_ranking.json";

      // 2) Hämta hela league_ranking.json från servern
      try {
        const rankingRes = await fetch(rankings);
        if (!rankingRes.ok) {
          throw new Error("Misslyckades ladda rankingdata från servern");
        }
        const allRankings = await rankingRes.json();
        setLeagueRankings(allRankings);
      } catch (err) {
        console.error("Error vid inläsning av ranking:", err);
        setError(t("error_load_ranking") + err.message);
        return;
      }

      // 3) Skicka alla backtest‐anrop som tidigare
      const currentBets = Object.keys(STAT_PATTERNS).flatMap((statKey) => {
        const f = updatedForm[statKey];
        const statOdds = oddsStore[`${home}-${away}`]?.[statKey] || {};
        return Object.entries(statOdds).flatMap(([scope, periods]) =>
          Object.entries(periods).flatMap(([period, lines]) =>
            Object.entries(lines).flatMap(([line, odds]) => {
              const lineNum = parseFloat(line);
              return [
                odds.over && {
                  statKey,
                  line: lineNum,
                  direction: "över",
                  odds: odds.over,
                  scope,
                  period,
                },
                odds.under && {
                  statKey,
                  line: lineNum,
                  direction: "under",
                  odds: odds.under,
                  scope,
                  period,
                },
              ]
                .filter(Boolean)
                .map((bet) => ({
                  ...bet,
                  form: f,
                  key: `${home}-${away}-${bet.statKey}-${bet.line}-${bet.direction}-${bet.scope}-${bet.period}-${f.formMatches}-${neutralGround}`,
                }));
            })
          )
        );
      });

      if (currentBets.length === 0) {
        setError(t("error_fill_odds"));
        return;
      }

      setLoading(true);
      setError(null);

      const pathSeg = window.location.pathname.includes("backtest-copy")
        ? "expected-value-copy"
        : "expected-value";
      const evUrl = isLocal
        ? `http://localhost:5000/${pathSeg}`
        : `https://bettingmodel-backend.onrender.com/${pathSeg}`;

      try {
        const responses = await Promise.all(
          currentBets.map((bet) =>
            fetch(evUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                homeTeam: bet.form.homeTeam,
                awayTeam: bet.form.awayTeam,
                over: bet.direction === "över",
                line: bet.line,
                scope: bet.scope,
                stat: bet.statKey,
                period: bet.period,
                form: bet.form.formMatches,
                odds: bet.odds,
                neutralGround,
                home_importance: bet.form.home_importance,
                away_importance: bet.form.away_importance,
              }),
              credentials: "include",
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
            updated[res.bet.key] = res;
          });
          return updated;
        });
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    });
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <h1 style={{ textAlign: "center", marginBottom: 24 }}>Back-testa spel</h1>
      <TeamSelector ref={teamSelectorRef} onSubmit={handleTeams} />
      <div className="input-group">
        <label>🔗 Unibet URL:</label>
        <input
          type="text"
          placeholder={t("paste_unibet_url")}
          value={unibetUrl}
          onChange={(e) => setUnibetUrl(e.target.value)}
        />
      </div>
      <button type="button" onClick={loadUnibetOdds}>
        {t("load_odds")}
      </button>
      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "1.5rem",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: "1rem",
              color: "#fff",
            }}
          >
            <input
              type="checkbox"
              checked={neutralGround}
              onChange={handleNeutralGround}
              style={{
                width: "1.2rem",
                height: "1.2rem",
                accentColor: "#3b82f6",
                cursor: "pointer",
              }}
            />
          <span>Neutral plan</span>
          </label>
        </div>
      </div>
      {positiveResults.length > 0 && (
        <div className="top-ev-list">
          <h2>Alla +EV</h2>

          <table className="positive-ev-table">
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
                const statName = statNames[r.bet.statKey] || r.bet.statKey;
                const teamName =
                  r.bet.scope === "home"
                    ? r.bet.homeTeam
                    : r.bet.scope === "away"
                    ? r.bet.awayTeam
                    : `${r.bet.homeTeam} - ${r.bet.awayTeam}`;
                const periodKey =
                  r.bet.period === "ALL"
                    ? "period_match"
                    : r.bet.period === "1ST"
                    ? "period_first_half"
                    : "period_second_half";
                const direction =
                  r.bet.direction === "över" ? t("over") : t("under");
                return (
                  <tr key={r.bet.key}>
                    <td>{statName}</td>
                    <td>{teamName}</td>
                    <td>{t(periodKey)}</td>
                    <td>
                      {direction} {r.bet.line}
                    </td>
                    <td>{r.bet.odds}</td>
                    <td>
                      {r.primaryEv.toFixed(1)}%
                      {r.primaryLabel ? ` (${r.primaryLabel})` : ""}
                      {typeof r.evPctWithMultiplier === "number" &&
                        r.primaryLabel !== t("ev_multiplier_short") && (
                          <div style={{ fontSize: "0.8em", opacity: 0.8 }}>
                            {`${r.evPctWithMultiplier.toFixed(1)}% (${t(
                              "ev_multiplier_label"
                            )})`}
                          </div>
                        )}
                      {typeof r.evPctMultifactor === "number" &&
                        r.primaryLabel !== t("ev_multifactor_short") && (
                          <div style={{ fontSize: "0.8em", opacity: 0.8 }}>
                            {`${r.evPctMultifactor.toFixed(1)}% (${t(
                              "ev_multifactor_label"
                            )})`}
                          </div>
                        )}
                      {typeof r.evPctLeagueAvg === "number" &&
                        r.primaryLabel !== t("ev_league_avg_short") && (
                          <div style={{ fontSize: "0.8em", opacity: 0.8 }}>
                            {`${r.evPctLeagueAvg.toFixed(1)}% (${t(
                              "ev_league_avg_label"
                            )})`}
                          </div>
                        )}
                      {typeof r.evPct === "number" &&
                        r.primaryLabel !== t("ev_model_label") && (
                          <div style={{ fontSize: "0.8em", opacity: 0.8 }}>
                            {`${r.evPct.toFixed(1)}% (${t("ev_model_label")})`}
                          </div>
                        )}
                      {typeof r.legacyEvPct === "number" &&
                        r.primaryLabel !== t("ev_legacy_label") && (
                          <div style={{ fontSize: "0.8em", opacity: 0.8 }}>
                            {`${r.legacyEvPct.toFixed(1)}% (${t(
                              "ev_legacy_label"
                            )})`}
                          </div>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

        </div>
      )}
      <form
        onSubmit={onSubmit}
        style={{ display: "grid", gap: 24, marginTop: 24 }}
      >
        <div className="team-importance">
          <label>
            Hemmalagets importance
            <input
              type="range"
              min="1"
              max="10"
              value={Object.values(form)[0].home_importance}
              onChange={handle(Object.keys(form)[0], "home_importance")}
              style={{
                width: "180px",
                height: "6px",
                appearance: "none",
                background: "linear-gradient(to right, #ffffff, #1e90ff)",
                borderRadius: "3px",
                border: "none",
                outline: "none",
              }}
            />
          </label>
          <label>
            Bortalagets importance
            <input
              type="range"
              min="1"
              max="10"
              value={Object.values(form)[0].away_importance}
              onChange={handle(Object.keys(form)[0], "away_importance")}
              style={{
                width: "180px",
                height: "6px",
                appearance: "none",
                background: "linear-gradient(to right, #ffffff, #1e90ff)",
                borderRadius: "3px",
                border: "none",
                outline: "none",
              }}
            />
          </label>
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "Kör…" : "Kör backtest"}
        </button>
        {Object.keys(STAT_PATTERNS).map((statKey) => {
          const chosenPeriod = form[statKey].period; // “ALL”, “1ST” eller “2ND”
          let homeForRank = "-";
          let homeAgainstRank = "-";
          let awayForRank = "-";
          let awayAgainstRank = "-";

          let homeForValue = null;
          let homeAgainstValue = null;
          let awayForValue = null;
          let awayAgainstValue = null;

          let homeForPct = null;
          let homeAgainstPct = null;
          let awayForPct = null;
          let awayAgainstPct = null;

          let homeForRaw = null;
          let homeAgainstRaw = null;
          let awayForRaw = null;
          let awayAgainstRaw = null;

          // console.log(
          //   "Renderar statKey:",
          //   statKey,
          //   "leagueRanking:",
          //   leagueRanking
          // );

          if (leagueRankings && homeLeagueName && awayLeagueName) {
            // Välj rätt nyckel i JSON (antingen rankKey eller statKey)
            const keyForRanking = STAT_PATTERNS[statKey].rankKey || statKey;

            // Hämta rankinglistor för båda ligorna
            const homeLeagueObj = leagueRankings.find(
              (x) => x.league === homeLeagueName
            );
            const awayLeagueObj = leagueRankings.find(
              (x) => x.league === awayLeagueName
            );

            const homeForList =
              homeLeagueObj?.ranking[keyForRanking]?.for?.[chosenPeriod] || [];
            const homeAgainstList =
              homeLeagueObj?.ranking[keyForRanking]?.against?.[chosenPeriod] || [];
            const awayForList =
              awayLeagueObj?.ranking[keyForRanking]?.for?.[chosenPeriod] || [];
            const awayAgainstList =
              awayLeagueObj?.ranking[keyForRanking]?.against?.[chosenPeriod] || [];

            const homeForEntry =
              homeForList.find((x) => x.team === form[statKey].homeTeam) || {};
            const homeAgainstEntry =
              homeAgainstList.find((x) => x.team === form[statKey].homeTeam) || {};
            const awayForEntry =
              awayForList.find((x) => x.team === form[statKey].awayTeam) || {};
            const awayAgainstEntry =
              awayAgainstList.find((x) => x.team === form[statKey].awayTeam) || {};

            homeForRank = homeForEntry.home_rank ?? "-";
            homeAgainstRank = homeAgainstEntry.home_rank ?? "-";
            awayForRank = awayForEntry.away_rank ?? "-";
            awayAgainstRank = awayAgainstEntry.away_rank ?? "-";

            homeForValue =
              homeForEntry.home_adjustedValue ?? homeForEntry.home_rawValue ?? null;
            homeAgainstValue =
              homeAgainstEntry.home_adjustedValue ??
              homeAgainstEntry.home_rawValue ??
              null;
            awayForValue =
              awayForEntry.away_adjustedValue ?? awayForEntry.away_rawValue ?? null;
            awayAgainstValue =
              awayAgainstEntry.away_adjustedValue ??
              awayAgainstEntry.away_rawValue ??
              null;

            homeForRaw = homeForEntry.home_rawValue ?? null;
            homeAgainstRaw = homeAgainstEntry.home_rawValue ?? null;
            awayForRaw = awayForEntry.away_rawValue ?? null;
            awayAgainstRaw = awayAgainstEntry.away_rawValue ?? null;

            if (statKey === "shotsOnGoal") {
              const totalHomeForList =
                homeLeagueObj?.ranking["totalShotsOnGoal"]?.for?.[chosenPeriod] || [];
              const totalHomeAgainstList =
                homeLeagueObj?.ranking["totalShotsOnGoal"]?.against?.[chosenPeriod] || [];
              const totalAwayForList =
                awayLeagueObj?.ranking["totalShotsOnGoal"]?.for?.[chosenPeriod] || [];
              const totalAwayAgainstList =
                awayLeagueObj?.ranking["totalShotsOnGoal"]?.against?.[chosenPeriod] || [];

              const homeTotalFor =
                totalHomeForList.find((x) => x.team === form[statKey].homeTeam);
              const homeTotalAgainst =
                totalHomeAgainstList.find((x) => x.team === form[statKey].homeTeam);
              const awayTotalFor =
                totalAwayForList.find((x) => x.team === form[statKey].awayTeam);
              const awayTotalAgainst =
                totalAwayAgainstList.find((x) => x.team === form[statKey].awayTeam);

              const homeTotalForVal =
                homeTotalFor?.home_adjustedValue ?? homeTotalFor?.home_rawValue;
              const homeTotalAgainstVal =
                homeTotalAgainst?.home_adjustedValue ??
                homeTotalAgainst?.home_rawValue;
              const awayTotalForVal =
                awayTotalFor?.away_adjustedValue ?? awayTotalFor?.away_rawValue;
              const awayTotalAgainstVal =
                awayTotalAgainst?.away_adjustedValue ??
                awayTotalAgainst?.away_rawValue;

              if (homeForValue != null && homeTotalForVal) {
                homeForPct = Math.round(
                  (homeForValue / homeTotalForVal) * 100
                );
              }
              if (homeAgainstValue != null && homeTotalAgainstVal) {
                homeAgainstPct = Math.round(
                  (homeAgainstValue / homeTotalAgainstVal) * 100
                );
              }
              if (awayForValue != null && awayTotalForVal) {
                awayForPct = Math.round(
                  (awayForValue / awayTotalForVal) * 100
                );
              }
              if (awayAgainstValue != null && awayTotalAgainstVal) {
                awayAgainstPct = Math.round(
                  (awayAgainstValue / awayTotalAgainstVal) * 100
                );
              }
            }

            // console.log(
            //   `StatKey=${statKey}, Period=${chosenPeriod}, ` +
            //     `Home for=${homeForRank}, Home against=${homeAgainstRank}, ` +
            //     `Away for=${awayForRank}, Away against=${awayAgainstRank}`
            // );
          }

          return (
            <div key={statKey} style={{ marginBottom: 32 }}>
              <h2 style={{ marginBottom: 16 }}>
                {STAT_PATTERNS[statKey].displayName}
              </h2>
              <div>
                {/* {leagueRankings && (
                  <>
                    ({form[statKey].homeTeam} attack-rank - {homeForRank},{" "}
                    {form[statKey].homeTeam} concede-rank - {homeAgainstRank};{" "}
                    {form[statKey].awayTeam} attackrank - {awayForRank},{" "}
                    {form[statKey].awayTeam} concede-rank - {awayAgainstRank})
                  </>
                )} */}
                {leagueRankings && homeLeagueName && awayLeagueName && (
                  <div
                    style={{
                      fontSize: "1rem",
                      color: "#cccccc",
                      marginTop: "-4px",
                      marginBottom: "12px",
                      lineHeight: 1.4,
                      fontStyle: "italic",
                      textAlign: "center",
                    }}
                  >
                    {(() => {
                      const parseRank = (r) => {
                        const n = parseInt(r, 10);
                        return isNaN(n) ? null : n;
                      };

                      const getForColor = (rankStr) => {
                        const n = parseRank(rankStr);
                        if (n === null) return "inherit";
                        if (n >= 1 && n <= 6) return "green";
                        if (n >= 14 && n <= 24) return "red";
                        return "yellow";
                      };

                      const getAgainstColor = (rankStr) => {
                        const n = parseRank(rankStr);
                        if (n === null) return "inherit";
                        if (n >= 1 && n <= 6) return "red";
                        if (n >= 14 && n <= 24) return "green";
                        return "yellow";
                      };

                      const homeForColor = getForColor(homeForRank);
                      const homeAgainstColor = getAgainstColor(homeAgainstRank);
                      const awayForColor = getForColor(awayForRank);
                      const awayAgainstColor = getAgainstColor(awayAgainstRank);

                      return (
                        <>
                          {/* Hemmalag på egen rad */}
                          <div style={{ marginBottom: "4px" }}>
                            {form[statKey].homeTeam} attack-rank:{" "}
                            <span
                              style={{
                                color: homeForColor,
                                marginRight: "10px",
                              }}
                              title={
                                homeForRaw != null
                                  ? `raw: ${homeForRaw.toFixed(2)}`
                                  : undefined
                              }
                            >
                              {homeForRank}
                              {homeForPct != null
                                ? ` (${homeForPct}%)`
                                : homeForValue != null
                                ? ` (${homeForValue.toFixed(2)})`
                                : ""}
                            </span>
                            {form[statKey].homeTeam} concede-rank:{" "}
                            <span
                              style={{ color: homeAgainstColor }}
                              title={
                                homeAgainstRaw != null
                                  ? `raw: ${homeAgainstRaw.toFixed(2)}`
                                  : undefined
                              }
                            >
                              {homeAgainstRank}
                              {homeAgainstPct != null
                                ? ` (${homeAgainstPct}%)`
                                : homeAgainstValue != null
                                ? ` (${homeAgainstValue.toFixed(2)})`
                                : ""}
                            </span>
                          </div>

                          {/* Bortalag på egen rad */}
                          <div>
                            {form[statKey].awayTeam} attack-rank:{" "}
                            <span
                              style={{
                                color: awayForColor,
                                marginRight: "10px",
                              }}
                              title={
                                awayForRaw != null
                                  ? `raw: ${awayForRaw.toFixed(2)}`
                                  : undefined
                              }
                            >
                              {awayForRank}
                              {awayForPct != null
                                ? ` (${awayForPct}%)`
                                : awayForValue != null
                                ? ` (${awayForValue.toFixed(2)})`
                                : ""}
                            </span>
                            {form[statKey].awayTeam} concede-rank:{" "}
                            <span
                              style={{ color: awayAgainstColor }}
                              title={
                                awayAgainstRaw != null
                                  ? `raw: ${awayAgainstRaw.toFixed(2)}`
                                  : undefined
                              }
                            >
                              {awayAgainstRank}
                              {awayAgainstPct != null
                                ? ` (${awayAgainstPct}%)`
                                : awayAgainstValue != null
                                ? ` (${awayAgainstValue.toFixed(2)})`
                                : ""}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <select
                  value={form[statKey].scope}
                  onChange={handle(statKey, "scope")}
                >
                  <option value="total">{t("scope_total")}</option>
                  <option value="home">
                    {form[statKey].homeTeam || t("home")}
                  </option>
                  <option value="away">
                    {form[statKey].awayTeam || t("away")}
                  </option>
                </select>
                <select
                  value={form[statKey].period}
                  onChange={handle(statKey, "period")}
                >
                  <option value="ALL">{t("period_match")}</option>
                  <option value="1ST">{t("period_first_half")}</option>
                  <option value="2ND">{t("period_second_half")}</option>
                </select>
                <input
                  placeholder='Form ("all" eller antal)'
                  value={form[statKey].formMatches}
                  onChange={handle(statKey, "formMatches")}
                />
              </div>
              <OddsTable
                statKey={statKey}
                scope={form[statKey].scope}
                period={form[statKey].period}
                homeTeam={form[statKey].homeTeam}
                awayTeam={form[statKey].awayTeam}
                teamKey={teamKey}
                oddsStore={oddsStore}
                setOddsStore={setOddsStore}
                results={results.filter(
                  (r) =>
                    r.bet.statKey === statKey &&
                    r.bet.scope === form[statKey].scope &&
                    r.bet.period === form[statKey].period &&
                    r.bet.key.includes(teamKey)
                )}
                onRecalculate={recalculateBet}
                setHistoryTooltip={setHistoryTooltip}
                setHistoryPos={setHistoryPos}
                neutralGround={neutralGround}
                setTooltipThreshold={setTooltipThreshold}
                STAT_PATTERNS={STAT_PATTERNS}
  t={t}
              />
            </div>
          );
        })}
      </form>
      {error && <p style={{ color: "#b91c1c", marginTop: 24 }}>{error}</p>}

      {historyTooltip && (
        <div
          className="hover-tooltip"
          style={{
            position: "fixed",
            top: historyPos.y + 10,
            left: historyPos.x + 10,
            backgroundColor: "#222",
            color: "#fff",
            padding: "8px",
            borderRadius: "4px",
            zIndex: 1000,
            fontSize: "0.85rem",
            maxWidth: "300px",
          }}
        >
          {historyTooltip.split("\n").map((entry, index) => {
            const parts = entry.split(": ");
            const label = parts[0]?.trim() || "";
            const valueStr = parts[1]?.trim() || "";
            const valueNum = parseFloat(valueStr);

            const isOverThreshold =
              tooltipThreshold != null &&
              !isNaN(valueNum) &&
              valueNum > tooltipThreshold;

            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  width: "100%",
                  marginBottom: "4px",
                }}
              >
                <span style={{ flex: "1", textAlign: "left" }}>{label}</span>
                {valueStr && (
                  <span
                    style={{
                      textAlign: "right",
                      marginLeft: "5px",
                      color: isOverThreshold ? "green" : "red",
                    }}
                  >
                    {valueStr}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
