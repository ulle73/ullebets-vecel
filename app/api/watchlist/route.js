import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

export const runtime = "nodejs";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "watchlist-items";

function sanitizeItem(body = {}) {
  return {
    trackingKey: typeof body.trackingKey === "string" ? body.trackingKey : null,
    matchId: body.matchId != null ? String(body.matchId) : null,
    homeTeamName: typeof body.homeTeamName === "string" ? body.homeTeamName : null,
    awayTeamName: typeof body.awayTeamName === "string" ? body.awayTeamName : null,
    leagueName: typeof body.leagueName === "string" ? body.leagueName : null,
    headline: typeof body.headline === "string" ? body.headline : null,
    strategyScore: Number.isFinite(Number(body.strategyScore)) ? Number(body.strategyScore) : null,
    confidenceScore: Number.isFinite(Number(body.confidenceScore)) ? Number(body.confidenceScore) : null,
    primaryEv: Number.isFinite(Number(body.primaryEv)) ? Number(body.primaryEv) : null,
    eventUrl: typeof body.eventUrl === "string" ? body.eventUrl : null,
    bet: body?.bet && typeof body.bet === "object" ? body.bet : null,
    proof: body?.proof && typeof body.proof === "object" ? body.proof : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function GET() {
  try {
    const client = await clientPromise;
    const items = await client
      .db(DB_NAME)
      .collection(COLLECTION)
      .find({}, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();

    return NextResponse.json({ items });
  } catch (error) {
    console.error("[api/watchlist] GET error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const item = sanitizeItem(body || {});
    if (!item.trackingKey || !item.matchId || !item.bet) {
      return NextResponse.json({ message: "Missing watchlist payload" }, { status: 400 });
    }

    const client = await clientPromise;
    await client.db(DB_NAME).collection(COLLECTION).updateOne(
      { trackingKey: item.trackingKey },
      {
        $set: {
          ...item,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/watchlist] POST error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const body = await req.json().catch(() => null);
    const trackingKey = typeof body?.trackingKey === "string" ? body.trackingKey : null;
    if (!trackingKey) {
      return NextResponse.json({ message: "Missing trackingKey" }, { status: 400 });
    }

    const client = await clientPromise;
    await client.db(DB_NAME).collection(COLLECTION).deleteOne({ trackingKey });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/watchlist] DELETE error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
