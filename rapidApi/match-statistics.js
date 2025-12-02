// import { fetchWithRapidApiFallbacks, fetchFromSofaScore } from "./http-helpers.js";

// const EVENT_ENDPOINTS = [
//   {
//     name: "sportapi7-event",
//     host: "sportapi7.p.rapidapi.com",
//     url: ({ matchId }) => `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}`,
//     transform: (data) => data?.event ?? null,
//   },
//   {
//     name: "sportapi7-event-alt",
//     host: "sportapi7.p.rapidapi.com",
//     url: ({ matchId }) => `https://sportapi7.p.rapidapi.com/api/v1/events/${matchId}`,
//     transform: (data) => data?.event ?? data ?? null,
//   },
//   {
//     name: "sportapi7-event-details",
//     host: "sportapi7.p.rapidapi.com",
//     url: ({ matchId }) =>
//       `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}?detailed=true`,
//     transform: (data) => data?.event ?? data ?? null,
//   },
//   {
//     name: "sofascore-event",
//     host: "sofascore.p.rapidapi.com",
//     url: () => `https://sofascore.p.rapidapi.com/matches/get-metadata`,
//     query: ({ matchId }) => ({ matchId }),
//     transform: (data) => data?.data ?? data?.event ?? data ?? null,
//   },
//   {
//     name: "sport-api-real-time-event",
//     host: "sport-api-real-time.p.rapidapi.com",
//     url: () => `https://sport-api-real-time.p.rapidapi.com/matches/detail`,
//     query: ({ matchId }) => ({ matchId }),
//     transform: (data) => data?.data ?? data?.event ?? data ?? null,
//   },
// ];

// const STAT_ENDPOINTS = [
//   {
//     name: "sportapi7-event-statistics",
//     host: "sportapi7.p.rapidapi.com",
//     url: ({ matchId }) => `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}/statistics`,
//     transform: (data) => data ?? null,
//   },
//   {
//     name: "sportapi7-event-statistics-locale",
//     host: "sportapi7.p.rapidapi.com",
//     url: ({ matchId }) =>
//       `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}/statistics?locale=en`,
//     transform: (data) => data ?? null,
//   },
//   {
//     name: "sportapi7-event-statistics-alt",
//     host: "sportapi7.p.rapidapi.com",
//     url: ({ matchId }) =>
//       `https://sportapi7.p.rapidapi.com/api/v1/events/${matchId}/statistics`,
//     transform: (data) => data ?? null,
//   },
//   {
//     name: "sofascore-event-statistics",
//     host: "sofascore.p.rapidapi.com",
//     url: () => `https://sofascore.p.rapidapi.com/matches/get-statistics`,
//     query: ({ matchId }) => ({ matchId }),
//     transform: (data) => data?.statistics ?? data?.data ?? data ?? null,
//   },
//   {
//     name: "sport-api-real-time-event-statistics",
//     host: "sport-api-real-time.p.rapidapi.com",
//     url: () => `https://sport-api-real-time.p.rapidapi.com/matches/statistics`,
//     query: ({ matchId }) => ({ matchId }),
//     transform: (data) => data?.data ?? data?.statistics ?? data ?? null,
//   },
// ];

// export async function fetchMatchStatistics(matchId, context) {
//   const { rapidApiKeys, rapidApiState, page, logger } = context;
//   let calls = 0;

//   const eventResult = await fetchWithRapidApiFallbacks({
//     endpoints: EVENT_ENDPOINTS,
//     params: { matchId },
//     rapidApiKeys,
//     rapidApiState,
//     label: "match-event",
//     allowEmpty: false,
//     logger,
//   });
//   calls += eventResult.calls || 0;

//   let eventData = eventResult.success ? eventResult.data : null;
//   let eventSource = eventResult.success ? eventResult.source : null;

//   if (!eventData) {
//     const sofaEvent = await fetchFromSofaScore({
//       page,
//       endpoint: `event/${matchId}`,
//       transform: (data) => data?.event ?? data ?? null,
//       allowEmpty: false,
//       label: "match-event",
//       logger,
//     });
//     calls += sofaEvent.calls || 0;
//     if (sofaEvent.success) {
//       eventData = sofaEvent.data;
//       eventSource = sofaEvent.source;
//     }
//   }

//   const statsResult = await fetchWithRapidApiFallbacks({
//     endpoints: STAT_ENDPOINTS,
//     params: { matchId },
//     rapidApiKeys,
//     rapidApiState,
//     label: "match-statistics",
//     allowEmpty: false,
//     logger,
//   });
//   calls += statsResult.calls || 0;

//   let statsData = statsResult.success ? statsResult.data : null;
//   let statsSource = statsResult.success ? statsResult.source : null;

//   if (!statsData) {
//     const sofaStats = await fetchFromSofaScore({
//       page,
//       endpoint: `event/${matchId}/statistics`,
//       transform: (data) => data ?? null,
//       allowEmpty: false,
//       label: "match-statistics",
//       logger,
//     });
//     calls += sofaStats.calls || 0;
//     if (sofaStats.success) {
//       statsData = sofaStats.data;
//       statsSource = sofaStats.source;
//     }
//   }

//   return {
//     event: eventData,
//     statistics: statsData,
//     source: statsSource || eventSource || null,
//     calls,
//   };
// }


import {
  fetchWithRapidApiFallbacks,
  fetchFromSofaScore,
} from "./http-helpers.js";

const STAT_ENDPOINTS = [
  {
    name: "sportapi7-event-statistics",
    host: "sportapi7.p.rapidapi.com",
    url: ({ matchId }) =>
      `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}/statistics`,
    transform: (data) => data ?? null,
  },
  {
    name: "sofascore-event-statistics",
    host: "sofascore.p.rapidapi.com",
    url: () => `https://sofascore.p.rapidapi.com/matches/get-statistics`,
    query: ({ matchId }) => ({ matchId }),
    transform: (data) => data?.statistics ?? data?.data ?? data ?? null,
  },
  {
    name: "sport-api-real-time-event-statistics",
    host: "sport-api-real-time.p.rapidapi.com",
    url: () => `https://sport-api-real-time.p.rapidapi.com/matches/statistics`,
    query: ({ matchId }) => ({ matchId }),
    transform: (data) => data?.data ?? data?.statistics ?? data ?? null,
  },
  {
    name: "sofascore-sport-event-statistics",
    host: "sofascore-sport-api.p.rapidapi.com",
    url: ({ matchId }) =>
      `https://sofascore-sport-api.p.rapidapi.com/api/event/${matchId}/statistics`,
    transform: (data) => data?.data ?? data?.statistics ?? data ?? null,
  },
  {
    name: "sofasport-event-statistics",
    host: "sofasport.p.rapidapi.com",
    url: () => `https://sofasport.p.rapidapi.com/v1/events/statistics`,
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
