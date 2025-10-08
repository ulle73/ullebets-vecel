import { NextResponse } from "next/server";
import { fetchTeamMatchesWithMeta } from "@/lib/backtest/data";
import { extractClosingOdds } from "@/lib/utils/odds";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const FETCH_MULTIPLIER = 3;
const MIN_FETCH_LIMIT = 8;

function toSafeLimit(raw) {
  if (raw === null || raw === undefined) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectTeamNameCandidates(match, side) {
  if (!match) return [];
  const prefix = side === "away" ? "away" : "home";
  const candidates = [];
  const direct = match?.[`${prefix}TeamName`];
  if (direct) {
    candidates.push(direct);
  }
  const teamField = match?.[`${prefix}Team`];
  if (typeof teamField === "string") {
    candidates.push(teamField);
  } else if (teamField && typeof teamField === "object") {
    for (const key of ["name", "teamName", "shortName", "displayName", "fullName"]) {
      if (teamField[key]) {
        candidates.push(teamField[key]);
      }
    }
  }
  return candidates.filter(Boolean);
}

function resolveVenue(match, teamName) {
  const normalizedTeam = normalizeName(teamName);
  if (!normalizedTeam) return null;

  const homeCandidates = collectTeamNameCandidates(match, "home");
  if (homeCandidates.some((candidate) => normalizeName(candidate) === normalizedTeam)) {
    return "home";
  }

  const awayCandidates = collectTeamNameCandidates(match, "away");
  if (awayCandidates.some((candidate) => normalizeName(candidate) === normalizedTeam)) {
    return "away";
  }

  return null;
}

function resolveOpponentName(match, venue, teamName) {
  if (!match) return null;
  if (venue === "home") {
    const awayCandidates = collectTeamNameCandidates(match, "away");
    return awayCandidates[0] ?? null;
  }
  if (venue === "away") {
    const homeCandidates = collectTeamNameCandidates(match, "home");
    return homeCandidates[0] ?? null;
  }

  const normalizedTeam = normalizeName(teamName);
  const combined = [
    ...collectTeamNameCandidates(match, "home"),
    ...collectTeamNameCandidates(match, "away"),
  ];
  for (const candidate of combined) {
    if (normalizeName(candidate) !== normalizedTeam) {
      return candidate;
    }
  }
  return combined[0] ?? null;
}

function resolveTimestamp(match) {
  const raw = match?.timestamp;
  const numeric = raw === null || raw === undefined ? NaN : Number(raw);
  if (Number.isFinite(numeric)) {
    if (numeric > 1e12) return numeric;
    if (numeric > 1e9) return numeric * 1000;
    return numeric;
  }
  const dateValue = match?.date || match?.matchDate || match?.eventDate;
  if (dateValue) {
    const parsed = Date.parse(dateValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function buildMatchKey(match) {
  if (!match) return null;
  const matchId = match.matchId ?? match.id ?? match._id ?? null;
  if (matchId !== null && matchId !== undefined) {
    return String(matchId);
  }
  const homeName = collectTeamNameCandidates(match, "home")[0] ?? "";
  const awayName = collectTeamNameCandidates(match, "away")[0] ?? "";
  const ts = resolveTimestamp(match);
  return `${normalizeName(homeName)}_${normalizeName(awayName)}_${ts}`;
}

function prepareMatchEntry(match, teamName, sourceRole, sourceFile) {
  const oddsInfo = extractClosingOdds(match) ?? null;
  const venue = resolveVenue(match, teamName);
  const opponentName = resolveOpponentName(match, venue, teamName);
  return {
    matchId: match?.matchId ?? match?.id ?? match?._id ?? null,
    timestamp: match?.timestamp ?? null,
    date: match?.date ?? null,
    homeTeamName: match?.homeTeamName ?? null,
    awayTeamName: match?.awayTeamName ?? null,
    opponentName: opponentName ?? null,
    venue,
    closingOdds: oddsInfo?.values ?? null,
    closingWinner: oddsInfo?.winner ?? null,
    sourceRole,
    sourceFile,
    _sortTimestamp: resolveTimestamp(match),
  };
}

function buildTeamData(teamName, homeDoc, awayDoc, limit) {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit))) : DEFAULT_LIMIT;
  const seen = new Set();
  const items = [];

  const pushMatches = (doc, role) => {
    if (!doc) return;
    const matches = Array.isArray(doc.matches) ? doc.matches : [];
    for (const match of matches) {
      const key = buildMatchKey(match);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push(prepareMatchEntry(match, teamName, role, doc.meta?.sourceFile ?? null));
    }
  };

  pushMatches(homeDoc, "home");
  pushMatches(awayDoc, "away");

  items.sort((a, b) => b._sortTimestamp - a._sortTimestamp);

  return {
    teamName,
    sources: {
      home: homeDoc?.meta?.sourceFile ?? null,
      away: awayDoc?.meta?.sourceFile ?? null,
    },
    matches: items.slice(0, safeLimit).map(({ _sortTimestamp, ...rest }) => rest),
  };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const homeTeam = url.searchParams.get("homeTeam");
    const awayTeam = url.searchParams.get("awayTeam");
    if (!homeTeam || !awayTeam) {
      return NextResponse.json({ message: "Missing homeTeam or awayTeam" }, { status: 400 });
    }

    const limit = toSafeLimit(url.searchParams.get("limit"));
    const fetchLimit = Math.max(MIN_FETCH_LIMIT, limit * FETCH_MULTIPLIER);

    const [homeHomeDoc, homeAwayDoc, awayHomeDoc, awayAwayDoc] = await Promise.all([
      fetchTeamMatchesWithMeta(homeTeam, "home", { limit: fetchLimit }),
      fetchTeamMatchesWithMeta(homeTeam, "away", { limit: fetchLimit }),
      fetchTeamMatchesWithMeta(awayTeam, "home", { limit: fetchLimit }),
      fetchTeamMatchesWithMeta(awayTeam, "away", { limit: fetchLimit }),
    ]);

    const response = {
      limit,
      homeTeam: buildTeamData(homeTeam, homeHomeDoc, homeAwayDoc, limit),
      awayTeam: buildTeamData(awayTeam, awayHomeDoc, awayAwayDoc, limit),
    };

    return NextResponse.json(response, {
      headers: {
        "cache-control": "public, s-maxage=300, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("recent-odds:error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
