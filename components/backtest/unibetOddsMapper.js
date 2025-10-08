import { getTeamAliases } from "./teamNameAliases";

export default function mapUnibetOdds(unibetOdds, homeTeam = "", awayTeam = "") {
  const tuples = [];
  if (!unibetOdds) return tuples;

  const STAT_MAP = [
    { key: "shotsOnGoal", regex: /(Totala|Totalt antal) skott på mål/i },
    { key: "totalShots", regex: /(Totala|Totalt antal) skott(?! på mål)/i },
    { key: "cornerKicks", regex: /(Totala|Totalt antal) hörnor/i },
    { key: "yellowCards", regex: /(Totala|Totalt antal) kort/i },
    { key: "freeKicks", regex: /(Totala|Totalt antal) frisparkar/i },
    {
      key: "fouls",
      regex: /(Totala utförda|Totala|Totalt antal) fouls/i,
    },
    { key: "totalTackle", regex: /(Totala|Totalt antal) tacklingar/i },
    { key: "offsides", regex: /(Totala|Totalt antal) offside/i },
  ];

  const homeAliases = getTeamAliases(homeTeam);
  const awayAliases = getTeamAliases(awayTeam);

  Object.entries(unibetOdds).forEach(([label, market]) => {
    const statEntry = STAT_MAP.find((s) => s.regex.test(label));
    if (!statEntry || !market?.outcomes) return;

    const period = label.includes("Första halvlek")
      ? "1ST"
      : label.includes("Andra halvlek")
      ? "2ND"
      : "ALL";

    const scope = homeAliases.some((alias) => label.includes(alias))
      ? "home"
      : awayAliases.some((alias) => label.includes(alias))
      ? "away"
      : "total";

    const lineMap = {};
    market.outcomes.forEach((o) => {
      const line = parseFloat(o.line);
      if (!Number.isFinite(line)) return;
      if (!lineMap[line]) lineMap[line] = {};
      const dir = String(o.label || "")
        .toLowerCase()
        .includes("over")
        ? "over"
        : "under";
      const oddsValue = parseFloat(o.odds);
      if (Number.isFinite(oddsValue)) {
        lineMap[line][dir] = oddsValue;
      }
    });

    Object.entries(lineMap).forEach(([line, odds]) => {
      if (!odds.over && !odds.under) return;
      tuples.push({
        statKey: statEntry.key,
        scope,
        period,
        line: parseFloat(line),
        odds,
      });
    });
  });

  return tuples;
}
