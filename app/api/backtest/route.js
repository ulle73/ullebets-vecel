import { NextResponse } from "next/server";

import { computeExpectedValue } from "@/lib/backtest/engine";
import {
  fetchLeaguesAndTeams,
  fetchTeamMatches,
} from "@/lib/backtest/data";
import {
  logServerBacktestError,
  logServerBacktestStep,
  resetServerBacktestSteps,
} from "@/lib/backtest/logger";

const JSON_HEADERS = {
  "cache-control": "no-store",
};

function parseUnibetMatchId(body) {
  if (!body) return null;
  if (body.matchId) {
    const trimmed = String(body.matchId).trim();
    if (trimmed) return trimmed;
  }
  if (body.url || body.unibetUrl) {
    const source = String(body.url || body.unibetUrl);
    const match = source.match(/event\/(\d+)/i);
    if (match) return match[1];
  }
  return null;
}

async function handleExpectedValue(body = {}) {
  resetServerBacktestSteps("expected-value");
  const result = await computeExpectedValue(body);
  return NextResponse.json(result, { headers: JSON_HEADERS });
}

async function handleInitialize(body = {}) {
  const homeTeam = body.homeTeam;
  const awayTeam = body.awayTeam;

  if (!homeTeam || !awayTeam) {
    return NextResponse.json(
      { error: "Missing homeTeam or awayTeam" },
      { status: 400 }
    );
  }

  logServerBacktestStep("Initierar backtest-datahämtning", {
    homeTeam,
    awayTeam,
  });

  const [homeHome, homeAway, awayHome, awayAway, leagues] = await Promise.all([
    fetchTeamMatches(homeTeam, "home"),
    fetchTeamMatches(homeTeam, "away"),
    fetchTeamMatches(awayTeam, "home"),
    fetchTeamMatches(awayTeam, "away"),
    fetchLeaguesAndTeams(),
  ]);

  const payload = {
    leagues: leagues || null,
    matches: {
      home: {
        home: homeHome,
        away: homeAway,
      },
      away: {
        home: awayHome,
        away: awayAway,
      },
    },
  };

  return NextResponse.json(payload, { headers: JSON_HEADERS });
}

function toDecimalOdds(outcome) {
  if (!outcome) return null;
  if (typeof outcome.odds === "object" && outcome.odds?.decimal) {
    const num = Number(outcome.odds.decimal);
    return Number.isFinite(num) ? num.toFixed(2) : null;
  }
  if (outcome.oddsDecimal != null) {
    const num = Number(outcome.oddsDecimal);
    return Number.isFinite(num) ? num.toFixed(2) : null;
  }
  if (outcome.oddsFractional) {
    const [num, denom] = String(outcome.oddsFractional)
      .split("/")
      .map(Number);
    if (Number.isFinite(num) && Number.isFinite(denom) && denom !== 0) {
      return (num / denom + 1).toFixed(2);
    }
  }
  if (outcome.oddsAmerican) {
    const american = Number(outcome.oddsAmerican);
    if (Number.isFinite(american)) {
      if (american >= 100) {
        return (american / 100 + 1).toFixed(2);
      }
      if (american <= -100) {
        return (100 / Math.abs(american) + 1).toFixed(2);
      }
    }
  }
  return null;
}

async function handleUnibetOdds(body = {}) {
  const matchId = parseUnibetMatchId(body);
  if (!matchId) {
    return NextResponse.json(
      { error: "Missing Unibet match id" },
      { status: 400 }
    );
  }

  const url = `https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event/${matchId}.json?lang=sv_SE&market=SE&client_id=2&channel_id=1&includeParticipants=true`;

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return NextResponse.json(
      { error: `Unibet request failed with status ${response.status}` },
      { status: response.status }
    );
  }

  const data = await response.json();
  const event = Array.isArray(data.events) ? data.events[0] || {} : {};

  const meta = {
    homeTeam: event.homeName || "",
    awayTeam: event.awayName || "",
    eventDate: event.start || null,
  };

  const odds = {};
  for (const offer of data.betOffers || []) {
    const label = offer?.criterion?.label;
    if (!label) continue;

    const outcomes = [];
    for (const outcome of offer.outcomes || []) {
      const formattedLine =
        typeof outcome.line === "number"
          ? (outcome.line / 1000).toFixed(3)
          : "x";
      const decimalOdds = toDecimalOdds(outcome);
      outcomes.push({
        participant: outcome.participant || null,
        label: outcome.englishLabel || outcome.label || null,
        line: formattedLine,
        odds: decimalOdds,
      });
    }

    if (outcomes.length) {
      odds[label] = { outcomes };
    }
  }

  return NextResponse.json({ meta, odds }, { headers: JSON_HEADERS });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const action = body?.action ?? "expectedValue";

    if (action === "expectedValue") {
      return await handleExpectedValue(body);
    }
    if (action === "initialize") {
      return await handleInitialize(body);
    }
    if (action === "unibetOdds") {
      return await handleUnibetOdds(body);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    logServerBacktestError("Fel i backtest-route", {
      message: error?.message,
      stack: error?.stack,
    });
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
