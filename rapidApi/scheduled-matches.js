import { fetchWithRapidApiFallbacks, fetchFromSofaScore } from "./http-helpers.js";
import { RAPIDAPI_BASE_URLS, buildRapidApiUrl } from "./urls.js";

const buildRapidEndpoints = ({ includeGlobalEndpoint }) => {
  const endpoints = [];

  if (includeGlobalEndpoint) {
    endpoints.push({
      name: "sportapi7-scheduled",
      url: ({ date }) =>
        buildRapidApiUrl(
          RAPIDAPI_BASE_URLS.sportapi7,
          `/api/v1/sport/football/scheduled-events/${date}`
        ),
      transform: (data) => (Array.isArray(data?.events) ? data.events : []),
      allowEmpty: true,
    });
  }

  endpoints.push(
    {
      name: "sofascore-api-dojo-tournaments",
      url: () =>
        buildRapidApiUrl(
          RAPIDAPI_BASE_URLS.sofascore,
          "/tournaments/get-scheduled-events"
        ),
      query: ({ date, categoryId }) => ({ categoryId, date }),
      transform: (data) => (Array.isArray(data?.events) ? data.events : []),
      allowEmpty: true,
    },
    {
      name: "sport-api-real-time-tournaments",
      url: () =>
        buildRapidApiUrl(
          RAPIDAPI_BASE_URLS.sportApiRealTime,
          "/tournaments/scheduled-events"
        ),
      query: ({ date, categoryId }) => ({ categoryId, date }),
      transform: (data) => (Array.isArray(data?.events) ? data.events : []),
      allowEmpty: true,
    },
    {
      name: "sofascore-sport-scheduled-events",
      url: ({ date }) =>
        buildRapidApiUrl(
          RAPIDAPI_BASE_URLS.sofascoreSportApi,
          `/api/sport/football/scheduled-events/${date}`
        ),
      transform: (data) => (Array.isArray(data?.events) ? data.events : []),
      allowEmpty: true,
    }
  );

  return endpoints;
};

export async function fetchScheduledMatches(date, context, options = {}) {
  const { rapidApiKeys, rapidApiState, page, logger } = context;
  const { categoryId, includeGlobalEndpoint } = options || {};

  const numericCategoryId = Number(categoryId);
  const effectiveCategoryId = Number.isFinite(numericCategoryId)
    ? numericCategoryId
    : 1;

  const shouldIncludeGlobal =
    typeof includeGlobalEndpoint === "boolean"
      ? includeGlobalEndpoint
      : typeof categoryId === "undefined";

  const rapidResult = await fetchWithRapidApiFallbacks({
    endpoints: buildRapidEndpoints({ includeGlobalEndpoint: shouldIncludeGlobal }),
    params: { date, categoryId: effectiveCategoryId },
    rapidApiKeys,
    rapidApiState,
    label: "scheduled-matches",
    allowEmpty: true,
    logger,
    apiStats: context?.apiCallStats,
  });

  if (rapidResult.success) {
    return {
      matches: Array.isArray(rapidResult.data) ? rapidResult.data : [],
      source: rapidResult.source,
      apiKey: rapidResult.apiKey || null,
      calls: rapidResult.calls,
    };
  }

  const sofaResult = await fetchFromSofaScore({
    page,
    endpoint: `sport/football/scheduled-events/${date}`,
    transform: (data) => (Array.isArray(data?.events) ? data.events : []),
    allowEmpty: true,
    label: "scheduled-matches",
    logger,
    apiStats: context?.apiCallStats,
  });

  return {
    matches:
      sofaResult.success && Array.isArray(sofaResult.data) ? sofaResult.data : [],
    source: sofaResult.success ? sofaResult.source : null,
    apiKey: null,
    calls: (rapidResult.calls || 0) + (sofaResult.calls || 0),
  };
}
