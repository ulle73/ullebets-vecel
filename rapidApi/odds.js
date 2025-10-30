import {
  fetchWithRapidApiFallbacks,
  fetchFromSofaScore,
  isValueEmpty,
} from "./http-helpers.js";

const MARKETS = [1, 5, 226, 317, 100];

const isEmptyOddsPayload = (payload) => {
  if (!payload) return true;
  if (Array.isArray(payload.odds) && payload.odds.length === 0) return true;
  if (Array.isArray(payload.bookmakers) && payload.bookmakers.length === 0) return true;
  if (Array.isArray(payload.markets) && payload.markets.length === 0) return true;
  if (isValueEmpty(payload)) return true;
  return false;
};

const normalizeOddsPayload = (payload) => {
  if (!payload || typeof payload !== "object") return payload ?? null;

  const candidates = [payload, payload.data, payload.event, payload.results];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    if (
      (Array.isArray(candidate.odds) && candidate.odds.length > 0) ||
      (Array.isArray(candidate.bookmakers) && candidate.bookmakers.length > 0) ||
      (Array.isArray(candidate.markets) && candidate.markets.length > 0)
    ) {
      return candidate;
    }
  }

  return payload;
};

const buildMarketEndpoints = (market) => [
  {
    name: `sportapi7-odds-${market}`,
    host: "sportapi7.p.rapidapi.com",
    url: ({ matchId }) =>
      `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}/odds/${market}/all`,
    transform: (data) => data ?? null,
    isEmpty: isEmptyOddsPayload,
  },
  {
    name: `sofascore-odds-${market}`,
    host: "sofascore.p.rapidapi.com",
    url: () => `https://sofascore.p.rapidapi.com/matches/get-all-odds`,
    query: ({ matchId }) => ({ matchId }),
    transform: (data) => normalizeOddsPayload(data),
    isEmpty: isEmptyOddsPayload,
  },
  {
    name: `sport-api-real-time-odds-${market}`,
    host: "sport-api-real-time.p.rapidapi.com",
    url: () => `https://sport-api-real-time.p.rapidapi.com/matches/all-odds`,
    query: ({ matchId }) => ({ matchId }),
    transform: (data) => normalizeOddsPayload(data),
    isEmpty: isEmptyOddsPayload,
  },
  {
    name: `sofasport-odds-${market}`,
    host: "sofasport.p.rapidapi.com",
    url: () => `https://sofasport.p.rapidapi.com/v1/events/odds/all`,
    query: ({ matchId }) => ({
      event_id: matchId,
      provider_id: "1",
      odds_format: "decimal",
    }),
    transform: (data) => normalizeOddsPayload(data),
    isEmpty: isEmptyOddsPayload,
  },
];

export async function fetchMatchOdds(matchId, context) {
  const { rapidApiKeys, rapidApiState, page, logger } = context;
  let calls = 0;
  let saw404 = false;

  for (const market of MARKETS) {
    const rapidResult = await fetchWithRapidApiFallbacks({
      endpoints: buildMarketEndpoints(market),
      params: { matchId },
      rapidApiKeys,
      rapidApiState,
      label: `match-odds-${market}`,
      allowEmpty: false,
      logger,
      apiStats: context?.apiCallStats,
    });
    calls += rapidResult.calls || 0;
    saw404 = saw404 || Boolean(rapidResult.saw404);

    if (rapidResult.success && !isEmptyOddsPayload(rapidResult.data)) {
      return {
        odds: rapidResult.data,
        market,
        source: rapidResult.source,
        apiKey: rapidResult.apiKey || null,
        calls,
        saw404,
      };
    }

    const sofaResult = await fetchFromSofaScore({
      page,
      endpoint: `event/${matchId}/odds/${market}/all`,
      transform: (data) => data ?? null,
      allowEmpty: false,
      label: `match-odds-${market}`,
      logger,
      apiStats: context?.apiCallStats,
    });
    calls += sofaResult.calls || 0;

    if (sofaResult.success && !isEmptyOddsPayload(sofaResult.data)) {
      return {
        odds: sofaResult.data,
        market,
        source: sofaResult.source,
        apiKey: null,
        calls,
        saw404,
      };
    }
  }

  return {
    odds: saw404 ? null : undefined,
    market: null,
    source: null,
    apiKey: null,
    calls,
    saw404,
  };
}
