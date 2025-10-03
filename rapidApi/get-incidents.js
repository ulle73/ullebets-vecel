import { fetchWithRapidApiFallbacks, fetchFromSofaScore } from "./http-helpers.js";

const INCIDENT_ENDPOINTS = [
  {
    name: "sportapi7-incidents",
    host: "sportapi7.p.rapidapi.com",
    url: ({ matchId }) =>
      `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}/incidents`,
    transform: (data) => data ?? null,
  },
  {
    name: "sofascore-incidents",
    host: "sofascore.p.rapidapi.com",
    url: () => `https://sofascore.p.rapidapi.com/matches/get-incidents`,
    query: ({ matchId }) => ({ matchId }),
    transform: (data) => data?.incidents ?? data?.data ?? data ?? null,
  },
  {
    name: "sport-api-real-time-incidents",
    host: "sport-api-real-time.p.rapidapi.com",
    url: () => `https://sport-api-real-time.p.rapidapi.com/matches/incidents`,
    query: ({ matchId }) => ({ matchId }),
    transform: (data) => data?.data ?? data?.incidents ?? data ?? null,
  },
];


export async function fetchMatchIncidents(matchId, context) {
  const { rapidApiKeys, rapidApiState, page, logger } = context;
  let calls = 0;

  const rapidResult = await fetchWithRapidApiFallbacks({
    endpoints: INCIDENT_ENDPOINTS,
    params: { matchId },
    rapidApiKeys,
    rapidApiState,
    label: "match-incidents",
    allowEmpty: false,
    logger,
    apiStats: context?.apiCallStats,
  });
  calls += rapidResult.calls || 0;

  if (rapidResult.success) {
    return {
      incidents: rapidResult.data,
      source: rapidResult.source,
      apiKey: rapidResult.apiKey || null,
      calls,
    };
  }

  const sofaResult = await fetchFromSofaScore({
    page,
    endpoint: `event/${matchId}/incidents`,
    transform: (data) => data ?? null,
    allowEmpty: true,
    label: "match-incidents",
    logger,
    apiStats: context?.apiCallStats,
  });
  calls += sofaResult.calls || 0;

  return {
    incidents: sofaResult.success ? sofaResult.data : null,
    source: sofaResult.success ? sofaResult.source : null,
    apiKey: null,
    calls,
  };
}
