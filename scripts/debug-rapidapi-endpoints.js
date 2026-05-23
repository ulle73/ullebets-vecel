const DEFAULT_BASE_URLS = {
  sportapi7: "https://sportapi7.p.rapidapi.com",
  sofascore: "https://sofascore.p.rapidapi.com",
  sportApiRealTime: "https://sport-api-real-time.p.rapidapi.com",
  sofascoreSportApi: "https://sofascore-sport-api.p.rapidapi.com",
  sofasport: "https://sofasport.p.rapidapi.com",
};

const trimSlash = (value) => String(value || "").replace(/\/+$/, "");
const joinUrl = (base, pathname) => new URL(String(pathname || "").replace(/^\/+/, ""), `${trimSlash(base)}/`).toString();

const baseUrls = {
  sportapi7: trimSlash(process.env.RAPIDAPI_SPORTAPI7_BASE_URL || DEFAULT_BASE_URLS.sportapi7),
  sofascore: trimSlash(process.env.RAPIDAPI_SOFASCORE_BASE_URL || DEFAULT_BASE_URLS.sofascore),
  sportApiRealTime: trimSlash(process.env.RAPIDAPI_SPORT_API_REAL_TIME_BASE_URL || DEFAULT_BASE_URLS.sportApiRealTime),
  sofascoreSportApi: trimSlash(process.env.RAPIDAPI_SOFASCORE_SPORT_API_BASE_URL || DEFAULT_BASE_URLS.sofascoreSportApi),
  sofasport: trimSlash(process.env.RAPIDAPI_SOFASPORT_BASE_URL || DEFAULT_BASE_URLS.sofasport),
};

function yesterdayYmdUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function unique(values) {
  return [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];
}

const secretKeys = unique([
  process.env.RAPIDAPI_KEY,
  ...(process.env.RAPIDAPI_KEYS || "").split(","),
  ...Array.from({ length: 20 }, (_, index) => process.env[`RAPIDAPI_KEY_${index + 1}`]),
]);

const keyLimit = Number.parseInt(process.env.RAPIDAPI_DEBUG_MAX_KEYS || "10", 10);
const rapidApiKeys = Number.isFinite(keyLimit) && keyLimit > 0 ? secretKeys.slice(0, keyLimit) : secretKeys;

const testDate = process.env.TEST_DATE || yesterdayYmdUTC();
const categoryId = process.env.TEST_CATEGORY_ID || "34";
const matchIds = unique((process.env.TEST_MATCH_IDS || "15235566,14065562,14083306").split(","));

function withQuery(url, params) {
  const u = new URL(url);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === null || typeof value === "undefined" || value === "") continue;
    u.searchParams.set(key, String(value));
  }
  return u.toString();
}

function safeJsonPreview(value) {
  if (value === null || typeof value === "undefined") return null;
  if (Array.isArray(value)) {
    return { type: "array", count: value.length };
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).slice(0, 12);
    const counts = {};
    for (const key of keys) {
      if (Array.isArray(value[key])) counts[key] = value[key].length;
    }
    return { type: "object", keys, counts };
  }
  return { type: typeof value, value: String(value).slice(0, 160) };
}

function extractScheduled(data) {
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.data?.events)) return data.data.events;
  if (Array.isArray(data?.data?.matches)) return data.data.matches;
  if (Array.isArray(data?.matches)) return data.matches;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function extractStats(data) {
  return data?.statistics ?? data?.data ?? data ?? null;
}

function isEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

async function fetchJson(url, { headers = {}, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": "ullebets-rapidapi-diagnostic/1.0",
        ...headers,
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text ? text.slice(0, 500) : null;
    }
    return { ok: res.ok, status: res.status, statusText: res.statusText, data };
  } catch (error) {
    return { ok: false, status: 0, statusText: error?.name === "AbortError" ? "timeout" : error?.message || String(error), data: null };
  } finally {
    clearTimeout(timeout);
  }
}

function keyLabel(key) {
  return key ? `...${String(key).slice(-4)}` : "<missing>";
}

async function testRapidEndpoint(endpoint, params, transform) {
  if (!rapidApiKeys.length) {
    return [{ endpoint: endpoint.name, ok: false, status: "NO_KEYS", empty: true, key: null, preview: null }];
  }

  const attempts = [];
  for (const apiKey of rapidApiKeys) {
    const rawUrl = typeof endpoint.url === "function" ? endpoint.url(params) : endpoint.url;
    const url = withQuery(rawUrl, typeof endpoint.query === "function" ? endpoint.query(params) : endpoint.query);
    const host = new URL(url).host;
    const result = await fetchJson(url, {
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": host,
      },
    });
    const transformed = result.ok ? (typeof transform === "function" ? transform(result.data) : result.data) : null;
    const empty = isEmpty(transformed);
    attempts.push({
      endpoint: endpoint.name,
      urlHost: host,
      ok: result.ok && !empty,
      httpOk: result.ok,
      status: result.status || result.statusText,
      empty,
      key: keyLabel(apiKey),
      preview: safeJsonPreview(transformed ?? result.data),
    });
    if (result.ok && !empty) break;
  }
  return attempts;
}

async function testPublicSofascore(name, endpoint, transform) {
  const url = joinUrl(process.env.SOFASCORE_PUBLIC_API_BASE_URL || "https://api.sofascore.com/api/v1", endpoint);
  const result = await fetchJson(url);
  const transformed = result.ok ? (typeof transform === "function" ? transform(result.data) : result.data) : null;
  return {
    endpoint: name,
    urlHost: new URL(url).host,
    ok: result.ok && !isEmpty(transformed),
    httpOk: result.ok,
    status: result.status || result.statusText,
    empty: isEmpty(transformed),
    key: null,
    preview: safeJsonPreview(transformed ?? result.data),
  };
}

const scheduledEndpoints = [
  {
    name: "sportapi7-scheduled-global",
    url: ({ date }) => joinUrl(baseUrls.sportapi7, `/api/v1/sport/football/scheduled-events/${date}`),
  },
  {
    name: "sofascore-api-dojo-tournaments",
    url: () => joinUrl(baseUrls.sofascore, "/tournaments/get-scheduled-events"),
    query: ({ date, categoryId }) => ({ categoryId, date }),
  },
  {
    name: "sport-api-real-time-tournaments",
    url: () => joinUrl(baseUrls.sportApiRealTime, "/tournaments/scheduled-events"),
    query: ({ date, categoryId }) => ({ categoryId, date }),
  },
  {
    name: "sofascore-sport-scheduled-events",
    url: ({ date }) => joinUrl(baseUrls.sofascoreSportApi, `/api/sport/football/scheduled-events/${date}`),
  },
];

const statEndpoints = [
  {
    name: "sportapi7-event-statistics",
    url: ({ matchId }) => joinUrl(baseUrls.sportapi7, `/api/v1/event/${matchId}/statistics`),
  },
  {
    name: "sofascore-event-statistics",
    url: () => joinUrl(baseUrls.sofascore, "/matches/get-statistics"),
    query: ({ matchId }) => ({ matchId }),
  },
  {
    name: "sport-api-real-time-event-statistics",
    url: () => joinUrl(baseUrls.sportApiRealTime, "/matches/statistics"),
    query: ({ matchId }) => ({ matchId }),
  },
  {
    name: "sofascore-sport-event-statistics",
    url: ({ matchId }) => joinUrl(baseUrls.sofascoreSportApi, `/api/event/${matchId}/statistics`),
  },
  {
    name: "sofasport-event-statistics",
    url: () => joinUrl(baseUrls.sofasport, "/v1/events/statistics"),
    query: ({ matchId }) => ({ event_id: matchId }),
  },
];

function printResult(result) {
  const icon = result.ok ? "✅" : result.httpOk && result.empty ? "⚠️" : "❌";
  const key = result.key ? ` key=${result.key}` : "";
  console.log(`${icon} ${result.endpoint} host=${result.urlHost || "?"}${key} status=${result.status} empty=${result.empty}`);
  console.log(`   preview=${JSON.stringify(result.preview)}`);
}

console.log("# RapidAPI endpoint diagnostic");
console.log(`date=${testDate} categoryId=${categoryId} matchIds=${matchIds.join(",")}`);
console.log(`secretKeysAvailable=${rapidApiKeys.length} testedMax=${keyLimit}`);
console.log("");

console.log("## Scheduled endpoints");
for (const endpoint of scheduledEndpoints) {
  const attempts = await testRapidEndpoint(endpoint, { date: testDate, categoryId }, extractScheduled);
  attempts.forEach(printResult);
}
console.log("");

for (const matchId of matchIds) {
  console.log(`## Match ${matchId} statistics endpoints`);
  for (const endpoint of statEndpoints) {
    const attempts = await testRapidEndpoint(endpoint, { matchId }, extractStats);
    attempts.forEach(printResult);
  }
  console.log(`## Match ${matchId} public SofaScore endpoints`);
  printResult(await testPublicSofascore("sofascore-public-event", `event/${matchId}`, (data) => data?.event ?? data));
  printResult(await testPublicSofascore("sofascore-public-statistics", `event/${matchId}/statistics`, (data) => data ?? null));
  console.log("");
}

console.log("Diagnostic complete. Full RapidAPI keys are never printed; only suffixes are shown.");
