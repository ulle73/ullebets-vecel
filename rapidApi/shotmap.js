import { fetchWithRapidApiFallbacks, fetchFromSofaScore } from "./http-helpers.js";

const SHOTMAP_ENDPOINTS = [
  {
    name: "sportapi7-shotmap",
    host: "sportapi7.p.rapidapi.com",
    url: ({ matchId }) => `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}/shotmap`,
    transform: (data) => data ?? null,
  },
  {
    name: "sofasport-shotmap",
    host: "sofasport.p.rapidapi.com",
    url: () => `https://sofasport.p.rapidapi.com/v1/events/shotmap`,
    query: ({ matchId }) => ({ event_id: matchId }),
    transform: (data) => data?.data ?? data ?? null,
  },
];

export async function fetchMatchShotmap(matchId, context) {
  const { rapidApiKeys, rapidApiState, page, logger } = context;
  let calls = 0;

  const rapidResult = await fetchWithRapidApiFallbacks({
    endpoints: SHOTMAP_ENDPOINTS,
    params: { matchId },
    rapidApiKeys,
    rapidApiState,
    label: "match-shotmap",
    allowEmpty: false,
    logger,
    apiStats: context?.apiCallStats,
  });
  calls += rapidResult.calls || 0;

  if (rapidResult.success) {
    return {
      shotmap: rapidResult.data,
      source: rapidResult.source,
      apiKey: rapidResult.apiKey || null,
      calls,
    };
  }

  const sofaResult = await fetchFromSofaScore({
    page,
    endpoint: `event/${matchId}/shotmap`,
    transform: (data) => data ?? null,
    allowEmpty: true,
    label: "match-shotmap",
    logger,
    apiStats: context?.apiCallStats,
  });
  calls += sofaResult.calls || 0;

  return {
    shotmap: sofaResult.success ? sofaResult.data : null,
    source: sofaResult.success ? sofaResult.source : null,
    apiKey: null,
    calls,
  };
}
