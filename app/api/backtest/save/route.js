import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION_NAME = "backtests";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9&]+/g, "_")
    .replace(/^_|_$/g, "");
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { homeTeam, awayTeam, matchDate, lines, url } = body ?? {};

    if (!homeTeam || !awayTeam || !matchDate || !Array.isArray(lines)) {
      return NextResponse.json(
        { error: "Missing fields" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const collection = client.db(DB_NAME).collection(COLLECTION_NAME);

    const now = new Date();
    const matchDirName = `${slugify(homeTeam)}-${slugify(awayTeam)}-${matchDate}`;
    const fileName = `${now.toISOString().replace(/[:.]/g, "-")}.json`;

    await collection.insertOne({
      homeTeam,
      awayTeam,
      matchDate,
      url: url ?? "",
      lines,
      matchDirName,
      fileName,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      status: "saved",
      file: `${matchDirName}/${fileName}`,
    });
  } catch (error) {
    console.error("[api/backtest/save] Failed to save backtest", error);
    return NextResponse.json(
      { error: "Could not save backtest" },
      { status: 500 }
    );
  }
}
