import { useMemo, useRef } from "react";
import { collectEvMetrics } from "./formulas";
import { formatPercent } from "./utils";
import { logClientBacktestStep } from "@/lib/backtest/logger";

function formatLineKey(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value ?? "");
}

function findResult(results, predicate) {
  if (!Array.isArray(results)) {
    logClientBacktestStep("OddsTabellen får inga resultat att matcha mot.", { results });
    return null;
  }
  const match = results.find(predicate) ?? null;
  logClientBacktestStep("OddsTabellen letar efter beräknat resultat.", {
    hasMatch: Boolean(match),
  });
  return match;
}

function formatStatValue({ match, value, teamType, statKey }) {
  if (value == null) return "-";

  if (statKey === "freeKicks" && typeof value === "number") {
    if (teamType === "total") {
      return String(value);
    }
    const opponentSide = teamType === "home" ? "away" : "home";
    const candidate =
      match?.offsides ??
      match?.offside ??
      match?.stats?.offsides ??
      match?.extraStats?.offsides ??
      match?.additionalStats?.offsides ??
      match?.allStats?.offsides ?? null;

    const opponentOffsides =
      typeof candidate === "number"
        ? candidate
        : candidate && typeof candidate === "object"
        ? candidate[opponentSide]
        : null;

    if (typeof opponentOffsides === "number") {
      const base = value - opponentOffsides;
      if (Number.isFinite(base)) {
        return `${value} (${base} + ${opponentOffsides} offsides)`;
      }
    }
    return String(value);
  }

  if (
    statKey === "shotsOnGoal" &&
    typeof value === "number" &&
    match?.totalShots &&
    typeof match.totalShots[teamType] === "number" &&
    match.totalShots[teamType] > 0
  ) {
    const pct = Math.round((value / match.totalShots[teamType]) * 100);
    return `${value} (${pct}%)`;
  }

  return String(value);
}

function collectMatches(result, scope, neutralGround, direction) {
  if (!result) {
    logClientBacktestStep("Inga historiska matcher hittades för raden.", {
      scope,
      neutralGround,
      direction,
    });
    return [];
  }
  const isOver = direction === "över";

  if (scope === "total") {
    const combined = [...(result.homeMatches ?? []), ...(result.awayMatches ?? [])];
    return combined.map((match) => ({
      match,
      stat: match.stat?.total,
      teamType: "total",
    }));
  }

  const pick = (matches, type) =>
    matches.map((match) => ({ match, stat: match.stat?.[type], teamType: type }));

  if (scope === "home") {
    if (neutralGround) {
      return isOver
        ? pick(result.homeMatches ?? [], "away")
        : pick(result.awayMatches ?? [], "home");
    }
    return isOver
      ? pick(result.homeMatches ?? [], "home")
      : pick(result.awayMatches ?? [], "home");
  }

  if (scope === "away") {
    if (neutralGround) {
      return isOver
        ? pick(result.awayMatches ?? [], "away")
        : pick(result.homeMatches ?? [], "home");
    }
    return isOver
      ? pick(result.awayMatches ?? [], "away")
      : pick(result.homeMatches ?? [], "away");
  }

  return [];
}

function getLeagueFormulaTooltip({ result, period, scope }) {
  const formulas = result?.leagueAvg?.details?.formulas;
  if (!Array.isArray(formulas) || !formulas.length) return "";
  const periodFormula = formulas.find((entry) => entry.period === period) ?? formulas[0];
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
}

function formatMatchCount(result, scope, direction) {
  if (!result) return "-";
  if (scope === "total") {
    const hits = direction === "över" ? result.hitsOver : result.hitsUnder;
    return hits ? `${hits} matcher` : "-";
  }
  if (direction === "under") {
    return result.hitsAgainst ? ` ${result.hitsAgainst}` : "-";
  }
  const hits = direction === "över" ? result.hitsOver : result.hitsUnder;
  return hits ? `${hits} matcher` : "-";
}

export default function OddsTable({
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
  neutralGround,
  setHistoryTooltip,
  setHistoryPosition,
  setTooltipThreshold,
  statPatterns,
  labels = { over: "Över", under: "Under" },
}) {
  const timeouts = useRef({});

  const thresholds = useMemo(() => {
    const pattern = statPatterns?.[statKey];
    const values = pattern ? pattern.thresholds(scope, period) : [];
    logClientBacktestStep("Tröskelvärdena för statistiken hämtas.", {
      statKey,
      scope,
      period,
      values,
    });
    return values;
  }, [statPatterns, statKey, scope, period]);

  const opponentLabel = scope === "home" ? awayTeam : scope === "away" ? homeTeam : "Under";

  const updateOddsStore = (line, dir, value) => {
    logClientBacktestStep("Odds fältet uppdateras.", {
      statKey,
      scope,
      period,
      line,
      dir,
      value,
    });
    const lineKey = formatLineKey(line);
    setOddsStore((prev) => {
      const currentOdds = prev?.[teamKey]?.[statKey]?.[scope]?.[period] ?? {};
      const nextStore = {
        ...prev,
        [teamKey]: {
          ...prev?.[teamKey],
          [statKey]: {
            ...prev?.[teamKey]?.[statKey],
            [scope]: {
              ...prev?.[teamKey]?.[statKey]?.[scope],
              [period]: {
                ...currentOdds,
                [lineKey]: {
                  ...currentOdds?.[lineKey],
                  [dir]: value,
                },
              },
            },
          },
        },
      };
      logClientBacktestStep("Oddsbutiken har skrivits om.", nextStore);
      return nextStore;
    });
  };

  const handleOddsChange = (line, dir) => (event) => {
    const value = event.target.value;
    logClientBacktestStep("Användaren matar in ett nytt odds.", {
      line,
      dir,
      value,
    });
    updateOddsStore(line, dir, value);

    const timeoutKey = `${line}-${dir}`;
    clearTimeout(timeouts.current[timeoutKey]);
    timeouts.current[timeoutKey] = setTimeout(() => {
      const direction = dir === "over" ? "över" : "under";
      logClientBacktestStep("Rekalkylering av expected value schemaläggs.", {
        statKey,
        line,
        direction,
        value,
        scope,
        period,
      });
      onRecalculate(statKey, line, direction, value, scope, period);
    }, 2000);
  };

  const buildEvEntries = (line, direction) => {
    const result = findResult(results, (res) => res.bet.line === line && res.bet.direction === direction);
    logClientBacktestStep("Historik för raden byggs upp.", {
      line,
      direction,
      hasResult: Boolean(result),
    });
    if (!result) {
      return [
        {
          key: "empty",
          raw: null,
          label: "",
          text: "-",
          tooltip: "",
        },
      ];
    }

    const leagueTooltip = getLeagueFormulaTooltip({ result, period, scope });
    const metrics = collectEvMetrics(result);
    logClientBacktestStep("EV-mått beräknas för raden.", {
      line,
      direction,
      metrics,
    });

    if (!metrics.length) {
      return [
        {
          key: "empty",
          raw: null,
          label: "",
          text: "-",
          tooltip: "",
        },
      ];
    }

    return metrics.map((metric) => ({
      key: metric.key,
      raw: metric.value,
      label: metric.label,
      text: `${formatPercent(metric.value)}`,
      tooltip: metric.key === "evPctLeagueAvg" ? leagueTooltip : "",
    }));
  };

  const makeHistoryHandler = (line, isOver) => (event) => {
    const result = findResult(results, (res) => res.bet.line === line);
    if (!result) return;
    const matches = collectMatches(result, scope, neutralGround, isOver ? "över" : "under");
    if (!matches.length) return;
    setHistoryTooltip(
      matches
        .map(({ match, stat, teamType }) =>
          `${match.homeTeam} vs ${match.awayTeam}: ${formatStatValue({
            match,
            value: stat,
            teamType,
            statKey,
          })}`
        )
        .join("\n")
    );
    setTooltipThreshold?.(line);
    setHistoryPosition?.({ x: event.clientX, y: event.clientY });
  };

  const clearHistory = () => setHistoryTooltip?.(null);

  const buildTooltip = (line, direction) => {
    const result =
      findResult(results, (res) => res.bet.line === line && res.bet.direction === direction) ??
      findResult(results, (res) => res.bet.line === line);

    if (!result) return "";
    const matches = collectMatches(result, scope, neutralGround, direction);
    if (!matches.length) return "";
    return matches
      .map(({ match, stat, teamType }) =>
        `${match.homeTeam} vs ${match.awayTeam}: ${formatStatValue({
          match,
          value: stat,
          teamType,
          statKey,
        })}`
      )
      .join("\n");
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-800 text-sm text-gray-100">
        <thead className="bg-gray-900/80 text-xs uppercase tracking-wide text-gray-400">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Lina</th>
            <th className="px-3 py-2 text-left font-semibold">{labels.over} (odds)</th>
            <th className="px-3 py-2 text-left font-semibold">EV % ({labels.over})</th>
            <th className="px-3 py-2 text-left font-semibold">{labels.under} (odds)</th>
            <th className="px-3 py-2 text-left font-semibold">EV % ({labels.under})</th>
            <th className="px-3 py-2 text-left font-semibold">Historik</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {thresholds.map((line) => {
            const overEntries = buildEvEntries(line, "över");
            const underEntries = buildEvEntries(line, "under");
            const overTooltip = buildTooltip(line, "över");
            const underTooltip = buildTooltip(line, "under");
            const lineResult =
              findResult(results, (res) => res.bet.line === line && res.bet.direction === "över") ??
              findResult(results, (res) => res.bet.line === line && res.bet.direction === "under");
            const lineKey = formatLineKey(line);
            const store = oddsStore?.[teamKey]?.[statKey]?.[scope]?.[period]?.[lineKey] ?? {};
            logClientBacktestStep("Oddsraden renderas i tabellen.", {
              line,
              store,
              overEntries,
              underEntries,
            });
            return (
              <tr key={line} className="bg-gray-900/60">
                <td className="px-3 py-2 align-top text-gray-200">{line}</td>
                <td className="px-3 py-2 align-top" title={overTooltip || undefined}>
                  <input
                    type="number"
                    step="0.01"
                    className="w-24 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder={labels.over}
                    value={store.over ?? ""}
                    onChange={handleOddsChange(line, "over")}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  {overEntries.map((entry) => (
                    <div
                      key={entry.key}
                      className={entry.raw >= 0 ? "text-emerald-400" : "text-red-400"}
                      title={entry.tooltip || undefined}
                    >
                      {entry.text}
                      {entry.label ? ` (${entry.label})` : ""}
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2 align-top" title={underTooltip || undefined}>
                  <input
                    type="number"
                    step="0.01"
                    className="w-24 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder={labels.under}
                    value={store.under ?? ""}
                    onChange={handleOddsChange(line, "under")}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  {underEntries.map((entry) => (
                    <div
                      key={entry.key}
                      className={entry.raw >= 0 ? "text-emerald-400" : "text-red-400"}
                      title={entry.tooltip || undefined}
                    >
                      {entry.text}
                      {entry.label ? ` (${entry.label})` : ""}
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2 align-top text-sm text-gray-300">
                  <div
                    onMouseEnter={makeHistoryHandler(line, true)}
                    onMouseLeave={clearHistory}
                    className="cursor-help"
                  >
                    {labels.over}: {formatMatchCount(lineResult, scope, "över")}
                  </div>
                  <div
                    onMouseEnter={makeHistoryHandler(line, false)}
                    onMouseLeave={clearHistory}
                    className="cursor-help"
                  >
                    {opponentLabel}{opponentLabel !== "Under" ? " conceded" : ""}: {formatMatchCount(lineResult, scope, "under")}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

