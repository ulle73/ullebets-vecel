import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

import mapUnibetOdds from "./frontend/src/utils/unibetOddsMapper.js";
import TEAM_NAME_ALIASES from "./frontend/src/utils/teamNameAliases.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIST_VIEW_BASE_URL =
  "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/listView/football.json";
const EVENT_ODDS_BASE_URL =
  "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event";
const UNIBET_EVENT_BASE_URL = "https://www.unibet.se/betting/sports/event";
const UNIBET_SERVER_BASE_URL =
  process.env.UNIBET_SERVER_BASE_URL || "http://localhost:5000";

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.unibet.se/",
  "X-Requested-With": "XMLHttpRequest",
};

const TIME_ZONE = "Europe/Stockholm";
const DEFAULT_FORM = "all";
const DEFAULT_IMPORTANCE = "5";
const DEFAULT_NEUTRAL = "false";

const leaguesPath = path.join(__dirname, "leagues-and-teams.json");
const leaguesRaw = await fs.readFile(leaguesPath, "utf-8");
const leagues = JSON.parse(leaguesRaw);

const teamToLeagues = new Map();
const groupIdToLeagues = new Map();
for (const [leagueName, leagueInfo] of Object.entries(leagues)) {
  for (const team of leagueInfo.teams) {
    const arr = teamToLeagues.get(team.name) || [];
    arr.push(leagueName);
    teamToLeagues.set(team.name, arr);
  }

  if (leagueInfo.groupId !== undefined && leagueInfo.groupId !== null) {
    const key = String(leagueInfo.groupId);
    const list = groupIdToLeagues.get(key) || [];
    list.push(leagueName);
    groupIdToLeagues.set(key, list);
  }
}

const hasGroupIdConfig = groupIdToLeagues.size > 0;

const normalizedLeagueMap = new Map();
for (const leagueName of Object.keys(leagues)) {
  for (const variant of generateLeagueVariants(leagueName)) {
    const normalized = normalizeLeagueName(variant);
    if (normalized) {
      normalizedLeagueMap.set(normalized, leagueName);
    }
  }
}

const aliasMap = buildAliasMap(leagues, TEAM_NAME_ALIASES);

function normalizeTeamName(name) {
  if (!name) return "";
  return name
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
  return name
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
    for (const team of leagueInfo.teams) {
      for (const variant of generateNameVariants(team.name)) {
        addAlias(variant, team.name);
      }
    }
  }

  for (const [canonical, aliases] of Object.entries(customAliases || {})) {
    for (const variant of generateNameVariants(canonical)) {
      addAlias(variant, canonical);
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

  const cleaned = normalized.replace(/\b(?:fc|cf|ac|afc|club|the)\b/g, "").replace(/\s+/g, " ").trim();
  if (cleaned && aliasMap.has(cleaned)) return aliasMap.get(cleaned);
  return null;
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
        ["TOURNAMENT", "COMPETITION", "LEAGUE", "EVENTGROUP", "GROUP"].includes(
          type
        )
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
  if (normalized && normalizedLeagueMap.has(normalized)) {
    return normalizedLeagueMap.get(normalized);
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
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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
  const args = { date: null, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--date=")) {
      args.date = arg.split("=")[1];
    } else if (arg === "--dry-run") {
      args.dryRun = true;
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

function toDecimalOdds(outcome) {
  if (!outcome) return null;
  if (typeof outcome.oddsDecimal === "number") return outcome.oddsDecimal;
  if (typeof outcome.odds === "number") return outcome.odds / 1000;
  if (typeof outcome.odds === "string" && outcome.odds.trim()) {
    const parsed = Number(outcome.odds);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof outcome.oddsFractional === "string") {
    const [num, denom] = outcome.oddsFractional
      .split("/")
      .map((part) => Number(part));
    if (!Number.isNaN(num) && !Number.isNaN(denom) && denom !== 0) {
      return num / denom + 1;
    }
  }
  return null;
}

function formatLine(line) {
  if (line === undefined || line === null) return "x";
  const numeric = Number(line);
  if (Number.isNaN(numeric)) return "x";
  return (numeric / 1000).toFixed(3);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

// async function fetchListView() {
//   const url = buildListViewUrl();
//   const json = await fetchJson(url);
//   return json.events || [];
// }

async function fetchListView() {
  const url = buildListViewUrl();
  console.log("🔎 Hämtar listView …");
  const json = await fetchJson(url);

  // Rådump: visa formen på de första raderna så vi vet exakt struktur
  const rawEvents = json?.events ?? [];
  console.log(
    `📥 listView: json.events typ=${
      Array.isArray(rawEvents) ? "array" : typeof rawEvents
    }, längd=${Array.isArray(rawEvents) ? rawEvents.length : 0}`
  );
  for (const [i, row] of rawEvents.slice(0, 3).entries()) {
    const keys =
      row && typeof row === "object" ? Object.keys(row) : ["(inte objekt)"];
    const innerKeys =
      row?.event && typeof row.event === "object" ? Object.keys(row.event) : [];
    console.log(
      `   • rå rad[${i}] keys=${JSON.stringify(
        keys
      )} | event.keys=${JSON.stringify(innerKeys)}`
    );
  }

  if (!Array.isArray(rawEvents)) {
    console.warn(
      "⚠️ listView: 'events' är inte en array – returnerar tom lista."
    );
    return [];
  }

  // Platta ut: ta row.event om det finns, annars row
  const flattened = rawEvents
    .map((row, idx) => {
      const ev = row?.event ?? row;
      if (!ev || typeof ev !== "object") {
        console.warn(`⚠️ Rad ${idx}: saknar giltigt event-objekt`);
        return null;
      }
      // Snabb sanity-logg för första raderna
      if (idx < 5) {
        console.log(
          `   ✔️ flat[${idx}]: id=${ev.id}, start=${ev.start}, home='${
            ev.homeName
          }', away='${ev.awayName}', group='${
            ev.group ?? ev.groupName ?? null
          }', groupId='${ev.groupId ?? ev.group?.id ?? "saknas"}'`
        );
      }
      return ev;
    })
    .filter(Boolean);

  return flattened;
}


async function fetchEventOdds(eventId) {
  const url = buildEventOddsUrl(eventId);
  const data = await fetchJson(url);
  const odds = {};

  const { event: normalizedEvent, eventId: nestedEventId } =
    extractEventFromOddsResponse(data);

  for (const offer of data.betOffers || []) {
    const label = offer?.criterion?.label;
    if (!label) continue;
    const market = odds[label] || { outcomes: [] };
    for (const outcome of offer.outcomes || []) {
      const line = formatLine(outcome.line);
      const decimalOdds = toDecimalOdds(outcome);
      if (!decimalOdds) continue;
      market.outcomes.push({
        participant: outcome.participant || "N/A",
        label: outcome.englishLabel || outcome.label || outcome.outcomeType || "",
        line,
        odds: decimalOdds.toFixed(2),
      });
    }
    if (market.outcomes.length) {
      odds[label] = market;
    }
  }

  return {
    odds,
    event: normalizedEvent,
    eventId: nestedEventId ?? normalizedEvent?.id ?? eventId,
  };
}

function extractEventFromOddsResponse(data) {
  if (!data || typeof data !== "object") {
    return { event: null, eventId: null };
  }

  if (Array.isArray(data.events)) {
    for (const entry of data.events) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.event && typeof entry.event === "object") {
        const nested = entry.event;
        return { event: nested, eventId: nested.id ?? null };
      }
      if (entry.id !== undefined && entry.id !== null) {
        return { event: entry, eventId: entry.id };
      }
    }
  }

  if (data.event && typeof data.event === "object") {
    const event = data.event;
    return { event, eventId: event.id ?? null };
  }

  return { event: null, eventId: null };
}

async function triggerServerOddsFetch(matchId) {
  if (!matchId) {
    console.warn("   ⚠️ Saknar matchId för serverhämtning av odds.");
    return null;
  }

  const baseUrl = UNIBET_SERVER_BASE_URL.replace(/\/$/, "");
  const endpoint = `${baseUrl}/unibet-odds/${matchId}`;

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const json = await response.json().catch(() => null);
    console.log(
      `   🔁 Uppdaterade Unibet-odds via servern för matchId ${matchId}.`
    );
    return json;
  } catch (error) {
    console.warn(
      `   ⚠️ Kunde inte uppdatera Unibet-odds via servern (${endpoint}): ${error.message}`
    );
    return null;
  }
}

async function runBacktest({
  homeTeam,
  awayTeam,
  direction,
  line,
  scope,
  statKey,
  period,
  odds,
}) {
  const scriptPath = path.join(__dirname, "backtest-copy.js");
  const resultFile = path.join(
    __dirname,
    `auto-backtest-result-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.json`
  );

  const args = [
    scriptPath,
    homeTeam,
    awayTeam,
    direction,
    String(line),
    scope,
    statKey,
    period,
    DEFAULT_FORM,
    DEFAULT_NEUTRAL,
    String(odds),
    DEFAULT_IMPORTANCE,
    DEFAULT_IMPORTANCE,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("node", args, {
      env: { ...process.env, RESULT_FILE: resultFile },
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });

    child.on("close", async (code) => {
      if (code !== 0) {
        return reject(new Error(`backtest exited with code ${code}: ${stderr}`));
      }
      try {
        const jsonText = await fs.readFile(resultFile, "utf-8");
        const json = JSON.parse(jsonText);
        await fs.unlink(resultFile).catch(() => {});
        resolve(json);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function processMatch(match, options) {
  const {
    eventId,
    start,
    canonicalHome,
    canonicalAway,
    url,
    league,
    rawHome,
    rawAway,
  } = match;

  console.log(
    `\n⚽️ ${canonicalHome} vs ${canonicalAway} (${league}) — event ${eventId}`
  );
  if (rawHome !== canonicalHome || rawAway !== canonicalAway) {
    console.log(
      `   ↳ Alias matchning: '${rawHome}' → '${canonicalHome}', '${rawAway}' → '${canonicalAway}'`
    );
  }

  if (options.dryRun) {
    console.log("   ⚠️ Dry-run aktiverad – hoppar över odds och backtest.");
    return;
  }

  const { odds, event, eventId: upstreamEventId } = await fetchEventOdds(eventId);
  if (!odds || Object.keys(odds).length === 0) {
    console.warn("   ⚠️ Inga odds hittades – hoppar över matchen.");
    return;
  }

  await triggerServerOddsFetch(upstreamEventId);

  const tuples = mapUnibetOdds(odds, canonicalHome, canonicalAway);
  if (!tuples.length) {
    console.warn("   ⚠️ Inga relevanta marknader hittades – hoppar över matchen.");
    return;
  }

  const results = [];
  for (const tuple of tuples) {
    const { statKey, scope, period, line, odds: tupleOdds } = tuple;
    for (const [dirKey, oddValue] of Object.entries(tupleOdds || {})) {
      if (!oddValue) continue;
      const direction = dirKey === "over" ? "över" : "under";
      console.log(
        `   → Kör ${statKey} ${scope}/${period} ${direction} ${line} @ ${oddValue}`
      );
      try {
        const result = await runBacktest({
          homeTeam: canonicalHome,
          awayTeam: canonicalAway,
          direction,
          line,
          scope,
          statKey,
          period,
          odds: oddValue,
        });
        const evDetails = collectEvDetails(result);
        const evValue = resolvePrimaryEvValue(evDetails);
        results.push({
          statKey,
          line,
          condition: direction,
          period,
          scope,
          odds: Number(oddValue),
          value: evValue,
          ...evDetails,
          evDetails,
          homeTeam: canonicalHome,
          awayTeam: canonicalAway,
        });
      } catch (err) {
        console.error(
          `   ❌ Misslyckades för ${statKey} ${direction} ${line}: ${err.message}`
        );
      }
    }
  }

  if (!results.length) {
    console.warn("   ⚠️ Inga resultat att spara.");
    return;
  }

  const matchDate = formatDateInZone(start || event?.start || new Date());
  const dirName = path.join(
    __dirname,
    "unibet-backtests",
    `${slugify(canonicalHome)}-${slugify(canonicalAway)}-${matchDate}`
  );
  await fs.mkdir(dirName, { recursive: true });
  const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const filePath = path.join(dirName, fileName);
  const payload = {
    url: url || `${UNIBET_EVENT_BASE_URL}/${eventId}`,
    lines: results,
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`   💾 Sparade ${results.length} marknader till ${filePath}`);
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
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

// Hjälpare: nästa dag
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  const options = parseCliArgs(process.argv);
  console.log("🔎 Bygger listView-URL …");
  const listUrl = buildListViewUrl();
  console.log(`GET ${listUrl}`);
  const events = await fetchListView();

  console.log(`\n📦 Totalt events från Unibet listView: ${events.length}`);
  if (events.length) {
    const sample = events.slice(0, Math.min(5, events.length));
    console.log("🧪 Första events (prov):");
    for (const e of sample) {
      console.log(
        `   • id=${e?.id}, start=${e?.start}, home='${e?.homeName}', away='${e?.awayName}', league='${extractLeagueName(e)}', groupId='${e?.groupId ?? e?.groupID ?? e?.group?.id ?? e?.eventGroupId ?? e?.tournamentId ?? "saknas"}'`
      );
    }
  }

  const targetDate = options.date ? new Date(options.date) : new Date();
  if (options.date && Number.isNaN(targetDate.getTime())) {
    throw new Error(`Ogiltigt datumformat: ${options.date}`);
  }
  console.log(
    `\n🎯 Target date (lokal): ${targetDate.toString()} | (SE-zon) ${formatDateInZone(targetDate)}`
  );

  // "today" + "next day"
  const datesToRun = [targetDate, addDays(targetDate, 1)];

  for (const currentDate of datesToRun) {
    console.log(
      `\n=========================\n==== DAG ${formatDateInZone(currentDate)} ====\n=========================`
    );

    const counts = {
      total: events.length,
      invalidShape: 0,
      notSameDay: 0,
      duplicateEventId: 0,
      filteredByGroupId: 0,
      unmatchedTeams: 0,
      missingLeague: 0,
      kept: 0,
    };

    const debugInfo = {
      sameDay: [],
      unmatchedTeams: [],
      missingLeague: [],
      groupIdFiltered: [],
    };
    const matches = [];
    const seenEvents = new Set();

    for (const event of events) {
      if (!event?.id || !event.start || !event.homeName || !event.awayName) {
        counts.invalidShape++;
        continue;
      }

      const sameDay = isSameDay(event.start, currentDate);
      if (!sameDay) {
        counts.notSameDay++;
        continue;
      }

      const rawGroupId =
        event.groupId ??
        event.groupID ??
        event.group?.id ??
        event.eventGroupId ??
        event.tournamentId ??
        null;
      const eventGroupId =
        rawGroupId === undefined || rawGroupId === null ? null : String(rawGroupId);
      const eventStart = coerceDate(event.start);

      debugInfo.sameDay.push({
        id: event.id,
        start: eventStart ? eventStart.toISOString() : event.start,
        homeName: event.homeName,
        awayName: event.awayName,
        league: extractLeagueName(event),
        groupId: eventGroupId,
      });

      if (seenEvents.has(event.id)) {
        counts.duplicateEventId++;
        console.log(`↩️  Dubblett id=${event.id} – hoppar.`);
        continue;
      }
      seenEvents.add(event.id);

      // GroupId-filter
      if (hasGroupIdConfig) {
        const leaguesForGroup = eventGroupId
          ? groupIdToLeagues.get(eventGroupId)
          : undefined;

        console.log(
          `🔗 groupId=${eventGroupId ?? "saknas"} → leagues: ${
            leaguesForGroup ? JSON.stringify(leaguesForGroup) : "[]"
          }`
        );

        if (!leaguesForGroup || leaguesForGroup.length === 0) {
          counts.filteredByGroupId++;
          console.warn(
            `🚫 Filtrerar bort event ${event.id} (${event.homeName} vs ${event.awayName}) – okänd groupId '${eventGroupId ?? "saknas"}'`
          );
          debugInfo.groupIdFiltered.push({
            id: event.id,
            homeName: event.homeName,
            awayName: event.awayName,
            groupId: eventGroupId,
            league: extractLeagueName(event),
          });
          continue;
        }
      }

      // Alias-/namnmatchning
      const homeNorm = normalizeTeamName(event.homeName);
      const awayNorm = normalizeTeamName(event.awayName);
      const canonicalHome = resolveTeamName(event.homeName);
      const canonicalAway = resolveTeamName(event.awayName);

      console.log(
        `👥 Lag: '${event.homeName}' (norm='${homeNorm}') → '${canonicalHome ?? "MISS"}'; '${event.awayName}' (norm='${awayNorm}') → '${canonicalAway ?? "MISS"}'`
      );

      if (!canonicalHome || !canonicalAway) {
        counts.unmatchedTeams++;
        console.warn(
          `🚫 Kunde inte matcha lag för event ${event.id}: ${event.homeName} vs ${event.awayName}`
        );
        debugInfo.unmatchedTeams.push({
          id: event.id,
          homeName: event.homeName,
          awayName: event.awayName,
        });
        continue;
      }

      // Liga-matchning
      const eventLeagueRaw = extractLeagueName(event);
      const eventLeagueNorm = normalizeLeagueName(eventLeagueRaw);
      const leaguesForGroup =
        eventGroupId ? groupIdToLeagues.get(eventGroupId) : undefined;

      let leagueName =
        Array.isArray(leaguesForGroup) && leaguesForGroup.length === 1
          ? leaguesForGroup[0]
          : null;

      console.log(
        `🏷️  Liga: raw='${eventLeagueRaw}' norm='${eventLeagueNorm}' | via groupId=${
          leagueName ?? "n/a"
        }`
      );

      if (!leagueName) {
        leagueName = findLeagueForMatch(
          eventLeagueRaw,
          canonicalHome,
          canonicalAway
        );
        console.log(
          `🔍 League resolve via namn/intersection → '${leagueName ?? "MISS"}' (home leagues=${JSON.stringify(
            teamToLeagues.get(canonicalHome) || []
          )}, away leagues=${JSON.stringify(teamToLeagues.get(canonicalAway) || [])})`
        );
      }

      if (!leagueName && Array.isArray(leaguesForGroup) && leaguesForGroup.length) {
        leagueName = leaguesForGroup[0];
        console.log(`🪄 Fallback liga via första i groupId-lista → '${leagueName}'`);
      }

      if (!leagueName) {
        counts.missingLeague++;
        console.warn(
          `🚫 Liga saknas i konfigurationen för event ${event.id}: '${eventLeagueRaw}' (groupId: ${eventGroupId ?? "saknas"})`
        );
        debugInfo.missingLeague.push({
          id: event.id,
          home: canonicalHome,
          away: canonicalAway,
          eventLeague: eventLeagueRaw,
          groupId: eventGroupId,
        });
        continue;
      }

      const url = event.url || event.webUrl || `${UNIBET_EVENT_BASE_URL}/${event.id}`;

      matches.push({
        eventId: event.id,
        start: eventStart ? eventStart.toISOString() : event.start,
        canonicalHome,
        canonicalAway,
        url,
        league: leagueName,
        rawHome: event.homeName,
        rawAway: event.awayName,
      });

      counts.kept++;
      console.log(
        `✅ Behåller event ${event.id}: ${canonicalHome} vs ${canonicalAway} — liga='${leagueName}', start=${eventStart ? eventStart.toISOString() : event.start}`
      );
    }

    const formattedDate = formatDateInZone(currentDate);
    console.log(`\n📊 Sammanfattning för ${formattedDate}`);
    console.log(`   • Total events i feed: ${counts.total}`);
    console.log(`   • Felaktig form (saknar fält): ${counts.invalidShape}`);
    console.log(`   • Ej samma dag: ${counts.notSameDay}`);
    console.log(`   • Dubbletter: ${counts.duplicateEventId}`);
    console.log(`   • Filtrerade p.g.a. okänd groupId: ${counts.filteredByGroupId}`);
    console.log(`   • Misslyckad lag-aliasmatchning: ${counts.unmatchedTeams}`);
    console.log(`   • Saknad liga i config: ${counts.missingLeague}`);
    console.log(`   • Kvar att bearbeta: ${counts.kept}`);

    if (!matches.length) {
      console.log("Inga matcher att bearbeta för valt datum.");
      continue;
    }

    console.log(`\n🚚 Går vidare med ${matches.length} matcher …`);
    for (const match of matches) {
      try {
        await processMatch(match, options);
      } catch (err) {
        console.error(
          `❌ Ett fel uppstod för event ${match.eventId}: ${err.message}`
        );
      }
    }
  }

  console.log("\n✅ Klar.");
}

main().catch((err) => {
  console.error("🚨 Skriptet misslyckades:", err);
  process.exit(1);
});
