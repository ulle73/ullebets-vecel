import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "teamstats";
const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 5;
const MAX_DEPTH = 6;

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(
      /,/g,
      "."
    );
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseOddsNumber(value, depth = 0) {
  if (value == null || depth > 3) {
    return null;
  }
  if (typeof value === "number" || typeof value === "string") {
    return toNumber(value);
  }
  if (typeof value !== "object") {
    return null;
  }
  const candidates = [
    value.decimal,
    value.decimalOdds,
    value.odds,
    value.price,
    value.value,
    value.val,
    value.probability,
    value.coefficient,
    value.coeff,
    value.current,
    value.closing,
  ];
  for (const candidate of candidates) {
    const parsed = parseOddsNumber(candidate, depth + 1);
    if (parsed != null) {
      return parsed;
    }
  }
  return null;
}

function normalizeString(value) {
  if (value == null) return "";
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const HOME_TOKENS = [
  "home",
  "hemm",
  "lag1",
  "team1",
  "first",
  "1",
  "one",
  "1 (home)",
  "1 (hemmalag)",
  "1 (hemma)",
  "homewin",
  "hemma",
  "home team",
  "matchwinner 1",
];
const AWAY_TOKENS = [
  "away",
  "borta",
  "lag2",
  "team2",
  "second",
  "2",
  "two",
  "2 (away)",
  "2 (borta)",
  "awaywin",
  "bortalag",
  "away team",
  "matchwinner 2",
];
const DRAW_TOKENS = [
  "draw",
  "tie",
  "x",
  "oavg",
  "uavg",
  "remis",
  "unentschieden",
  "empate",
  "gelijk",
  "gelijkspel",
];

function includesToken(label, tokens) {
  for (const token of tokens) {
    if (!token) continue;
    if (label === token) return true;
    if (label.startsWith(`${token} `)) return true;
    if (label.endsWith(` ${token}`)) return true;
    if (label.includes(` ${token} `)) return true;
    if (label.includes(`${token}-`)) return true;
    if (label.includes(`-${token}`)) return true;
  }
  return false;
}

function classifyOutcomeType(entry, match) {
  const labelCandidates = [
    entry?.label,
    entry?.name,
    entry?.outcome,
    entry?.outcomeName,
    entry?.selection,
    entry?.selectionName,
    entry?.participant,
    entry?.team,
    entry?.teamName,
    entry?.shortName,
    entry?.longName,
    entry?.key,
    entry?.type,
    entry?.market,
    entry?.marketName,
    entry?.group,
    entry?.betType,
  ];

  let normalized = "";
  for (const candidate of labelCandidates) {
    normalized = normalizeString(candidate);
    if (normalized) {
      break;
    }
  }

  if (includesToken(normalized, HOME_TOKENS)) {
    return "home";
  }
  if (includesToken(normalized, AWAY_TOKENS)) {
    return "away";
  }
  if (includesToken(normalized, DRAW_TOKENS)) {
    return "draw";
  }

  const typeCandidates = [
    entry?.type,
    entry?.outcomeType,
    entry?.result,
    entry?.side,
    entry?.teamType,
  ];

  for (const candidate of typeCandidates) {
    const normalizedType = normalizeString(candidate);
    if (!normalizedType) continue;
    if (includesToken(normalizedType, HOME_TOKENS)) {
      return "home";
    }
    if (includesToken(normalizedType, AWAY_TOKENS)) {
      return "away";
    }
    if (includesToken(normalizedType, DRAW_TOKENS)) {
      return "draw";
    }
  }

  const homeName = normalizeString(
    match?.homeTeamName ?? match?.homeTeam ?? match?.home
  );
  const awayName = normalizeString(
    match?.awayTeamName ?? match?.awayTeam ?? match?.away
  );

  if (normalized && homeName && normalized.includes(homeName)) {
    return "home";
  }
  if (normalized && awayName && normalized.includes(awayName)) {
    return "away";
  }

  for (const candidate of typeCandidates) {
    const normalizedType = normalizeString(candidate);
    if (!normalizedType) continue;
    if (homeName && normalizedType.includes(homeName)) {
      return "home";
    }
    if (awayName && normalizedType.includes(awayName)) {
      return "away";
    }
  }

  return null;
}

function mergeOdds(target, update) {
  const result = { ...target };
  for (const key of ["home", "draw", "away"]) {
    if (result[key] == null && update[key] != null) {
      result[key] = update[key];
    }
  }
  return result;
}

function countOdds(result) {
  return [result.home, result.draw, result.away].filter(
    (value) => typeof value === "number"
  ).length;
}

function normalizeOddsFromArray(value, match, depth) {
  if (!Array.isArray(value)) return null;
  let result = { home: null, draw: null, away: null };
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const type = classifyOutcomeType(entry, match);
    if (!type) {
      const nested = normalizeOdds(entry, match, depth + 1);
      if (nested) {
        result = mergeOdds(result, nested);
      }
      continue;
    }
    const parsed =
      parseOddsNumber(entry) ??
      parseOddsNumber(entry.odds) ??
      parseOddsNumber(entry.value) ??
      parseOddsNumber(entry.price) ??
      parseOddsNumber(entry.decimal) ??
      parseOddsNumber(entry.decimalOdds);
    if (parsed != null && result[type] == null) {
      result[type] = parsed;
    }
  }
  return countOdds(result) >= 2 ? result : null;
}

function tryDirectObjectMapping(obj) {
  if (!obj || typeof obj !== "object") return null;
  const result = { home: null, draw: null, away: null };
  const keyMap = [
    ["home", "home"],
    ["homeWin", "home"],
    ["hemmaseger", "home"],
    ["hemmalag", "home"],
    ["1", "home"],
    ["one", "home"],
    ["lag1", "home"],
    ["team1", "home"],
    ["draw", "draw"],
    ["x", "draw"],
    ["tie", "draw"],
    ["oavgjort", "draw"],
    ["oavg", "draw"],
    ["away", "away"],
    ["awayWin", "away"],
    ["bortaseger", "away"],
    ["bortalag", "away"],
    ["2", "away"],
    ["two", "away"],
    ["lag2", "away"],
    ["team2", "away"],
  ];
  for (const [key, mapped] of keyMap) {
    if (!(key in obj)) continue;
    const raw = obj[key];
    const parsed = parseOddsNumber(raw);
    if (parsed != null && result[mapped] == null) {
      result[mapped] = parsed;
    }
    if (
      (raw && typeof raw === "object" && result[mapped] == null)
    ) {
      const nested = parseOddsNumber(raw);
      if (nested != null) {
        result[mapped] = nested;
      }
    }
  }
  return countOdds(result) >= 2 ? result : null;
}

function normalizeOdds(value, match, depth = 0) {
  if (value == null || depth > MAX_DEPTH) {
    return null;
  }
  if (Array.isArray(value)) {
    const direct = normalizeOddsFromArray(value, match, depth);
    if (direct) {
      return direct;
    }
    for (const entry of value) {
      const nested = normalizeOdds(entry, match, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
  if (typeof value !== "object") {
    return null;
  }
  const direct = tryDirectObjectMapping(value);
  if (direct) {
    return direct;
  }
  const prioritizedKeys = [
    "closingOdds",
    "closing",
    "odds",
    "markets",
    "market",
    "betting",
    "betoffers",
    "outcomes",
    "selections",
    "options",
    "choices",
    "results",
    "values",
    "lines",
    "bets",
  ];
  for (const key of prioritizedKeys) {
    if (!(key in value)) continue;
    const nested = normalizeOdds(value[key], match, depth + 1);
    if (nested) {
      return nested;
    }
  }
  for (const nestedValue of Object.values(value)) {
    if (!nestedValue || typeof nestedValue !== "object") {
      continue;
    }
    const nested = normalizeOdds(nestedValue, match, depth + 1);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function resolveTimestamp(match) {
  const raw = match?.timestamp ?? match?.matchTimestamp ?? null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric > 1e12) {
      return Math.trunc(numeric);
    }
    return Math.trunc(numeric * 1000);
  }
  if (match?.date) {
    const ms = Date.parse(match.date);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function resolveMatchId(match) {
  const candidates = [
    match?.matchId,
    match?.match_id,
    match?.id,
    match?._id,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const str = String(candidate).trim();
    if (str) return str;
  }
  return null;
}

function toInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeMatchEntry(entry, role) {
  const timestamp = resolveTimestamp(entry);
  const date = entry?.date ?? (timestamp ? new Date(timestamp).toISOString().slice(0, 10) : null);
  const match = {
    homeTeamName: entry?.homeTeamName ?? entry?.homeTeam ?? entry?.home ?? null,
    awayTeamName: entry?.awayTeamName ?? entry?.awayTeam ?? entry?.away ?? null,
  };
  const closingOdds = normalizeOdds(
    entry?.closingOdds ??
      entry?.closing_odds ??
      entry?.odds ??
      entry?.matchOdds ??
      entry?.match_details?.odds ??
      entry?.matchDetails?.odds ??
      entry?.matchDetails ??
      null,
    match
  );
  const homeScore = toInt(
    entry?.homeScore ??
      entry?.score?.home ??
      entry?.result?.home ??
      entry?.score?.fullTime?.home ??
      entry?.matchDetails?.score?.home
  );
  const awayScore = toInt(
    entry?.awayScore ??
      entry?.score?.away ??
      entry?.result?.away ??
      entry?.score?.fullTime?.away ??
      entry?.matchDetails?.score?.away
  );
  const opponentName =
    role === "home"
      ? entry?.awayTeamName ?? entry?.awayTeam ?? entry?.away ?? null
      : entry?.homeTeamName ?? entry?.homeTeam ?? entry?.home ?? null;
  const opponentId =
    role === "home"
      ? entry?.awayTeamId ?? entry?.awayTeam?.id ?? null
      : entry?.homeTeamId ?? entry?.homeTeam?.id ?? null;
  return {
    matchId: resolveMatchId(entry),
    timestamp,
    date,
    venue: role,
    opponentName,
    opponentId: opponentId ? String(opponentId) : null,
    homeTeamName: match.homeTeamName,
    awayTeamName: match.awayTeamName,
    closingOdds,
    homeScore,
    awayScore,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildIdentifierFilter(teamId, teamName) {
  const filters = [];
  if (teamId) {
    filters.push({ "_importMeta.teamId": String(teamId) });
  }
  if (teamName) {
    filters.push({
      "_importMeta.teamName": { $regex: `^${escapeRegex(teamName)}$`, $options: "i" },
    });
  }
  return filters.length ? { $or: filters } : {};
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const teamIdRaw = url.searchParams.get("teamId");
    const teamNameRaw = url.searchParams.get("team");
    const limitRaw = Number(url.searchParams.get("limit"));

    if (!teamIdRaw && !teamNameRaw) {
      return NextResponse.json(
        { message: "Missing team identifier" },
        { status: 400 }
      );
    }

    const limit = Number.isFinite(limitRaw)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limitRaw)))
      : DEFAULT_LIMIT;

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const col = db.collection(COLLECTION);

    const identifierFilter = buildIdentifierFilter(teamIdRaw, teamNameRaw);
    const cursor = col
      .find({
        ...identifierFilter,
        "_importMeta.teamRole": { $in: ["home", "away"] },
      }, {
        projection: {
          full: 1,
          "_importMeta.teamRole": 1,
          "_importMeta.teamName": 1,
          "_importMeta.teamId": 1,
          "_importMeta.sourceFile": 1,
        },
      })
      .sort({ "_importMeta.importedAt": -1 })
      .limit(2);

    const docs = await cursor.toArray();

    if (!docs.length) {
      return NextResponse.json(
        { message: "Team stats not found" },
        { status: 404 }
      );
    }

    const matches = [];
    const sourceFiles = [];
    let resolvedTeamName = null;
    let resolvedTeamId = null;

    for (const doc of docs) {
      const role = doc?._importMeta?.teamRole === "away" ? "away" : "home";
      if (!resolvedTeamName) {
        resolvedTeamName = doc?._importMeta?.teamName ?? null;
      }
      if (!resolvedTeamId) {
        resolvedTeamId = doc?._importMeta?.teamId ?? null;
      }
      if (doc?._importMeta?.sourceFile) {
        sourceFiles.push(doc._importMeta.sourceFile);
      }
      const items = Array.isArray(doc?.full) ? doc.full : [];
      for (const item of items) {
        matches.push(normalizeMatchEntry(item, role));
      }
    }

    const unique = new Map();
    for (const match of matches) {
      const key = match.matchId ?? `${match.timestamp ?? ""}:${match.venue}:${match.opponentName ?? ""}`;
      if (!unique.has(key)) {
        unique.set(key, match);
      }
    }

    const sorted = Array.from(unique.values()).sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return b.timestamp - a.timestamp;
      }
      if (a.timestamp) return -1;
      if (b.timestamp) return 1;
      return 0;
    });

    const limited = sorted.slice(0, limit);

    return NextResponse.json(
      {
        teamId: resolvedTeamId ?? (teamIdRaw ? String(teamIdRaw) : null),
        teamName: resolvedTeamName ?? teamNameRaw ?? null,
        limit,
        matches: limited,
        sourceFiles,
      },
      {
        headers: {
          "cache-control": "public, s-maxage=900, stale-while-revalidate=1800",
        },
      }
    );
  } catch (error) {
    console.error("[api/teamstats/recent] error", error);
    return NextResponse.json(
      { message: "Server error" },
      { status: 500 }
    );
  }
}
