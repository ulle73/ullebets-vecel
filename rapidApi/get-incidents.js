import { fetchWithRapidApiFallbacks, fetchFromSofaScore } from "./http-helpers.js";
import { RAPIDAPI_BASE_URLS, buildRapidApiUrl } from "./urls.js";

const INCIDENT_ENDPOINTS = [
  {
    name: "sportapi7-incidents",
    url: ({ matchId }) =>
      buildRapidApiUrl(
        RAPIDAPI_BASE_URLS.sportapi7,
        `/api/v1/event/${matchId}/incidents`
      ),
    transform: (data) => data ?? null,
  },
  {
    name: "sofascore-incidents",
    url: () => buildRapidApiUrl(RAPIDAPI_BASE_URLS.sofascore, "/matches/get-incidents"),
    query: ({ matchId }) => ({ matchId }),
    transform: (data) => data?.incidents ?? data?.data ?? data ?? null,
  },
  {
    name: "sport-api-real-time-incidents",
    url: () =>
      buildRapidApiUrl(
        RAPIDAPI_BASE_URLS.sportApiRealTime,
        "/matches/incidents"
      ),
    query: ({ matchId }) => ({ matchId }),
    transform: (data) => data?.data ?? data?.incidents ?? data ?? null,
  },
  {
    name: "sofascore-sport-incidents",
    url: ({ matchId }) =>
      buildRapidApiUrl(
        RAPIDAPI_BASE_URLS.sofascoreSportApi,
        `/api/event/${matchId}/incidents`
      ),
    transform: (data) => data?.data ?? data?.incidents ?? data ?? null,
  },
  {
    name: "sofasport-incidents",
    url: () => buildRapidApiUrl(RAPIDAPI_BASE_URLS.sofasport, "/v1/events/incidents"),
    query: ({ matchId }) => ({ event_id: matchId }),
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
