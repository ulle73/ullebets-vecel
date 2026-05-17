import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import {
  AUTO_ANALYSIS_RUN_COLLECTION,
} from "@/lib/autoAnalysis/store";
import { executeAndPersistAutoAnalysisRun } from "@/lib/autoAnalysis/executeRun";

export const runtime = "nodejs";

const DB_NAME = process.env.MONGODB_DB || "app";

function sanitizeMatches(matches) {
  return Array.isArray(matches)
    ? matches
        .map((match) => ({
          ...match,
          matchId: match?.matchId ?? match?.id ?? null,
        }))
        .filter((match) => match?.matchId || match?.homeTeamName || match?.awayTeamName)
    : [];
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 10, 1), 50);
    const date = url.searchParams.get("date");
    const strategyId = url.searchParams.get("strategyId");
    const checkpointKey = url.searchParams.get("checkpointKey");

    const query = {};
    if (date) query.date = date;
    if (strategyId) query.strategyId = strategyId;
    if (checkpointKey) query.checkpointKey = checkpointKey;

    const client = await clientPromise;
    const items = await client
      .db(DB_NAME)
      .collection(AUTO_ANALYSIS_RUN_COLLECTION)
      .find(query, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({ items });
  } catch (error) {
    console.error("[api/auto-analysis-runs] GET error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const date = typeof body?.date === "string" ? body.date : null;
    const strategyId = typeof body?.strategyId === "string" ? body.strategyId : "balanced";
    const source = typeof body?.source === "string" ? body.source : "manual-ui";
    const matches = sanitizeMatches(body?.matches);

    if (!date || !matches.length) {
      return NextResponse.json({ message: "Missing auto analysis payload" }, { status: 400 });
    }

    const now = new Date();
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const result = await executeAndPersistAutoAnalysisRun({
      db,
      date,
      matches,
      strategyId,
      strategyLabel: typeof body?.strategyLabel === "string" ? body.strategyLabel : null,
      source,
      learningProfile: body?.learningProfile || null,
      checkpoint: body?.checkpoint && typeof body.checkpoint === "object" ? body.checkpoint : null,
      now,
      deterministicRunId: false,
    });

    return NextResponse.json({
      run: result.run,
      summary: result.summary,
      bestOverall: result.bestOverall,
      shortlist: result.shortlist,
      candidates: result.qualifyingCandidates,
    });
  } catch (error) {
    console.error("[api/auto-analysis-runs] POST error", error);
    return NextResponse.json({ message: error?.message || "Server error" }, { status: 500 });
  }
}
