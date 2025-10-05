import { NextResponse } from "next/server";
import { fetchUnibetOdds } from "@/lib/unibet/fetch-unibet-odds";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const matchId = params?.matchId;

  if (!matchId || typeof matchId !== "string") {
    return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
  }

  try {
    const odds = await fetchUnibetOdds(matchId);
    return NextResponse.json(odds, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch Unibet odds", error);
    return NextResponse.json(
      {
        error: "Failed to fetch Unibet odds",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
