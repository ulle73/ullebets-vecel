import { fetchWithRapidApiFallbacks, fetchFromSofaScore } from "./http-helpers.js";

// const RAPID_ENDPOINTS = [
//   {
//     name: "sportapi7-scheduled",
//     host: "sportapi7.p.rapidapi.com",
//     url: ({ date }) =>
//       `https://sportapi7.p.rapidapi.com/api/v1/sport/football/scheduled-events/${date}`,
//     transform: (data) => (Array.isArray(data?.events) ? data.events : []),
//     allowEmpty: true,
//   },
//   {
//     name: "sportapi7-scheduled-locale",
//     host: "sportapi7.p.rapidapi.com",
//     url: ({ date }) =>
//       `https://sportapi7.p.rapidapi.com/api/v1/sport/football/scheduled-events/${date}?locale=en`,
//     transform: (data) => (Array.isArray(data?.events) ? data.events : []),
//     allowEmpty: true,
//   },
//   {
//     name: "sportapi7-scheduled-utc",
//     host: "sportapi7.p.rapidapi.com",
//     url: ({ date }) =>
//       `https://sportapi7.p.rapidapi.com/api/v1/sport/football/events/scheduled?date=${date}`,
//     transform: (data) => (Array.isArray(data?.events) ? data.events : []),
//     allowEmpty: true,
//   },
//   {
//     name: "sofascore-scheduled",
//     host: "sofascore.p.rapidapi.com",
//     url: ({ date }) =>
//       `https://sofascore.p.rapidapi.com/sport/football/scheduled-events/${date}`,
//     transform: (data) => (Array.isArray(data?.events) ? data.events : []),
//     allowEmpty: true,
//   },
//   {
//     name: "sport-api-real-time-scheduled",
//     host: "sport-api-real-time.p.rapidapi.com",
//     url: ({ date }) =>
//       `https://sport-api-real-time.p.rapidapi.com/sport/football/scheduled-events/${date}`,
//     transform: (data) => (Array.isArray(data?.events) ? data.events : []),
//     allowEmpty: true,
//   },
// ];


const buildRapidEndpoints = ({ includeGlobalEndpoint }) => {
  const endpoints = [];

  if (includeGlobalEndpoint) {
    endpoints.push({
      name: "sportapi7-scheduled",
      host: "sportapi7.p.rapidapi.com",
      url: ({ date }) =>
        `https://sportapi7.p.rapidapi.com/api/v1/sport/football/scheduled-events/${date}`,
      transform: (data) => (Array.isArray(data?.events) ? data.events : []),
      allowEmpty: true,
    });
  }

  endpoints.push(
    {
      name: "sofascore-api-dojo-tournaments",
      host: "sofascore.p.rapidapi.com",
      url: ({ date, categoryId }) =>
        `https://sofascore.p.rapidapi.com/tournaments/get-scheduled-events?categoryId=${categoryId}&date=${date}`,
      transform: (data) => (Array.isArray(data?.events) ? data.events : []),
      allowEmpty: true,
    },
    {
      name: "sport-api-real-time-tournaments",
      host: "sport-api-real-time.p.rapidapi.com",
      url: ({ date, categoryId }) =>
        `https://sport-api-real-time.p.rapidapi.com/tournaments/scheduled-events?categoryId=${categoryId}&date=${date}`,
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
    matches: sofaResult.success && Array.isArray(sofaResult.data)
      ? sofaResult.data
      : [],
    source: sofaResult.success ? sofaResult.source : null,
    apiKey: null,
    calls: (rapidResult.calls || 0) + (sofaResult.calls || 0),
  };
}
