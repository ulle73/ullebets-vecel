import { getTeamAliases } from "./teamNameAliases";

const STAT_MAP = [
  { key: "shotsOnGoal", regex: /(totala|totalt antal) skott på mål/i },
  { key: "totalShots", regex: /(totala|totalt antal) skott(?! på mål)/i },
  { key: "cornerKicks", regex: /(totala|totalt antal) hörnor/i },
  { key: "yellowCards", regex: /(totala|totalt antal) kort/i },
  { key: "freeKicks", regex: /(totala|totalt antal) frisparkar/i },
  { key: "fouls", regex: /(totala utförda|totala|totalt antal) foul/i },
  { key: "totalTackle", regex: /(totala|totalt antal) tacklingar/i },
  { key: "offsides", regex: /(totala|totalt antal) offside/i },
];

function normalizeLabel(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function includesAnyLabel(label, aliases) {
  if (!label) return false;
  const normalized = normalizeLabel(label).toLowerCase();
  return aliases.some((alias) => normalized.includes(normalizeLabel(alias).toLowerCase()));
}

function parseFractionalOdds(value) {
  if (typeof value !== "string") return null;
  const [num, den] = value.split("/").map((part) => Number(part));
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return null;
  }
  return num / den + 1;
}

function parseOdds(outcome) {
  const decimal = Number.parseFloat(outcome?.oddsDecimal);
  if (Number.isFinite(decimal) && decimal > 1) {
    return decimal;
  }

  const fractional = parseFractionalOdds(outcome?.oddsFractional);
  if (Number.isFinite(fractional)) {
    return fractional;
  }

  const numeric = Number.parseFloat(outcome?.odds);
  if (Number.isFinite(numeric)) {
    if (numeric > 1000) return numeric / 1000;
    if (numeric > 100) return numeric / 100;
    if (numeric > 10) return numeric / 10;
    return numeric;
  }

  return null;
}

function parseOutcomeLine(outcome) {
  const candidates = [outcome?.line, outcome?.lineEU, outcome?.lineInPoints, outcome?.lineInFractions];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric)) continue;
    if (Math.abs(numeric) >= 1000) {
      return numeric / 1000;
    }
    return numeric;
  }

  if (typeof outcome?.line === "string") {
    const parsed = Number.parseFloat(outcome.line.replace(",", "."));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function mapUnibetOdds(unibetOdds, homeTeam = "", awayTeam = "") {
  if (!unibetOdds || typeof unibetOdds !== "object") {
    return [];
  }

  const tuples = [];
  const homeAliases = getTeamAliases(homeTeam);
  const awayAliases = getTeamAliases(awayTeam);

  for (const [label, market] of Object.entries(unibetOdds)) {
    if (!market || typeof market !== "object") continue;

    const statEntry = STAT_MAP.find((item) => item.regex.test(label));
    if (!statEntry) continue;

    const normalizedLabel = normalizeLabel(label);
    const period = normalizedLabel.includes("Första halvlek") || normalizedLabel.includes("Forsta halvlek")
      ? "1ST"
      : normalizedLabel.includes("Andra halvlek")
      ? "2ND"
      : "ALL";

    let scope = "total";
    if (includesAnyLabel(label, homeAliases)) {
      scope = "home";
    } else if (includesAnyLabel(label, awayAliases)) {
      scope = "away";
    }

    const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
    const lineMap = new Map();

    for (const outcome of outcomes) {
      const line = parseOutcomeLine(outcome);
      if (line == null) continue;
      const oddsValue = parseOdds(outcome);
      if (oddsValue == null) continue;
      const direction = String(outcome?.label || outcome?.englishLabel || "")
        .toLowerCase()
        .includes("under")
        ? "under"
        : "over";

      if (!lineMap.has(line)) {
        lineMap.set(line, {});
      }
      lineMap.get(line)[direction] = oddsValue;
    }

    for (const [line, odds] of lineMap.entries()) {
      if (!odds.over && !odds.under) continue;
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

export default mapUnibetOdds;

