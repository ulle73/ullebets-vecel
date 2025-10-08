const OUTCOME_TOKENS = {
  home: [
    "home",
    "hemmalag",
    "hemmaseger",
    "lag1",
    "team1",
    "1",
    "w1",
    "win1",
    "team_1",
    "homewin",
  ],
  draw: [
    "draw",
    "oavgjort",
    "oavg",
    "x",
    "d",
    "tie",
    "0",
    "w0",
  ],
  away: [
    "away",
    "bortalag",
    "bortaseger",
    "lag2",
    "team2",
    "2",
    "w2",
    "win2",
    "team_2",
    "awaywin",
  ],
};

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
      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
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

  if (typeof rawLabel === "number") {
    if (rawLabel === 1) return "home";
    if (rawLabel === 0) return "draw";
    if (rawLabel === 2) return "away";
    return null;
  }

  const label = String(rawLabel).trim();
  if (!label) {
    return null;
  }

  const normalized = label.toLowerCase();

  for (const [outcome, tokens] of Object.entries(OUTCOME_TOKENS)) {
    if (tokens.some((token) => normalized === token || normalized.includes(token))) {
      return outcome;
    }
  }

  const tokenSet = new Set(normalized.split(/\s+|\W+/).filter(Boolean));

  if (tokenSet.has("home") || tokenSet.has("hemmalag") || tokenSet.has("team1") || tokenSet.has("lag1")) {
    return "home";
  }

  if (tokenSet.has("away") || tokenSet.has("bortalag") || tokenSet.has("team2") || tokenSet.has("lag2")) {
    return "away";
  }

  if (tokenSet.has("draw") || tokenSet.has("oavgjort") || tokenSet.has("oavg")) {
    return "draw";
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

    if (["true", "winner", "won", "win", "yes", "y", "1"].includes(normalized)) {
      return true;
    }

    if (["false", "loser", "lost", "lose", "no", "n", "0"].includes(normalized)) {
      return false;
    }

    return null;
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

function extractOddsValue(value, depth = 0, metadata = null) {
  if (value === null || value === undefined || depth > 4) {
    return null;
  }

  if (typeof value === "number" || typeof value === "string") {
    return parseOddsNumber(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const extracted = extractOddsValue(entry, depth + 1, metadata);
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
      const extracted = extractOddsValue(value[key], depth + 1, metadata);
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
      const extracted = extractOddsValue(nested, depth + 1, metadata);
      if (extracted !== null) {
        return extracted;
      }
    }
  }

  return null;
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

    const numeric = extractOddsValue(value, 0, metadata);
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

    const labelCandidates = [
      outcome.label,
      outcome.name,
      outcome.type,
      outcome.key,
      outcome.result,
      outcome.outcome,
      outcome.selection,
      outcome.selectionName,
      outcome.title,
      outcome.code,
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

    const numeric = extractOddsValue(outcome, depth + 1, metadata);
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

const LIKELY_MARKET_PATTERN = /1x2|threeway|3way|full\s*time\s*result|fulltimeresult|match\s*result|matchresult|win.?draw.?win|moneyline/i;

function searchOddsContainer(
  value,
  { allowDirectMapping = false, depth = 0, metadata = null } = {}
) {
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

      const label =
        entry.marketKey ||
        entry.key ||
        entry.name ||
        entry.marketName ||
        entry.label ||
        entry.type ||
        entry.betType ||
        entry.group;

      const isLikelyMarket =
        typeof label === "string" && LIKELY_MARKET_PATTERN.test(label.toLowerCase());

      if (isLikelyMarket) {
        const candidateSources = [
          entry.closingOdds,
          entry.closing,
          entry.odds?.closing,
          entry.odds?.closingOdds,
          entry.odds,
          entry.latestOdds,
          entry.currentOdds,
          entry.finalOdds,
        ];

        for (const source of candidateSources) {
          const normalized = searchOddsContainer(source, {
            allowDirectMapping: true,
            depth: depth + 1,
            metadata,
          });
          if (normalized) {
            return normalized;
          }
        }

        const outcomesSource =
          entry.outcomes ||
          entry.selections ||
          entry.options ||
          entry.choices ||
          entry.results ||
          entry.bets ||
          entry.values;

        const nestedOutcomes = searchOddsContainer(outcomesSource, {
          allowDirectMapping: true,
          depth: depth + 1,
          metadata,
        });
        if (nestedOutcomes) {
          return nestedOutcomes;
        }

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
    const isLikelyMarket = LIKELY_MARKET_PATTERN.test(lowerKey);

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

  return fallback
    ? {
        values: fallback,
        winner: metadata.winner || null,
      }
    : null;
}

export function formatOddsValue(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2)
    : "–";
}

export function resolveOddsWinnerLabel(winner) {
  if (!winner) return null;
  if (winner === "home") return "1";
  if (winner === "away") return "2";
  if (winner === "draw") return "X";
  return null;
}

