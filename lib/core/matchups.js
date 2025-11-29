/**
 * @fileoverview Match normalization utilities for the Ullebets platform.
 * Shared functions for normalizing match data across backend and frontend.
 *
 * @module lib/core/matchups
 */

/**
 * Utility function to pick values from nested objects using dot notation paths.
 *
 * @param {any} v - The object to pick from
 * @param {string[]} paths - Array of dot-notation paths to try
 * @param {any} fallback - Fallback value if no path matches
 * @returns {any} The picked value or fallback
 */
function pick(v, paths, fallback = null) {
  for (const p of paths) {
    const val = p
      .split(".")
      .reduce((acc, key) => (acc == null ? acc : acc[key]), v);
    if (val != null) return val;
  }
  return fallback;
}

/**
 * Convert value to positive integer.
 *
 * @param {any} value - Value to convert
 * @returns {number|null} Positive integer or null
 */
export function toPositiveInt(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Extract score value from various possible formats.
 *
 * @param {any} value - Value to extract score from
 * @returns {number|null} Score value or null
 */
function toScoreValue(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = toScoreValue(item);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  if (typeof value === "object") {
    const keys = [
      "current",
      "display",
      "total",
      "normaltime",
      "normalTime",
      "regular",
      "fullTime",
      "ft",
      "value",
      "main",
      "score",
    ];
    for (const key of keys) {
      if (!(key in value)) continue;
      const resolved = toScoreValue(value[key]);
      if (resolved !== null) return resolved;
    }
  }
  return null;
}

/**
 * Normalize a match object from various data sources.
 * Extracts consistent fields regardless of the source format.
 *
 * @param {Object} item - Raw match data
 * @returns {Object} Normalized match object
 */
export function normalizeMatch(item) {
  if (!item) return null;

  const id = String(
    pick(
      item,
      ["id", "matchId", "event.id", "event.matchId"],
      crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
    )
  );

  const leagueId = toPositiveInt(
    pick(
      item,
      [
        "tournament.uniqueTournament.id",
        "uniqueTournament.id",
        "tournament.id",
        "event.tournament.uniqueTournament.id",
        "event.tournament.id",
      ],
      null
    )
  );

  const leagueName = pick(
    item,
    ["tournament.name", "event.tournament.name", "league.name"],
    "Unknown"
  );

  const homeTeamId = toPositiveInt(
    pick(
      item,
      ["homeTeam.id", "event.homeTeam.id", "home.id", "teams.home.id"],
      null
    )
  );
  const awayTeamId = toPositiveInt(
    pick(
      item,
      ["awayTeam.id", "event.awayTeam.id", "away.id", "teams.away.id"],
      null
    )
  );

  const homeTeamName = pick(
    item,
    ["homeTeam.name", "event.homeTeam.name", "home.name", "teams.home.name"],
    "—"
  );
  const awayTeamName = pick(
    item,
    ["awayTeam.name", "event.awayTeam.name", "away.name", "teams.away.name"],
    "—"
  );

  const homeScore = toScoreValue(
    pick(
      item,
      [
        "homeScore",
        "homeScore.current",
        "homeScore.display",
        "homeScore.total",
        "event.homeScore",
        "event.homeScore.current",
        "event.homeScore.display",
        "event.homeScore.total",
        "score.home",
        "scores.home",
        "event.score.home",
        "event.scores.home",
        "result.home",
        "event.result.home",
      ],
      null
    )
  );

  const awayScore = toScoreValue(
    pick(
      item,
      [
        "awayScore",
        "awayScore.current",
        "awayScore.display",
        "awayScore.total",
        "event.awayScore",
        "event.awayScore.current",
        "event.awayScore.display",
        "event.awayScore.total",
        "score.away",
        "scores.away",
        "event.score.away",
        "event.scores.away",
        "result.away",
        "event.result.away",
      ],
      null
    )
  );

  const timestampRaw = pick(
    item,
    ["startTimestamp", "event.startTimestamp", "timestamp", "kickoffTime"],
    null
  );
  const timestamp = Number(timestampRaw);
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : null;

  return {
    id,
    matchId: id,
    leagueId,
    leagueName,
    homeTeamName,
    awayTeamName,
    homeTeamId,
    awayTeamId,
    timestamp: safeTimestamp,
    raw: item,
    homeScore,
    awayScore,
  };
}