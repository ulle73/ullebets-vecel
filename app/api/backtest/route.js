import { NextResponse } from "next/server";
import { computeExpectedValue } from "@/lib/backtest/engine";
import {
  fetchTeamMatches,
  loadLeaguesAndTeams,
} from "@/lib/backtest/data";
import {
  logServerBacktestError,
  logServerBacktestStep,
  resetServerBacktestSteps,
} from "@/lib/backtest/logger";
import { mapUnibetOdds } from "@/lib/backtest/unibetOddsMapper";

const UNIBET_ENDPOINT =
  "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event";

function buildErrorResponse(message, status = 400) {
  return NextResponse.json({ message }, { status });
}

async function parseJsonBody(req) {
  try {
    return await req.json();
  } catch (error) {
    logServerBacktestError("Kunde inte tolka JSON-kropp.", { message: error?.message });
    throw new Error("Invalid JSON body");
  }
}

function extractMatchId(raw) {
  if (!raw) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const direct = trimmed.replace(/[^0-9]/g, "");
    if (direct.length >= 6) {
      const match = trimmed.match(/event\/(\d+)/i);
      if (match) return match[1];
      return direct;
    }
  }
  return null;
}

function normalizeOutcome(outcome) {
  const lineCandidates = [
    outcome?.line,
    outcome?.lineEU,
    outcome?.lineInPoints,
    outcome?.lineInFractions,
  ];

  let line = null;
  for (const candidate of lineCandidates) {
    if (candidate === undefined || candidate === null) continue;
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric)) continue;
    line = Math.abs(numeric) >= 1000 ? numeric / 1000 : numeric;
    break;
  }

  if (line == null && typeof outcome?.line === "string") {
    const parsed = Number.parseFloat(outcome.line.replace(",", "."));
    if (Number.isFinite(parsed)) {
      line = parsed;
    }
  }

  const decimalOdds = (() => {
    const asNumber = Number.parseFloat(outcome?.oddsDecimal);
    if (Number.isFinite(asNumber) && asNumber > 1) return asNumber;
    if (typeof outcome?.oddsFractional === "string") {
      const [num, den] = outcome.oddsFractional.split("/").map(Number);
      if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
        return num / den + 1;
      }
    }
    const fallback = Number.parseFloat(outcome?.odds);
    if (Number.isFinite(fallback)) {
      if (fallback > 1000) return fallback / 1000;
      if (fallback > 100) return fallback / 100;
      if (fallback > 10) return fallback / 10;
      return fallback;
    }
    return null;
  })();

  if (line == null || decimalOdds == null) {
    return null;
  }

  return {
    participant: outcome?.participant ?? null,
    label: outcome?.englishLabel ?? outcome?.label ?? "",
    odds: decimalOdds,
    line,
  };
}

function transformUnibetOdds(betOffers) {
  const odds = {};
  if (!Array.isArray(betOffers)) return odds;

  for (const offer of betOffers) {
    const label =
      offer?.criterion?.label ||
      offer?.betOfferType?.name ||
      offer?.event?.name ||
      "";

    const normalizedOutcomes = [];
    for (const outcome of offer?.outcomes ?? []) {
      const transformed = normalizeOutcome(outcome);
      if (transformed) {
        normalizedOutcomes.push(transformed);
      }
    }

    if (!normalizedOutcomes.length) continue;
    odds[label] = { outcomes: normalizedOutcomes };
  }

  return odds;
}

async function handleExpectedValue(body) {
  const {
    homeTeam,
    awayTeam,
    over,
    line,
    scope,
    stat,
    period,
    form,
    odds,
    neutralGround,
    home_importance,
    away_importance,
  } = body;

  if (!homeTeam || !awayTeam) {
    return buildErrorResponse("Hemmalag och bortalag måste anges", 400);
  }

  if (line === undefined || line === null) {
    return buildErrorResponse("Lina måste anges", 400);
  }

  const result = await computeExpectedValue({
    homeTeam,
    awayTeam,
    over,
    line,
    scope,
    stat,
    period,
    form,
    odds,
    neutralGround,
    home_importance,
    away_importance,
  });

  return NextResponse.json(result);
}

async function handleMatchData(body) {
  const { homeTeam, awayTeam, limit = 60 } = body;
  if (!homeTeam || !awayTeam) {
    return buildErrorResponse("Hemmalag och bortalag måste anges", 400);
  }

  const [homeMatches, awayMatches, leagues] = await Promise.all([
    fetchTeamMatches(homeTeam, "home"),
    fetchTeamMatches(awayTeam, "away"),
    loadLeaguesAndTeams(),
  ]);

  return NextResponse.json({
    homeMatches: Array.isArray(homeMatches) ? homeMatches.slice(0, limit) : [],
    awayMatches: Array.isArray(awayMatches) ? awayMatches.slice(0, limit) : [],
    leagues,
  });
}

async function handleUnibetOdds(body) {
  const { matchId: rawMatchId, url } = body;
  const matchId = extractMatchId(rawMatchId ?? url);
  if (!matchId) {
    return buildErrorResponse("matchId saknas", 400);
  }

  const requestUrl = `${UNIBET_ENDPOINT}/${encodeURIComponent(matchId)}.json?lang=sv_SE&market=SE&client_id=2&channel_id=1&includeParticipants=true`;

  const response = await fetch(requestUrl, {
    headers: { "user-agent": "betting-model/1.0" },
    cache: "no-store",
  });

  if (!response.ok) {
    logServerBacktestError("Misslyckades att hämta Unibet-odds.", {
      status: response.status,
      statusText: response.statusText,
    });
    return buildErrorResponse("Kunde inte hämta odds från Unibet", 502);
  }

  const data = await response.json();
  const event = Array.isArray(data?.events) ? data.events[0] ?? {} : {};
  const meta = {
    matchId,
    homeTeam: event?.homeName ?? "",
    awayTeam: event?.awayName ?? "",
    eventDate: event?.start ?? null,
  };

  const odds = transformUnibetOdds(data?.betOffers);
  const tuples = mapUnibetOdds(odds, meta.homeTeam, meta.awayTeam);

  return NextResponse.json({ meta, odds, tuples });
}

export async function POST(req) {
  resetServerBacktestSteps("Ny förfrågan mot /api/backtest");

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (error) {
    return buildErrorResponse(error.message, 400);
  }

  const action = body?.action;
  logServerBacktestStep("Inkommande förfrågan", { action });

  try {
    switch (action) {
      case "expected-value":
        return await handleExpectedValue(body);
      case "match-data":
        return await handleMatchData(body);
      case "unibet-odds":
        return await handleUnibetOdds(body);
      default:
        return buildErrorResponse("Okänd action", 400);
    }
  } catch (error) {
    logServerBacktestError("Fel i backtest-route", { message: error?.message });
    return buildErrorResponse("Serverfel i backtest-route", 500);
  }
}
