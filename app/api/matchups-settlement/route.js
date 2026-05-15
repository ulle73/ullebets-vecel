import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import { enrichMatchupsForDate, buildRapidContext } from "@/lib/matchupsEnrichment";
import { assertPastStockholmDate } from "@/lib/stockholmDate";

export const runtime = "nodejs";

const DB_NAME = process.env.MONGODB_DB || "app";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const date = typeof body?.date === "string" ? body.date.trim() : "";
    const targetDate = assertPastStockholmDate(date);

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const result = await enrichMatchupsForDate(db, targetDate, buildRapidContext(console), {
      persistFiles: false,
      logger: console,
    });

    return NextResponse.json({
      ok: true,
      date: targetDate,
      result,
      message: `Rättning klar för ${targetDate}.`,
    });
  } catch (error) {
    const message = error?.message || "Server error";
    const status = /senare än matchens datum|Ogiltigt datum/i.test(message) ? 400 : 500;
    console.error("[api/matchups-settlement] POST error", error);
    return NextResponse.json({ message }, { status });
  }
}

