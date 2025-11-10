// unibetAuto.js – SLUTGILTIG VERSION
import { readFile } from "node:fs/promises";
import path from "node:path";

import TEAM_NAME_ALIASES from "@/components/backtest/teamNameAliases";

// NY: Ladda URL-konfig från separat fil
let unibetLeagueConfig = {};
async function loadUnibetLeagueConfig() {
  try {
    const configPath = path.join(
      process.cwd(),
      "data",
      "unibetLeagueUrls.json"
    );
    const raw = await readFile(configPath, "utf-8");
    unibetLeagueConfig = JSON.parse(raw);
    console.log(
      "Unibet auto: loaded league config",
      Object.keys(unibetLeagueConfig).join(", ")
    );
  } catch (err) {
    console.error("Unibet auto: failed to load unibetLeagueUrls.json", err);
  }
}
loadUnibetLeagueConfig();

const UNIBET_EVENT_BASE_URL = "https://www.unibet.se/betting/sports/event";

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
  Referer: "https://www.unibet.se/",
  "X-Requested-With": "XMLHttpRequest",
};

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let configurationPromise;
const listViewCache = new Map();

// --- HJÄLPFUNKTIONER (samma som tidigare) ---
function normalizeTeamName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, "and")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeLeagueName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/\d{4}\/\d{2}|\d{2}\/\d{2}/g, "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function generateNameVariants(name) {
  const variants = new Set();
  if (!name) return variants;
  variants.add(name);
  variants.add(name.replace(/-/g, " "));
  variants.add(name.replace(/&/g, "and"));
  variants.add(name.replace(/[.]/g, ""));
  variants.add(name.replace(/\b(?:FC|CF|AC|AFC|Club|The)\b/gi, "").trim());
  return new Set(Array.from(variants).filter(Boolean));
}

function generateLeagueVariants(name) {
  const variants = new Set([name]);
  variants.add(name.replace(/\d{4}-\d{2}/g, ""));
  variants.add(name.replace(/\d{4}\/\d{2}/g, ""));
  variants.add(name.replace(/\d{2}\/\d{2}/g, ""));
  variants.add(name.replace(/\d{4}-\d{4}/g, ""));
  variants.add(name.replace(/-/g, " "));
  return Array.from(
    new Set(
      Array.from(variants)
        .map((v) => v.trim())
        .filter(Boolean)
    )
  );
}

function buildAliasMap(leaguesData, customAliases) {
  const map = new Map();
  const addAlias = (alias, canonical) => {
    if (!alias || !canonical) return;
    const normalized = normalizeTeamName(alias);
    if (!normalized) return;
    if (!map.has(normalized)) map.set(normalized, canonical);
  };
  for (const leagueInfo of Object.values(leaguesData)) {
    for (const team of leagueInfo.teams || []) {
      if (!team?.name) continue;
      for (const variant of generateNameVariants(team.name)) {
        addAlias(variant, team.name);
      }
    }
  }
  for (const [canonical, aliases] of Object.entries(customAliases || {})) {
    if (canonical) {
      for (const variant of generateNameVariants(canonical))
        addAlias(variant, canonical);
    }
    for (const alias of aliases || []) {
      for (const variant of generateNameVariants(alias))
        addAlias(variant, canonical);
    }
  }
  return map;
}

function buildLeagueMap(leaguesData) {
  const map = new Map();
  for (const leagueName of Object.keys(leaguesData)) {
    for (const variant of generateLeagueVariants(leagueName)) {
      const normalized = normalizeLeagueName(variant);
      if (normalized && !map.has(normalized)) map.set(normalized, leagueName);
    }
  }
  return map;
}

async function loadConfiguration() {
  if (!configurationPromise) {
    configurationPromise = (async () => {
      const leaguesPath = path.join(
        process.cwd(),
        "data",
        "leagues-and-teams.json"
      );
      const raw = await readFile(leaguesPath, "utf-8");
      const leagues = JSON.parse(raw);
      const aliasMap = buildAliasMap(leagues, TEAM_NAME_ALIASES);
      const leagueMap = buildLeagueMap(leagues);
      return { aliasMap, leagueMap };
    })();
  }
  return configurationPromise;
}

function canonicalizeTeamName(name, aliasMap) {
  const resolved = resolveTeamName(name, aliasMap);
  if (resolved) return resolved;
  return typeof name === "string" ? name.trim() : null;
}

function resolveTeamName(name, aliasMap) {
  const normalized = normalizeTeamName(name);
  if (!normalized) return null;
  if (aliasMap.has(normalized)) return aliasMap.get(normalized);
  const cleaned = normalized
    .replace(/\b(?:fc|cf|ac|afc|club|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned && aliasMap.has(cleaned)) return aliasMap.get(cleaned);
  return null;
}

function canonicalizeLeagueName(name, leagueMap) {
  const normalized = normalizeLeagueName(name);
  if (normalized && leagueMap.has(normalized)) return leagueMap.get(normalized);
  return typeof name === "string" ? name.trim() : null;
}

function toEvent(entry) {
  if (!entry || typeof entry !== "object") return null;
  return entry.event && typeof entry.event === "object" ? entry.event : entry;
}

function extractLeagueName(event) {
  return (
    event?.group ??
    event?.groupName ??
    event?.tournament?.name ??
    event?.eventGroup ??
    null
  );
}

function toTimestampMs(value) {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value))
    return value > 1e12 ? value : value * 1000;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric))
      return numeric > 1e12 ? numeric : numeric * 1000;
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseEventStart(event) {
  if (!event?.start) return null;
  const date = new Date(event.start);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

// --- HÄMTA URL FRÅN CONFIG ---
function normalizeLeagueLookupValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase()
    .trim();
}

function buildLeagueLookupSlugs(leagueName) {
  if (!leagueName) return [];
  const trimmed = String(leagueName).trim();
  if (!trimmed) return [];
  const candidates = new Set();
  candidates.add(trimmed);
  candidates.add(trimmed.replace(/\s+/g, ""));
  candidates.add(trimmed.replace(/[^\w\s]+/g, ""));
  candidates.add(trimmed.replace(/\s+/g, "_"));
  return Array.from(candidates)
    .map(normalizeLeagueLookupValue)
    .filter(Boolean);
}

function getLeagueConfig(leagueName) {
  if (!leagueName) return null;

  const direct = unibetLeagueConfig[leagueName];
  if (direct) return direct;

  const lookupSlugs = buildLeagueLookupSlugs(leagueName);
  if (lookupSlugs.length === 0) return null;
  const lookupSet = new Set(lookupSlugs);

  for (const [name, config] of Object.entries(unibetLeagueConfig)) {
    const normalizedName = normalizeLeagueLookupValue(name);
    if (normalizedName && lookupSet.has(normalizedName)) {
      return config;
    }
    const normalizedSlug = normalizeLeagueLookupValue(config?.leagueSlug);
    if (normalizedSlug && lookupSet.has(normalizedSlug)) {
      return config;
    }
    const normalizedLookupSlugs = (config?.lookupSlugs || [])
      .map(normalizeLeagueLookupValue)
      .filter(Boolean);
    if (
      normalizedLookupSlugs.some((lookupSlug) => lookupSet.has(lookupSlug))
    ) {
      return config;
    }
  }

  return null;
}

// --- BYGG URL MED PARAMETRAR ---
function buildListViewUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set("lang", "sv_SE");
  url.searchParams.set("market", "SE");
  url.searchParams.set("client_id", "2");
  url.searchParams.set("channel_id", "1");
  url.searchParams.set("useCombined", "true");
  url.searchParams.set("ncid", Date.now().toString());
  return url.toString();
}

// --- HÄMTA DATA ---
async function fetchListViewEvents(baseUrl) {
  const cacheKey = baseUrl;
  const cached = listViewCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.log("Unibet auto: cache hit", {
      league: baseUrl.split("/").slice(-2).join("/"),
    });
    return cached.events;
  }

  const url = buildListViewUrl(baseUrl);
  console.log("********* UNIBET URL ********", url);
  console.log("Unibet auto: fetching", { url });

  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    next: { revalidate: 60 },
  });
  if (!response.ok) {
    console.warn("Unibet auto: fetch failed", { status: response.status, url });
    return [];
  }

  const json = await response.json().catch(() => ({}));
  const events = (json?.events || [])
    .map(toEvent)
    .filter((e) => e?.id && e.homeName && e.awayName);

  listViewCache.set(cacheKey, { events, expiresAt: Date.now() + 300_000 }); // 5 min
  return events;
}

// --- HITTA MATCH ---
export async function findUnibetEventForMatch(matchInfo = {}) {
  const { aliasMap, leagueMap } = await loadConfiguration();

  const leagueName = canonicalizeLeagueName(matchInfo.leagueName, leagueMap);
  const config = getLeagueConfig(leagueName);

  if (!config) {
    console.warn("Unibet auto: no config for league", {
      league: matchInfo.leagueName,
    });
    return null;
  }

  console.log("Unibet auto: using config", {
    league: leagueName,
    config: config.baseUrl,
  });

  const events = await fetchListViewEvents(config.baseUrl);
  const canonicalHomeTeam =
    canonicalizeTeamName(matchInfo.homeTeam, aliasMap) || matchInfo.homeTeam;
  const canonicalAwayTeam =
    canonicalizeTeamName(matchInfo.awayTeam, aliasMap) || matchInfo.awayTeam;
  const context = {
    matchHomeNorm: normalizeTeamName(canonicalHomeTeam),
    matchAwayNorm: normalizeTeamName(canonicalAwayTeam),
    targetTimestamp: toTimestampMs(
      matchInfo.timestamp ?? matchInfo.kickoff ?? matchInfo.start
    ),
    matchLeagueNorm: normalizeLeagueName(leagueName),
  };

  const result = collectCandidates(events, context, aliasMap, leagueMap);
  if (result.candidates.length === 0) {
    console.warn("Unibet auto: no match found", {
      league: leagueName,
      events: events.length,
    });
    return null;
  }

  result.candidates.sort((a, b) => b.score - a.score);
  const best = result.candidates[0];

  console.log("Unibet auto: match found", {
    eventId: best.event.id,
    home: best.canonicalHome,
    away: best.canonicalAway,
    league: best.eventLeague,
  });

  return {
    eventId: String(best.event.id),
    eventUrl: `${UNIBET_EVENT_BASE_URL.replace(/\/$/, "")}/${best.event.id}`,
    start: best.event.start ?? null,
    league: best.eventLeague ?? null,
    homeTeam: best.canonicalHome,
    awayTeam: best.canonicalAway,
  };
}

function collectCandidates(events, context, aliasMap, leagueMap) {
  const { matchHomeNorm, matchAwayNorm, targetTimestamp, matchLeagueNorm } =
    context;
  const candidates = [];

  for (const event of events || []) {
    const eventHome = canonicalizeTeamName(event.homeName, aliasMap);
    const eventAway = canonicalizeTeamName(event.awayName, aliasMap);
    const eventHomeNorm = normalizeTeamName(eventHome || event.homeName);
    const eventAwayNorm = normalizeTeamName(eventAway || event.awayName);

    const matchesExactOrder =
      eventHomeNorm === matchHomeNorm && eventAwayNorm === matchAwayNorm;
    const matchesSwappedOrder =
      eventHomeNorm === matchAwayNorm && eventAwayNorm === matchHomeNorm;

    if (!matchesExactOrder && !matchesSwappedOrder)
      continue;

    const eventStart = parseEventStart(event);
    const diffMs =
      targetTimestamp && eventStart
        ? Math.abs(eventStart - targetTimestamp)
        : null;
    if (diffMs !== null && diffMs > SIX_HOURS_MS) continue;

    const eventLeague = canonicalizeLeagueName(
      extractLeagueName(event),
      leagueMap
    );
    const eventLeagueNorm = normalizeLeagueName(eventLeague);

    let score = 0;
    if (diffMs !== null)
      score += Math.max(0, SIX_HOURS_MS - diffMs) / (60 * 60 * 1000);
    if (matchLeagueNorm && eventLeagueNorm === matchLeagueNorm) score += 5;

    candidates.push({
      event,
      score,
      diffMs,
      eventLeague,
      canonicalHome: matchesExactOrder
        ? eventHome || event.homeName
        : eventAway || event.awayName,
      canonicalAway: matchesExactOrder
        ? eventAway || event.awayName
        : eventHome || event.homeName,
    });
  }

  return { candidates };
}

export { UNIBET_EVENT_BASE_URL };
