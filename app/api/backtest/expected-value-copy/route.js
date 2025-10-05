import { NextResponse } from "next/server";
import { computeExpectedValue } from "@/lib/backtest/engine";

function parseImportance(value, label) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 10) {
    throw new Error(`${label} måste vara ett nummer mellan 1 och 10`);
  }
  return numeric;
}

export async function POST(request) {
  try {
    const body = await request.json();

    const homeImportance = parseImportance(body.home_importance ?? 5, "home_importance");
    const awayImportance = parseImportance(body.away_importance ?? 5, "away_importance");

    const result = await computeExpectedValue({
      ...body,
      home_importance: homeImportance,
      away_importance: awayImportance,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kunde inte beräkna expected value";
    const status = /måste vara ett nummer mellan 1 och 10|krävs|Okänd|Ogiltig|Inga matcher/i.test(message)
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

