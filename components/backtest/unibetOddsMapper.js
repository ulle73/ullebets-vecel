import { getTeamAliases } from "@/lib/teamNameAliases";
import { normalizeTeamName } from "./utils";

const MARKET_MAP = [
  { match: /(shots on target|skott på mål)/i, statKey: "shotsOnGoal" },
  {
    match: /(total shots|totala|totalt antal skott(?! på mål))/i,
    statKey: "totalShots",
  },
  { match: /(corner|hörn)/i, statKey: "cornerKicks" },
  { match: /(yellow card|kort)/i, statKey: "yellowCards" },
  { match: /(throw[-\s]?in|inkast)/i, statKey: "throwIns" },
  { match: /(free kick|frispark)/i, statKey: "freeKicks" },
  { match: /(foul|fouls)/i, statKey: "fouls" },
  { match: /(tackle|tackling)/i, statKey: "totalTackle" },
  { match: /offside/i, statKey: "offsides" },
];

const EMPTY_ALIAS_CONTEXT = { homeAliases: [], awayAliases: [] };

function normalizeAliasText(value) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function createAliasList(teamName) {
  const normalized = normalizeTeamName(teamName);
  return Array.from(
    new Set(
      getTeamAliases(normalized)
        .map((alias) => normalizeAliasText(alias))
        .filter(Boolean)
    )
  );
}

function createAliasContext(homeTeam, awayTeam) {
  return {
    homeAliases: createAliasList(homeTeam),
    awayAliases: createAliasList(awayTeam),
  };
}

function includesAlias(value, aliases = []) {
  if (!aliases.length) return false;
  const normalized = normalizeAliasText(value);
  if (!normalized) return false;
  return aliases.some((alias) => normalized.includes(alias));
}

function inferStatKey(name = "") {
  for (const entry of MARKET_MAP) {
    if (entry.match.test(name)) return entry.statKey;
  }
  return null;
}

function inferScope(name = "", aliasContext = EMPTY_ALIAS_CONTEXT) {
  if (/home/i.test(name)) return "home";
  if (/away/i.test(name)) return "away";
  if (includesAlias(name, aliasContext.homeAliases)) return "home";
  if (includesAlias(name, aliasContext.awayAliases)) return "away";
  return "total";
}

function inferPeriod(name = "") {
  if (/1st|first half|första halvlek/i.test(name)) return "1ST";
  if (/2nd|second half|andra halvlek/i.test(name)) return "2ND";
  return "ALL";
}

function parseDirection(label = "") {
  return /under/i.test(label) ? "under" : "over";
}

function parseNumeric(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const normalized = value.replace(",", ".").trim();
    if (!normalized) return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseLineFromText(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const match = value.match(/(\d+(?:[.,]\d+)?)/);
    if (match) {
      const parsed = Number.parseFloat(match[1].replace(",", "."));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    const numeric = Number.parseFloat(value.replace(",", "."));
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function resolveLine(outcome = {}, market = {}) {
  const candidates = [
    outcome.label,
    outcome.outcome,
    outcome.handicap,
    outcome.line,
    outcome.points,
    outcome.total,
    outcome.target,
    outcome.handicapValue,
    outcome.odds?.handicap,
    outcome.selectionHandicap,
    market.handicap,
    market.line,
    market.points,
    market.total,
    market.criterion?.handicap,
    market.criterion?.points,
    market.criterion?.total,
  ];
  for (const candidate of candidates) {
    const line = parseLineFromText(candidate);
    if (Number.isFinite(line)) {
      return line;
    }
  }
  return null;
}

function parseFractionalOdds(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const numerator = Number.parseFloat(match[1]);
  const denominator = Number.parseFloat(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator + 1;
}

function parseOdds(outcome) {
  if (outcome == null) return null;
  const direct = parseNumeric(outcome);
  if (direct != null) return direct;

  const oddsValue = parseNumeric(outcome.odds);
  if (oddsValue != null) return oddsValue;

  const decimalOdds = parseNumeric(outcome.odds?.decimal);
  if (decimalOdds != null) return decimalOdds;

  const nestedDecimal = parseNumeric(outcome.decimal);
  if (nestedDecimal != null) return nestedDecimal;

  const priceOdds = parseNumeric(outcome.price);
  if (priceOdds != null) return priceOdds;

  const fractionalOdds = parseFractionalOdds(outcome.oddsFractional ?? outcome.odds?.fractional);
  if (fractionalOdds != null) return fractionalOdds;

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

function resolveScopeForOutcome(baseScope, market, outcome, aliasContext = EMPTY_ALIAS_CONTEXT) {
  if (baseScope !== "total") return baseScope;
  const { homeAliases, awayAliases } = aliasContext;
  const candidates = [
    market?.name,
    market?.title,
    market?.marketName,
    market?.criterion?.label,
    market?.criterion?.abbreviation,
    outcome?.label,
    outcome?.englishLabel,
    outcome?.participant,
    outcome?.outcome,
    outcome?.type,
  ];
  if (candidates.some((value) => includesAlias(value, homeAliases))) {
    return "home";
  }
  if (candidates.some((value) => includesAlias(value, awayAliases))) {
    return "away";
  }
  return "total";
}

function mapFromMarkets(markets = [], aliasContext = EMPTY_ALIAS_CONTEXT) {
  const tuples = [];
  for (const market of markets) {
    if (!market) continue;
    const name = market.name ?? market.title ?? market.marketName ?? "";
    const statKey = inferStatKey(name);
    if (!statKey) continue;
    const period = inferPeriod(name);
    const baseScope = inferScope(name, aliasContext);
    const outcomes = market.outcomes ?? market.selections ?? [];
    const groupedByScope = {};

    for (const outcome of outcomes) {
      const label = outcome.label ?? outcome.outcome ?? "";
      const line = resolveLine(outcome, market);
      if (!Number.isFinite(line)) continue;
      const dir = parseDirection(label ?? outcome.type ?? "");
      const odds = parseOdds(outcome);
      if (odds == null) continue;
      const scope = resolveScopeForOutcome(baseScope, market, outcome, aliasContext);
      if (!groupedByScope[scope]) {
        groupedByScope[scope] = {};
      }
      if (!groupedByScope[scope][line]) {
        groupedByScope[scope][line] = { over: null, under: null };
      }
      groupedByScope[scope][line][dir] = odds;
    }

    for (const [scope, lines] of Object.entries(groupedByScope)) {
      for (const [lineKey, odds] of Object.entries(lines ?? {})) {
        const line = Number.parseFloat(lineKey);
        if (!Number.isFinite(line)) continue;
        if (odds?.over == null && odds?.under == null) continue;
        pushTuple(tuples, { statKey, scope, period, line, odds });
      }
    }
  }
  return tuples;
}

function convertObjectToMarkets(objectPayload = {}) {
  const entries = Object.entries(objectPayload);
  if (!entries.length) return null;
  const isMarketLike = entries.every(([, value]) => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value.outcomes) || Array.isArray(value.selections)) {
      return true;
    }
    return false;
  });
  if (!isMarketLike) return null;
  return entries.map(([label, value]) => ({
    name: label,
    ...value,
  }));
}

export function mapUnibetOdds(payload, homeTeam, awayTeam) {
  const aliasContext = createAliasContext(homeTeam, awayTeam);
  if (!payload) return [];
  if (Array.isArray(payload)) {
    if (payload.every((item) => item?.statKey && item?.scope && item?.period)) {
      return payload;
    }
    return mapFromMarkets(payload, aliasContext);
  }
  if (payload?.odds) {
    return mapUnibetOdds(payload.odds, homeTeam, awayTeam);
  }
  if (payload?.markets) {
    return mapFromMarkets(payload.markets, aliasContext);
  }
  if (typeof payload === "object") {
    const markets = convertObjectToMarkets(payload);
    if (markets) {
      return mapFromMarkets(markets, aliasContext);
    }
    return mapFromNestedObject(payload);
  }
  return [];
}
