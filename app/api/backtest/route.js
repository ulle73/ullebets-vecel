import { NextResponse } from "next/server";
import { computeExpectedValue, calculateEVFromData } from "@/lib/backtest/engine";
import {
  fetchTeamMatches,
  fetchLeaguesAndTeams,
  fetchTeamProfilesBundle,
} from "@/lib/backtest/data";
import {
  findUnibetEventForMatch,
  UNIBET_EVENT_BASE_URL,
} from "@/lib/backtest/unibetAuto";
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  return result;
}

async function handleBatchExpectedValue(body) {
    const bets = body?.bets;
    if (!Array.isArray(bets) || !bets.length) {
      throw new Error("`bets` array is required for batch action");
    }
  
    logServerBacktestStep("API: Batch Start", { count: bets.length });
  
    // 1. Deduplicate data fetching
    const uniqueTeams = new Set();
    bets.forEach((bet) => {
      if (bet.homeTeam) uniqueTeams.add(bet.homeTeam);
      if (bet.awayTeam) uniqueTeams.add(bet.awayTeam);
    });
  
    const teamDataPromises = {};
    uniqueTeams.forEach((teamName) => {
      teamDataPromises[teamName] = {
        profiles: fetchTeamProfilesBundle(teamName),
        homeMatches: fetchTeamMatches(teamName, "home"),
        awayMatches: fetchTeamMatches(teamName, "away"),
      };
    });
  
    // Wait for all data to be fetched
    const teamData = {};
    for (const teamName of uniqueTeams) {
      const { profiles, homeMatches, awayMatches } = teamDataPromises[teamName];
      teamData[teamName] = {
        profiles: await profiles,
        homeMatches: await homeMatches,
        awayMatches: await awayMatches,
      };
    }
  
    logServerBacktestStep("API: Batch Data Fetched", { teams: uniqueTeams.size });
  
    // 2. Process bets in parallel with pre-fetched data
    const results = await Promise.all(
      bets.map(async (betParams) => {
        try {
          const homeData = teamData[betParams.homeTeam];
          const awayData = teamData[betParams.awayTeam];
  
          if (!homeData || !awayData) {
            throw new Error(`Missing data for ${betParams.homeTeam} or ${betParams.awayTeam}`);
          }
  
          const fetchedData = {
            homeBundle: homeData.profiles,
            awayBundle: awayData.profiles,
            homeMatchesRaw: betParams.neutralGround ? homeData.awayMatches : homeData.homeMatches,
            awayMatchesRaw: awayData.awayMatches,
          };
  
          // Call the calculation-only function
          return await calculateEVFromData(betParams, fetchedData);
        } catch (e) {
          logServerBacktestError("API: Batch item error", { message: e?.message, params: betParams });
          // Return a result that indicates an error for this specific bet
          return { params: betParams, error: e?.message || "Unknown error" };
        }
      })
    );
  
    logServerBacktestStep("API: Batch Complete", { results: results.length });
    return results;
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

async function handleAutoUnibetOdds(body) {
  const directEventId = extractUnibetEventId(body?.eventId);
  if (directEventId) {
    const odds = await handleUnibetOdds({ eventId: directEventId });
    return {
      ...odds,
      eventUrl: `${UNIBET_EVENT_BASE_URL.replace(/\/$/, "")}/${directEventId}`,
    };
  }

  const matchInfo = {
    homeTeam: body?.homeTeam || body?.homeTeamName,
    awayTeam: body?.awayTeam || body?.awayTeamName,
    leagueName: body?.leagueName,
    timestamp: body?.timestamp,
    kickoff: body?.kickoff,
    start: body?.start,
  };

  if (!matchInfo.homeTeam || !matchInfo.awayTeam) {
    throw new Error("Saknar lag för automatisk Unibet-hämtning");
  }

  let match = await findUnibetEventForMatch(matchInfo);
  if (!match) {
    console.warn("Unibet auto: initial lookup miss, retrying with refresh", {
      league: matchInfo.leagueName,
      home: matchInfo.homeTeam,
      away: matchInfo.awayTeam,
    });
    await sleep(1500);
    match = await findUnibetEventForMatch(matchInfo, { forceRefresh: true });
  }
  if (!match) {
    throw new Error("Kunde inte hitta match i Unibets listView");
  }

  const odds = await handleUnibetOdds({ eventId: match.eventId });
  return {
    ...odds,
    eventUrl: match.eventUrl,
    matched: {
      home: match.homeTeam,
      away: match.awayTeam,
      league: match.league,
      start: match.start,
    },
  };
}

async function handleTeamStats(body) {
  const { teamName, matchType = "all" } = body || {};
  if (!teamName) {
    throw new Error("teamName krävs");
  }

  if (matchType === "all") {
    const [homeMatches, awayMatches] = await Promise.all([
      fetchTeamMatches(teamName, "home"),
      fetchTeamMatches(teamName, "away"),
    ]);
    return { matches: [...homeMatches, ...awayMatches] };
  }

  // Fallback för specifika anrop (home/away)
  const matches = await fetchTeamMatches(teamName, matchType);
  return { teamName, matchType, matches };
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
      case "batch-expected-value": {
        logServerBacktestStep("API: batch expected value", { count: body?.bets?.length });
        const results = await handleBatchExpectedValue(body);
        return json(results);
      }
      case "unibet-odds": {
        logServerBacktestStep("API: unibet odds", body);
        const odds = await handleUnibetOdds(body);
        return json(odds);
      }
      case "auto-unibet-odds": {
        logServerBacktestStep("API: auto unibet odds", body);
        const odds = await handleAutoUnibetOdds(body);
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
