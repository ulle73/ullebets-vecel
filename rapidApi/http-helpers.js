import axios from "axios";

const defaultLogger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

const isPlainObject = (value) =>
  Object.prototype.toString.call(value) === "[object Object]";

const isValueEmpty = (value) => {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim() === "";
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
};

function resolveLogger(logger) {
  if (!logger) return defaultLogger;
  return {
    info: typeof logger.info === "function" ? logger.info.bind(logger) : defaultLogger.info,
    warn: typeof logger.warn === "function" ? logger.warn.bind(logger) : defaultLogger.warn,
    error: typeof logger.error === "function" ? logger.error.bind(logger) : defaultLogger.error,
  };
}

function recordApiOutcome(apiStats, provider, success) {
  if (!apiStats || !provider) return;
  const bucket = apiStats[provider];
  if (!bucket) return;
  if (success) {
    bucket.success = (bucket.success || 0) + 1;
  } else {
    bucket.failure = (bucket.failure || 0) + 1;
  }
}

export async function fetchWithRapidApiFallbacks({
  endpoints,
  params,
  rapidApiKeys = [],
  rapidApiState,
  label = "rapid-api",
  allowEmpty = false,
  logger,
  apiStats,
}) {
  const log = resolveLogger(logger);
  let calls = 0;
  let saw404 = false;

  if (!Array.isArray(endpoints) || !endpoints.length) {
    return { success: false, data: null, source: null, endpoint: null, calls, saw404 };
  }

  if (!Array.isArray(rapidApiKeys) || rapidApiKeys.length === 0) {
    log.warn(`[${label}] Inga RapidAPI-nycklar tillgängliga.`);
    return { success: false, data: null, source: null, endpoint: null, calls, saw404 };
  }

  const state = rapidApiState || { index: 0 };

  for (const endpoint of endpoints) {
    const buildUrl = endpoint?.url;
    if (typeof buildUrl !== "function") {
      continue;
    }

    const url = buildUrl(params);
    const host = endpoint.host || (typeof url === "string" ? new URL(url).host : undefined);
    const timeout = endpoint.timeout ?? 15000;
    const makeHeaders = endpoint.headers;
    const makeQuery = endpoint.query;
    const transform = endpoint.transform;
    const allowEmptyForEndpoint = endpoint.allowEmpty ?? allowEmpty;
    const isEmpty = endpoint.isEmpty || isValueEmpty;
    const name = endpoint.name || url;

    const totalKeys = rapidApiKeys.length;
    const startingIndex =
      typeof state.index === "number" && Number.isFinite(state.index)
        ? ((state.index % totalKeys) + totalKeys) % totalKeys
        : 0;

    for (let attempt = 0; attempt < totalKeys; attempt++) {
      const idx = (startingIndex + attempt) % totalKeys;
      const apiKey = rapidApiKeys[idx];

      try {
        calls++;
        if (typeof state.calls === "number") {
          state.calls += 1;
        } else {
          state.calls = 1;
        }

        const headers = {
          "x-rapidapi-key": apiKey,
          ...(host ? { "x-rapidapi-host": host } : {}),
          ...(typeof makeHeaders === "function" ? makeHeaders(params) : makeHeaders || {}),
        };

        const response = await axios.get(url, {
          headers,
          params: typeof makeQuery === "function" ? makeQuery(params) : undefined,
          timeout,
          validateStatus: () => true,
        });

        if (response.status === 200) {
          const rawData = typeof transform === "function"
            ? transform(response.data, { params, response })
            : response.data;

          if (!isEmpty(rawData) || allowEmptyForEndpoint) {
            state.index = (idx + 1) % totalKeys;
            recordApiOutcome(apiStats, "rapid", true);
            return {
              success: true,
              data: rawData,
              source: endpoint.source || `${label}:rapid`,
              endpoint: url,
              apiKey,
              calls,
              saw404,
            };
          }

          log.warn(
            `[${label}] Tomt svar från ${name} med nyckel ...${apiKey.slice(-4)} – provar nästa fallback.`
          );
          state.index = (idx + 1) % totalKeys;
          recordApiOutcome(apiStats, "rapid", false);
          continue;
        }

        if (response.status === 404) {
          saw404 = true;
          // log.warn(
          //   `[${label}] ${name} gav 404 med RapidAPI-nyckel ...${apiKey.slice(-4)}.`
          // );
          state.index = (idx + 1) % totalKeys;
          recordApiOutcome(apiStats, "rapid", false);
          continue;
        }

        // log.warn(
        //   `[${label}] ${name} gav HTTP ${response.status} med RapidAPI-nyckel ...${apiKey.slice(-4)}.`
        // );
        state.index = (idx + 1) % totalKeys;
        recordApiOutcome(apiStats, "rapid", false);
        continue;
      } catch (error) {
        const status = error?.response?.status;
        const message = status
          ? `HTTP ${status}`
          : error?.message || "okänt fel";
        log.warn(
          `[${label}] ${name} misslyckades med RapidAPI-nyckel ...${apiKey.slice(-4)} (${message}).`
        );
        state.index = (idx + 1) % totalKeys;
        recordApiOutcome(apiStats, "rapid", false);
        continue;
      }
    }
  }

  return { success: false, data: null, source: null, endpoint: null, calls, saw404 };
}

export async function fetchFromSofaScore({
  page,
  endpoint,
  transform,
  allowEmpty = true,
  label = "sofascore",
  logger,
  apiStats,
}) {
  const log = resolveLogger(logger);
  if (!page) {
    log.warn(`[${label}] Ingen puppeteer-sida tillgänglig för SofaScore-fallback.`);
    return { success: false, data: null, source: "sofascore", endpoint: null, calls: 0 };
  }

  const url = endpoint.startsWith("http")
    ? endpoint
    : `https://www.sofascore.com/api/v1/${endpoint}`;

  try {
    const result = await page.evaluate(async (targetUrl) => {
      try {
        const response = await fetch(targetUrl, {
          method: "GET",
          headers: { accept: "application/json, text/plain, */*" },
        });

        if (!response.ok) {
          return { ok: false, status: response.status };
        }

        const data = await response.json();
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    }, url);

    if (!result?.ok) {
      const statusText = result?.status ? `HTTP ${result.status}` : result?.error || "okänt fel";
      log.warn(`[${label}] SofaScore svarade inte OK (${statusText}).`);
      recordApiOutcome(apiStats, "sofascore", false);
      return {
        success: false,
        data: null,
        source: "sofascore",
        endpoint: url,
        calls: 1,
      };
    }

    const transformed = typeof transform === "function"
      ? transform(result.data)
      : result.data;

    if (!allowEmpty && isValueEmpty(transformed)) {
      log.warn(`[${label}] SofaScore gav tomt svar, anses misslyckat.`);
      recordApiOutcome(apiStats, "sofascore", false);
      return {
        success: false,
        data: transformed,
        source: "sofascore",
        endpoint: url,
        calls: 1,
      };
    }

    recordApiOutcome(apiStats, "sofascore", true);
    return {
      success: true,
      data: transformed,
      source: "sofascore",
      endpoint: url,
      calls: 1,
    };
  } catch (error) {
    log.error(
      `[${label}] SofaScore-fallback misslyckades (${error?.message || error}).`
    );
    recordApiOutcome(apiStats, "sofascore", false);
    return {
      success: false,
      data: null,
      source: "sofascore",
      endpoint: url,
      calls: 1,
    };
  }
}

export { isValueEmpty };
