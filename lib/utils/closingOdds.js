if (process.env.NEXT_RUNTIME) {
  await import("server-only");
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

const MARKET_REGEX =
  /1x2|threeway|3way|full\s*time\s*result|fulltimeresult|match\s*result|matchresult|win.?draw.?win|moneyline/;

const OUTCOME_LABEL_CANDIDATES = [
  "outcome",
  "outcomeCode",
  "result",
  "selection",
  "selectionName",
  "name",
  "label",
  "type",
  "title",
  "code",
  "key",
  "side",
  "participant",
  "team",
];

const NESTED_OUTCOMES_KEYS = [
  "outcomes",
  "selections",
  "options",
  "choices",
  "results",
  "bets",
  "values",
];

const MARKET_LABEL_KEYS = [
  "marketKey",
  "key",
  "name",
  "marketName",
  "label",
  "type",
  "betType",
  "group",
];

const ODDS_CONTAINER_KEYS = [
  "closingOdds",
  "closing",
  "odds",
  "latestOdds",
  "currentOdds",
  "finalOdds",
];

const DIRECT_CHILD_KEYS = [
  "markets",
  "market",
  "marketOdds",
  "market_odds",
  "betting",
  "betoffers",
  "odds",
  "closing",
  "close",
  "outcomes",
  "selections",
  "options",
  "choices",
  "results",
  "lines",
  "bets",
  "values",
];

const ODDS_VALUE_KEYS = [
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

const DEFAULT_LIMIT = 5;

function parseOddsNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Number(value.toFixed(2));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
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

    if (["true", "winner", "won", "win", "yes", "y", "1"].includes(normalized)) {
      return true;
    }

    if (["false", "loser", "lost", "lose", "no", "n", "0"].includes(normalized)) {
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

  const hasToken = (...candidates) => candidates.some((candidate) => tokenSet.has(candidate));

  if (hasToken("1", "one", "home")) {
    return "home";
  }

  if (hasToken("2", "two", "away")) {
    return "away";
  }

  if (hasToken("x", "draw", "tie", "oavgjord", "oavgjort", "kryss")) {
    return "draw";
  }

  if (
    tokens.some((token) => token.startsWith("1x2") && token.endsWith("1")) ||
    joined.includes("1x2 1") ||
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
    tokens.some((token) => token.startsWith("1x2") && token.endsWith("2")) ||
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

  if (tokens.some((token) => token.startsWith("1x2") && token.endsWith("x")) || tokenSet.has("w0")) {
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

  for (const key of ODDS_VALUE_KEYS) {
    if (key in value) {
      const extracted = extractOddsValue(value[key], depth + 1);
      if (extracted !== null) {
        return extracted;
      }
    }
  }

  for (const [key, nested] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower.includes("odd") || lower.includes("price") || lower.includes("fraction")) {
      const extracted = extractOddsValue(nested, depth + 1);
      if (extracted !== null) {
        return extracted;
      }
    }
  }

  return null;
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

    for (const key of NESTED_OUTCOMES_KEYS) {
      if (!outcome[key]) {
        continue;
      }
      const nested = normalizeOddsArray(outcome[key], depth + 1, metadata);
      if (nested) {
        return nested;
      }
    }

    let outcomeType = null;
    for (const labelKey of OUTCOME_LABEL_CANDIDATES) {
      if (!(labelKey in outcome)) {
        continue;
      }
      outcomeType = identifyOutcomeType(outcome[labelKey]);
      if (outcomeType) {
        break;
      }
    }

    if (!outcomeType) {
      continue;
    }

    updateWinnerMetadata(metadata, outcome, outcomeType);

    const numeric = extractOddsValue(outcome, depth + 1);
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

function searchOddsContainer(value, { allowDirectMapping = false, depth = 0, metadata = null } = {}) {
  if (value === null || value === undefined || depth > 6) {
    return null;
  }

  if (Array.isArray(value)) {
    const direct = normalizeOddsArray(value, depth + 1, metadata);
    if (direct) {
      return direct;
    }

    for (const entry of value) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      let label = null;
      for (const key of MARKET_LABEL_KEYS) {
        if (key in entry) {
          label = entry[key];
          break;
        }
      }

      const isLikelyMarket =
        typeof label === "string" && MARKET_REGEX.test(label.toLowerCase());

      if (isLikelyMarket) {
        for (const key of ODDS_CONTAINER_KEYS) {
          if (!(key in entry)) {
            continue;
          }
          const normalized = searchOddsContainer(entry[key], {
            allowDirectMapping: true,
            depth: depth + 1,
            metadata,
          });
          if (normalized) {
            return normalized;
          }
        }

        for (const nestedKey of NESTED_OUTCOMES_KEYS) {
          if (!(nestedKey in entry)) {
            continue;
          }
          const nestedOutcomes = searchOddsContainer(entry[nestedKey], {
            allowDirectMapping: true,
            depth: depth + 1,
            metadata,
          });
          if (nestedOutcomes) {
            return nestedOutcomes;
          }
        }
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
    const asArray = normalizeOddsArray(Object.values(value), depth + 1, metadata);
    if (asArray) {
      return asArray;
    }

    const mapped = mapOddsFromObject(value, metadata);
    if (mapped) {
      return mapped;
    }
  }

  for (const key of DIRECT_CHILD_KEYS) {
    if (!(key in value)) {
      continue;
    }

    const nested = searchOddsContainer(value[key], {
      allowDirectMapping: key.includes("odds") || key === "closing" || key === "closingOdds",
      depth: depth + 1,
      metadata,
    });

    if (nested) {
      return nested;
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (!nestedValue || typeof nestedValue !== "object") {
      continue;
    }

    const lowerKey = key.toLowerCase();
    const isLikelyMarket = MARKET_REGEX.test(lowerKey);

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

  if (fallback) {
    return {
      values: fallback,
      winner: metadata.winner || null,
    };
  }

  return null;
}

export function buildTeamClosingOddsEntries(docs, teamId, { limit = DEFAULT_LIMIT } = {}) {
  if (!Array.isArray(docs) || !Number.isFinite(teamId)) {
    return [];
  }

  const normalizedLimit = Math.max(1, Math.min(50, limit));

  const entries = [];

  for (const doc of docs) {
    if (!doc) {
      continue;
    }

    const f0 = Array.isArray(doc.full) ? doc.full[0] ?? {} : doc.full?.[0] ?? {};
    const matchInfo = { ...f0 };

    const closing = extractClosingOdds(matchInfo);
    if (!closing?.values) {
      continue;
    }

    const { home, draw, away } = closing.values;
    if ([home, draw, away].filter((v) => typeof v === "number").length < 2) {
      continue;
    }

    const isHome = Number(f0.homeTeamId) === teamId;
    const isAway = Number(f0.awayTeamId) === teamId;
    if (!isHome && !isAway) {
      continue;
    }

    const rawTs =
      f0.timestamp ??
      f0.utcDate ??
      f0.startTime ??
      f0.startTimestamp ??
      f0.kickoff ??
      f0.kickoffTime ??
      f0.matchTime ??
      doc.timestamp ??
      doc.lastUpdated ??
      null;

    const timestamp = rawTs ? new Date(rawTs).toISOString() : null;

    entries.push({
      matchId: doc._id ?? null,
      market: "1x2",
      timestamp,
      side: isHome ? "home" : "away",
      opponent: {
        teamId: isHome ? f0.awayTeamId ?? null : f0.homeTeamId ?? null,
        name: isHome ? f0.awayTeamName ?? null : f0.homeTeamName ?? null,
      },
      odds: {
        home: typeof home === "number" ? home : null,
        draw: typeof draw === "number" ? draw : null,
        away: typeof away === "number" ? away : null,
      },
      winner: closing.winner ?? null,
    });
  }

  entries.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  return entries.slice(0, normalizedLimit);
}

export const DEFAULT_CLOSING_ODDS_LIMIT = DEFAULT_LIMIT;
