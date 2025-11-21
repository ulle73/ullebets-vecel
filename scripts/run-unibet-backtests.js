import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mapUnibetOdds from "../components/backtest/unibetOddsMapper.js";
import TEAM_NAME_ALIASES from "../components/backtest/teamNameAliases.js";
import clientPromise from "../lib/mongo.js";
import {
  fetchTeamProfilesBundle,
  fetchTeamMatches,
} from "../lib/backtest/data.js";
import { calculateEVFromData } from "../lib/backtest/engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIST_VIEW_BASE_URL =
  "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/listView/football.json";
const EVENT_ODDS_BASE_URL =
  "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event";
const UNIBET_EVENT_BASE_URL = "https://www.unibet.se/betting/sports/event";
const TIME_ZONE = "Europe/Stockholm";
const COLLECTION_NAME = "unibet-backtest";
const DEFAULT_FORM = "all";
const DEFAULT_IMPORTANCE = 5;
const DEFAULT_NEUTRAL = false;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.unibet.se/",
  "X-Requested-With": "XMLHttpRequest",
};

const leaguesPath = path.join(process.cwd(), "data", "leagues-and-teams.json");
const leaguesRaw = await fs.readFile(leaguesPath, "utf-8");
const leagues = JSON.parse(leaguesRaw);

const aliasMap = buildAliasMap(leagues, TEAM_NAME_ALIASES);
const leagueMap = buildLeagueMap(leagues);
const teamToLeagues = buildTeamToLeagues(leagues);
const groupIdToLeagues = buildGroupIdToLeagues(leagues);
const hasGroupIdConfig = groupIdToLeagues.size > 0;

const teamDataCache = new Map();

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

function buildTeamToLeagues(leaguesData) {
  const map = new Map();
  for (const [leagueName, leagueInfo] of Object.entries(leaguesData)) {
    for (const team of leagueInfo.teams || []) {
      if (!team?.name) continue;
      const list = map.get(team.name) || [];
      list.push(leagueName);
      map.set(team.name, list);
    }
  }
  return map;
}

function buildGroupIdToLeagues(leaguesData) {
  const map = new Map();
  for (const [leagueName, leagueInfo] of Object.entries(leaguesData)) {
    if (
      leagueInfo.groupId !== undefined &&
      leagueInfo.groupId !== null &&
      leagueInfo.groupId !== ""
    ) {
      const key = String(leagueInfo.groupId);
      const list = map.get(key) || [];
      list.push(leagueName);
      map.set(key, list);
    }
  }
  return map;
}

function resolveTeamName(name) {
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

function canonicalizeTeamName(name) {
  const resolved = resolveTeamName(name);
  if (resolved) return resolved;
  return typeof name === "string" ? name.trim() : null;
}

function extractLeagueName(event) {
  if (!event) return null;
  if (event.group) return event.group;
  if (event.groupName) return event.groupName;
  if (event.eventGroup) return event.eventGroup;
  if (event.tournament) return event.tournament;
  if (Array.isArray(event.path)) {
    for (let i = event.path.length - 1; i >= 0; i -= 1) {
      const node = event.path[i];
      if (!node) continue;
      const type = String(node.type || node.nodeType || "").toUpperCase();
      const name = node.name || node.englishName || node.localizedName;
      if (!name) continue;
      if (
        ["TOURNAMENT", "COMPETITION", "LEAGUE", "EVENTGROUP", "GROUP"].includes(type)
      ) {
        return name;
      }
    }
    const last = event.path[event.path.length - 1];
    if (last) {
      return last.name || last.englishName || last.localizedName || null;
    }
  }
  return null;
}

function findLeagueForMatch(eventLeague, homeTeam, awayTeam) {
  const normalized = normalizeLeagueName(eventLeague);
  if (normalized && leagueMap.has(normalized)) {
    return leagueMap.get(normalized);
  }

  const homeLeagues = new Set(teamToLeagues.get(homeTeam) || []);
  const awayLeagues = new Set(teamToLeagues.get(awayTeam) || []);
  const intersection = Array.from(homeLeagues).filter((league) =>
    awayLeagues.has(league)
  );

  if (intersection.length === 1) return intersection[0];
  if (intersection.length > 1 && normalized) {
    const match = intersection.find(
      (league) => normalizeLeagueName(league) === normalized
    );
    if (match) return match;
  }
  return intersection[0] || null;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function coerceDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      const ms = num > 1e12 ? num : num * 1000;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateInZone(dateLike, timeZone = TIME_ZONE) {
  const date = coerceDate(dateLike);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function isSameDay(dateA, dateB, timeZone = TIME_ZONE) {
  if (!dateA || !dateB) return false;
  const normalizedA = formatDateInZone(dateA, timeZone);
  const normalizedB = formatDateInZone(dateB, timeZone);
  if (!normalizedA || !normalizedB) return false;
  return normalizedA === normalizedB;
}

function parseCliArgs(argv) {
  const args = { date: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--date=")) {
      args.date = arg.split("=")[1];
    }
  }
  return args;
}

function buildListViewUrl() {
  const url = new URL(LIST_VIEW_BASE_URL);
  url.searchParams.set("lang", "sv_SE");
  url.searchParams.set("market", "SE");
  url.searchParams.set("client_id", "2");
  url.searchParams.set("channel_id", "3");
  url.searchParams.set("useCombined", "true");
  url.searchParams.set("ncid", Date.now().toString());
  return url.toString();
}

function buildEventOddsUrl(eventId) {
  const url = new URL(`${EVENT_ODDS_BASE_URL}/${eventId}.json`);
  url.searchParams.set("lang", "sv_SE");
  url.searchParams.set("market", "SE");
  url.searchParams.set("client_id", "2");
  url.searchParams.set("channel_id", "3");
  url.searchParams.set("includeParticipants", "true");
  url.searchParams.set("ncid", Date.now().toString());
  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function fetchListView() {
  const url = buildListViewUrl();
  const json = await fetchJson(url);
  const rawEvents = json?.events ?? [];
  if (!Array.isArray(rawEvents)) {
    return [];
  }
  return rawEvents
    .map((row) => (row?.event && typeof row.event === "object" ? row.event : row))
    .filter((event) => event && typeof event === "object");
}

async function fetchEventOdds(eventId) {
  const url = buildEventOddsUrl(eventId);
  const data = await fetchJson(url);
  return {
    betOffers: data?.betOffers || [],
    event: data?.event || null,
  };
}

function collectEvDetails(result) {
  return {
    evPctWithMultiplier: toNumber(result?.evPctWithMultiplier),
    evPctMultifactor: toNumber(result?.evPctMultifactor),
    evPctLeagueAvg: toNumber(result?.evPctLeagueAvg),
    evPct: toNumber(result?.evPct),
    legacyEvPct: toNumber(result?.legacyEvPct),
  };
}

function resolvePrimaryEvValue(evDetails) {
  if (!evDetails) return null;
  const preferredOrder = [
    "evPctWithMultiplier",
    "evPctMultifactor",
    "evPctLeagueAvg",
    "evPct",
    "legacyEvPct",
  ];
  for (const key of preferredOrder) {
    const value = evDetails[key];
    if (typeof value === "number") {
      return value;
    }
  }
  return null;
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

async function ensureTeamData(teamName) {
  if (teamDataCache.has(teamName)) {
    return teamDataCache.get(teamName);
  }
  const [profiles, homeMatches, awayMatches] = await Promise.all([
    fetchTeamProfilesBundle(teamName),
    fetchTeamMatches(teamName, "home"),
    fetchTeamMatches(teamName, "away"),
  ]);
  const payload = {
    profiles,
    homeMatches,
    awayMatches,
  };
  teamDataCache.set(teamName, payload);
  return payload;
}

function buildBetParams(match, tuple, direction, odds) {
  return {
    homeTeam: match.canonicalHome,
    awayTeam: match.canonicalAway,
    stat: tuple.statKey,
    scope: tuple.scope,
    period: tuple.period,
    line: tuple.line,
    over: direction === "over",
    odds,
    form: DEFAULT_FORM,
    neutralGround: DEFAULT_NEUTRAL,
    home_importance: DEFAULT_IMPORTANCE,
    away_importance: DEFAULT_IMPORTANCE,
  };
}

async function runEvCalculation(match, tuple, direction, odds) {
  const params = buildBetParams(match, tuple, direction, odds);
  const [homeData, awayData] = await Promise.all([
    ensureTeamData(match.canonicalHome),
    ensureTeamData(match.canonicalAway),
  ]);

  const fetchedData = {
    homeBundle: homeData.profiles,
    awayBundle: awayData.profiles,
    homeMatchesRaw: homeData.homeMatches,
    awayMatchesRaw: awayData.awayMatches,
  };

  return calculateEVFromData(params, fetchedData);
}

function extractGroupId(event) {
  return (
    event.groupId ??
    event.groupID ??
    event.group?.id ??
    event.eventGroupId ??
    event.tournamentId ??
    null
  );
}

function getMatchesForDate(events, targetDate) {
  const matches = [];
  const seenEvents = new Set();

  for (const event of events) {
    if (!event?.id || !event.start || !event.homeName || !event.awayName) {
      continue;
    }

    if (!isSameDay(event.start, targetDate)) {
      continue;
    }

    if (seenEvents.has(event.id)) {
      continue;
    }
    seenEvents.add(event.id);

    const canonicalHome = canonicalizeTeamName(event.homeName);
    const canonicalAway = canonicalizeTeamName(event.awayName);
    if (!canonicalHome || !canonicalAway) {
      console.warn(
        `⚠️ Skipping event ${event.id}: missing alias for teams '${event.homeName}' vs '${event.awayName}'`
      );
      continue;
    }

    const eventGroupId = extractGroupId(event);
    if (hasGroupIdConfig) {
      if (!eventGroupId || !groupIdToLeagues.has(String(eventGroupId))) {
        console.warn(
          `⚠️ Skipping event ${event.id}: unknown groupId '${eventGroupId ?? "saknas"}'`
        );
        continue;
      }
    }

    let leagueName = null;
    const leagueCandidates = eventGroupId
      ? groupIdToLeagues.get(String(eventGroupId))
      : null;
    if (Array.isArray(leagueCandidates) && leagueCandidates.length === 1) {
      leagueName = leagueCandidates[0];
    }

    if (!leagueName) {
      leagueName = findLeagueForMatch(
        extractLeagueName(event),
        canonicalHome,
        canonicalAway
      );
    }

    if (!leagueName && Array.isArray(leagueCandidates) && leagueCandidates.length) {
      leagueName = leagueCandidates[0];
    }

    if (!leagueName) {
      console.warn(
        `⚠️ Skipping event ${event.id}: league missing in configuration (${event.homeName} vs ${event.awayName})`
      );
      continue;
    }

    matches.push({
      eventId: String(event.id),
      start: event.start,
      canonicalHome,
      canonicalAway,
      league: leagueName,
      url: event.url || event.webUrl || `${UNIBET_EVENT_BASE_URL}/${event.id}`,
    });
  }

  return matches;
}

async function processMatch(match, collection) {
  console.log(
    `⚽️ Bearbetar ${match.canonicalHome} vs ${match.canonicalAway} (event ${match.eventId})`
  );
  let betOffers;
  try {
    const oddsPayload = await fetchEventOdds(match.eventId);
    betOffers = oddsPayload.betOffers;
  } catch (error) {
    console.error(
      `❌ Kunde inte hämta odds för ${match.eventId}: ${error.message}`
    );
    return null;
  }

  const tuples = mapUnibetOdds(betOffers, match.canonicalHome, match.canonicalAway);
  if (!tuples.length) {
    console.warn("   ⚠️ Inga relevanta marknader hittades – hoppar över matchen.");
    return null;
  }

  const lines = [];
  for (const tuple of tuples) {
    const { statKey, scope, period, line, odds } = tuple;
    for (const direction of ["over", "under"]) {
      const oddValue = odds?.[direction];
      if (!oddValue || !Number.isFinite(oddValue)) {
        continue;
      }
      const condition = direction === "over" ? "över" : "under";
      console.log(
        `   → Kör ${statKey} ${scope}/${period} ${condition} ${line} @ ${oddValue}`
      );
      try {
        const result = await runEvCalculation(match, tuple, direction, Number(oddValue));
        const evDetails = collectEvDetails(result);
        const value = resolvePrimaryEvValue(evDetails);
        lines.push({
          statKey,
          line,
          condition,
          period,
          scope,
          odds: Number(oddValue),
          value,
          evDetails,
          homeTeam: match.canonicalHome,
          awayTeam: match.canonicalAway,
          actual: null,
          win: null,
        });
      } catch (error) {
        console.error(
          `   ❌ Misslyckades för ${statKey} ${condition} ${line}: ${error.message}`
        );
      }
    }
  }

  if (!lines.length) {
    console.warn("   ⚠️ Inga resultat att spara för matchen.");
    return null;
  }

  const matchDate = formatDateInZone(match.start);
  const slug = `${slugify(match.canonicalHome)}-${slugify(
    match.canonicalAway
  )}-${matchDate}`;
  const payload = {
    _id: slug,
    slug,
    eventId: match.eventId,
    matchDate,
    url: match.url,
    league: match.league,
    homeTeam: match.canonicalHome,
    awayTeam: match.canonicalAway,
    generatedAt: new Date().toISOString(),
    lines,
  };

  await collection.updateOne(
    { _id: slug },
    { $set: payload },
    { upsert: true }
  );

  console.log(
    `   ✅ Sparade ${lines.length} marknader till ${COLLECTION_NAME} (document ${slug})`
  );

  return {
    slug,
    lineCount: lines.length,
    homeTeam: match.canonicalHome,
    awayTeam: match.canonicalAway,
  };
}

async function main() {
  const { date } = parseCliArgs(process.argv);
  const targetDate = date ? new Date(date) : new Date();
  if (Number.isNaN(targetDate.getTime())) {
    throw new Error(`Ogiltigt datumformat: ${date}`);
  }
  const targetDateLabel = formatDateInZone(targetDate);
  console.log(
    `✅ Kör Unibet-backtests för datum ${targetDateLabel} (${TIME_ZONE})`
  );

  const events = await fetchListView();
  console.log(`⚽️ Hämtade ${events.length} events från Unibet listView`);

  const matches = getMatchesForDate(events, targetDate);
  console.log(`✅ ${matches.length} matcher matchade datumet och konfigurationen`);

  if (!matches.length) {
    console.log("Inga matcher att bearbeta för valt datum.");
    return;
  }

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const collection = db.collection(COLLECTION_NAME);

  let processed = 0;
  let totalLinesSaved = 0;
  const summaries = [];
  for (const match of matches) {
    const result = await processMatch(match, collection);
    if (result) {
      processed += 1;
      totalLinesSaved += result.lineCount;
      summaries.push(result);
    }
  }

  if (summaries.length) {
    console.log("\nℹ️   Matchöversikt");
    for (const entry of summaries) {
      console.log(
        `   ⚽️ ${entry.homeTeam} vs ${entry.awayTeam}: ${entry.lineCount} linjer`
      );
    }
  }

  console.log(
    `\nℹ️  Totalt sparade backtests (linjer): ${totalLinesSaved} i ${processed} matcher`
  );
  console.log(
    `✅ Klar! Backtests sparade för ${processed}/${matches.length} matcher i ${COLLECTION_NAME}.`
  );

  if (typeof client.close === "function") {
    await client.close();
    console.log("✅ Stängde MongoDB-anslutningen.");
  }
}

main().catch((error) => {
  console.error("🚨 Skriptet misslyckades:", error);
  process.exit(1);
});
