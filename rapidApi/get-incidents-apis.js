import { RAPIDAPI_BASE_URLS, buildRapidApiUrl, buildSofaScoreApiUrl } from "./urls.js";

export const incidentApiUrls = {
  sofascore: () => buildRapidApiUrl(RAPIDAPI_BASE_URLS.sofascore, "/matches/get-incidents"),
  sportApiRealTime: () =>
    buildRapidApiUrl(RAPIDAPI_BASE_URLS.sportApiRealTime, "/matches/incidents"),
  sportapi7: (matchId) =>
    buildRapidApiUrl(
      RAPIDAPI_BASE_URLS.sportapi7,
      `/api/v1/event/${matchId}/incidents`
    ),
  sofascorePublic: (matchId) => buildSofaScoreApiUrl(`event/${matchId}/incidents`),
  sofasport: () => buildRapidApiUrl(RAPIDAPI_BASE_URLS.sofasport, "/v1/events/incidents"),
  sofascoreSportApi: (matchId) =>
    buildRapidApiUrl(
      RAPIDAPI_BASE_URLS.sofascoreSportApi,
      `/api/event/${matchId}/incidents`
    ),
};
