import { NextResponse } from "next/server";
import puppeteer from "puppeteer";
import clientPromise from "@/lib/mongo";

export const runtime = "nodejs";

const rapidApiKeys = (process.env.RAPIDAPI_KEYS || process.env.RAPIDAPI_KEY || "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

const rapidApiState = { index: 0 };

const CACHE_SYMBOL = Symbol.for("ullebets.lineups.cache");
const lineupsCache = globalThis[CACHE_SYMBOL] ?? new Map();
globalThis[CACHE_SYMBOL] = lineupsCache;

const INFLIGHT_SYMBOL = Symbol.for("ullebets.lineups.inflight");
const inFlightFetches = globalThis[INFLIGHT_SYMBOL] ?? new Map();
globalThis[INFLIGHT_SYMBOL] = inFlightFetches;

const TEN_MINUTES_MS = 10 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * HOUR_MS;

const DB_NAME = process.env.MONGODB_DB || "app";
const MATCHES_COLLECTION = "match-for-date";
const STOCKHOLM_TIME_ZONE = "Europe/Stockholm";

const stockholmDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: STOCKHOLM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatStockholmDate(ms) {
  if (!Number.isFinite(ms)) {
    return null;
  }

  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = stockholmDateFormatter.formatToParts(date);
  let year;
  let month;
  let day;

  for (const part of parts) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
  }

  if (year && month && day) {
    return `${year}-${month}-${day}`;
  }
  return null;
}

function toMatchIdCandidates(matchId) {
  const values = new Set();
  let primaryString = null;

  if (typeof matchId === "string") {
    const trimmed = matchId.trim();
    if (trimmed) {
      values.add(trimmed);
      primaryString = trimmed;
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        values.add(numeric);
      }
    }
  } else if (Number.isFinite(matchId)) {
    const truncated = Math.trunc(matchId);
    values.add(truncated);
    const asString = String(truncated);
    values.add(asString);
    primaryString = asString;
  } else if (matchId != null) {
    const asString = String(matchId);
    if (asString) {
      values.add(asString);
      primaryString = asString;
      const numeric = Number(asString);
      if (Number.isFinite(numeric)) {
        values.add(numeric);
      }
    }
  }

  const allValues = Array.from(values);
  const numbers = allValues.filter((value) => typeof value === "number");
  const strings = allValues.filter((value) => typeof value === "string");

  if (!primaryString) {
    if (strings.length) {
      primaryString = strings[0];
    } else if (numbers.length) {
      primaryString = String(numbers[0]);
    }
  }

  return {
    values: allValues,
    numbers,
    strings,
    primaryString,
  };
}

function omitUndefinedEntries(object) {
  const entries = Object.entries(object);
  const result = {};
  for (const [key, value] of entries) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function parsePersistedTimestamp(value, fallbackMs = null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) {
      return ms;
    }
  }
  if (fallbackMs != null && Number.isFinite(fallbackMs)) {
    return Math.trunc(fallbackMs);
  }
  return null;
}

function resolvePersistedLineups(match) {
  if (!match || typeof match !== "object") {
    return null;
  }

  const snapshot = match.lineupsSnapshot;
  const rawLineups = Array.isArray(match.lineups)
    ? match.lineups
    : Array.isArray(snapshot?.lineups)
      ? snapshot.lineups
      : [];

  const confirmed =
    typeof match.lineupsConfirmed === "boolean"
      ? match.lineupsConfirmed
      : typeof snapshot?.confirmed === "boolean"
        ? snapshot.confirmed
        : null;

  const provider = match.lineupsProvider ?? snapshot?.provider ?? null;

  const fetchedAtMs =
    parsePersistedTimestamp(match.lineupsFetchedAtMs) ??
    parsePersistedTimestamp(match.lineupsFetchedAt, snapshot?.fetchedAtMs);

  const kickoffMs =
    parsePersistedTimestamp(match.lineupsKickoffMs) ??
    parsePersistedTimestamp(snapshot?.kickoffMs);

  const fetchedAtIso =
    typeof match.lineupsFetchedAt === "string" && match.lineupsFetchedAt.trim()
      ? match.lineupsFetchedAt
      : typeof snapshot?.fetchedAt === "string" && snapshot.fetchedAt.trim()
        ? snapshot.fetchedAt
        : fetchedAtMs
          ? new Date(fetchedAtMs).toISOString()
          : null;

  return {
    payload: {
      matchId: match.matchId ?? snapshot?.matchId ?? null,
      provider,
      confirmed,
      lineups: rawLineups,
      fetchedAt: fetchedAtIso,
      fetchedAtMs: fetchedAtMs ?? null,
      kickoffMs: kickoffMs ?? null,
    },
    confirmed,
    fetchedAtMs: fetchedAtMs ?? null,
    kickoffMs: kickoffMs ?? null,
  };
}

function matchIncludesCandidate(match, candidates) {
  if (!match || !candidates?.values?.length) {
    return false;
  }

  const candidateSet = new Set(
    candidates.values.map((value) =>
      typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : String(value)
    )
  );

  const fields = [
    match.id,
    match.matchId,
    match.event?.id,
    match.event?.matchId,
    match.raw?.id,
    match.raw?.matchId,
    match.lineupsSnapshot?.matchId,
  ];

  for (const field of fields) {
    if (field == null) continue;
    const normalized =
      typeof field === "number" && Number.isFinite(field)
        ? String(Math.trunc(field))
        : typeof field === "string"
          ? field.trim()
          : String(field ?? "").trim();
    if (normalized && candidateSet.has(normalized)) {
      return true;
    }
  }

  return false;
}

async function loadPersistedLineups({ matchId, kickoffMs }) {
  if (!matchId) {
    return null;
  }

  const candidates = toMatchIdCandidates(matchId);
  if (!candidates.values.length) {
    return null;
  }

  try {
    const client = await clientPromise;
    const collection = client.db(DB_NAME).collection(MATCHES_COLLECTION);

    const dateKey = formatStockholmDate(kickoffMs);
    const baseFilter = dateKey ? { _id: dateKey } : {};
    const projections = {
      projection: {
        _id: 1,
        "full.0.matches": 1,
      },
    };

    const paths = [
      "full.0.matches.id",
      "full.0.matches.matchId",
      "full.0.matches.event.id",
    ];

    for (const path of paths) {
      const filter = {
        ...baseFilter,
        [path]: { $in: candidates.values },
      };

      const doc = await collection.findOne(filter, projections);
      if (!doc) {
        continue;
      }

      const matches = doc?.full?.[0]?.matches;
      if (!Array.isArray(matches)) {
        continue;
      }

      for (const match of matches) {
        if (!matchIncludesCandidate(match, candidates)) {
          continue;
        }
        const resolved = resolvePersistedLineups(match);
        if (resolved) {
          const normalizedPayload = {
            ...resolved.payload,
            matchId: String(matchId),
            kickoffMs:
              resolved.kickoffMs ??
              parsePersistedTimestamp(match.timestamp) ??
              parsePersistedTimestamp(match.kickoff, kickoffMs) ??
              (Number.isFinite(kickoffMs) ? Math.trunc(kickoffMs) : null),
          };

          return {
            payload: normalizedPayload,
            confirmed: resolved.confirmed,
            fetchedAtMs: resolved.fetchedAtMs,
            kickoffMs: normalizedPayload.kickoffMs ?? null,
          };
        }
      }
    }
  } catch (error) {
    console.error("lineups:load-persisted-error", {
      matchId: String(matchId),
      message: error?.message ?? String(error),
    });
  }

  return null;
}

async function persistLineupsSnapshot({
  matchId,
  kickoffMs,
  lineups,
  confirmed,
  provider,
  raw,
  fetchedAtIso,
  fetchedAtMs,
}) {
  if (!matchId) {
    return false;
  }

  const candidates = toMatchIdCandidates(matchId);
  if (!candidates.values.length) {
    return false;
  }

  const normalizedLineups = Array.isArray(lineups) ? lineups : [];
  const snapshot = omitUndefinedEntries({
    matchId: candidates.primaryString ?? String(matchId),
    confirmed: confirmed ?? null,
    provider: provider ?? null,
    fetchedAt: fetchedAtIso ?? null,
    fetchedAtMs: fetchedAtMs ?? null,
    kickoffMs: Number.isFinite(kickoffMs) ? Math.trunc(kickoffMs) : null,
    lineups: normalizedLineups,
    raw: raw ?? null,
  });

  const setDoc = omitUndefinedEntries({
    "full.0.matches.$[match].lineups": normalizedLineups,
    "full.0.matches.$[match].lineupsConfirmed": confirmed ?? null,
    "full.0.matches.$[match].lineupsProvider": provider ?? null,
    "full.0.matches.$[match].lineupsFetchedAt": fetchedAtIso ?? null,
    "full.0.matches.$[match].lineupsFetchedAtMs": fetchedAtMs ?? null,
    "full.0.matches.$[match].lineupsKickoffMs": Number.isFinite(kickoffMs)
      ? Math.trunc(kickoffMs)
      : null,
    "full.0.matches.$[match].lineupsSnapshot": snapshot,
    "full.0.matches.$[match].lineupsRaw": raw ?? null,
  });

  if (!Object.keys(setDoc).length) {
    return false;
  }

  const client = await clientPromise;
  const collection = client.db(DB_NAME).collection(MATCHES_COLLECTION);

  const dateKey = formatStockholmDate(kickoffMs);
  const baseFilter = dateKey ? { _id: dateKey } : {};
  const updateDoc = { $set: setDoc };

  const valueList = candidates.values;
  const paths = [
    { queryField: "full.0.matches.id", arrayField: "match.id" },
    { queryField: "full.0.matches.matchId", arrayField: "match.matchId" },
    { queryField: "full.0.matches.event.id", arrayField: "match.event.id" },
  ];

  for (const path of paths) {
    if (!valueList.length) {
      continue;
    }
    const filter = {
      ...baseFilter,
      [path.queryField]: { $in: valueList },
    };
    const result = await collection.updateOne(filter, updateDoc, {
      arrayFilters: [{ [path.arrayField]: { $in: valueList } }],
    });
    if (result.matchedCount > 0) {
      return true;
    }
  }

  return false;
}

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

// async function tryRapidWithKeys(buildConfig, label) {
//   let lastError = null;
//   for (let attempt = 0; attempt < rapidApiKeys.length; attempt += 1) {
//     const keyIndex = (rapidApiState.index + attempt) % rapidApiKeys.length;
//     const apiKey = rapidApiKeys[keyIndex];
//     const config = buildConfig(apiKey);
//     const url = buildUrlWithParams(config.url, config.params);

//     try {
//       const result = await fetchJson(url, {
//         method: config.method || "GET",
//         headers: {
//           "x-rapidapi-key": apiKey,
//           ...("host" in config ? { "x-rapidapi-host": config.host } : {}),
//           ...(config.headers || {}),
//         },
//       });

//       if (result.ok) {
//         rapidApiState.index = (keyIndex + 1) % rapidApiKeys.length;
//         console.log(
//           `VIP lineups: hämtade via ${label} (key ...${apiKey.slice(-4)})`
//         );
//         return { success: true, data: result.data, provider: label, apiKey };
//       }

//       if (result.status === 404) {
//         lastError = new Error(`${label}: Not found`);
//       } else {
//         lastError = new Error(
//           `${label}: Unexpected response status ${result.status}`
//         );
//       }
//       console.warn(
//         `VIP lineups: ${label} key ...${apiKey.slice(-4)} returned HTTP ${result.status}`
//       );
//     } catch (error) {
//       lastError = error;
//       console.warn(
//         `VIP lineups: ${label} key ...${apiKey.slice(-4)} failed – ${error?.message ?? error}`
//       );
//     }
//   }

//   return { success: false, data: null, provider: label, error: lastError };
// }

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
          accept: "application/json",
          "user-agent": "Mozilla/5.0",
          ...(config.headers || {}),
        },
      });

      if (result.ok) {
        // rotera bara index vid lyckad träff
        rapidApiState.index = (keyIndex + 1) % rapidApiKeys.length;
        console.log(
          `VIP lineups: hämtade via ${label} (key ...${apiKey.slice(-4)})`
        );
        return { success: true, data: result.data, provider: label, apiKey };
      }

      // --- NYTT: hantering per status ---
      if (result.status === 404) {
        // 404 betyder nästan alltid fel ID-namespace hos providern → att byta nyckel hjälper inte.
        console.warn(
          `VIP lineups: ${label} returned 404 – stoppar nyckel-rotation för denna provider. Body: ${String(
            result.raw
          ).slice(0, 180)}`
        );
        return {
          success: false,
          data: null,
          provider: label,
          error: new Error(`${label}: 404 Not Found`),
        };
      }

    

      // Övriga 4xx/5xx: logga råkropp, prova nästa nyckel
      lastError = new Error(`${label}: HTTP ${result.status}`);
      console.warn(
        `VIP lineups: ${label} key ...${apiKey.slice(-4)} HTTP ${
          result.status
        } – ${String(result.raw).slice(0, 180)}`
      );
    } catch (error) {
      lastError = error;
      console.warn(
        `VIP lineups: ${label} key ...${apiKey.slice(-4)} failed – ${
          error?.message ?? error
        }`
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

function parseKickoffMs(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.trunc(value) : Math.trunc(value * 1000);
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1e12 ? Math.trunc(numeric) : Math.trunc(numeric * 1000);
    }
  }
  return null;
}

function shouldRefetchLineups(entry, now, kickoffMs) {
  if (!entry) {
    return true;
  }

  if (!entry.payload) {
    const lastAttempt = entry.lastPolledAt ?? entry.fetchedAt;
    if (!Number.isFinite(lastAttempt)) {
      return true;
    }
    return now - lastAttempt >= TEN_MINUTES_MS;
  }

  const age = now - entry.fetchedAt;
  if (!Number.isFinite(age) || age < 0) {
    return true;
  }

  if (entry.confirmed === true) {
    return age > SIX_HOURS_MS;
  }

  const timeUntilKickoff = kickoffMs != null ? kickoffMs - now : null;

  if (timeUntilKickoff != null && timeUntilKickoff <= 0) {
    const nextPollAt = (entry.lastPolledAt ?? entry.fetchedAt) + TEN_MINUTES_MS;
    return now >= nextPollAt;
  }

  if (timeUntilKickoff != null && timeUntilKickoff <= HOUR_MS) {
    const nextPollAt = (entry.lastPolledAt ?? entry.fetchedAt) + TEN_MINUTES_MS;
    return now >= nextPollAt;
  }

  return age > THIRTY_MINUTES_MS;
}

function buildResponseHeaders(cacheState, confirmed, { stale = false } = {}) {
  const headers = {
    "cache-control": stale
      ? "public, s-maxage=0, must-revalidate"
      : "public, s-maxage=300, stale-while-revalidate=120",
    "x-lineups-cache": cacheState,
  };

  if (confirmed === true) {
    headers["x-lineups-confirmed"] = "true";
  } else if (confirmed === false) {
    headers["x-lineups-confirmed"] = "false";
  }

  if (stale) {
    headers["x-lineups-cache-stale"] = "true";
  }

  return headers;
}

export async function GET(req, contextPromise) {
  const { params } = await contextPromise;
  const matchId = params?.id;
  if (!matchId) {
    return NextResponse.json({ message: "Missing match id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const kickoffMs = parseKickoffMs(url.searchParams.get("kickoff"));
  const cacheKey = String(matchId);
  const now = Date.now();
  let existingEntry = lineupsCache.get(cacheKey) ?? null;

  if (!existingEntry?.payload) {
    const persisted = await loadPersistedLineups({
      matchId,
      kickoffMs,
    });
    if (persisted?.payload) {
      const persistedFetchedAt =
        persisted.fetchedAtMs != null && Number.isFinite(persisted.fetchedAtMs)
          ? Math.trunc(persisted.fetchedAtMs)
          : now;
      existingEntry = {
        payload: {
          ...persisted.payload,
          kickoffMs: persisted.kickoffMs ?? persisted.payload.kickoffMs ?? null,
          fetchedAt: persisted.payload.fetchedAt ??
            (persistedFetchedAt ? new Date(persistedFetchedAt).toISOString() : null),
          fetchedAtMs: persisted.payload.fetchedAtMs ?? persistedFetchedAt ?? null,
        },
        confirmed: persisted.confirmed ?? null,
        fetchedAt: persistedFetchedAt,
        lastPolledAt: persistedFetchedAt,
        kickoffMs:
          persisted.kickoffMs ??
          persisted.payload.kickoffMs ??
          (Number.isFinite(kickoffMs) ? Math.trunc(kickoffMs) : null),
      };
      lineupsCache.set(cacheKey, existingEntry);
    }
  }

  const resolvedKickoff =
    (Number.isFinite(kickoffMs) ? Math.trunc(kickoffMs) : null) ??
    (Number.isFinite(existingEntry?.kickoffMs) ? Math.trunc(existingEntry.kickoffMs) : null);

  if (existingEntry) {
    existingEntry.kickoffMs = resolvedKickoff;
  }

  const needsRefresh = shouldRefetchLineups(existingEntry, now, resolvedKickoff);

  if (!needsRefresh && existingEntry?.payload) {
    return NextResponse.json(existingEntry.payload, {
      headers: buildResponseHeaders("hit", existingEntry.confirmed),
    });
  }

  const inflight = inFlightFetches.get(cacheKey);
  if (inflight) {
    try {
      const payload = await inflight;
      const latestEntry = lineupsCache.get(cacheKey) ?? existingEntry;
      const confirmed = latestEntry?.confirmed ?? payload?.confirmed ?? null;
      return NextResponse.json(payload, {
        headers: buildResponseHeaders("hit", confirmed),
      });
    } catch (error) {
      inFlightFetches.delete(cacheKey);
      console.error("lineups:inflight-error", error);
      if (existingEntry) {
        existingEntry.lastPolledAt = now;
      }
      if (existingEntry?.payload) {
        return NextResponse.json(existingEntry.payload, {
          headers: buildResponseHeaders("stale", existingEntry.confirmed, {
            stale: true,
          }),
        });
      }
      if (!existingEntry) {
        lineupsCache.set(cacheKey, {
          payload: null,
          confirmed: null,
          fetchedAt: now,
          lastPolledAt: now,
          kickoffMs: resolvedKickoff ?? null,
        });
      }
      return NextResponse.json(
        { message: "Kunde inte hämta laguppställning" },
        { status: 502 }
      );
    }
  }

  if (existingEntry) {
    existingEntry.lastPolledAt = now;
  }

  const fetchPromise = (async () => {
    const result = await fetchEventLineups(matchId);
    const normalized = normalizeResponse(result.data);
    const fetchedAtMs = Date.now();
    const fetchedAtIso = new Date(fetchedAtMs).toISOString();
    const payload = {
      matchId: String(matchId),
      provider: result.provider,
      confirmed: normalized.confirmed,
      lineups: normalized.lineups,
      fetchedAt: fetchedAtIso,
      fetchedAtMs,
      kickoffMs: resolvedKickoff ?? null,
    };

    lineupsCache.set(cacheKey, {
      payload,
      confirmed: normalized.confirmed ?? null,
      fetchedAt: fetchedAtMs,
      lastPolledAt: fetchedAtMs,
      kickoffMs: resolvedKickoff ?? null,
    });

    try {
      const persisted = await persistLineupsSnapshot({
        matchId,
        kickoffMs: resolvedKickoff ?? null,
        lineups: normalized.lineups,
        confirmed: normalized.confirmed ?? null,
        provider: result.provider ?? null,
        raw: result.data ?? null,
        fetchedAtIso,
        fetchedAtMs,
      });
      if (!persisted) {
        console.warn("lineups:persist-miss", {
          matchId: String(matchId),
          kickoffMs: resolvedKickoff ?? null,
          kickoffDate: typeof resolvedKickoff === "number" &&
            Number.isFinite(resolvedKickoff)
            ? formatStockholmDate(resolvedKickoff)
            : null,
          reason: "match-not-found",
        });
      }
    } catch (persistError) {
      console.error("lineups:persist-error", {
        matchId: String(matchId),
        message: persistError?.message ?? String(persistError),
      });
    }

    return payload;
  })();

  inFlightFetches.set(cacheKey, fetchPromise);

  try {
    const payload = await fetchPromise;
    inFlightFetches.delete(cacheKey);
    return NextResponse.json(payload, {
      headers: buildResponseHeaders(
        existingEntry ? "updated" : "miss",
        payload.confirmed ?? null
      ),
    });
  } catch (error) {
    inFlightFetches.delete(cacheKey);
    console.error("lineups:error", error);

    if (existingEntry) {
      existingEntry.lastPolledAt = now;
    }

    if (existingEntry?.payload) {
      return NextResponse.json(existingEntry.payload, {
        headers: buildResponseHeaders("stale", existingEntry.confirmed, {
          stale: true,
        }),
      });
    }

    if (!existingEntry) {
      lineupsCache.set(cacheKey, {
        payload: null,
        confirmed: null,
        fetchedAt: now,
        lastPolledAt: now,
        kickoffMs: resolvedKickoff ?? null,
      });
    }

    return NextResponse.json(
      { message: "Kunde inte hämta laguppställning" },
      { status: 502 }
    );
  }
}
