const MARKET_MAP = [
  { match: /shots on target/i, statKey: "shotsOnGoal" },
  { match: /total shots/i, statKey: "totalShots" },
  { match: /corner/i, statKey: "cornerKicks" },
  { match: /yellow card/i, statKey: "yellowCards" },
  { match: /throw-in/i, statKey: "throwIns" },
  { match: /free kick/i, statKey: "freeKicks" },
  { match: /foul/i, statKey: "fouls" },
  { match: /tackle/i, statKey: "totalTackle" },
  { match: /offside/i, statKey: "offsides" },
];

function inferStatKey(name = "") {
  for (const entry of MARKET_MAP) {
    if (entry.match.test(name)) return entry.statKey;
  }
  return null;
}

function inferScope(name = "") {
  if (/home/i.test(name)) return "home";
  if (/away/i.test(name)) return "away";
  return "total";
}

function inferPeriod(name = "") {
  if (/1st|first half/i.test(name)) return "1ST";
  if (/2nd|second half/i.test(name)) return "2ND";
  return "ALL";
}

function parseLine(label = "") {
  const match = label.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  return Number.parseFloat(match[1].replace(",", "."));
}

function parseDirection(label = "") {
  return /under/i.test(label) ? "under" : "over";
}

function parseOdds(outcome) {
  if (outcome == null) return null;
  if (typeof outcome === "number") return outcome;
  if (typeof outcome.odds === "number") return outcome.odds;
  if (typeof outcome.odds?.decimal === "number") return outcome.odds.decimal;
  if (typeof outcome.decimal === "number") return outcome.decimal;
  if (typeof outcome.price === "number") return outcome.price;
  return null;
}

function pushTuple(target, tuple) {
  if (!tuple) return;
  if (
    !tuple.statKey ||
    !tuple.scope ||
    !tuple.period ||
    typeof tuple.line !== "number" ||
    Number.isNaN(tuple.line)
  ) {
    return;
  }
  target.push(tuple);
}

function mapFromNestedObject(oddsObject) {
  const tuples = [];
  for (const [statKey, scopes] of Object.entries(oddsObject)) {
    if (statKey == null || typeof scopes !== "object") continue;
    for (const [scope, periods] of Object.entries(scopes ?? {})) {
      for (const [period, lines] of Object.entries(periods ?? {})) {
        for (const [lineKey, odds] of Object.entries(lines ?? {})) {
          const line = Number.parseFloat(lineKey);
          if (!Number.isFinite(line)) continue;
          if (odds?.over || odds?.under) {
            pushTuple(tuples, {
              statKey,
              scope,
              period,
              line,
              odds: {
                over: odds.over ?? null,
                under: odds.under ?? null,
              },
            });
          }
        }
      }
    }
  }
  return tuples;
}

function mapFromMarkets(markets = []) {
  const tuples = [];
  for (const market of markets) {
    if (!market) continue;
    const name = market.name ?? market.title ?? market.marketName ?? "";
    const statKey = inferStatKey(name);
    const scope = inferScope(name);
    const period = inferPeriod(name);
    if (!statKey) continue;
    const outcomes = market.outcomes ?? market.selections ?? [];
    const grouped = {};
    for (const outcome of outcomes) {
      const label = outcome.label ?? outcome.outcome ?? "";
      const line = parseLine(label ?? outcome.handicap ?? outcome.line);
      if (!Number.isFinite(line)) continue;
      const dir = parseDirection(label ?? outcome.type ?? "");
      const odds = parseOdds(outcome);
      if (odds == null) continue;
      if (!grouped[line]) {
        grouped[line] = { over: null, under: null };
      }
      if (dir === "over") grouped[line].over = odds;
      else grouped[line].under = odds;
    }
    for (const [lineKey, odds] of Object.entries(grouped)) {
      const line = Number.parseFloat(lineKey);
      if (!Number.isFinite(line)) continue;
      pushTuple(tuples, { statKey, scope, period, line, odds });
    }
  }
  return tuples;
}

export function mapUnibetOdds(payload, homeTeam, awayTeam) {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    if (payload.every((item) => item?.statKey && item?.scope && item?.period)) {
      return payload;
    }
    return mapFromMarkets(payload);
  }
  if (payload?.odds) {
    return mapUnibetOdds(payload.odds, homeTeam, awayTeam);
  }
  if (payload?.markets) {
    return mapFromMarkets(payload.markets);
  }
  if (typeof payload === "object") {
    return mapFromNestedObject(payload);
  }
  return [];
}
