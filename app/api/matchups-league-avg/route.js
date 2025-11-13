import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "matchups-league-avg";
const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=3600";

export const runtime = "nodejs";

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    if (!date) {
      return NextResponse.json({ message: "Missing date" }, { status: 400 });
    }

    const client = await clientPromise;
    const doc = await client.db(DB_NAME).collection(COLLECTION).findOne({ _id: date });

    if (!doc?.data) {
      return NextResponse.json(
        { message: "Matchups data not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(doc.data, {
      headers: {
        "cache-control": CACHE_CONTROL,
      },
    });
  } catch (error) {
    console.error("[api/matchups-league-avg] GET error", error);
    return NextResponse.json(
      { message: "Server error" },
      { status: 500 }
    );
  }
}
