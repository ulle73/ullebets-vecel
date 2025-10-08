import { NextResponse } from "next/server";
import { clientPromise } from "@/lib/db";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION_NAME = "backtests";

function isValidLineEntry(entry) {
  return entry && typeof entry === "object";
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { homeTeam, awayTeam, matchDate, lines, url } = body || {};

    if (
      !homeTeam ||
      !awayTeam ||
      !matchDate ||
      !Array.isArray(lines) ||
      lines.some((line) => !isValidLineEntry(line))
    ) {
      return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
    }

    const client = await clientPromise;
    const collection = client.db(DB_NAME).collection(COLLECTION_NAME);

    const document = {
      homeTeam,
      awayTeam,
      matchDate,
      url: url ?? "",
      lines,
      createdAt: new Date().toISOString(),
    };

    const result = await collection.insertOne(document);

    return NextResponse.json({ status: "saved", id: result.insertedId.toString() });
  } catch (error) {
    console.error("[api/save-backtest] Failed to persist backtest", error);
    return NextResponse.json(
      { error: "Could not save backtest" },
      { status: 500 }
    );
  }
}
