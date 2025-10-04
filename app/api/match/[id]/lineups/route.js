import puppeteer from "puppeteer";

export const runtime = "nodejs";

const rapidApiKeys = (process.env.RAPIDAPI_KEYS || process.env.RAPIDAPI_KEY || "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

const rapidApiState = { index: 0 };

const providers = {
  sportapi7: "rapid(sportapi7)",
  sportRealTime: "rapid(sport-api-real-time)",
  sofaRapid: "rapid(sofascore)",
  sofaWeb: "sofascore-web",
};

async function fetchJson(url, { headers, method = "GET" } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    next: { revalidate: 0 },
  });
  const status = response.status;
  if (status === 200) {
    return { ok: true, status, data: await response.json() };
  }
  return { ok: false, status, data: null };
}

function buildUrlWithParams(baseUrl, params) {
  if (!params || typeof params !== "object") {
    return baseUrl;
  }
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    searchParams.append(key, String(value));
  }
  const query = searchParams.toString();
  if (!query) return baseUrl;
  const joiner = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${joiner}${query}`;
}

async function tryRapidWithKeys(buildConfig, label) {
  let lastError = null;
  for (let attempt = 0; attempt < rapidApiKeys.length; attempt += 1) {
    const keyIndex = (rapidApiState.index + attempt) % rapidApiKeys.length;
    const apiKey = rapidApiKeys[keyIndex];
    const config = buildConfig(apiKey);
    const url = buildUrlWithParams(config.url, config.params);

    try {
      const result = await fetchJson(url, {
        method: config.method || "GET",
        headers: {
          "x-rapidapi-key": apiKey,
          ...("host" in config ? { "x-rapidapi-host": config.host } : {}),
          ...(config.headers || {}),
        },
      });

      if (result.ok) {
        rapidApiState.index = (keyIndex + 1) % rapidApiKeys.length;
        console.log(
          `VIP lineups: hämtade via ${label} (key ...${apiKey.slice(-4)})`
        );
        return { success: true, data: result.data, provider: label, apiKey };
      }

      if (result.status === 404) {
        lastError = new Error(`${label}: Not found`);
      } else {
        lastError = new Error(
          `${label}: Unexpected response status ${result.status}`
        );
      }
      console.warn(
        `VIP lineups: ${label} key ...${apiKey.slice(-4)} returned HTTP ${result.status}`
      );
    } catch (error) {
      lastError = error;
      console.warn(
        `VIP lineups: ${label} key ...${apiKey.slice(-4)} failed – ${error?.message ?? error}`
      );
    }
  }

  return { success: false, data: null, provider: label, error: lastError };
}

async function fetchEventLineups(matchId) {
  if (!matchId) {
    throw new Error("A matchId is required to fetch lineups");
  }

  let lastError = null;

  if (rapidApiKeys.length > 0) {
    const primary = await tryRapidWithKeys(
      (apiKey) => ({
        method: "GET",
        url: `https://sportapi7.p.rapidapi.com/api/v1/event/${matchId}/lineups`,
        host: "sportapi7.p.rapidapi.com",
      }),
      providers.sportapi7
    );
    if (primary.success) {
      return { ...primary };
    }
    lastError = primary.error;

    const secondary = await tryRapidWithKeys(
      () => ({
        method: "GET",
        url: "https://sport-api-real-time.p.rapidapi.com/matches/lineups",
        host: "sport-api-real-time.p.rapidapi.com",
        params: { matchId: String(matchId) },
      }),
      providers.sportRealTime
    );
    if (secondary.success) {
      return { ...secondary };
    }
    lastError = secondary.error;

    const tertiary = await tryRapidWithKeys(
      () => ({
        method: "GET",
        url: "https://sofascore.p.rapidapi.com/matches/get-lineups",
        host: "sofascore.p.rapidapi.com",
        params: { matchId: String(matchId) },
      }),
      providers.sofaRapid
    );
    if (tertiary.success) {
      return { ...tertiary };
    }
    lastError = tertiary.error;
  }

  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
      );
      await page.goto("https://www.sofascore.com/", { waitUntil: "domcontentloaded" });

      const targetUrl = `https://www.sofascore.com/api/v1/event/${matchId}/lineups`;
      const data = await page.evaluate(async (url) => {
        try {
          const response = await fetch(url, {
            headers: { accept: "application/json, text/plain, */*" },
          });
          if (!response.ok) return null;
          return await response.json();
        } catch (error) {
          console.warn("VIP lineups: SofaScore fallback fetch error", error);
          return null;
        }
      }, targetUrl);

      if (data) {
        console.log("VIP lineups: hämtade via sofascore (fallback)");
        return { success: true, data, provider: providers.sofaWeb, apiKey: null };
      }

      console.warn("VIP lineups: SofaScore gav tomt svar eller non-OK");
    } finally {
      await browser.close();
    }
  } catch (error) {
    lastError = error;
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("VIP lineups: all providers failed");
}

const RATING_KEYS = [
  "avg",
  "average",
  "value",
  "rating",
  "score",
  "overall",
];

function parseRatingCandidate(candidate, depth = 0) {
  if (candidate === null || candidate === undefined || depth > 3) {
    return null;
  }
  if (typeof candidate === "number") {
    return Number.isFinite(candidate) ? Number(candidate.toFixed(2)) : null;
  }
  if (typeof candidate === "string") {
    const normalized = candidate.replace(/,/g, ".");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
  }
  if (typeof candidate === "object") {
    for (const key of RATING_KEYS) {
      if (candidate && key in candidate) {
        const nested = parseRatingCandidate(candidate[key], depth + 1);
        if (nested !== null) return nested;
      }
    }
  }
  return null;
}

function isSubstituteEntry(entry) {
  return Boolean(
    entry?.substitute ||
      entry?.isSubstitute ||
      entry?.bench ||
      entry?.onBench ||
      entry?.reserve
  );
}

function extractPlayerSource(entry = {}) {
  return (
    entry.player ||
    entry.athlete ||
    entry.person ||
    entry.playerData ||
    entry
  );
}

function mapPlayer(entry = {}, substituteOverride = null) {
  const playerSource = extractPlayerSource(entry);
  const playerId =
    playerSource?.id ??
    entry.playerId ??
    entry.id ??
    playerSource?.uuid ??
    null;
  const baseName =
    playerSource?.name ||
    playerSource?.shortName ||
    playerSource?.displayName ||
    entry.playerName ||
    entry.name ||
    null;

  const ratingCandidates = [
    entry.avgRating,
    entry.averageRating,
    entry.rating,
    entry.form?.avgRating,
    entry.statistics?.avgRating,
    entry.statistics?.rating,
    playerSource?.avgRating,
    playerSource?.averageRating,
    playerSource?.rating,
    playerSource?.statistics?.rating,
  ];

  let rating = null;
  for (const candidate of ratingCandidates) {
    rating = parseRatingCandidate(candidate);
    if (rating !== null) break;
  }

  return {
    id: playerId,
    name: baseName,
    shortName: playerSource?.shortName ?? null,
    position:
      playerSource?.position ||
      entry.position ||
      playerSource?.primaryPosition ||
      entry.playerPosition ||
      null,
    jerseyNumber:
      entry.shirtNumber ??
      entry.number ??
      playerSource?.shirtNumber ??
      playerSource?.jerseyNumber ??
      null,
    captain: Boolean(entry.captain || entry.isCaptain),
    substitute:
      substituteOverride !== null ? substituteOverride : isSubstituteEntry(entry),
    rating,
  };
}

function mapLineupPlayers(lineupEntry = {}) {
  const starters = [];
  const substitutes = [];

  const combinedPlayers = Array.isArray(lineupEntry.players)
    ? lineupEntry.players
    : null;

  if (combinedPlayers && combinedPlayers.length) {
    for (const entry of combinedPlayers) {
      const mapped = mapPlayer(entry);
      if (mapped.substitute) {
        substitutes.push(mapped);
      } else {
        starters.push(mapped);
      }
    }
    return { starters, substitutes };
  }

  const startersSource =
    (Array.isArray(lineupEntry.startXI) && lineupEntry.startXI) ||
    (Array.isArray(lineupEntry.startingXI) && lineupEntry.startingXI) ||
    (Array.isArray(lineupEntry.startingLineup) && lineupEntry.startingLineup) ||
    (Array.isArray(lineupEntry.lineup) && lineupEntry.lineup) ||
    [];
  const substitutesSource =
    (Array.isArray(lineupEntry.substitutes) && lineupEntry.substitutes) ||
    (Array.isArray(lineupEntry.bench) && lineupEntry.bench) ||
    (Array.isArray(lineupEntry.reserves) && lineupEntry.reserves) ||
    (Array.isArray(lineupEntry.subs) && lineupEntry.subs) ||
    [];

  for (const entry of startersSource) {
    const mapped = mapPlayer(entry, false);
    starters.push(mapped);
  }

  for (const entry of substitutesSource) {
    const mapped = mapPlayer(entry, true);
    substitutes.push(mapped);
  }

  return { starters, substitutes };
}

function normalizeLineup(lineup) {
  if (!lineup) return null;

  const { starters, substitutes } = mapLineupPlayers(lineup);

  return {
    teamId: lineup.team?.id ?? lineup.teamId ?? null,
    teamName: lineup.team?.name ?? lineup.teamName ?? null,
    formation: lineup.formation ?? null,
    coach:
      lineup.coach?.name ||
      lineup.coach?.shortName ||
      lineup.coach?.fullName ||
      null,
    starters,
    substitutes,
  };
}

function collectLineupEntries(raw) {
  const results = [];
  const pushEntries = (entries) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (entry) results.push(entry);
    }
  };

  pushEntries(raw?.lineups);
  pushEntries(raw?.teamLineups);
  pushEntries(raw?.data?.lineups);
  pushEntries(raw?.data?.teamLineups);
  pushEntries(raw?.data?.data);

  if (raw?.home && raw?.away) {
    results.push(raw.home);
    results.push(raw.away);
  }
  if (raw?.data?.home && raw?.data?.away) {
    results.push(raw.data.home);
    results.push(raw.data.away);
  }
  if (raw?.lineup) {
    pushEntries(raw.lineup.home ? [raw.lineup.home, raw.lineup.away] : raw.lineup);
  }
  return results;
}

function extractLineupsConfirmed(response) {
  const candidates = [
    response?.confirmed,
    response?.lineups?.confirmed,
    response?.data?.confirmed,
    response?.lineups?.data?.confirmed,
    response?.lineups?.lineups?.confirmed,
    response?.data?.lineups?.confirmed,
    response?.data?.lineups?.data?.confirmed,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }
  return null;
}

function normalizeResponse(raw) {
  const lineups = collectLineupEntries(raw)
    .map((entry) => normalizeLineup(entry))
    .filter(Boolean);
  const confirmed = extractLineupsConfirmed(raw);
  return { lineups, confirmed };
}

export async function GET(_req, context) {
  const matchId = context?.params?.id;
  if (!matchId) {
    return new Response("Missing match id", { status: 400 });
  }

  try {
    const result = await fetchEventLineups(matchId);
    const normalized = normalizeResponse(result.data);
    return new Response(
      JSON.stringify({
        matchId: String(matchId),
        provider: result.provider,
        confirmed: normalized.confirmed,
        lineups: normalized.lineups,
      }),
      {
        headers: { "content-type": "application/json" },
      }
    );
  } catch (error) {
    console.error("lineups:error", error);
    return new Response(
      JSON.stringify({ message: "Kunde inte hämta laguppställning" }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }
}
