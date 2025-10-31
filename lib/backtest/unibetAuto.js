import { readFile } from "node:fs/promises";
import path from "node:path";

import TEAM_NAME_ALIASES from "@/components/backtest/teamNameAliases";

const LIST_VIEW_BASE_URL =
  "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/listView/football.json";
const UNIBET_EVENT_BASE_URL = "https://www.unibet.se/betting/sports/event";

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.unibet.se/",
  "X-Requested-With": "XMLHttpRequest",
};

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

let configurationPromise;
const listViewCache = new Map();

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
  return Array.from(new Set(Array.from(variants).map((v) => v.trim()).filter(Boolean)));
}

function buildAliasMap(leaguesData, customAliases) {
  const map = new Map();

  const addAlias = (alias, canonical) => {
    if (!alias || !canonical) return;
    const normalized = normalizeTeamName(alias);
    if (!normalized) return;
    if (!map.has(normalized)) {
      map.set(normalized, canonical);
    }
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
      for (const variant of generateNameVariants(canonical)) {
        addAlias(variant, canonical);
      }
    }
    for (const alias of aliases || []) {
      for (const variant of generateNameVariants(alias)) {
        addAlias(variant, canonical);
      }
    }
  }

  return map;
}

function buildLeagueMap(leaguesData) {
  const map = new Map();
  for (const leagueName of Object.keys(leaguesData)) {
    for (const variant of generateLeagueVariants(leagueName)) {
      const normalized = normalizeLeagueName(variant);
      if (normalized && !map.has(normalized)) {
        map.set(normalized, leagueName);
      }
    }
  }
  return map;
}

function slugifySegment(value) {
  if (!value) return null;
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .trim() || null;
}

function buildLeagueMetaMap(leaguesData) {
  const map = new Map();
  for (const [leagueName, info] of Object.entries(leaguesData)) {
    if (!info || typeof info !== "object") continue;
    const groupId = info.groupId ? String(info.groupId) : null;
    const countrySlug = slugifySegment(info.country);
    const leagueSlug = slugifySegment(leagueName);
    map.set(leagueName, {
      groupId,
      countrySlug,
      leagueSlug,
    });
  }
  return map;
}

async function loadConfiguration() {
  if (!configurationPromise) {
    configurationPromise = (async () => {
      const leaguesPath = path.join(process.cwd(), "data", "leagues-and-teams.json");
      const raw = await readFile(leaguesPath, "utf-8");
      const leagues = JSON.parse(raw);
      const aliasMap = buildAliasMap(leagues, TEAM_NAME_ALIASES);
      const leagueMap = buildLeagueMap(leagues);
      const leagueMetaMap = buildLeagueMetaMap(leagues);
      return { aliasMap, leagueMap, leagueMetaMap };
    })();
  }
  return configurationPromise;
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

function canonicalizeTeamName(name, aliasMap) {
  const resolved = resolveTeamName(name, aliasMap);
  if (resolved) return resolved;
  if (typeof name === "string") {
    const trimmed = name.trim();
    return trimmed || null;
  }
  return null;
}

function canonicalizeLeagueName(name, leagueMap) {
  const normalized = normalizeLeagueName(name);
  if (normalized && leagueMap.has(normalized)) {
    return leagueMap.get(normalized);
  }
  if (typeof name === "string") {
    const trimmed = name.trim();
    return trimmed || null;
  }
  return null;
}

function buildListViewUrl(options = {}) {
  let base = LIST_VIEW_BASE_URL;
  if (options.countrySlug && options.leagueSlug) {
    base = `https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/listView/football/${options.countrySlug}/${options.leagueSlug}.json`;
  }

  const url = new URL(base);
  url.searchParams.set("lang", "sv_SE");
  url.searchParams.set("market", "SE");
  url.searchParams.set("client_id", "2");
  url.searchParams.set("channel_id", "1");
  url.searchParams.set("useCombined", "true");
  url.searchParams.set("ncid", Date.now().toString());
  return url.toString();
}

function toEvent(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.event && typeof entry.event === "object") {
    return entry.event;
  }
  return entry;
}

function extractLeagueName(event) {
  if (!event) return null;
  if (event.group) return event.group;
  if (event.groupName) return event.groupName;
  if (event.tournament?.name) return event.tournament.name;
  if (event.eventGroup) return event.eventGroup;
  return null;
}

function toTimestampMs(value) {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseEventStart(event) {
  if (!event?.start) return null;
  const date = new Date(event.start);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function resolveListViewCache(key) {
  if (!listViewCache.has(key)) {
    listViewCache.set(key, { expiresAt: 0, events: [] });
  }
  return listViewCache.get(key);
}

async function fetchListViewEvents(options = {}) {
  const cacheKey = buildCacheKeyFromOptions(options);
  const cacheEntry = resolveListViewCache(cacheKey);
  const now = Date.now();
  if (cacheEntry.events.length && cacheEntry.expiresAt > now) {
    console.log("Unibet auto: returning cached listView events", {
      count: cacheEntry.events.length,
      expiresAt: new Date(cacheEntry.expiresAt).toISOString(),
      cacheKey,
    });
    return cacheEntry.events;
  }

  const url = buildListViewUrl(options);
  console.log("Unibet auto: fetching listView events", { url, cacheKey, options });

  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    console.warn("Unibet auto: listView fetch failed", {
      status: response.status,
      url,
    });
    throw new Error(
      `Unibet listView request failed with status ${response.status} (${url})`
    );
  }

  const json = await response.json().catch(() => ({}));
  const events = Array.isArray(json?.events)
    ? json.events
        .map(toEvent)
        .filter((event) => event && event.id && event.homeName && event.awayName)
    : [];

  cacheEntry.events = events;
  cacheEntry.expiresAt = now + 60_000;

  listViewCache.set(cacheKey, cacheEntry);

  console.log("Unibet auto: fetched listView events", {
    count: events.length,
    cacheKey,
  });

  return events;
}

function buildCacheKeyFromOptions(options) {
  if (options?.groupId) {
    return `group:${options.groupId}`;
  }
  if (options?.countrySlug || options?.leagueSlug) {
    return `league:${options.countrySlug || "unknown"}:${options.leagueSlug || "unknown"}`;
  }
  return "default";
}

async function fetchListViewEventsWithMeta(meta = null) {
  if (!meta) {
    return fetchListViewEvents();
  }
  if (meta.countrySlug && meta.leagueSlug) {
    return fetchListViewEvents({
      countrySlug: meta.countrySlug,
      leagueSlug: meta.leagueSlug,
    });
  }
  return fetchListViewEvents();
}

function collectCandidates(events, context, aliasMap, leagueMap) {
  const { matchHomeNorm, matchAwayNorm, targetTimestamp, matchLeagueNorm } = context;
  const candidates = [];
  const potentialHomeMatches = [];

  for (const event of events || []) {
    const eventHome = canonicalizeTeamName(event.homeName, aliasMap);
    const eventAway = canonicalizeTeamName(event.awayName, aliasMap);
    const eventHomeNorm = normalizeTeamName(eventHome || event.homeName);
    const eventAwayNorm = normalizeTeamName(eventAway || event.awayName);

    if (!eventHomeNorm || !eventAwayNorm) continue;
    if (eventHomeNorm === matchHomeNorm) {
      potentialHomeMatches.push({
        id: event.id,
        home: eventHome || event.homeName,
        away: eventAway || event.awayName,
        start: event.start ?? null,
        group: extractLeagueName(event),
      });
    }
    if (eventHomeNorm !== matchHomeNorm || eventAwayNorm !== matchAwayNorm) {
      continue;
    }

    const eventStart = parseEventStart(event);
    const diffMs =
      targetTimestamp && eventStart ? Math.abs(eventStart - targetTimestamp) : null;
    if (diffMs !== null && diffMs > SIX_HOURS_MS) {
      continue;
    }

    const eventLeague = canonicalizeLeagueName(extractLeagueName(event), leagueMap);
    const eventLeagueNorm = normalizeLeagueName(eventLeague);

    let score = 0;
    if (diffMs !== null) {
      score += Math.max(0, SIX_HOURS_MS - diffMs) / (60 * 60 * 1000);
    }
    if (matchLeagueNorm && eventLeagueNorm === matchLeagueNorm) {
      score += 5;
    }

    candidates.push({
      event,
      score,
      diffMs,
      eventLeague,
      canonicalHome: eventHome || event.homeName,
      canonicalAway: eventAway || event.awayName,
    });
  }

  return { candidates, potentialHomeMatches };
}

export async function findUnibetEventForMatch(matchInfo = {}) {
  const { aliasMap, leagueMap, leagueMetaMap } = await loadConfiguration();

  console.log("Unibet auto: find match start", {
    homeTeam: matchInfo.homeTeam,
    awayTeam: matchInfo.awayTeam,
    leagueName: matchInfo.leagueName,
    timestamp: matchInfo.timestamp ?? matchInfo.kickoff ?? matchInfo.start ?? null,
  });

  const matchHome = canonicalizeTeamName(matchInfo.homeTeam, aliasMap);
  const matchAway = canonicalizeTeamName(matchInfo.awayTeam, aliasMap);
  const matchHomeNorm = normalizeTeamName(matchHome || matchInfo.homeTeam);
  const matchAwayNorm = normalizeTeamName(matchAway || matchInfo.awayTeam);

  if (!matchHomeNorm || !matchAwayNorm) {
    return null;
  }

  const targetTimestamp = toTimestampMs(
    matchInfo.timestamp ?? matchInfo.kickoff ?? matchInfo.start ?? null
  );
  const matchLeague = canonicalizeLeagueName(matchInfo.leagueName, leagueMap);
  const matchLeagueNorm = normalizeLeagueName(matchLeague);

  const searchContext = {
    matchHomeNorm,
    matchAwayNorm,
    targetTimestamp,
    matchLeagueNorm,
  };

  let primaryResult = collectCandidates(
    await fetchListViewEvents(),
    searchContext,
    aliasMap,
    leagueMap
  );

  const meta =
    (matchLeague && leagueMetaMap.get(matchLeague)) ||
    leagueMetaMap.get(matchInfo.leagueName || "");

  let usedMeta = null;
  if (!primaryResult.candidates.length && meta) {
    const leagueEvents = await fetchListViewEventsWithMeta(meta);
    const leagueResult = collectCandidates(leagueEvents, searchContext, aliasMap, leagueMap);
    usedMeta = meta;
    primaryResult = {
      candidates: leagueResult.candidates,
      potentialHomeMatches: primaryResult.potentialHomeMatches.concat(
        leagueResult.potentialHomeMatches
      ),
    };
    console.log("Unibet auto: league fallback result", {
      meta,
      candidates: leagueResult.candidates.length,
    });
  }

  if (!primaryResult.candidates.length) {
    const triedKeys = new Set();
    if (usedMeta && usedMeta.countrySlug && usedMeta.leagueSlug) {
      triedKeys.add(`${usedMeta.countrySlug}:${usedMeta.leagueSlug}`);
    } else if (meta?.countrySlug && meta?.leagueSlug) {
      triedKeys.add(`${meta.countrySlug}:${meta.leagueSlug}`);
    }
    for (const metaEntry of leagueMetaMap.values()) {
      if (!metaEntry?.countrySlug || !metaEntry?.leagueSlug) continue;
      const key = `${metaEntry.countrySlug}:${metaEntry.leagueSlug}`;
      if (triedKeys.has(key)) continue;
      triedKeys.add(key);
      const leagueEvents = await fetchListViewEventsWithMeta(metaEntry);
      const leagueResult = collectCandidates(
        leagueEvents,
        searchContext,
        aliasMap,
        leagueMap
      );
      console.log("Unibet auto: scanning league listView", {
        meta: metaEntry,
        candidates: leagueResult.candidates.length,
      });
      if (leagueResult.candidates.length) {
        usedMeta = metaEntry;
        primaryResult = {
          candidates: leagueResult.candidates,
          potentialHomeMatches: primaryResult.potentialHomeMatches.concat(
            leagueResult.potentialHomeMatches
          ),
        };
        break;
      }
      primaryResult = {
        candidates: [],
        potentialHomeMatches: primaryResult.potentialHomeMatches.concat(
          leagueResult.potentialHomeMatches
        ),
      };
    }
  }

  if (!primaryResult.candidates.length) {
    console.warn("Unibet auto: no listView match", {
      homeTeam: matchInfo.homeTeam,
      awayTeam: matchInfo.awayTeam,
      league: matchInfo.leagueName,
      canonicalLeague: matchLeague,
      timestamp: matchInfo.timestamp ?? matchInfo.kickoff ?? matchInfo.start ?? null,
      matchHomeNorm,
      matchAwayNorm,
      potentialHomeCount: primaryResult.potentialHomeMatches.length,
      sample: primaryResult.potentialHomeMatches.slice(0, 5),
      usedMeta,
    });
    return null;
  }

  const candidates = primaryResult.candidates;
  console.log("Unibet auto: sorted candidates", {
    count: candidates.length,
    topIds: candidates.slice(0, 3).map((c) => c.event.id),
  });

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.diffMs !== b.diffMs) {
      if (a.diffMs === null) return 1;
      if (b.diffMs === null) return -1;
      return a.diffMs - b.diffMs;
    }
    const aId = Number(a.event.id);
    const bId = Number(b.event.id);
    if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
    return String(a.event.id).localeCompare(String(b.event.id));
  });

  const best = candidates[0];
  console.log("Unibet auto: match found", {
    eventId: best.event.id,
    home: best.canonicalHome,
    away: best.canonicalAway,
    league: best.eventLeague ?? null,
    start: best.event.start ?? null,
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

export { UNIBET_EVENT_BASE_URL };
