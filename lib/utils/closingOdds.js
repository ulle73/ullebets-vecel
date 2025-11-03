function parseOddsNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d+\/\d+$/.test(trimmed)) {
      const [numerator, denominator] = trimmed
        .split("/")
        .map((part) => Number.parseFloat(part));
      if (
        Number.isFinite(numerator) &&
        Number.isFinite(denominator) &&
        denominator !== 0
      ) {
        const decimal = numerator / denominator + 1;
        return Number(decimal.toFixed(2));
      }
    }

    const normalized = trimmed.replace(/,/g, ".");
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }

    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
  }

  return null;
}

function identifyOutcomeType(rawLabel) {
  if (rawLabel === null || rawLabel === undefined) {
    return null;
  }

  const normalized = String(rawLabel).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const sanitized = normalized.replace(/[_]/g, " ");
  const tokens = sanitized.split(/[^a-z0-9]+/).filter(Boolean);
  const tokenSet = new Set(tokens);
  const joined = tokens.join(" ");

  const hasToken = (...candidates) =>
    candidates.some((candidate) => tokenSet.has(candidate));

  if (hasToken("1", "one", "home", "h", "1x2-1")) {
    return "home";
  }

  if (hasToken("2", "two", "away", "a", "1x2-2")) {
    return "away";
  }

  if (hasToken("x", "draw", "tie", "oavgjord", "oavgjort", "kryss", "1x2-x")) {
    return "draw";
  }

  if (
    joined.includes("home win") ||
    joined.includes("home team") ||
    joined.includes("hemmaseger") ||
    joined.includes("hemmalag") ||
    joined.includes("team 1") ||
    joined.includes("lag 1") ||
    tokenSet.has("w1")
  ) {
    return "home";
  }

  if (
    joined.includes("away win") ||
    joined.includes("away team") ||
    joined.includes("bortaseger") ||
    joined.includes("bortalag") ||
    joined.includes("team 2") ||
    joined.includes("lag 2") ||
    tokenSet.has("w2")
  ) {
    return "away";
  }

  if (tokenSet.has("w0")) {
    return "draw";
  }

  return null;
}

function extractOddsValue(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) {
    return null;
  }

  if (typeof value === "number" || typeof value === "string") {
    return parseOddsNumber(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const extracted = extractOddsValue(entry, depth + 1);
      if (extracted !== null) {
        return extracted;
      }
    }
    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const candidateKeys = [
    "decimalOdds",
    "decimal",
    "odds",
    "odd",
    "price",
    "fractionalValue",
    "initialFractionalValue",
    "value",
    "numericalOdds",
    "current",
    "closing",
    "close",
    "latest",
    "final",
    "result",
    "trueOdds",
  ];

  for (const key of candidateKeys) {
    if (key in value) {
      const extracted = extractOddsValue(value[key], depth + 1);
      if (extracted !== null) {
        return extracted;
      }
    }
  }

  for (const [key, nested] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("odd") ||
      lower.includes("price") ||
      lower.includes("fraction")
    ) {
      const extracted = extractOddsValue(nested, depth + 1);
      if (extracted !== null) {
        return extracted;
      }
    }
  }

  return null;
}

const WINNING_FLAG_KEYS = [
  "winning",
  "isWinner",
  "isWinning",
  "winner",
  "won",
  "win",
  "hasWon",
  "result",
  "status",
];

function parseWinningFlag(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (value === true) {
    return true;
  }

  if (value === false) {
    return false;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (
      ["true", "winner", "won", "win", "yes", "y", "1"].includes(normalized)
    ) {
      return true;
    }

    if (
      ["false", "loser", "lost", "lose", "no", "n", "0"].includes(normalized)
    ) {
      return false;
    }
  }

  return null;
}

function updateWinnerMetadata(metadata, source, outcomeType) {
  if (!metadata || metadata.winner || !source || typeof source !== "object") {
    return;
  }

  for (const key of WINNING_FLAG_KEYS) {
    if (!(key in source)) {
      continue;
    }

    const parsed = parseWinningFlag(source[key]);
    if (parsed === true) {
      metadata.winner = outcomeType;
      return;
    }
  }
}

function mapOddsFromObject(source, metadata = null) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const result = { home: null, draw: null, away: null };
  let filled = 0;

  for (const [key, value] of Object.entries(source)) {
    const outcomeType = identifyOutcomeType(key);
    if (!outcomeType) {
      continue;
    }

    updateWinnerMetadata(metadata, value, outcomeType);

    const numeric = extractOddsValue(value, 0);
    if (numeric === null) {
      continue;
    }

    if (result[outcomeType] === null) {
      result[outcomeType] = numeric;
      filled += 1;
    }
  }

  return filled >= 2 ? result : null;
}

function normalizeOddsArray(outcomes, depth = 0, metadata = null) {
  if (!Array.isArray(outcomes) || depth > 4) {
    return null;
  }

  const result = { home: null, draw: null, away: null };
  let filled = 0;

  for (const outcome of outcomes) {
    if (!outcome || typeof outcome !== "object") {
      continue;
    }

    const nestedOutcomes =
      outcome.outcomes ||
      outcome.selections ||
      outcome.options ||
      outcome.choices ||
      outcome.results ||
      outcome.bets;

    if (nestedOutcomes) {
      const nested = normalizeOddsArray(nestedOutcomes, depth + 1, metadata);
      if (nested) {
        return nested;
      }
    }

    const labelCandidates = [
      outcome.outcome,
      outcome.outcomeCode,
      outcome.result,
      outcome.selection,
      outcome.selectionName,
      outcome.name,
      outcome.label,
      outcome.type,
      outcome.title,
      outcome.code,
      outcome.key,
      outcome.side,
      outcome.participant,
      outcome.team,
    ];

    let outcomeType = null;
    for (const label of labelCandidates) {
      outcomeType = identifyOutcomeType(label);
      if (outcomeType) {
        break;
      }
    }

    if (!outcomeType) {
      continue;
    }

    updateWinnerMetadata(metadata, outcome, outcomeType);

    const numeric = extractOddsValue(outcome, 0);
    if (numeric === null) {
      continue;
    }

    if (result[outcomeType] === null) {
      result[outcomeType] = numeric;
      filled += 1;
    }
  }

  return filled >= 2 ? result : null;
}

function searchOddsContainer(
  value,
  { allowDirectMapping = false, depth = 0, metadata = null } = {}
) {
  if (value === null || value === undefined || depth > 6) {
    return null;
  }

  // HANTERA odds.data STRUKTUR (utan att kräva metadata)
  if (Array.isArray(value)) {
    const market1x2 = value.find(
      (m) =>
        m.marketGroup === "1X2" ||
        m.marketName?.toLowerCase().includes("full time") ||
        m.marketName?.toLowerCase().includes("1x2") ||
        m.marketId === 1
    );

    if (market1x2?.choices) {
      const result = { home: null, draw: null, away: null };
      let filled = 0;
      let localWinner = null;

      for (const choice of market1x2.choices) {
        const type = identifyOutcomeType(choice.name);
        if (type && choice.fractionalValue != null) {
          result[type] = parseOddsNumber(choice.fractionalValue);
          if (choice.winning) localWinner = type;
          filled++;
        }
      }

      if (filled >= 2) {
        if (metadata && localWinner) metadata.winner = localWinner;
        return result;
      }
    }

    const direct = normalizeOddsArray(value, depth + 1, metadata);
    if (direct) {
      return direct;
    }

    for (const entry of value) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const nested = searchOddsContainer(entry, {
        allowDirectMapping,
        depth: depth + 1,
        metadata,
      });
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  if (allowDirectMapping) {
    const direct = mapOddsFromObject(value, metadata);
    if (direct) {
      return direct;
    }
  }

  const prioritizedKeys = [
    "closingOdds",
    "closing_odds",
    "finalOdds",
    "final_odds",
    "odds",
    "closing",
    "close",
    "markets",
    "market",
    "marketOdds",
    "market_odds",
    "betting",
    "betoffers",
    "outcomes",
    "selections",
    "options",
    "choices",
    "results",
    "lines",
    "bets",
    "values",
    "data",
  ];

  for (const key of prioritizedKeys) {
    if (key in value) {
      const nested = searchOddsContainer(value[key], {
        allowDirectMapping:
          key.includes("odds") || key === "closing" || key === "closingOdds",
        depth: depth + 1,
        metadata,
      });
      if (nested) {
        return nested;
      }
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (!nestedValue || typeof nestedValue !== "object") {
      continue;
    }

    const lowerKey = key.toLowerCase();
    const isLikelyMarket =
      /1x2|threeway|3way|full\s*time\s*result|fulltimeresult|match\s*result|matchresult|win.?draw.?win|moneyline/.test(
        lowerKey
      );

    if (isLikelyMarket) {
      const nested = searchOddsContainer(nestedValue, {
        allowDirectMapping: true,
        depth: depth + 1,
        metadata,
      });
      if (nested) {
        return nested;
      }
      continue;
    }

    if (
      lowerKey.includes("odds") ||
      lowerKey.includes("market") ||
      lowerKey.includes("bet") ||
      lowerKey.includes("price")
    ) {
      const nested = searchOddsContainer(nestedValue, {
        allowDirectMapping: false,
        depth: depth + 1,
        metadata,
      });
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

export function extractClosingOdds(match) {
  if (!match || typeof match !== "object") {
    return null;
  }

  const candidateSources = [
    match.odds,
    match.full?.odds,
    match.closingOdds,
    match.closing_odds,
    match.matchOdds?.closing,
    match.matchOdds?.closingOdds,
    match.matchDetails?.closingOdds,
    match.matchDetails?.closing_odds,
    match.matchDetails?.odds?.closing,
    match.matchDetails?.odds?.closingOdds,
    match.matchDetails?.odds,
    match.matchDetails?.markets,
    match.odds?.closing,
    match.odds?.closingOdds,
    match.odds,
    match.betting,
    match.odds?.data,
  ];

  for (const source of candidateSources) {
    if (!source) {
      continue;
    }

    const metadata = { winner: null };
    const normalized = searchOddsContainer(source, {
      allowDirectMapping: true,
      metadata,
    });
    if (normalized) {
      return {
        values: normalized,
        winner: metadata.winner || null,
      };
    }
  }

  const metadata = { winner: null };
  const fallback = searchOddsContainer(match, {
    allowDirectMapping: false,
    metadata,
  });

  return fallback
    ? {
        values: fallback,
        winner: metadata.winner || null,
      }
    : null;
}
