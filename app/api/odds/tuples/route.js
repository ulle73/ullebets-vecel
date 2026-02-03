import { NextResponse } from "next/server";
import { getMatchesForDate } from "@/lib/repos/fixtures";
import { findUnibetEvent, fetchUnibetOdds } from "@/lib/repos/unibet";
import mapUnibetOdds from "@/components/backtest/unibetOddsMapper";

// Smoke test:
// curl "http://localhost:3000/api/odds/tuples?date=2026-01-29&book=unibet"

const SUPPORTED_BOOK = "unibet";
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=300";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STATKEY_NORMALIZATION = new Map([
  ["totalShots", "totalShotsOnGoal"],
]);

function normalizeStatKey(value) {
  if (!value) return value;
  return STATKEY_NORMALIZATION.get(value) || value;
}

function normalizeMatchId(match) {
  const candidates = [
    match?.matchId,
    match?.id,
    match?.event?.id,
    match?.event?.matchId,
  ];
  for (const value of candidates) {
    if (value === undefined || value === null) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return null;
}

function pickTeamName(match, side) {
  if (side === "home") {
    return (
      match?.homeTeamName ||
      match?.homeTeam?.name ||
      match?.event?.homeName ||
      match?.event?.homeTeam?.name ||
      null
    );
  }
  return (
    match?.awayTeamName ||
    match?.awayTeam?.name ||
    match?.event?.awayName ||
    match?.event?.awayTeam?.name ||
    null
  );
}

function pickTeamId(match, side) {
  if (side === "home") {
    return (
      match?.homeTeamId ||
      match?.homeTeam?.id ||
      match?.event?.homeTeamId ||
      match?.event?.homeTeam?.id ||
      null
    );
  }
  return (
    match?.awayTeamId ||
    match?.awayTeam?.id ||
    match?.event?.awayTeamId ||
    match?.event?.awayTeam?.id ||
    null
  );
}

function pickLeagueName(match) {
  return (
    match?.leagueName ||
    match?.league?.name ||
    match?.tournament?.name ||
    match?.event?.tournament?.name ||
    null
  );
}

function pickTimestamp(match) {
  const raw =
    match?.startTimestamp ||
    match?.timestamp ||
    match?.matchDate ||
    match?.event?.startTimestamp ||
    match?.event?.start ||
    null;
  return raw ?? null;
}

function sortMatchesStable(matches) {
  return matches.slice().sort((a, b) => {
    const aTs = Number(a.timestamp ?? 0);
    const bTs = Number(b.timestamp ?? 0);
    if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) {
      return aTs - bTs;
    }
    const aId = String(a.matchId ?? "");
    const bId = String(b.matchId ?? "");
    return aId.localeCompare(bId);
  });
}

async function findEventWithRetry(matchInfo) {
  let match = await findUnibetEvent(matchInfo);
  if (match) return match;

  await sleep(1500);
  match = await findUnibetEvent(matchInfo, { forceRefresh: true });
  return match;
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    const book = (url.searchParams.get("book") || SUPPORTED_BOOK).toLowerCase();

    if (!date || !DATE_REGEX.test(date)) {
      return NextResponse.json(
        { message: "Missing or invalid date (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    if (book !== SUPPORTED_BOOK) {
      return NextResponse.json(
        { message: `Unsupported book '${book}'` },
        { status: 400 }
      );
    }

    const rawMatches = await getMatchesForDate(date);
    const normalized = rawMatches
      .map((match) => {
        const matchId = normalizeMatchId(match);
        const homeTeam = pickTeamName(match, "home");
        const awayTeam = pickTeamName(match, "away");
        return {
          matchId,
          leagueName: pickLeagueName(match),
          homeTeam,
          awayTeam,
          homeTeamId: pickTeamId(match, "home"),
          awayTeamId: pickTeamId(match, "away"),
          timestamp: pickTimestamp(match),
          raw: match,
        };
      })
      .filter((match) => match.matchId);

    const matches = sortMatchesStable(normalized);
    const results = [];
    const errors = [];
    
// testt föra tt see att ändringar sparas
    for (const match of matches) {
      const entry = {
        matchId: match.matchId,
        eventId: null,
        leagueName: match.leagueName || null,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        fetchedAt: null,
        tuples: [],
      };

      if (!match.homeTeam || !match.awayTeam) {
        errors.push({
          matchId: match.matchId,
          reason: "no_event_match",
          details: "missing homeTeam or awayTeam",
        });
        results.push(entry);
        continue;
      }

      const searchInfo = {
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        leagueName: match.leagueName,
        timestamp: match.timestamp,
      };

      let event = null;
      try {
        event = await findEventWithRetry(searchInfo);
      } catch (error) {
        errors.push({
          matchId: match.matchId,
          reason: "no_event_match",
          details: error?.message || "event lookup failed",
        });
        results.push(entry);
        continue;
      }

      if (!event?.eventId) {
        errors.push({
          matchId: match.matchId,
          reason: "no_event_match",
          details: "no eventId found",
        });
        results.push(entry);
        continue;
      }

      entry.eventId = event.eventId;

      let oddsData = null;
      try {
        oddsData = await fetchUnibetOdds(event.eventId);
        entry.fetchedAt = new Date().toISOString();
      } catch (error) {
        errors.push({
          matchId: match.matchId,
          reason: "unibet_fetch_failed",
          details: error?.message || "odds fetch failed",
        });
        results.push(entry);
        continue;
      }

      try {
        const tuples = mapUnibetOdds(
          oddsData?.betOffers || [],
          match.homeTeam,
          match.awayTeam
        );

        entry.tuples = Array.isArray(tuples)
          ? tuples.map((tuple) => ({
              ...tuple,
              statKey: normalizeStatKey(tuple.statKey),
            }))
          : [];

        if (!entry.tuples.length) {
          errors.push({
            matchId: match.matchId,
            reason: "parse_failed",
            details: "no tuples mapped from betOffers",
          });
        }
      } catch (error) {
        errors.push({
          matchId: match.matchId,
          reason: "parse_failed",
          details: error?.message || "odds parse failed",
        });
      }

      results.push(entry);
    }

    return NextResponse.json(
      {
        date,
        book: SUPPORTED_BOOK,
        generatedAt: new Date().toISOString(),
        matches: results,
        errors,
      },
      {
        headers: {
          "cache-control": CACHE_CONTROL,
        },
      }
    );
  } catch (error) {
    console.error("[api/odds/tuples] GET error", error);
    return NextResponse.json(
      { message: "Server error" },
      { status: 500 }
    );
  }
}
