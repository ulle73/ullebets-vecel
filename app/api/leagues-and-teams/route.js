import { NextResponse } from "next/server";
import { clientPromise } from "@/lib/db";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION_NAME = "leagues-and-teams";

function sanitizeDocument(doc) {
  if (!doc || typeof doc !== "object") {
    return null;
  }
  const { _id, ...rest } = doc;
  if (rest.data && typeof rest.data === "object") {
    return rest.data;
  }
  if (rest.leagues && typeof rest.leagues === "object") {
    return rest.leagues;
  }
  return rest;
}

async function loadLeaguesFromDb() {
  const client = await clientPromise;
  const collection = client.db(DB_NAME).collection(COLLECTION_NAME);

  const primaryDoc = await collection.findOne({ _id: "leagues-and-teams" });
  const sanitizedPrimary = sanitizeDocument(primaryDoc);
  if (sanitizedPrimary && Object.keys(sanitizedPrimary).length > 0) {
    return sanitizedPrimary;
  }

  const docs = await collection.find({}).toArray();
  if (!docs.length) {
    return null;
  }

  const aggregated = {};
  for (const doc of docs) {
    const sanitized = sanitizeDocument(doc);
    if (!sanitized || typeof sanitized !== "object") {
      continue;
    }
    const key =
      doc?.name ||
      doc?.leagueName ||
      doc?._id ||
      sanitized?.name ||
      sanitized?.leagueName;
    if (!key) {
      continue;
    }
    aggregated[key] = sanitized;
  }

  return Object.keys(aggregated).length > 0 ? aggregated : null;
}

export async function GET() {
  try {
    const leagues = await loadLeaguesFromDb();
    if (!leagues) {
      return NextResponse.json(
        { error: "Leagues data not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(leagues, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/leagues-and-teams] Failed to load leagues", error);
    return NextResponse.json(
      { error: "Failed to load leagues" },
      { status: 500 }
    );
  }
}
