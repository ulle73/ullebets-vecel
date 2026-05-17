import { RAPIDAPI_BASE_URLS, buildRapidApiUrl, buildSofaScoreApiUrl } from "./urls.js";

export const scheduledMatchApiUrls = {
  sofascore: () =>
    buildRapidApiUrl(
      RAPIDAPI_BASE_URLS.sofascore,
      "/tournaments/get-scheduled-events"
    ),
  sportApiRealTime: () =>
    buildRapidApiUrl(
      RAPIDAPI_BASE_URLS.sportApiRealTime,
      "/tournaments/scheduled-events"
    ),
  sportapi7: (date) =>
    buildRapidApiUrl(
      RAPIDAPI_BASE_URLS.sportapi7,
      `/api/v1/sport/football/scheduled-events/${date}`
    ),
  sofascorePublic: (date) =>
    buildSofaScoreApiUrl(`sport/football/scheduled-events/${date}`),
  sofascoreSportApi: (date) =>
    buildRapidApiUrl(
      RAPIDAPI_BASE_URLS.sofascoreSportApi,
      `/api/sport/football/scheduled-events/${date}`
    ),
};
