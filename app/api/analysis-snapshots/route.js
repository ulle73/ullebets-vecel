import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

export const runtime = "nodejs";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "analysis-snapshots";

function sanitizeSnapshot(body = {}) {
  const shortlist = Array.isArray(body.shortlist) ? body.shortlist.slice(0, 20) : [];
  return {
    date: typeof body.date === "string" ? body.date : null,
    strategyId: typeof body.strategyId === "string" ? body.strategyId : null,
    strategyLabel: typeof body.strategyLabel === "string" ? body.strategyLabel : null,
    analyzedMatches: Number(body.analyzedMatches) || 0,
    shortlist,
    createdAt: new Date(),
  };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 10, 1), 50);

    const client = await clientPromise;
    const docs = await client
      .db(DB_NAME)
      .collection(COLLECTION)
      .find({}, { projection: { shortlist: 1, date: 1, strategyId: 1, strategyLabel: 1, analyzedMatches: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({ items: docs });
  } catch (error) {
    console.error("[api/analysis-snapshots] GET error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const snapshot = sanitizeSnapshot(body || {});

    if (!snapshot.date || !snapshot.strategyId) {
      return NextResponse.json({ message: "Missing snapshot metadata" }, { status: 400 });
    }

    const client = await clientPromise;
    const collection = client.db(DB_NAME).collection(COLLECTION);
    await collection.insertOne(snapshot);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/analysis-snapshots] POST error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
