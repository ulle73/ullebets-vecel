import { RAPIDAPI_BASE_URLS, buildRapidApiUrl, buildSofaScoreApiUrl } from "./urls.js";

export const matchStatisticsApiUrls = {
  sofascore: () => buildRapidApiUrl(RAPIDAPI_BASE_URLS.sofascore, "/matches/get-statistics"),
  sportApiRealTime: () =>
    buildRapidApiUrl(RAPIDAPI_BASE_URLS.sportApiRealTime, "/matches/statistics"),
  sportapi7: (matchId) =>
    buildRapidApiUrl(
      RAPIDAPI_BASE_URLS.sportapi7,
      `/api/v1/event/${matchId}/statistics`
    ),
  sofascorePublic: (matchId) => buildSofaScoreApiUrl(`event/${matchId}/statistics`),
  sofasport: () => buildRapidApiUrl(RAPIDAPI_BASE_URLS.sofasport, "/v1/events/statistics"),
  sofascoreSportApi: (matchId) =>
    buildRapidApiUrl(
      RAPIDAPI_BASE_URLS.sofascoreSportApi,
      `/api/event/${matchId}/statistics`
    ),
};
