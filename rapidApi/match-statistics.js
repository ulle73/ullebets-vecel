import {
  fetchWithRapidApiFallbacks,
  fetchFromSofaScore,
} from "./http-helpers.js";
import { RAPIDAPI_BASE_URLS, buildRapidApiUrl } from "./urls.js";

const STAT_ENDPOINTS = [
  {
    name: "sportapi7-event-statistics",
    url: ({ matchId }) =>
      buildRapidApiUrl(
        RAPIDAPI_BASE_URLS.sportapi7,
        `/api/v1/event/${matchId}/statistics`
      ),
    transform: (data) => data ?? null,
  },
  {
    name: "sofascore-event-statistics",
    url: () => buildRapidApiUrl(RAPIDAPI_BASE_URLS.sofascore, "/matches/get-statistics"),
    query: ({ matchId }) => ({ matchId }),
    transform: (data) => data?.statistics ?? data?.data ?? data ?? null,
  },
  {
    name: "sport-api-real-time-event-statistics",
    url: () =>
      buildRapidApiUrl(
        RAPIDAPI_BASE_URLS.sportApiRealTime,
        "/matches/statistics"
      ),
    query: ({ matchId }) => ({ matchId }),
    transform: (data) => data?.data ?? data?.statistics ?? data ?? null,
  },
  {
    name: "sofascore-sport-event-statistics",
    url: ({ matchId }) =>
      buildRapidApiUrl(
        RAPIDAPI_BASE_URLS.sofascoreSportApi,
        `/api/event/${matchId}/statistics`
      ),
    transform: (data) => data?.data ?? data?.statistics ?? data ?? null,
  },
  {
    name: "sofasport-event-statistics",
    url: () => buildRapidApiUrl(RAPIDAPI_BASE_URLS.sofasport, "/v1/events/statistics"),
    query: ({ matchId }) => ({ event_id: matchId }),
    transform: (data) => data?.data ?? data?.statistics ?? data ?? null,
  },
];

export async function fetchMatchStatistics(matchId, context) {
  const { rapidApiKeys, rapidApiState, page, logger } = context;
  let calls = 0;

  const statsResult = await fetchWithRapidApiFallbacks({
    endpoints: STAT_ENDPOINTS,
    params: { matchId },
    rapidApiKeys,
    rapidApiState,
    label: "match-statistics",
    allowEmpty: false,
    logger,
    apiStats: context?.apiCallStats,
  });
  calls += statsResult.calls || 0;

  if (statsResult.success) {
    return {
      statistics: statsResult.data,
      source: statsResult.source,
      apiKey: statsResult.apiKey || null,
      calls,
    };
  }

  const sofaStats = await fetchFromSofaScore({
    page,
    endpoint: `event/${matchId}/statistics`,
    transform: (data) => data ?? null,
    allowEmpty: false,
    label: "match-statistics",
    logger,
    apiStats: context?.apiCallStats,
  });
  calls += sofaStats.calls || 0;

  return {
    statistics: sofaStats.success ? sofaStats.data : null,
    source: sofaStats.success ? sofaStats.source : null,
    apiKey: null,
    calls,
  };
}
