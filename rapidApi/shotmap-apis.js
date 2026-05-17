import { RAPIDAPI_BASE_URLS, buildRapidApiUrl, buildSofaScoreApiUrl } from "./urls.js";

export const shotmapApiUrls = {
  sportapi7: (matchId) =>
    buildRapidApiUrl(
      RAPIDAPI_BASE_URLS.sportapi7,
      `/api/v1/event/${matchId}/shotmap`
    ),
  sofascorePublic: (matchId) => buildSofaScoreApiUrl(`event/${matchId}/shotmap`),
  sofasport: () => buildRapidApiUrl(RAPIDAPI_BASE_URLS.sofasport, "/v1/events/shotmap"),
};
