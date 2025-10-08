import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import {
  logServerBacktestError,
  logServerBacktestStep,
} from "@/lib/backtest/logger";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "backtests";

function sanitizeLines(lines) {
  if (!Array.isArray(lines)) {
    return [];
  }
  return lines
    .filter((line) => line && typeof line === "object")
    .map((line) => ({ ...line }));
}

export async function POST(request) {
  try {
    const body = await request.json();
    logServerBacktestStep("Servern tar emot begäran om att spara backtest.", body);

    const { homeTeam, awayTeam, matchDate, lines, url } = body || {};

    if (!homeTeam || !awayTeam || !matchDate || !Array.isArray(lines)) {
      logServerBacktestError("Backtest saknar obligatoriska fält.", {
        homeTeam,
        awayTeam,
        matchDate,
        hasLines: Array.isArray(lines),
      });
      return NextResponse.json(
        { error: "Missing fields" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const collection = client.db(DB_NAME).collection(COLLECTION);

    const document = {
      homeTeam,
      awayTeam,
      matchDate,
      url: url ?? null,
      lines: sanitizeLines(lines),
      createdAt: new Date(),
      meta: {
        userAgent: request.headers.get("user-agent") ?? null,
        referer: request.headers.get("referer") ?? null,
      },
    };

    const result = await collection.insertOne(document);
    const insertedId = result.insertedId?.toString?.() ?? null;
    logServerBacktestStep("Backtest sparades i databasen.", {
      insertedId,
    });

    return NextResponse.json({
      status: "saved",
      id: insertedId,
    });
  } catch (error) {
    logServerBacktestError("Kunde inte spara backtest i databasen.", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
