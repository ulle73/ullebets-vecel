import { RAPIDAPI_BASE_URLS, buildRapidApiUrl, buildSofaScoreApiUrl } from "./urls.js";

export const oddsApiUrls = {
  sofascore: () => buildRapidApiUrl(RAPIDAPI_BASE_URLS.sofascore, "/matches/get-all-odds"),
  sportApiRealTime: () =>
    buildRapidApiUrl(RAPIDAPI_BASE_URLS.sportApiRealTime, "/matches/all-odds"),
  sportapi7: (matchId, market = 1) =>
    buildRapidApiUrl(
      RAPIDAPI_BASE_URLS.sportapi7,
      `/api/v1/event/${matchId}/odds/${market}/all`
    ),
  sofascorePublic: (matchId, market = 1) =>
    buildSofaScoreApiUrl(`event/${matchId}/odds/${market}/all`),
  sofasport: () => buildRapidApiUrl(RAPIDAPI_BASE_URLS.sofasport, "/v1/events/odds/all"),
  sofascoreSportApi: (matchId, market = 1) =>
    buildRapidApiUrl(
      RAPIDAPI_BASE_URLS.sofascoreSportApi,
      `/api/event/${matchId}/odds/${market}/all`
    ),
};
