import { NextResponse } from "next/server";
import { fetchUnibetOdds } from "@/lib/unibet/fetchUnibetOdds";

export async function GET(_request, { params }) {
  const matchId = params?.matchId;
  if (!matchId || !/^\d+$/.test(String(matchId))) {
    return NextResponse.json({ error: "Ogiltigt match-id" }, { status: 400 });
  }

  try {
    const data = await fetchUnibetOdds(matchId);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch Unibet odds", { matchId, error });
    return NextResponse.json(
      { error: "Kunde inte hämta Unibet-odds." },
      { status: 502 }
    );
  }
}
