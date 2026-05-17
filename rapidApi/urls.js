const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");

const joinUrl = (baseUrl, path) => {
  const cleanBase = trimTrailingSlash(baseUrl);
  const cleanPath = String(path || "").replace(/^\/+/, "");
  return new URL(cleanPath, `${cleanBase}/`).toString();
};

const readUrl = (envName) => {
  const value = process.env[envName];
  if (!value) {
    throw new Error(`Missing required env var ${envName}`);
  }
  return trimTrailingSlash(value);
};

export const RAPIDAPI_BASE_URLS = {
  get sportapi7() {
    return readUrl("RAPIDAPI_SPORTAPI7_BASE_URL");
  },
  get sofascore() {
    return readUrl("RAPIDAPI_SOFASCORE_BASE_URL");
  },
  get sportApiRealTime() {
    return readUrl("RAPIDAPI_SPORT_API_REAL_TIME_BASE_URL");
  },
  get sofascoreSportApi() {
    return readUrl("RAPIDAPI_SOFASCORE_SPORT_API_BASE_URL");
  },
  get sofasport() {
    return readUrl("RAPIDAPI_SOFASPORT_BASE_URL");
  },
};

export function getSofaScorePublicApiBaseUrl() {
  return readUrl("SOFASCORE_PUBLIC_API_BASE_URL");
}

export function buildRapidApiUrl(baseUrl, path) {
  return joinUrl(baseUrl, path);
}

export function buildSofaScoreApiUrl(endpoint) {
  if (typeof endpoint !== "string" || endpoint.trim() === "") {
    return joinUrl(getSofaScorePublicApiBaseUrl(), "");
  }

  if (endpoint.startsWith("http")) {
    return endpoint;
  }

  return joinUrl(getSofaScorePublicApiBaseUrl(), endpoint);
}
