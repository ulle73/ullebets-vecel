import { NextResponse } from "next/server";
import { computeExpectedValue } from "@/lib/backtest/engine";
import {
  fetchTeamMatches,
  fetchLeaguesAndTeams,
} from "@/lib/backtest/data";
import { logServerBacktestError, logServerBacktestStep } from "@/lib/backtest/logger";

const UNIBET_BASE_URL =
  "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event";

function json(data, init = {}) {
  return NextResponse.json(data, init);
}

function parseJsonBody(body) {
  if (!body || typeof body !== "object") {
    return {};
  }
  return body;
}

function extractAction(body) {
  const { action } = body || {};
  return typeof action === "string" ? action.toLowerCase() : null;
}

function extractUnibetEventId(input) {
  if (!input) return null;
  const str = String(input);
  const match = str.match(/event\/(\d+)/i);
  if (match) return match[1];
  const numeric = str.match(/\d+/);
  return numeric ? numeric[0] : null;
}

async function fetchUnibetOdds(eventId) {
  if (!eventId) {
    throw new Error("Missing Unibet event id");
  }
  const url = `${UNIBET_BASE_URL}/${eventId}.json?lang=sv_SE&market=SE&client_id=2&channel_id=1&includeParticipants=true`;
  const res = await fetch(url, {
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`Unibet request failed with status ${res.status}`);
  }
  return res.json();
}

async function handleExpectedValue(body) {
  const params = { ...body };
  delete params.action;
  const result = await computeExpectedValue(params);

  const [homeMatches, awayMatches] = await Promise.all([
    params.homeTeam ? fetchTeamMatches(params.homeTeam, "home") : Promise.resolve([]),
    params.awayTeam ? fetchTeamMatches(params.awayTeam, "away") : Promise.resolve([]),
  ]);

  return {
    ...result,
    homeMatches,
    awayMatches,
  };
}

async function handleUnibetOdds(body) {
  const eventId = extractUnibetEventId(body?.eventId || body?.url || body?.unibetUrl);
  if (!eventId) {
    throw new Error("Kunde inte läsa event-id från Unibet-url");
  }
  const payload = await fetchUnibetOdds(eventId);
  return {
    eventId,
    meta: {
      eventDate: payload?.event?.start,
      name: payload?.event?.name,
    },
    odds: payload?.betOffers || [],
  };
}

async function handleTeamStats(body) {
  const { teamName, matchType = "home" } = body || {};
  if (!teamName) {
    throw new Error("teamName krävs");
  }
  const matches = await fetchTeamMatches(teamName, matchType);
  return {
    teamName,
    matchType,
    matches,
  };
}

async function handleLeagues() {
  const leagues = await fetchLeaguesAndTeams();
  return { leagues };
}

export async function POST(req) {
  try {
    const body = parseJsonBody(await req.json().catch(() => null));
    const action = extractAction(body);

    if (!action) {
      return json({ message: "Missing action" }, { status: 400 });
    }

    switch (action) {
      case "expected-value": {
        logServerBacktestStep("API: expected value", body);
        const result = await handleExpectedValue(body);
        return json(result);
      }
      case "unibet-odds": {
        logServerBacktestStep("API: unibet odds", body);
        const odds = await handleUnibetOdds(body);
        return json(odds);
      }
      case "team-stats": {
        logServerBacktestStep("API: team stats", body);
        const stats = await handleTeamStats(body);
        return json(stats);
      }
      case "leagues": {
        logServerBacktestStep("API: leagues", body);
        const leagues = await handleLeagues();
        return json(leagues);
      }
      default:
        return json({ message: `Unknown action '${action}'` }, { status: 400 });
    }
  } catch (error) {
    logServerBacktestError("API error", { message: error?.message });
    return json({ message: error?.message || "Server error" }, { status: 500 });
  }
}
