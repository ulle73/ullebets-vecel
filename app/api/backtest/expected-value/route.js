import { NextResponse } from "next/server";
import { computeExpectedValue } from "@/lib/backtest/engine";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await computeExpectedValue(body);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kunde inte beräkna expected value";
    const status = /krävs|Okänd|Ogiltig|Inga matcher/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
