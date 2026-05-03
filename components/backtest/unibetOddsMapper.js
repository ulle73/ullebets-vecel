import { getTeamAliases } from "./teamNameAliases.js";

// Unibet has used both legacy "Totala/Totalt antal" labels and newer "Antal" labels.
// Keep both so we stay backward-compatible if they switch back again.
const STAT_PREFIX = "(?:Totala|Totalt antal|Antal)";

const STAT_MAP = [
  { key: "shotsOnGoal", regex: new RegExp(`${STAT_PREFIX} skott på mål`, "i") },
  { key: "totalShots", regex: new RegExp(`${STAT_PREFIX} skott(?! på mål)`, "i") },
  { key: "cornerKicks", regex: new RegExp(`${STAT_PREFIX} hörnor`, "i") },
  { key: "yellowCards", regex: new RegExp(`${STAT_PREFIX} kort`, "i") },
  { key: "freeKicks", regex: new RegExp(`${STAT_PREFIX} frisparkar`, "i") },
  {
    key: "fouls",
    regex: new RegExp(`(?:Totala utförda|${STAT_PREFIX}) fouls`, "i"),
  },
  { key: "totalTackle", regex: new RegExp(`${STAT_PREFIX} tacklingar`, "i") },
  { key: "offsides", regex: new RegExp(`${STAT_PREFIX} offside`, "i") },
];

function parseLine(raw) {
  if (raw == null) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  
  // Unibet API sometimes sends values × 1000
  // e.g., 5.5 corners → 5500, but sometimes buggy and sends 500 instead of 5000
  // Safe threshold: anything >= 100 is likely ×1000 format
  if (Math.abs(numeric) >= 100) {
    return Number((numeric / 1000).toFixed(1));
  }
  return Number(numeric.toFixed(2));
}

function parseDecimalOdds(outcome) {
  if (!outcome) return null;
  if (typeof outcome.oddsDecimal === "number") {
    return Number(outcome.oddsDecimal.toFixed(2));
  }
  if (typeof outcome.odds === "number") {
    return Number((outcome.odds / 1000).toFixed(2));
  }
  if (typeof outcome.oddsFractional === "string") {
    const [num, den] = outcome.oddsFractional.split("/").map(Number);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return Number((num / den + 1).toFixed(2));
    }
  }
  return null;
}

function determineScope(label, homeAliases, awayAliases) {
  if (!label) return "total";
  const normalized = label.toLowerCase();
  if (homeAliases.some((alias) => normalized.includes(alias.toLowerCase()))) {
    return "home";
  }
  if (awayAliases.some((alias) => normalized.includes(alias.toLowerCase()))) {
    return "away";
  }
  return "total";
}

function determinePeriod(label) {
  if (!label) return "ALL";
  if (/första halvlek/i.test(label) || /1st/i.test(label)) return "1ST";
  if (/andra halvlek/i.test(label) || /2nd/i.test(label)) return "2ND";
  return "ALL";
}

function normalizeEntries(unibetOdds) {
  if (!unibetOdds) return [];
  if (Array.isArray(unibetOdds)) {
    return unibetOdds.map((offer) => [offer?.criterion?.label || "", offer]);
  }
  if (typeof unibetOdds === "object") {
    return Object.entries(unibetOdds);
  }
  return [];
}

export default function mapUnibetOdds(unibetOdds, homeTeam = "", awayTeam = "") {
  const tuples = [];
  const entries = normalizeEntries(unibetOdds);
  if (!entries.length) return tuples;

  const homeAliases = getTeamAliases(homeTeam);
  const awayAliases = getTeamAliases(awayTeam);

  for (const [label, market] of entries) {
    const statEntry = STAT_MAP.find((s) => s.regex.test(label));
    if (!statEntry || !market) continue;

    const outcomes = Array.isArray(market.outcomes)
      ? market.outcomes
      : Array.isArray(market?.betOffer?.outcomes)
      ? market.betOffer.outcomes
      : [];

    if (!outcomes.length) continue;

    const period = determinePeriod(label);
    const scope = determineScope(label, homeAliases, awayAliases);

    const lineMap = new Map();

    for (const outcome of outcomes) {
      const line = parseLine(outcome.line ?? outcome.handicap);
      if (line == null) continue;
      const odds = parseDecimalOdds(outcome);
      if (!Number.isFinite(odds)) continue;
      const dirLabel = (outcome.englishLabel || outcome.label || "").toLowerCase();
      const dir = dirLabel.includes("under") ? "under" : "over";
      if (!lineMap.has(line)) {
        lineMap.set(line, { over: null, under: null });
      }
      const entry = lineMap.get(line);
      entry[dir] = odds;
    }

    for (const [line, odds] of lineMap.entries()) {
      tuples.push({
        statKey: statEntry.key,
        scope,
        period,
        line,
        odds,
      });
    }
  }

  return tuples;
}
