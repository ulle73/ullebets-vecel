// import { getTeamAliases } from "@/lib/teamNameAliases";
// import { normalizeTeamName } from "./utils";

// const MARKET_MAP = [
//   { match: /(shots on target|skott på mål)/i, statKey: "shotsOnGoal" },
//   {
//     match: /(total shots|totala|totalt antal skott(?! på mål))/i,
//     statKey: "totalShots",
//   },
//   { match: /(corner|hörn)/i, statKey: "cornerKicks" },
//   { match: /(yellow card|kort)/i, statKey: "yellowCards" },
//   { match: /(throw[-\s]?in|inkast)/i, statKey: "throwIns" },
//   { match: /(free kick|frispark)/i, statKey: "freeKicks" },
//   { match: /(foul|fouls)/i, statKey: "fouls" },
//   { match: /(tackle|tackling)/i, statKey: "totalTackle" },
//   { match: /offside/i, statKey: "offsides" },
// ];

// const EMPTY_ALIAS_CONTEXT = { homeAliases: [], awayAliases: [] };

// function normalizeAliasText(value) {
//   if (value == null) return "";
//   const text = String(value).trim();
//   if (!text) return "";
//   return text
//     .normalize("NFD")
//     .replace(/[\u0300-\u036f]/g, "")
//     .toLowerCase();
// }

// function createAliasList(teamName) {
//   const normalized = normalizeTeamName(teamName);
//   return Array.from(
//     new Set(
//       getTeamAliases(normalized)
//         .map((alias) => normalizeAliasText(alias))
//         .filter(Boolean)
//     )
//   );
// }

// function createAliasContext(homeTeam, awayTeam) {
//   return {
//     homeAliases: createAliasList(homeTeam),
//     awayAliases: createAliasList(awayTeam),
//   };
// }

// function includesAlias(value, aliases = []) {
//   if (!aliases.length) return false;
//   const normalized = normalizeAliasText(value);
//   if (!normalized) return false;
//   return aliases.some((alias) => normalized.includes(alias));
// }

// function inferStatKey(name = "") {
//   for (const entry of MARKET_MAP) {
//     if (entry.match.test(name)) return entry.statKey;
//   }
//   return null;
// }

// function inferScope(name = "", aliasContext = EMPTY_ALIAS_CONTEXT) {
//   if (/home/i.test(name)) return "home";
//   if (/away/i.test(name)) return "away";
//   if (includesAlias(name, aliasContext.homeAliases)) return "home";
//   if (includesAlias(name, aliasContext.awayAliases)) return "away";
//   return "total";
// }

// function inferPeriod(name = "") {
//   if (/1st|first half|första halvlek/i.test(name)) return "1ST";
//   if (/2nd|second half|andra halvlek/i.test(name)) return "2ND";
//   return "ALL";
// }

// function parseDirection(label = "") {
//   return /under/i.test(label) ? "under" : "over";
// }

// function parseNumeric(value) {
//   if (value == null) return null;
//   if (typeof value === "number") {
//     return Number.isFinite(value) ? value : null;
//   }
//   if (typeof value === "string") {
//     const normalized = value.replace(",", ".").trim();
//     if (!normalized) return null;
//     const parsed = Number.parseFloat(normalized);
//     return Number.isFinite(parsed) ? parsed : null;
//   }
//   return null;
// }

// function parseLineFromText(value) {
//   if (value == null) return null;
//   if (typeof value === "number") {
//     return Number.isFinite(value) ? value : null;
//   }
//   if (typeof value === "string") {
//     const match = value.match(/(\d+(?:[.,]\d+)?)/);
//     if (match) {
//       const parsed = Number.parseFloat(match[1].replace(",", "."));
//       if (Number.isFinite(parsed)) {
//         return parsed;
//       }
//     }
//     const numeric = Number.parseFloat(value.replace(",", "."));
//     return Number.isFinite(numeric) ? numeric : null;
//   }
//   return null;
// }

// function resolveLine(outcome = {}, market = {}) {
//   const candidates = [
//     outcome.label,
//     outcome.outcome,
//     outcome.handicap,
//     outcome.line,
//     outcome.points,
//     outcome.total,
//     outcome.target,
//     outcome.handicapValue,
//     outcome.odds?.handicap,
//     outcome.selectionHandicap,
//     market.handicap,
//     market.line,
//     market.points,
//     market.total,
//     market.criterion?.handicap,
//     market.criterion?.points,
//     market.criterion?.total,
//   ];
//   for (const candidate of candidates) {
//     const line = parseLineFromText(candidate);
//     if (Number.isFinite(line)) {
//       return line;
//     }
//   }
//   return null;
// }

// function parseFractionalOdds(value) {
//   if (typeof value !== "string") return null;
//   const match = value.trim().match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
//   if (!match) return null;
//   const numerator = Number.parseFloat(match[1]);
//   const denominator = Number.parseFloat(match[2]);
//   if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
//     return null;
//   }
//   return numerator / denominator + 1;
// }

// function parseOdds(outcome) {
//   if (outcome == null) return null;
//   const direct = parseNumeric(outcome);
//   if (direct != null) return direct;

//   const oddsValue = parseNumeric(outcome.odds);
//   if (oddsValue != null) return oddsValue;

//   const decimalOdds = parseNumeric(outcome.odds?.decimal);
//   if (decimalOdds != null) return decimalOdds;

//   const nestedDecimal = parseNumeric(outcome.decimal);
//   if (nestedDecimal != null) return nestedDecimal;

//   const priceOdds = parseNumeric(outcome.price);
//   if (priceOdds != null) return priceOdds;

//   const fractionalOdds = parseFractionalOdds(outcome.oddsFractional ?? outcome.odds?.fractional);
//   if (fractionalOdds != null) return fractionalOdds;

//   return null;
// }

// function pushTuple(target, tuple) {
//   if (!tuple) return;
//   if (
//     !tuple.statKey ||
//     !tuple.scope ||
//     !tuple.period ||
//     typeof tuple.line !== "number" ||
//     Number.isNaN(tuple.line)
//   ) {
//     return;
//   }
//   target.push(tuple);
// }

// function mapFromNestedObject(oddsObject) {
//   const tuples = [];
//   for (const [statKey, scopes] of Object.entries(oddsObject)) {
//     if (statKey == null || typeof scopes !== "object") continue;
//     for (const [scope, periods] of Object.entries(scopes ?? {})) {
//       for (const [period, lines] of Object.entries(periods ?? {})) {
//         for (const [lineKey, odds] of Object.entries(lines ?? {})) {
//           const line = Number.parseFloat(lineKey);
//           if (!Number.isFinite(line)) continue;
//           if (odds?.over || odds?.under) {
//             pushTuple(tuples, {
//               statKey,
//               scope,
//               period,
//               line,
//               odds: {
//                 over: odds.over ?? null,
//                 under: odds.under ?? null,
//               },
//             });
//           }
//         }
//       }
//     }
//   }
//   return tuples;
// }

// function resolveScopeForOutcome(baseScope, market, outcome, aliasContext = EMPTY_ALIAS_CONTEXT) {
//   if (baseScope !== "total") return baseScope;
//   const { homeAliases, awayAliases } = aliasContext;
//   const candidates = [
//     market?.name,
//     market?.title,
//     market?.marketName,
//     market?.criterion?.label,
//     market?.criterion?.abbreviation,
//     outcome?.label,
//     outcome?.englishLabel,
//     outcome?.participant,
//     outcome?.outcome,
//     outcome?.type,
//   ];
//   if (candidates.some((value) => includesAlias(value, homeAliases))) {
//     return "home";
//   }
//   if (candidates.some((value) => includesAlias(value, awayAliases))) {
//     return "away";
//   }
//   return "total";
// }

// function mapFromMarkets(markets = [], aliasContext = EMPTY_ALIAS_CONTEXT) {
//   const tuples = [];
//   for (const market of markets) {
//     if (!market) continue;
//     const name = market.name ?? market.title ?? market.marketName ?? "";
//     const statKey = inferStatKey(name);
//     if (!statKey) continue;
//     const period = inferPeriod(name);
//     const baseScope = inferScope(name, aliasContext);
//     const outcomes = market.outcomes ?? market.selections ?? [];
//     const groupedByScope = {};

//     for (const outcome of outcomes) {
//       const label = outcome.label ?? outcome.outcome ?? "";
//       const line = resolveLine(outcome, market);
//       if (!Number.isFinite(line)) continue;
//       const dir = parseDirection(label ?? outcome.type ?? "");
//       const odds = parseOdds(outcome);
//       if (odds == null) continue;
//       const scope = resolveScopeForOutcome(baseScope, market, outcome, aliasContext);
//       if (!groupedByScope[scope]) {
//         groupedByScope[scope] = {};
//       }
//       if (!groupedByScope[scope][line]) {
//         groupedByScope[scope][line] = { over: null, under: null };
//       }
//       groupedByScope[scope][line][dir] = odds;
//     }

//     for (const [scope, lines] of Object.entries(groupedByScope)) {
//       for (const [lineKey, odds] of Object.entries(lines ?? {})) {
//         const line = Number.parseFloat(lineKey);
//         if (!Number.isFinite(line)) continue;
//         if (odds?.over == null && odds?.under == null) continue;
//         pushTuple(tuples, { statKey, scope, period, line, odds });
//       }
//     }
//   }
//   return tuples;
// }

// function convertObjectToMarkets(objectPayload = {}) {
//   const entries = Object.entries(objectPayload);
//   if (!entries.length) return null;
//   const isMarketLike = entries.every(([, value]) => {
//     if (!value || typeof value !== "object") return false;
//     if (Array.isArray(value.outcomes) || Array.isArray(value.selections)) {
//       return true;
//     }
//     return false;
//   });
//   if (!isMarketLike) return null;
//   return entries.map(([label, value]) => ({
//     name: label,
//     ...value,
//   }));
// }

// export function mapUnibetOdds(payload, homeTeam, awayTeam, aliasContext) {
//   const aliasContext = createAliasContext(homeTeam, awayTeam);
//   if (!payload) return [];
//   if (Array.isArray(payload)) {
//     if (payload.every((item) => item?.statKey && item?.scope && item?.period)) {
//       return payload;
//     }
//     return mapFromMarkets(payload, aliasContext);
//   }
//   if (payload?.odds) {
//     return mapUnibetOdds(payload.odds, homeTeam, awayTeam);
//   }
//   if (payload?.markets) {
//     return mapFromMarkets(payload.markets, aliasContext);
//   }
//   if (typeof payload === "object") {
//     const markets = convertObjectToMarkets(payload);
//     if (markets) {
//       return mapFromMarkets(markets, aliasContext);
//     }
//     return mapFromNestedObject(payload);
//   }
//   return [];
// }


import { getTeamAliases } from "@/lib/teamNameAliases";
import { normalizeTeamName } from "./utils";
import { areTeamNamesEquivalent } from "@/lib/teamNameAliases";

// const MARKET_MAP = [
//   { match: /(shots on target|skott på mål)/i, statKey: "shotsOnGoal" },
//   {
//     match: /(total shots|totala|totalt antal skott(?! på mål))/i,
//     statKey: "totalShots",
//   },
//   { match: /(corner|hörn)/i, statKey: "cornerKicks" },
//   { match: /(yellow card|kort)/i, statKey: "yellowCards" },
//   { match: /(throw[-\s]?in|inkast)/i, statKey: "throwIns" },
//   { match: /(free kick|frispark)/i, statKey: "freeKicks" },
//   { match: /(foul|fouls)/i, statKey: "fouls" },
//   { match: /(tackle|tackling)/i, statKey: "totalTackle" },
//   { match: /offside/i, statKey: "offsides" },
// ];


// SPECIFIKA → GENERELLA. Undvik ensamt "totala".
// const MARKET_MAP = [
//   // Shots on target (sv + en)
//   { match: /\b(shots?\s+on\s+target|skott\s+p[åa]\s+m[åa]l)\b/i, statKey: "shotsOnGoal" },

//   // Total shots (sv + en), men uttryckligen INTE "på mål"
//   { match: /\b(total\s+shots|totalt?\s+antal\s+skott|skott\s+totalt)\b(?!.*(p[åa]\s+m[åa]l|on\s+target))/i, statKey: "totalShots" },

//   // Corners
//   { match: /\b(corners?|hörnor?)\b/i, statKey: "cornerKicks" },

//   // Yellow cards
//   { match: /\b(yellow\s+cards?|gula?\s+kort)\b/i, statKey: "yellowCards" },

//   // Throw-ins
//   { match: /\b(throw[-\s]?ins?|inkast(er)?)\b/i, statKey: "throwIns" },

//   // Free kicks
//   { match: /\b(free\s+kicks?|frisparkar?)\b/i, statKey: "freeKicks" },

//   // Fouls
//   { match: /\b(fouls?)\b/i, statKey: "fouls" },

//   // Tackles
//   { match: /\b(tackles?|tackling(ar)?)\b/i, statKey: "totalTackle" },

//   // Offsides
//   { match: /\b(offsides?|offside)\b/i, statKey: "offsides" },
// ];


const MARKET_MAP = [
  // Skott på mål – måste komma före "skott"
  {
    match: /(shots\s+on\s+(target|goal)|skott\s+p(å|a)\s+m(å|a)l)/i,
    statKey: "shotsOnGoal",
  },

  // Totala skott (inte skott på mål)
  {
    match:
      /((total|totalt(?:a)?)\s+shots?|totalt?\s+antal\s+skott)(?!.*p(å|a)\s+m(å|a)l)/i,
    statKey: "totalShots",
  },

  // Hörnor
  {
    match: /((total|totalt(?:a)?)\s+corners?|hörnor|hörna)/i,
    statKey: "cornerKicks",
  },

  // Gula kort
  {
    match: /((total|totalt(?:a)?)\s+yellow\s+cards?|gula?\s+kort)/i,
    statKey: "yellowCards",
  },

  // Inkast
  { match: /(throw[-\s]?ins?|inkast(er)?)/i, statKey: "throwIns" },

  // Frisparkar
  {
    match: /((total|totalt(?:a)?)\s+free\s+kicks?|frisparkar?)/i,
    statKey: "freeKicks",
  },

  // Fouls
  { match: /((total|totalt(?:a)?)\s+fouls?|fouls?)/i, statKey: "fouls" },

  // Tacklingar
  {
    match: /((total|totalt(?:a)?)\s+tackles?|tackling(ar)?)/i,
    statKey: "totalTackle",
  },

  // Offside
  { match: /offsides?|offside/i, statKey: "offsides" },
];


const EMPTY_ALIAS_CONTEXT = { homeAliases: [], awayAliases: [] };

// function normalizeAliasText(value) {
//   if (value == null) return "";
//   const text = String(value).trim();
//   if (!text) return "";
//   return text
//     .normalize("NFD")
//     .replace(/[\u0300-\u036f]/g, "")
//     .toLowerCase();
// }

function normalizeAliasText(value) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  // 1) NFKD för att bryta isär accenter
  // 2) ta bort diakritiska tecken
  // 3) ersätt ALL icke a-z0-9 med mellanslag (tar alla Unicode-dashar, NBSP, parenteser etc.)
  // 4) kollapsa whitespace
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


function createAliasList(teamName) {
  const normalized = normalizeTeamName(teamName);
  const aliases = getTeamAliases(normalized);
  const normalizedAliases = aliases
    .concat(normalized ? [normalized] : [])
    .map((alias) => normalizeAliasText(alias))
    .filter(Boolean);
  return Array.from(new Set(normalizedAliases));
}

function createAliasContext(homeTeam, awayTeam) {
  return {
    homeTeam, // <-- lägg till
    awayTeam, // <-- lägg till
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

function inferScope(market = {}, aliasContext = EMPTY_ALIAS_CONTEXT) {
  const name =
    market?.name ?? market?.title ?? market?.marketName ?? market?.label ?? "";

  if (/home/i.test(name)) return "home";
  if (/away/i.test(name)) return "away";

  const criterionTexts = [
    market?.criterion?.label,
    market?.criterion?.abbreviation,
    market?.criterion?.name,
  ];

  if (includesAlias(name, aliasContext.homeAliases)) return "home";
  if (includesAlias(name, aliasContext.awayAliases)) return "away";

  if (criterionTexts.some((value) => includesAlias(value, aliasContext.homeAliases))) {
    return "home";
  }
  if (criterionTexts.some((value) => includesAlias(value, aliasContext.awayAliases))) {
    return "away";
  }

  return "total";
}

function inferPeriod(market = {}) {
  const name =
    market?.name ?? market?.title ?? market?.marketName ?? market?.label ?? "";
  const criterionTexts = [
    market?.criterion?.label,
    market?.criterion?.abbreviation,
    market?.criterion?.name,
  ]
    .filter(Boolean)
    .join(" ");

  const text = `${name} ${criterionTexts}`.trim();

  if (/1st|first half|första halvlek/i.test(text)) return "1ST";
  if (/2nd|second half|andra halvlek/i.test(text)) return "2ND";
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

// function parseLineFromText(value) {
//   if (value == null) return null;
//   if (typeof value === "number") {
//     return Number.isFinite(value) ? value : null;
//   }
//   if (typeof value === "string") {
//     const match = value.match(/(\d+(?:[.,]\d+)?)/);
//     if (match) {
//       const parsed = Number.parseFloat(match[1].replace(",", "."));
//       if (Number.isFinite(parsed)) {
//         return parsed;
//       }
//     }
//     const numeric = Number.parseFloat(value.replace(",", "."));
//     return Number.isFinite(numeric) ? numeric : null;
//   }
//   return null;
// }

function parseLineFromText(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    if (/(^|\b)(1st|2nd|first|second)\b/i.test(value)) return null;

    const match = value.match(/[-+]?\d+(?:[.,]\d+)?/);
    if (match) {
      const parsed = Number.parseFloat(match[0].replace(",", "."));
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
  for (const c of candidates) {
    const line = parseLineFromText(c);
    if (Number.isFinite(line)) return line;
  }
  return null;
}


function parseFractionalOdds(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const numerator = Number.parseFloat(match[1]);
  const denominator = Number.parseFloat(match[2]);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
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

  const fractionalOdds = parseFractionalOdds(
    outcome.oddsFractional ?? outcome.odds?.fractional
  );
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

// function resolveScopeForOutcome(
//   baseScope,
//   market,
//   outcome,
//   aliasContext = EMPTY_ALIAS_CONTEXT
// ) {
//   if (baseScope !== "total") return baseScope;
//   const { homeAliases, awayAliases } = aliasContext;
//   const candidates = [
//     market?.name,
//     market?.title,
//     market?.marketName,
//     market?.criterion?.label,
//     market?.criterion?.abbreviation,
//     outcome?.label,
//     outcome?.englishLabel,
//     outcome?.participant,
//     outcome?.outcome,
//     outcome?.type,
//   ];
//   if (candidates.some((value) => includesAlias(value, homeAliases))) {
//     return "home";
//   }
//   if (candidates.some((value) => includesAlias(value, awayAliases))) {
//     return "away";
//   }
//   return "total";
// }

function resolveScopeForOutcome(
  baseScope,
  market,
  outcome,
  aliasContext = EMPTY_ALIAS_CONTEXT
) {
  if (baseScope !== "total") return baseScope;

  const name =
    market?.name ||
    market?.title ||
    market?.marketName ||
    market?.criterion?.label ||
    market?.criterion?.abbreviation ||
    market?.criterion?.name ||
    "";

  const {
    homeAliases = [],
    awayAliases = [],
    homeTeam,
    awayTeam,
  } = aliasContext;

  // 1) Försök extrahera explicit lag från marknadstiteln:
  //   - "av {lag}", "för {lag}", "of {team}", "for {team}"
  //   - stoppa vid "(" eller slut på strängen
  const m =
    name.match(/\b(?:av|för|of|for)\s+([^(]+?)(?:\s*\(|$)/i) ||
    name.match(/\b(?:hemma|borta)\s*:\s*([^(]+?)(?:\s*\(|$)/i);

  if (m && m[1]) {
    const mentioned = m[1].trim();
    if (homeTeam && areTeamNamesEquivalent(mentioned, homeTeam)) return "home";
    if (awayTeam && areTeamNamesEquivalent(mentioned, awayTeam)) return "away";
    // om inte exakt equivalence, prova alias-substring
    if (includesAlias(mentioned, homeAliases)) return "home";
    if (includesAlias(mentioned, awayAliases)) return "away";
  }

  // 2) Om inget explicit “av/för”, testa hela marknadsnamnet mot alias
  if (includesAlias(name, homeAliases)) return "home";
  if (includesAlias(name, awayAliases)) return "away";

  const criterionTexts = [
    market?.criterion?.label,
    market?.criterion?.abbreviation,
    market?.criterion?.name,
  ];
  if (criterionTexts.some((value) => includesAlias(value, homeAliases))) {
    return "home";
  }
  if (criterionTexts.some((value) => includesAlias(value, awayAliases))) {
    return "away";
  }

  // 3) Fallback: outcome-fält (ibland skriver feeden Home/Away där)
  const candidates = [
    outcome?.label,
    outcome?.englishLabel,
    outcome?.participant, // ofta "N/A" här, men testa ändå
    outcome?.outcome,
    outcome?.type,
    outcome?.team,
  ];
  if (candidates.some((v) => includesAlias(v, homeAliases))) return "home";
  if (candidates.some((v) => includesAlias(v, awayAliases))) return "away";

  return "total";
}

function mapFromMarkets(markets = [], aliasContext = EMPTY_ALIAS_CONTEXT) {
  const tuples = [];
  for (const market of markets) {
    if (!market) continue;
    const name = market.name ?? market.title ?? market.marketName ?? "";
    const statKey = inferStatKey(name);
    if (!statKey) continue;
    const period = inferPeriod(market);
    const baseScope = inferScope(market, aliasContext);
    const outcomes = market.outcomes ?? market.selections ?? [];
    const groupedByScope = {};

    for (const outcome of outcomes) {
      const label = outcome.label ?? outcome.outcome ?? "";
      const line = resolveLine(outcome, market);
      if (!Number.isFinite(line)) continue;
      const dir = parseDirection(label ?? outcome.type ?? "");
      const odds = parseOdds(outcome);
      if (odds == null) continue;
      const scope = resolveScopeForOutcome(
        baseScope,
        market,
        outcome,
        aliasContext
      );
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

export function mapUnibetOdds(payload, homeTeam, awayTeam, ctx) {
  const context = ctx ?? createAliasContext(homeTeam, awayTeam);
  if (!payload) return [];

  if (Array.isArray(payload)) {
    if (payload.every((item) => item?.statKey && item?.scope && item?.period)) {
      return payload;
    }
    return mapFromMarkets(payload, context);
  }

  if (payload?.odds) {
    return mapUnibetOdds(payload.odds, homeTeam, awayTeam, context); // passera vidare
  }

  if (payload?.markets) {
    return mapFromMarkets(payload.markets, context);
  }

  if (typeof payload === "object") {
    const markets = convertObjectToMarkets(payload);
    if (markets) {
      return mapFromMarkets(markets, context);
    }
    return mapFromNestedObject(payload); // här finns redan scope i objektet
  }

  return [];
}

