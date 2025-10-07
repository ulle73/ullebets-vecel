import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import {
  buildTeamClosingOddsEntries,
  DEFAULT_CLOSING_ODDS_LIMIT,
} from "@/lib/utils/closingOdds";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "teamstats";

const MAX_FETCH_LIMIT = 50;

function parsePositiveInt(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  const int = Math.trunc(num);
  return int >= 0 ? int : null;
}

function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CLOSING_ODDS_LIMIT;
  }
  return Math.max(1, Math.min(MAX_FETCH_LIMIT, Math.floor(parsed)));
}

function buildQuery(teamId) {
  return {
    $or: [
      { "full.0.homeTeamId": teamId },
      { "full.0.awayTeamId": teamId },
    ],
  };
}

function pickProjection() {
  return {
    _id: 1,
    full: { $slice: 1 },
  };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const teamIdParam = url.searchParams.get("teamId");
    const market = url.searchParams.get("market")?.toLowerCase() || "1x2";
    const limitParam = url.searchParams.get("limit");

    const teamId = parsePositiveInt(teamIdParam);

    if (!Number.isFinite(teamId)) {
      return NextResponse.json(
        { message: "teamId måste vara numeriskt" },
        { status: 400 }
      );
    }

    if (market && market !== "1x2") {
      return NextResponse.json(
        { message: "Endast 1x2 stöds för närvarande" },
        { status: 400 }
      );
    }

    const limit = parseLimit(limitParam ?? DEFAULT_CLOSING_ODDS_LIMIT);
    const fetchCount = Math.max(limit * 3, limit);

    const client = await clientPromise;
    const collection = client.db(DB_NAME).collection(COLLECTION);

    const docs = await collection
      .find(buildQuery(teamId), { projection: pickProjection() })
      .sort({ "full.0.timestamp": -1, _id: -1 })
      .limit(fetchCount)
      .toArray();

    const entries = buildTeamClosingOddsEntries(docs, teamId, { limit });

    return NextResponse.json(
      { teamId, market: "1x2", entries },
      {
        headers: {
          "cache-control": "public, s-maxage=300, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    console.error("[api/team-odds/closing] error", error);
    return NextResponse.json(
      { message: "Server error" },
      { status: 500 }
    );
  }
}
