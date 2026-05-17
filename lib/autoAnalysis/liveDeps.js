import mapUnibetOdds from "../../components/backtest/unibetOddsMapper.js";
import { calculateEVFromData } from "../backtest/engine.js";
import { fetchTeamMatches, fetchTeamProfilesBundle } from "../backtest/data.js";
import { findUnibetEventForMatch, UNIBET_EVENT_BASE_URL } from "../backtest/unibetAuto.js";

const UNIBET_BASE_URL =
  "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event";

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

async function lookupOdds(matchInfo) {
  const directEventId = matchInfo?.eventId || matchInfo?.raw?.event?.id || matchInfo?.raw?.eventId;
  if (directEventId) {
    const oddsPayload = await fetchUnibetOdds(directEventId);
    return {
      odds: oddsPayload?.betOffers || [],
      eventUrl: `${UNIBET_EVENT_BASE_URL.replace(/\/$/, "")}/${directEventId}`,
    };
  }

  let match = await findUnibetEventForMatch({
    homeTeam: matchInfo?.homeTeamName,
    awayTeam: matchInfo?.awayTeamName,
    leagueName: matchInfo?.leagueName,
    timestamp: matchInfo?.timestamp,
    start: matchInfo?.raw?.event?.start || null,
  });

  if (!match) {
    await sleep(1500);
    match = await findUnibetEventForMatch({
      homeTeam: matchInfo?.homeTeamName,
      awayTeam: matchInfo?.awayTeamName,
      leagueName: matchInfo?.leagueName,
      timestamp: matchInfo?.timestamp,
      start: matchInfo?.raw?.event?.start || null,
    }, { forceRefresh: true });
  }

  if (!match) {
    throw new Error("Kunde inte hitta match i Unibets listView");
  }

  const oddsPayload = await fetchUnibetOdds(match.eventId);
  return {
    odds: oddsPayload?.betOffers || [],
    eventUrl: match.eventUrl,
  };
}

async function evaluateBatchBets(bets) {
  if (!Array.isArray(bets) || !bets.length) return [];

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

  const teamData = {};
  for (const teamName of uniqueTeams) {
    const { profiles, homeMatches, awayMatches } = teamDataPromises[teamName];
    teamData[teamName] = {
      profiles: await profiles,
      homeMatches: await homeMatches,
      awayMatches: await awayMatches,
    };
  }

  return Promise.all(
    bets.map(async (betParams) => {
      try {
        const homeData = teamData[betParams.homeTeam];
        const awayData = teamData[betParams.awayTeam];

        if (!homeData || !awayData) {
          throw new Error(`Missing data for ${betParams.homeTeam} or ${betParams.awayTeam}`);
        }

        return await calculateEVFromData(betParams, {
          homeBundle: homeData.profiles,
          awayBundle: awayData.profiles,
          homeMatchesRaw: betParams.neutralGround ? homeData.awayMatches : homeData.homeMatches,
          awayMatchesRaw: awayData.awayMatches,
        });
      } catch (error) {
        return { params: betParams, error: error?.message || "Unknown error" };
      }
    })
  );
}

export function createLiveAutoAnalysisDeps() {
  return {
    lookupOdds,
    mapOdds: (odds, homeTeamName, awayTeamName) => mapUnibetOdds(odds, homeTeamName, awayTeamName),
    evaluateBatchBets,
  };
}
