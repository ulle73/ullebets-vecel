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
import { findUnibetEventForMatch, UNIBET_EVENT_BASE_URL } from "../lib/backtest/unibetAuto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = "https://ullebets-vecel.vercel.app";
const EVENT_ODDS_BASE_URL =
  "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event";
const TIME_ZONE = "Europe/Stockholm";
const COLLECTION_NAME = "unibet-backtest";
const DEFAULT_FORM = "all";
const DEFAULT_IMPORTANCE = 5;
const DEFAULT_NEUTRAL = false;
const CLOSING_SNAPSHOT_LIMIT = 5;

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
const teamDataCache = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildBetKey({
  matchId,
  homeTeam,
  awayTeam,
  stat,
  scope,
  period,
  line,
  over,
  form,
  neutralGround,
}) {
  const parts = [
    matchId != null ? String(matchId) : "",
    String(homeTeam || "").toLowerCase().trim(),
    String(awayTeam || "").toLowerCase().trim(),
    stat ?? "",
    scope ?? "total",
    period ?? "ALL",
    over ? "over" : "under",
    Number(line),
    form ?? "",
    neutralGround ? "N" : "H",
  ];
  return parts.join("|");
}

function formatDateInZone(dateLike, timeZone = TIME_ZONE) {
  const date = new Date(dateLike);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
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

async function fetchFixturesByDate(dateStr) {
  // 1) DB: match-for-date
  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB || "app");
    const col = db.collection("match-for-date");
    const doc =
      (await col.findOne({ _id: dateStr })) ||
      (await col.findOne({ date: dateStr }));

    const candidates = [];
    if (Array.isArray(doc?.matches)) candidates.push(...doc.matches);
    if (Array.isArray(doc?.full)) {
      for (const entry of doc.full) {
        if (Array.isArray(entry?.matches)) candidates.push(...entry.matches);
        else if (entry?.match) candidates.push(entry.match);
      }
    }
    if (Array.isArray(doc?.sources)) {
      for (const src of doc.sources) {
        if (Array.isArray(src?.matches)) candidates.push(...src.matches);
      }
    }

    if (candidates.length) {
      console.log(`📄 Fixtures från DB match-for-date (${candidates.length})`);
      return candidates;
    }
  } catch (err) {
    console.warn(`⚠️ Kunde inte hämta fixtures från match-for-date: ${err.message}`);
  }

  // 2) API fallback
  try {
    const url = `${BASE_URL}/api/matches/by-date?date=${encodeURIComponent(dateStr)}`;
    const res = await fetch(url);
    if (res.ok) {
      const payload = await res.json();
      const items = payload?.items || [];
      if (items.length) {
        console.log(`📡 Fixtures från API /matches/by-date (${items.length})`);
        return items;
      }
    } else {
      const text = await res.text().catch(() => "");
      console.warn(`⚠️ API /matches/by-date misslyckades: ${res.status} ${text}`);
    }
  } catch (err) {
    console.warn(`⚠️ API /matches/by-date fel: ${err.message}`);
  }

  console.warn("⚠️ Inga fixtures hittades (DB/API)");
  return [];
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function fetchEventOdds(eventId) {
  const url = buildEventOddsUrl(eventId);
  const data = await fetchJson(url);
  return {
    betOffers: data?.betOffers || [],
    event: data?.event || null,
  };
}

async function mapFixtureToUnibetMatch(fx) {
  const matchId =
    fx.matchId ||
    fx.id ||
    fx.match_id ||
    fx.raw?.matchId ||
    fx.raw?.match_id ||
    fx.raw?.event?.id ||
    fx.raw?.eventId ||
    null;

  const matchInfo = {
    homeTeam:
      fx.homeTeamName ||
      fx.homeTeam?.name ||
      fx.raw?.homeTeamName ||
      fx.raw?.homeTeam?.name,
    awayTeam:
      fx.awayTeamName ||
      fx.awayTeam?.name ||
      fx.raw?.awayTeamName ||
      fx.raw?.awayTeam?.name,
    leagueName:
      fx.leagueName ||
      fx.league?.name ||
      fx.tournament?.name ||
      fx.raw?.league?.name ||
      fx.raw?.tournament?.name,
    timestamp:
      fx.matchDate ||
      fx.timestamp ||
      fx.startTimestamp ||
      fx.raw?.event?.start ||
      fx.raw?.start ||
      fx.time?.currentPeriodStart,
  };

  if (!matchInfo.homeTeam || !matchInfo.awayTeam) {
    return null;
  }

  let found = await findUnibetEventForMatch(matchInfo);
  if (!found) {
    await sleep(1200);
    found = await findUnibetEventForMatch(matchInfo, { forceRefresh: true });
  }
  if (!found) return null;

  return {
    eventId: String(found.eventId),
    matchId,
    start: found.start || matchInfo.timestamp,
    canonicalHome: found.homeTeam || matchInfo.homeTeam,
    canonicalAway: found.awayTeam || matchInfo.awayTeam,
    league: found.league || matchInfo.leagueName,
    url: found.eventUrl || `${UNIBET_EVENT_BASE_URL}/${found.eventId}`,
  };
}

async function ensureTeamData(teamName) {
  if (!teamDataCache.has(teamName)) {
    const [profiles, homeMatches, awayMatches] = await Promise.all([
      fetchTeamProfilesBundle(teamName),
      fetchTeamMatches(teamName, "home"),
      fetchTeamMatches(teamName, "away"),
    ]);
    teamDataCache.set(teamName, {
      profiles,
      homeMatches,
      awayMatches,
    });
  }
  return teamDataCache.get(teamName);
}

async function runEvCalculation(match, tuple, direction, odds) {
  const params = {
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

function collectEvDetails(result) {
  if (!result || typeof result !== "object") return {};

  const evDetails = {};
  for (const [key, value] of Object.entries(result)) {
    if (key.startsWith("evPct") || key === "legacyEvPct" || key.includes("Ev")) {
      const numericValue = toNumber(value);
      if (numericValue !== null) {
        evDetails[key] = numericValue;
      }
    }
  }
  return evDetails;
}

function resolvePrimaryEvValue(evDetails) {
  if (!evDetails) return null;
  const preferredOrder = [
    "evPctUniversalOptimized",
    "evPctWithMultiplier",
    "evPctMultifactor",
    "evPctOptaCombined",
    "evPctOptaPlusBase",
    "evPctLeagueAvg",
    "evPct",
    "legacyEvPct",
  ];
  for (const key of preferredOrder) {
    const value = evDetails[key];
    if (typeof value === "number") return value;
  }
  for (const [, value] of Object.entries(evDetails)) {
    if (typeof value === "number") return value;
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

async function processMatch(match, collection, meta) {
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
      if (!oddValue || !Number.isFinite(oddValue)) continue;
      const condition = direction === "over" ? "över" : "under";
      console.log(
        `   → Kör ${statKey} ${scope}/${period} ${condition} ${line} @ ${oddValue}`
      );
      try {
        const result = await runEvCalculation(match, tuple, direction, Number(oddValue));
        const evDetails = collectEvDetails(result);
        const value = resolvePrimaryEvValue(evDetails);
        lines.push({
          betKey: buildBetKey({
            matchId: match.matchId,
            homeTeam: match.canonicalHome,
            awayTeam: match.canonicalAway,
            stat: statKey,
            scope,
            period,
            line,
            over: direction === "over",
            form: DEFAULT_FORM,
            neutralGround: DEFAULT_NEUTRAL,
          }),
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

  const snapshot = {
    type: "closing",
    runDate: matchDate,
    fetchedAt: new Date(),
    lines,
  };

  const baseFields = {
    slug,
    eventId: match.eventId,
    matchId: match.matchId || null,
    matchDate,
    url: match.url,
    league: match.league,
    homeTeam: match.canonicalHome,
    awayTeam: match.canonicalAway,
  };

  await collection.updateOne(
    { _id: slug },
    {
      $setOnInsert: { generatedAt: new Date().toISOString() },
      $set: baseFields,
      $push: {
        snapshots: { $each: [snapshot], $slice: -CLOSING_SNAPSHOT_LIMIT },
      },
    },
    { upsert: true }
  );

  console.log(
    `   ✅ Sparade closing-snapshot (${lines.length} linjer) för ${slug}`
  );

  return {
    slug,
    lineCount: lines.length,
    homeTeam: match.canonicalHome,
    awayTeam: match.canonicalAway,
  };
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

async function main() {
  const { date } = parseCliArgs(process.argv);
  const targetDate = date ? new Date(date) : new Date();
  if (Number.isNaN(targetDate.getTime())) {
    throw new Error(`Ogiltigt datumformat: ${date}`);
  }
  const targetDateLabel = formatDateInZone(targetDate);

  console.log(`\n▶️  Kör closing-odds för datum ${targetDateLabel} (${TIME_ZONE})`);

  const fixtures = await fetchFixturesByDate(targetDateLabel);
  console.log(`📅 Hämtade ${fixtures.length} fixtures`);

  const matches = [];
  for (const fx of fixtures) {
    try {
      const mapped = await mapFixtureToUnibetMatch(fx);
      if (mapped) {
        matches.push(mapped);
      } else {
        console.warn(
          `⚠️ Hittade ingen Unibet-match för ${fx.homeTeamName || fx.homeTeam?.name} vs ${fx.awayTeamName || fx.awayTeam?.name}`
        );
      }
    } catch (err) {
      console.warn(`⚠️ Misslyckades att mappa fixture: ${err.message}`);
    }
  }

  console.log(`✅ ${matches.length} matcher hittades för closing-körning`);

  // Filtrera på start inom ±20 min från nu (closing-fönster)
  const now = Date.now();
  const windowMs = 20 * 60 * 1000;
  const windowed = matches.filter((m) => {
    const ts = m.start ? new Date(m.start).getTime() : null;
    if (!ts || Number.isNaN(ts)) return false;
    return Math.abs(ts - now) <= windowMs;
  });

  if (!windowed.length) {
    console.log("⚠️ Inga matcher inom 20 min-fönstret för closing.");
    if (typeof (await clientPromise).close === "function") {
      const client = await clientPromise;
      await client.close();
    }
    return;
  }

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const collection = db.collection(COLLECTION_NAME);

  let processed = 0;
  let totalLinesSaved = 0;
  for (const match of windowed) {
    const result = await processMatch(match, collection, {});
    if (result) {
      processed += 1;
      totalLinesSaved += result.lineCount;
    }
  }

  console.log(
    `ℹ️  Totalt sparade ${totalLinesSaved} linjer i ${processed}/${windowed.length} matcher (closing, 20 min fönster)`
  );

  if (typeof client.close === "function") {
    await client.close();
    console.log("✅ Stängde MongoDB-anslutningen.");
  }
}

main().catch((error) => {
  console.error("🚨 Closing-skriptet misslyckades:", error);
  process.exit(1);
});
