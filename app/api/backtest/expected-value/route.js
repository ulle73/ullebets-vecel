import { NextResponse } from "next/server";
import { computeExpectedValue } from "@/lib/backtest/engine";
import {
  logServerBacktestError,
  logServerBacktestStep,
  resetServerBacktestSteps,
} from "@/lib/backtest/logger";

export async function POST(request) {
  try {
    resetServerBacktestSteps("/api/backtest/expected-value", {
      method: request.method,
      url: request.url,
    });
    const body = await request.json();
    logServerBacktestStep("Servern tar emot payload för expected value.", body);
    const result = await computeExpectedValue(body);
    logServerBacktestStep("Servern har beräknat expected value.", result);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kunde inte beräkna expected value";
    const status = /krävs|Okänd|Ogiltig|Inga matcher/i.test(message) ? 400 : 500;
    logServerBacktestError("Servern misslyckades med att svara på expected value.", {
      message,
      status,
    });
    return NextResponse.json({ error: message }, { status });
  }
}
