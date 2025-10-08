
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";

import { fetchScheduledMatches } from "../rapidApi/scheduled-matches.js";
import { fetchMatchStatistics } from "../rapidApi/match-statistics.js";
import { fetchMatchIncidents } from "../rapidApi/get-incidents.js";
import { fetchMatchShotmap } from "../rapidApi/shotmap.js";
import { fetchMatchOdds as fetchMatchOddsRapid } from "../rapidApi/odds.js";

// 👇 NYTT: DB-import efter körning
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
if (!process.env.VERCEL) {
  dotenv.config({ path: ".env.local" });
}

// __dirname för ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Absoluta basvägar (kan override:as via env)
const ABS_TEAMSTATS_DIR =
  process.env.TEAMSTATS_DIR ||
  "C:/Users/ryd/OneDrive/Skrivbord/FRONTEND/bet365/UNIBET/teamstats";

const ABS_PUBLIC_TEAMSTATS_DIR =
  process.env.PUBLIC_TEAMSTATS_DIR ||
  "C:/Users/ryd/OneDrive/Skrivbord/FRONTEND/bet365/UNIBET/frontend/public/teamstats";

// Relativ data-mapp (i repo) – skriv också hit
const REL_TEAMSTATS_DIR = path.join(__dirname, "..", "data", "teamstats");

// Skapa mapparna om de saknas
await fs.mkdir(ABS_TEAMSTATS_DIR, { recursive: true });
await fs.mkdir(ABS_PUBLIC_TEAMSTATS_DIR, { recursive: true });
await fs.mkdir(REL_TEAMSTATS_DIR, { recursive: true });

// Skriv till alla tre; läs från alla tre (prioritetsordning vid läsning)
const WRITE_DIRS = [
  ABS_TEAMSTATS_DIR,
  ABS_PUBLIC_TEAMSTATS_DIR,
  REL_TEAMSTATS_DIR,
];
const READ_DIRS = [
  ABS_TEAMSTATS_DIR,
  REL_TEAMSTATS_DIR,
  ABS_PUBLIC_TEAMSTATS_DIR,
];

// 👇 NYTT: spåra vilka filer som faktiskt skrevs
const WRITTEN_FILES = new Set();

// ---------- CLI ------------------------------------------------
const rawArgs = process.argv.slice(2);
const optionArgs = rawArgs.filter((arg) => arg.startsWith("--"));
const positionalArgs = rawArgs.filter((arg) => !arg.startsWith("--"));

const wantYesterdayMode = optionArgs.includes("--yesterday");

const filteredOptionArgs = optionArgs.filter(
  (arg) => arg !== "--yesterday" && !arg.startsWith("--backfill=")
);

const [ligaNamnInput, teamOrMatchesInput, maybeMatchesInput] = positionalArgs;

const antalMatcherCLI = isNaN(parseInt(teamOrMatchesInput))
  ? isNaN(parseInt(maybeMatchesInput))
    ? 10
    : +maybeMatchesInput
  : +teamOrMatchesInput;

// --backfill=N (valfri)
const backfillArg = optionArgs.find(
  (a) => typeof a === "string" && a.startsWith("--backfill=")
);
const backfill = backfillArg
  ? Math.max(0, parseInt(backfillArg.split("=")[1]))
  : 0;

// --- Selektiva flaggor ----------------------------------------
const allowedFlags = new Set([
  "--matches",
  "--incidents",
  "--shotmap",
  "--odds",
]);
const selectedFlags = filteredOptionArgs.filter((a) => allowedFlags.has(a));
const modeLimited = selectedFlags.length > 0;

const WANT_MATCHES = !modeLimited || selectedFlags.includes("--matches");
const WANT_INCIDENTS = !modeLimited || selectedFlags.includes("--incidents");
const WANT_SHOTMAP = !modeLimited || selectedFlags.includes("--shotmap");
const WANT_ODDS = !modeLimited || selectedFlags.includes("--odds");

// Enskild extraflagga? (inte --matches) → tvinga backfill
const singleFlagBackfillMode =
  modeLimited &&
  selectedFlags.length === 1 &&
  !selectedFlags.includes("--matches");

// ---------- Allmänt -------------------------------------------
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const lastRunFile = path.join(__dirname, ".last-run-update-teams-v2.json");
const MAX_LAST_RUN_HISTORY = 30;

let apiCalls = 0; // global anropsräknare

const apiCallStats = {
  rapid: { success: 0, failure: 0 },
  sofascore: { success: 0, failure: 0 },
};

const recordApiCallOutcome = (provider, success) => {
  if (!provider) return;
  const bucket = apiCallStats[provider];
  if (!bucket) return;
  if (success) {
    bucket.success += 1;
  } else {
    bucket.failure += 1;
  }
};

const logApiCallSummary = () => {
  console.log(
    `✅ Total lyckade API-anrop Rapid-api: ${apiCallStats.rapid.success}`
  );
  console.log(
    `❌ totalt misslyckade API-anrop Rapid-api: ${apiCallStats.rapid.failure}`
  );
  console.log("");
  console.log(
    `✅ Total lyckade API-anrop Sofascore.com: ${apiCallStats.sofascore.success}`
  );
  console.log(
    `❌ totalt misslyckade API-anrop Sofascore.com: ${apiCallStats.sofascore.failure}`
  );
};

const rapidApiKeys = Array.from(
  new Set(
    [
      process.env.RAPIDAPI_KEY,
      "2421949038msh47b6bd3f6b5c077p151577jsn42ebd0d9888a",
      "d26361d6a1msh55def5349c5e57dp1eaee1jsn74e247833a6e",
      "c347347d96msh753a5e5acbca775p174d61jsn4ddb08841042",
      "bcc2fe6d26msh84d34b156ba870fp1269cejsn3c65899c262e",
      "adb090d6e6msh09b5af9b62cab53p18ec97jsnf66f393501ab",
      "9ccda5724cmsh62c63c5c9b7bbb4p1a2637jsnfbfacc616c38",
      "d71b975b3bmsh119f2182f5f36a2p132437jsnc623beefd032",
      "458c4dc749msh93ad163f4a8f4efp13ac33jsn776bb3a83b55",
      "87b25a4718msh550e88b539cccfep180203jsna7971b255886",
    ].filter(Boolean)
  )
);
const rapidApiState = { index: 0, calls: 0 };

const EXTRA_MATCH_FIELDS = ["incidents", "shotmap", "odds"];

const normalizeKey = (value) => {
  if (typeof value !== "string") return null;

  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
};

const toNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const createLookupSets = () => ({
  leagueIds: new Set(),
  leagueKeys: new Set(),

  leaguePrimaryIds: new Set(),

  teamIds: new Set(),
  teamKeys: new Set(),
});

const addTeamToLookups = (lookups, team) => {
  if (!team || typeof team !== "object") return;

  const idCandidates = [
    team.id,
    team.teamId,
    team.optaId,
    team.sofaScoreId,
    team.sofascoreId,
    team.uniqueTeamId,
    team.participantId,
    team.clubId,
    team.primaryTeamId,
  ]
    .map((value) => toNumber(value))
    .filter((value) => value !== null);

  idCandidates.forEach((value) => lookups.teamIds.add(value));

  const keyCandidates = [
    team.name,
    team.slug,
    team.shortName,
    team.displayName,
    team.fullName,
    team.code,
    team.abbreviation,
    team.abbr,
    team.nickname,
    team.teamName,
  ]
    .map((value) => normalizeKey(value))
    .filter(Boolean);

  keyCandidates.forEach((value) => lookups.teamKeys.add(value));
};

const registerLeagueInfo = (lookups, leagueName, info = {}) => {
  const leagueKey = normalizeKey(leagueName);
  if (leagueKey) lookups.leagueKeys.add(leagueKey);

  const teamList = Array.isArray(info.teams) ? info.teams : [];

  const numericLeagueFields = [
    info.leagueId,
    info.seasonId,
    info.groupId,
    info.tournamentId,
    info.uniqueTournamentId,
    info.competitionId,
  ]
    .map((value) => toNumber(value))
    .filter((value) => value !== null);

  numericLeagueFields.forEach((value) => lookups.leagueIds.add(value));

  const primaryIdCandidates = [info.leagueId, info.uniqueTournamentId]
    .map((value) => toNumber(value))
    .filter((value) => value !== null);

  primaryIdCandidates.forEach((value) => lookups.leaguePrimaryIds.add(value));

  const keyLeagueFields = [
    info.slug,
    info.leagueSlug,
    info.uniqueTournamentSlug,
    info.name,
  ]
    .map((value) => normalizeKey(value))
    .filter(Boolean);

  keyLeagueFields.forEach((value) => lookups.leagueKeys.add(value));

  teamList.forEach((team) => addTeamToLookups(lookups, team));
};

const buildLeagueTeamLookups = (leaguesConfig = {}) => {
  const lookups = createLookupSets();

  for (const [leagueName, info] of Object.entries(leaguesConfig)) {
    if (!info || typeof info !== "object") continue;
    registerLeagueInfo(lookups, leagueName, info);
  }

  return lookups;
};

const eventMatchesLookups = (event, lookups) => {
  if (!event || typeof event !== "object") return false;
  if (!lookups) return true;

  const uniqueTournamentCandidates = [
    event.uniqueTournament,
    event.tournament?.uniqueTournament,
    event.league?.uniqueTournament,
    event.competition?.uniqueTournament,
  ].filter(Boolean);

  let leagueMatch = false;

  let canFallbackToBroadMatch = true;

  if (lookups.leaguePrimaryIds.size > 0) {
    const uniqueTournamentIds = uniqueTournamentCandidates
      .map((candidate) =>
        toNumber(
          candidate?.id ??
            candidate?.uniqueTournamentId ??
            candidate?.tournamentId ??
            candidate?.leagueId
        )
      )
      .filter((value) => value !== null);

    if (uniqueTournamentIds.length > 0) {
      leagueMatch = uniqueTournamentIds.some((value) =>
        lookups.leaguePrimaryIds.has(value)
      );
      canFallbackToBroadMatch = false;
    }
  }

  if (!leagueMatch && canFallbackToBroadMatch) {
    const leagueCandidates = [
      event.tournament,
      event.league,
      event.competition,
      event.uniqueTournament,
      event.tournament?.uniqueTournament,
      event.league?.uniqueTournament,
      event.competition?.uniqueTournament,
      event.round,
      event.group,
      event.season,
      event.category,
      event.tournament?.category,
      event.league?.category,
    ].filter(Boolean);

    for (const candidate of leagueCandidates) {
      const idValues = [
        candidate.id,
        candidate.leagueId,
        candidate.tournamentId,
        candidate.uniqueTournamentId,
        candidate.seasonId,
        candidate.groupId,
        candidate.categoryId,
      ]
        .map((value) => toNumber(value))
        .filter((value) => value !== null);

      if (idValues.some((value) => lookups.leagueIds.has(value))) {
        leagueMatch = true;
        break;
      }

      const keyValues = [
        candidate.name,
        candidate.slug,
        candidate.leagueName,
        candidate.tournamentName,
      ]
        .map((value) => normalizeKey(value))
        .filter(Boolean);

      if (keyValues.some((value) => lookups.leagueKeys.has(value))) {
        leagueMatch = true;
        break;
      }
    }
  }

  const checkTeamCandidate = (team) => {
    if (!team) return false;

    const idValues = [
      team.id,
      team.teamId,
      team.optaId,
      team.sofaScoreId,
      team.sofascoreId,
      team.uniqueTeamId,
      team.participantId,
      team.clubId,
      team.primaryTeamId,
    ]
      .map((value) => toNumber(value))
      .filter((value) => value !== null);

    if (idValues.some((value) => lookups.teamIds.has(value))) {
      return true;
    }

    const keyValues = [
      team.name,
      team.shortName,
      team.slug,
      team.displayName,
      team.fullName,
      team.code,
      team.abbreviation,
      team.abbr,
      team.nickname,
      team.teamName,
    ]
      .map((value) => normalizeKey(value))
      .filter(Boolean);

    return keyValues.some((value) => lookups.teamKeys.has(value));
  };

  let teamMatch = false;

  const directTeamCandidates = [
    event.homeTeam,
    event.home,
    event.teamHome,
    event.awayTeam,
    event.away,
    event.teamAway,
  ];
  for (const candidate of directTeamCandidates) {
    if (checkTeamCandidate(candidate)) {
      teamMatch = true;
      break;
    }
  }

  if (!teamMatch) {
    const participantLists = [
      event.participants,
      event.teams,
      event.competitors,
    ];
    for (const list of participantLists) {
      if (!Array.isArray(list)) continue;
      for (const participant of list) {
        if (checkTeamCandidate(participant)) {
          teamMatch = true;
          break;
        }
        if (participant?.team && checkTeamCandidate(participant.team)) {
          teamMatch = true;
          break;
        }
      }
      if (teamMatch) break;
    }
  }

  const requireLeague =
    lookups.leagueIds.size > 0 ||
    lookups.leagueKeys.size > 0 ||
    lookups.leaguePrimaryIds.size > 0;

  const requireTeam = lookups.teamIds.size > 0 || lookups.teamKeys.size > 0;

  if (requireLeague && requireTeam) return leagueMatch && teamMatch;
  if (requireLeague) return leagueMatch;
  if (requireTeam) return teamMatch;
  return true;
};

const describeEventLeague = (event) => {
  const tournament = event?.tournament || event?.league || {};
  const name =
    tournament?.name ||
    tournament?.uniqueTournament?.name ||
    event?.league?.name ||
    event?.competition?.name ||
    "okänd liga";
  const id =
    tournament?.uniqueTournament?.id ||
    tournament?.id ||
    event?.league?.id ||
    event?.competition?.id ||
    null;
  return { name, id };
};

const normalizeEvent = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const id = entry.id ?? entry.matchId ?? entry.eventId;
  if (!id) return null;

  const startTimestamp =
    entry.startTimestamp ??
    entry.timestamp ??
    entry.start_time ??
    entry.startTime ??
    null;

  const homeTeam =
    entry.homeTeam ?? entry.home ?? entry.home_team ?? entry.teamHome ?? {};
  const awayTeam =
    entry.awayTeam ?? entry.away ?? entry.away_team ?? entry.teamAway ?? {};

  const resolveTeamName = (team) => {
    if (typeof team === "string") return team;
    if (!team || typeof team !== "object") return null;
    return team.name ?? team.shortName ?? team.slug ?? null;
  };

  const resolveTeamId = (team) => {
    if (!team || typeof team !== "object") return null;
    return team.id ?? team.teamId ?? null;
  };

  return {
    id,
    startTimestamp,
    homeTeamName: resolveTeamName(homeTeam),
    awayTeamName: resolveTeamName(awayTeam),
    homeTeamId: resolveTeamId(homeTeam),
    awayTeamId: resolveTeamId(awayTeam),
  };
};

const resolveStartTimestamp = (event, normalizedEvent) => {
  const candidates = [
    normalizedEvent?.startTimestamp,
    event?.startTimestamp,
    event?.timestamp,
    event?.start_time,
    event?.startTime,
  ]
    .map((value) => toNumber(value))
    .filter((value) => value !== null);

  if (candidates.length > 0) {
    return candidates[0];
  }

  return Math.floor(Date.now() / 1000);
};

const ymdUTC = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDaysUTC = (date, days) => {
  const copy = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};

const parseYmdStrict = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value
    .split("-")
    .map((segment) => parseInt(segment, 10));
  const dt = new Date(Date.UTC(year, month - 1, day));
  return ymdUTC(dt) === value ? dt : null;
};

const readLastRunInfo = async () => {
  try {
    if (!existsSync(lastRunFile)) {
      return { lastRunDate: null, history: [] };
    }

    const raw = await fs.readFile(lastRunFile, "utf-8");
    const data = JSON.parse(raw);

    const lastRunDate = parseYmdStrict(data?.lastRun) || null;
    const history = Array.isArray(data?.history)
      ? data.history
          .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const runDate =
              typeof entry.runDate === "string"
                ? entry.runDate
                : data?.lastRun ?? null;
            const runAt = typeof entry.runAt === "string" ? entry.runAt : null;
            const processedDates = Array.isArray(entry.processedDates)
              ? entry.processedDates.filter(
                  (value) => typeof value === "string"
                )
              : undefined;
            if (!runDate && !runAt) return null;
            return {
              ...(runDate ? { runDate } : {}),
              ...(runAt ? { runAt } : {}),
              ...(processedDates && processedDates.length
                ? { processedDates }
                : {}),
            };
          })
          .filter(Boolean)
      : [];

    return { lastRunDate, history };
  } catch {
    return { lastRunDate: null, history: [] };
  }
};

const writeLastRunInfo = async ({
  runDate,
  processedDates,
  previousHistory = [],
}) => {
  const sanitizedProcessedDates = Array.isArray(processedDates)
    ? processedDates.filter((value) => typeof value === "string")
    : [];

  const entry = {
    runDate,
    runAt: new Date().toISOString(),
    ...(sanitizedProcessedDates.length
      ? { processedDates: sanitizedProcessedDates }
      : {}),
  };

  const nextHistory = [...previousHistory, entry];
  const trimmedHistory = nextHistory.slice(-MAX_LAST_RUN_HISTORY);

  const payload = {
    lastRun: runDate,
    history: trimmedHistory,
  };

  await fs.writeFile(lastRunFile, JSON.stringify(payload, null, 2), "utf-8");
};

const deepEqual = (a, b) => {
  if (a === b) return true;
  if (typeof a === "undefined" || typeof b === "undefined") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

const getUpdatedFields = (existingMatch = {}, newMatch = {}) =>
  ["matchDetails", ...EXTRA_MATCH_FIELDS].filter((field) => {
    if (!(field in newMatch)) {
      return false;
    }

    if (typeof newMatch[field] === "undefined") {
      return false;
    }

    const existingValue = existingMatch[field];
    if (typeof existingValue === "undefined") {
      return true;
    }

    return !deepEqual(existingValue, newMatch[field]);
  });

const shouldUpdateExistingMatch = (existingMatch, newMatch) =>
  getUpdatedFields(existingMatch, newMatch).length > 0;

const valueIsMissing = (value) =>
  typeof value === "undefined" || value === null;

const matchDetailsIsMissing = (details) =>
  valueIsMissing(details) || Array.isArray(details);

const formatMatchDetails = (stats) => {
  if (typeof stats === "undefined") return undefined;
  if (stats === null) return null;
  if (stats && typeof stats === "object" && "statistics" in stats) return stats;
  return { statistics: stats };
};

const normalizeMatchRecord = (match) => {
  if (!match || typeof match !== "object") return match;

  const normalized = { ...match };

  if ("matchDetails" in normalized) {
    const formatted = formatMatchDetails(normalized.matchDetails);
    if (typeof formatted === "undefined") {
      delete normalized.matchDetails;
    } else {
      normalized.matchDetails = formatted;
    }
  }

  return normalized;
};

const matchNeedsEnrichment = (match) => {
  if (WANT_MATCHES) {
    const details = match?.matchDetails;
    if (matchDetailsIsMissing(details)) {
      return true;
    }
  }

  return EXTRA_MATCH_FIELDS.some((field) => valueIsMissing(match?.[field]));
};

const buildFetchPlan = (existingRecords = []) => {
  const records = Array.isArray(existingRecords)
    ? existingRecords.filter(Boolean)
    : [existingRecords].filter(Boolean);

  const hasField = (resolver) =>
    records.some((record) => !valueIsMissing(resolver(record)));

  const hasMatchDetails = hasField((record) => {
    const details = record?.matchDetails;
    return matchDetailsIsMissing(details) ? undefined : details;
  });
  const hasIncidents = hasField((record) => record?.incidents);
  const hasShotmap = hasField((record) => record?.shotmap);
  const hasOdds = hasField((record) => record?.odds);

  return {
    matches: WANT_MATCHES && !hasMatchDetails,
    incidents: WANT_INCIDENTS && !hasIncidents,
    shotmap: WANT_SHOTMAP && !hasShotmap,
    odds: WANT_ODDS && !hasOdds,
  };
};

// ---------- Browser-wrapper -----------------------------------
async function browserFetch(page, endpoint) {
  const url = `https://api.sofascore.com/api/v1/${endpoint}`;
  const result = await page.evaluate(async (u) => {
    try {
      const response = await fetch(u);
      if (!response.ok) {
        return { ok: false, status: response.status };
      }
      const data = await response.json();
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }, url);

  if (result?.ok) {
    recordApiCallOutcome("sofascore", true);
    return result.data;
  }

  recordApiCallOutcome("sofascore", false);
  return null;
}

// ---------- API-funktioner ------------------------------------
// (den tidigare versionen av fetchMatchIdsSofascore är bortkommenterad)

// Byt ut tidigare fetchMatchIdsSofascore(...) mot denna:
async function fetchMatchIdsSofascore(page, team, ligaFilter, ligaSlug, context) {
  const norm = (s) => (s || "").toLowerCase().replace(/\s|-/g, "");
  const wantName = norm(ligaFilter);
  const wantSlug = norm(ligaSlug);

  const allaMatcher = [];
  const besöktaIds = new Set();

  // ----- 1) RapidAPI: sport-api-real-time (först) -----
  async function fetchRapid_SportApiRealTime(teamId, pageIndex) {
    if (!context || !Array.isArray(context.rapidApiKeys) || !context.rapidApiKeys.length) return { ok: false };
    const url = "https://sport-api-real-time.p.rapidapi.com/teams/last-matches";
    const params = new URLSearchParams({ teamId: String(teamId), page: String(pageIndex) }).toString();

    // rotera nycklar
    for (let i = 0; i < context.rapidApiKeys.length; i++) {
      const key = context.rapidApiKeys[(context.rapidApiState.index + i) % context.rapidApiKeys.length];
      try {
        const res = await fetch(`${url}?${params}`, {
          method: "GET",
          headers: {
            "x-rapidapi-key": key,
            "x-rapidapi-host": "sport-api-real-time.p.rapidapi.com",
          },
        });
        if (!res.ok) {
          recordApiCallOutcome("rapid", false);
          continue;
        }
        const data = await res.json();
        recordApiCallOutcome("rapid", true);
        context.rapidApiState.index = (context.rapidApiState.index + 1) % context.rapidApiKeys.length;
        context.rapidApiState.calls = (context.rapidApiState.calls || 0) + 1;
        return { ok: true, data, apiKey: key };
      } catch {
        recordApiCallOutcome("rapid", false);
        continue;
      }
    }
    return { ok: false };
  }

  // ----- 2) RapidAPI: sofascore.p.rapidapi.com (andra) -----
  async function fetchRapid_Sofascore(teamId, pageIndex) {
    if (!context || !Array.isArray(context.rapidApiKeys) || !context.rapidApiKeys.length) return { ok: false };
    const url = "https://sofascore.p.rapidapi.com/teams/get-last-matches";
    const params = new URLSearchParams({ teamId: String(teamId), pageIndex: String(pageIndex) }).toString();

    for (let i = 0; i < context.rapidApiKeys.length; i++) {
      const key = context.rapidApiKeys[(context.rapidApiState.index + i) % context.rapidApiKeys.length];
      try {
        const res = await fetch(`${url}?${params}`, {
          method: "GET",
          headers: {
            "x-rapidapi-key": key,
            "x-rapidapi-host": "sofascore.p.rapidapi.com",
          },
        });
        if (!res.ok) {
          recordApiCallOutcome("rapid", false);
          continue;
        }
        const data = await res.json();
        recordApiCallOutcome("rapid", true);
        context.rapidApiState.index = (context.rapidApiState.index + 1) % context.rapidApiKeys.length;
        context.rapidApiState.calls = (context.rapidApiState.calls || 0) + 1;
        return { ok: true, data, apiKey: key };
      } catch {
        recordApiCallOutcome("rapid", false);
        continue;
      }
    }
    return { ok: false };
  }

  // Hjälp: plocka ut events-array ur olika payloads på ett robust sätt
  function extractEvents(payload) {
    if (!payload || typeof payload !== "object") return [];
    const candidates = [
      payload.events,
      payload.data?.events,
      payload.data?.matches,
      payload.matches,
      payload.data,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c;
    }
    return [];
  }

  // Liga/lag-filter (samma som innan)
  function passLeagueFilter(e) {
    const tour = e?.tournament || {};
    const nameCandidates = [tour.name, tour.uniqueTournament?.name];
    const slugCandidates = [tour.slug, tour.uniqueTournament?.slug];
    const nameOk = nameCandidates.some((n) => norm(n) === wantName);
    const slugOk = slugCandidates.some((s) => norm(s) === wantSlug);
    return nameOk || slugOk;
  }
  function isFinished(e) {
    const cand = [
      e?.status?.type,
      e?.status?.description,
      e?.status?.code,
      e?.status,
    ].map((v) => (typeof v === "string" ? v.toLowerCase() : undefined)).filter(Boolean);
    if (!cand.length) return true;
    return cand.some((v) => ["finished", "after", "full", "ended", "ft"].some((t) => v.includes(t)));
  }

  // ---- Först: RapidAPI (sport-api-real-time → sofascore.rapidapi) med pagination ----
  let pageIndex = 0;
  let rapidFoundAny = false;
  for (;; pageIndex++) {
    let r = await fetchRapid_SportApiRealTime(team.id, pageIndex);
    apiCalls++;
    let events = extractEvents(r.data);

    if (!(events && events.length)) {
      r = await fetchRapid_Sofascore(team.id, pageIndex);
      apiCalls++;
      events = extractEvents(r.data);
    }

    if (!events.length) break;

    rapidFoundAny = true;

    for (const e of events) {
      if (!isFinished(e) || !e.startTimestamp) continue;
      if (!passLeagueFilter(e)) continue;
      const id = e.id ?? e.eventId ?? e.matchId ?? e.event?.id;
      if (!id) continue;
      if (besöktaIds.has(id)) continue;
      besöktaIds.add(id);
      allaMatcher.push({ id, ts: e.startTimestamp });
    }
  }

  if (rapidFoundAny && allaMatcher.length) {
    return allaMatcher.sort((a, b) => b.ts - a.ts);
  }

  // ---- Fallback: SofaScore-browser ----
  for (let sida = 0; ; sida++) {
    const data = await browserFetch(page, `team/${team.id}/events/last/${sida}`);
    apiCalls++;
    const events = data?.events || [];
    if (!events.length) break;

    for (const e of events) {
      if (e.status?.type !== "finished" || !e.startTimestamp) continue;
      if (!passLeagueFilter(e)) continue;
      if (besöktaIds.has(e.id)) continue;
      besöktaIds.add(e.id);
      allaMatcher.push({ id: e.id, ts: e.startTimestamp });
    }
  }

  return allaMatcher.sort((a, b) => b.ts - a.ts);
}

// Selektiv hämtning av matchdata enligt flaggor
async function fetchMatchDataSofascore(page, matchId, context, plan = {}) {
  let info = null;
  let stats = null;
  let statsSource = null;
  let statsApiKey = null;
  let incidents = undefined;
  let incidentsSource = null;
  let incidentsApiKey = null;
  let shotmap = undefined;
  let shotmapSource = null;
  let shotmapApiKey = null;

  const wantMatches = plan.matches ?? WANT_MATCHES;
  const wantIncidents = plan.incidents ?? WANT_INCIDENTS;
  const wantShotmap = plan.shotmap ?? WANT_SHOTMAP;

  if (!wantMatches && !wantIncidents && !wantShotmap) {
    return null;
  }

  if (wantMatches) {
    info = await browserFetch(page, `event/${matchId}`);
    apiCalls++;

    if (context) {
      const statsResult = await fetchMatchStatistics(matchId, context);
      apiCalls += statsResult?.calls || 0;
      stats = statsResult?.statistics ?? null;
      if (statsResult?.source) statsSource = statsResult.source;
      if (typeof statsResult?.apiKey !== "undefined")
        statsApiKey = statsResult.apiKey ?? null;
    }

    if (!stats) {
      const sofaStats = await browserFetch(page, `event/${matchId}/statistics`);
      apiCalls++;
      stats = sofaStats ?? null;
      if (!statsSource) statsSource = "sofascore-browser";
    }
  }

  if (wantIncidents) {
    if (context) {
      const incidentsResult = await fetchMatchIncidents(matchId, context);
      apiCalls += incidentsResult?.calls || 0;
      incidents = incidentsResult?.incidents ?? null;
      if (incidentsResult?.source) incidentsSource = incidentsResult.source;
      if (typeof incidentsResult?.apiKey !== "undefined")
        incidentsApiKey = incidentsResult.apiKey ?? null;
    } else {
      incidents = await browserFetch(page, `event/${matchId}/incidents`);
      apiCalls++;
      incidentsSource = "sofascore-browser";
    }
  }

  if (wantShotmap) {
    if (context) {
      const shotmapResult = await fetchMatchShotmap(matchId, context);
      apiCalls += shotmapResult?.calls || 0;
      shotmap = shotmapResult?.shotmap ?? null;
      if (shotmapResult?.source) shotmapSource = shotmapResult.source;
      if (typeof shotmapResult?.apiKey !== "undefined")
        shotmapApiKey = shotmapResult.apiKey ?? null;
    } else {
      shotmap = await browserFetch(page, `event/${matchId}/shotmap`);
      apiCalls++;
      shotmapSource = "sofascore-browser";
    }
  }

  if (wantMatches && !(info && stats)) {
    return null;
  }

  return {
    info: info ? info.event ?? info : null,
    stats: stats || null,
    statsSource: statsSource || null,
    statsApiKey,
    incidents: typeof incidents === "undefined" ? undefined : incidents,
    incidentsSource: incidentsSource || null,
    incidentsApiKey,
    shotmap: typeof shotmap === "undefined" ? undefined : shotmap,
    shotmapSource: shotmapSource || null,
    shotmapApiKey,
  };
}

// Hjälpare för tomt odds-svar
function isEmptyOddsPayload(payload) {
  if (!payload) return true;
  if (typeof payload === "object" && Object.keys(payload).length === 0)
    return true;
  if (Array.isArray(payload.odds) && payload.odds.length === 0) return true;
  if (Array.isArray(payload.bookmakers) && payload.bookmakers.length === 0)
    return true;
  if (Array.isArray(payload.markets) && payload.markets.length === 0)
    return true;
  return false;
}

async function fetchMatchOdds(context, matchId) {
  if (!matchId) {
    return { value: undefined, source: null, market: null };
  }

  if (!context) {
    return { value: undefined, source: null, market: null };
  }

  const oddsResult = await fetchMatchOddsRapid(matchId, context);
  apiCalls += oddsResult?.calls || 0;

  if (typeof oddsResult?.odds === "undefined") {
    return {
      value: oddsResult?.odds,
      source: oddsResult?.source || null,
      market: oddsResult?.market || null,
      apiKey: oddsResult?.apiKey || null,
    };
  }

  return {
    value: oddsResult.odds ?? null,
    source: oddsResult?.source || null,
    market: oddsResult?.market || null,
    apiKey: oddsResult?.apiKey || null,
  };
}

const formatSourceWithKey = (source, apiKey) => {
  const base = source || "okänd";
  if (!apiKey) return base;
  const keyString = String(apiKey);
  const suffix = keyString.slice(-4);
  return `${base} (RapidAPI-nyckel ...${suffix})`;
};

// ---------- Spara-funktion ------------------------------------
async function sparaMatch(teamName, matchType, nyData) {
  const baseFilename = `${teamName
    .toLowerCase()
    .replace(/\s/g, "_")}_${matchType}_match_stats.json`;

  // Skriv till tre ställen
  const paths = Array.from(
    new Set(WRITE_DIRS.map((dir) => path.join(dir, baseFilename)))
  );

  // Läs "existing" från första READ_DIR som har filen
  let existing = [];
  let firstExistingPath = null;
  for (const dir of READ_DIRS) {
    const p = path.join(dir, baseFilename);
    if (existsSync(p)) {
      try {
        existing = JSON.parse(await fs.readFile(p, "utf-8")).full || [];
        firstExistingPath = p;
        break;
      } catch {
        console.warn(`⚠️ Kunde inte läsa/parsa ${p}`);
      }
    }
  }

  const existingById = new Map(existing.map((m) => [m.matchId, m]));
  const nyaMatcher = [];
  const uppdateradeMatcher = [];

  for (const match of nyData) {
    if (!match || typeof match.matchId === "undefined") continue;

    const normalizedIncoming = normalizeMatchRecord(match);
    const befintlig = existingById.get(normalizedIncoming.matchId);
    if (!befintlig) {
      const creatingPartial =
        modeLimited &&
        !("homeTeamName" in normalizedIncoming) &&
        !("awayTeamName" in normalizedIncoming) &&
        !("matchDetails" in normalizedIncoming);
      if (creatingPartial) {
        continue;
      }

      existingById.set(normalizedIncoming.matchId, normalizedIncoming);
      nyaMatcher.push(normalizedIncoming);
      continue;
    }

    if (shouldUpdateExistingMatch(befintlig, normalizedIncoming)) {
      const updatedFields = getUpdatedFields(befintlig, normalizedIncoming);
      const sammanslagen = normalizeMatchRecord({
        ...befintlig,
        ...normalizedIncoming,
      });
      existingById.set(normalizedIncoming.matchId, sammanslagen);
      uppdateradeMatcher.push({ match: sammanslagen, updatedFields });
    }
  }

  if (!nyaMatcher.length && !uppdateradeMatcher.length) {
    console.log(
      `✅ Inga nya matcher eller uppdateringar för ${teamName} (${matchType})`
    );
    return false;
  }

  const full = Array.from(existingById.values())
    .map((match) => normalizeMatchRecord(match))
    .sort((a, b) => b.timestamp - a.timestamp);
  const payload = JSON.stringify({ full }, null, 2);

  await Promise.all(
    paths.map(async (filename) => {
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, payload, "utf-8");
      console.log(`💾 Skrev fil: ${filename}`);
    })
  );

  // 👇 markera att den här basfilen uppdaterades i denna körning
  WRITTEN_FILES.add(baseFilename);

  const loggaMatch = (emoji, prefix, match) => {
    const d = new Date(match.timestamp * 1000).toISOString().split("T")[0];
    const prefixText = prefix ? `${prefix} ` : "";
    console.log(
      `${emoji} ${teamName} (${matchType}): ${prefixText}${match.homeTeamName} vs ${match.awayTeamName} - ${d} → ${baseFilename}`
    );
  };

  nyaMatcher.forEach((m) => loggaMatch("🔄", "", m));
  uppdateradeMatcher.forEach(({ match, updatedFields }) =>
    loggaMatch("♻️", `uppdaterade ${updatedFields.join("/")}`, match)
  );

  return true;
}

// ---------- Ny hjälpfunktion för lagdata -----------------
async function getTeamDataState(teamName) {
  const base = teamName.toLowerCase().replace(/\s/g, "_");
  const candidates = [];
  for (const dir of READ_DIRS) {
    candidates.push(path.join(dir, `${base}_home_match_stats.json`));
    candidates.push(path.join(dir, `${base}_away_match_stats.json`));
  }

  let maxTimestamp = 0;
  const matchesNeedingEnrichment = new Set();
  const existingIds = new Set();

  for (const p of candidates) {
    if (!existsSync(p)) continue;

    try {
      const full = JSON.parse(await fs.readFile(p, "utf-8")).full || [];
      for (const match of full) {
        if (
          typeof match.timestamp === "number" &&
          match.timestamp > maxTimestamp
        ) {
          maxTimestamp = match.timestamp;
        }
        if (match && typeof match.matchId !== "undefined") {
          existingIds.add(match.matchId);
          if (matchNeedsEnrichment(match)) {
            matchesNeedingEnrichment.add(match.matchId);
          }
        }
      }
    } catch {
      console.warn(`⚠️ Kunde inte läsa/parsa ${p}`);
    }
  }

  return { maxTimestamp, matchesNeedingEnrichment, existingIds };
}

// Hitta befintlig matchpost för ett lag (för att kunna uppdatera odds utan att slå mot SofaScore)
async function getExistingMatchRecord(teamName, matchId) {
  const base = teamName.toLowerCase().replace(/\s/g, "_");
  const candidates = [];
  for (const dir of READ_DIRS) {
    candidates.push(path.join(dir, `${base}_home_match_stats.json`));
    candidates.push(path.join(dir, `${base}_away_match_stats.json`));
  }

  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const full = JSON.parse(await fs.readFile(p, "utf-8")).full || [];
      const found = full.find((m) => m.matchId === matchId);
      if (found) {
        const type = p.includes("_home_") ? "home" : "away";
        return { record: found, matchType: type };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

async function runYesterdayMode(lookups, leagues) {
  if (!WANT_MATCHES) {
    console.error(
      "❌ Flaggan --yesterday kräver att matchdata (matches) hämtas. Lägg till --matches eller ta bort selektiva flaggor."
    );
    return;
  }

  const categoryMap = new Map();
if (leagues && typeof leagues === "object") {
    for (const [leagueName, info] of Object.entries(leagues)) {
      const categoryId = toNumber(info?.categoryId);
      if (categoryId === null) continue;

      if (!categoryMap.has(categoryId)) {
        categoryMap.set(categoryId, new Set());
      }
      categoryMap.get(categoryId).add(leagueName);
    }
  }

  const categoryEntries = Array.from(categoryMap.entries()).sort(
    (a, b) => a[0] - b[0]
  );

  const { lastRunDate, history } = await readLastRunInfo();

  const todayUTC = new Date();
  const startOfTodayUTC = new Date(
    Date.UTC(
      todayUTC.getUTCFullYear(),
      todayUTC.getUTCMonth(),
      todayUTC.getUTCDate()
    )
  );
  const runDateStr = ymdUTC(startOfTodayUTC);
  const yesterdayDate = addDaysUTC(startOfTodayUTC, -1);

  if (lastRunDate && lastRunDate >= startOfTodayUTC) {
    console.log("✅ Inget att göra. Senaste körningen var redan idag.");
    await writeLastRunInfo({
      runDate: runDateStr,
      processedDates: [],
      previousHistory: history,
    });
    return;
  }

  const startDate = lastRunDate ? lastRunDate : yesterdayDate;
  const endDate = yesterdayDate;

  if (startDate > endDate) {
    console.log("✅ Inget att göra. Senaste körningen var redan igår.");
    await writeLastRunInfo({
      runDate: runDateStr,
      processedDates: [],
      previousHistory: history,
    });
    return;
  }

  const datesToProcess = [];
  for (let dt = new Date(startDate); dt <= endDate; dt = addDaysUTC(dt, 1)) {
    datesToProcess.push(ymdUTC(dt));
  }

  if (!datesToProcess.length) {
    console.log("✅ Inget att göra.");
    await writeLastRunInfo({
      runDate: runDateStr,
      processedDates: [],
      previousHistory: history,
    });
    return;
  }

  console.log(`📅 Dagar att bearbeta: ${datesToProcess.join(", ")}`);

  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--no-zygote","--no-first-run"] });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
  );

  const context = {
    rapidApiKeys,
    rapidApiState,
    page,
    apiCallStats,
    logger: console,
  };

  const processedDates = [];
  let runCompleted = false;

  try {
    await page.goto("https://www.sofascore.com/", {
      waitUntil: "domcontentloaded",
    });
    await sleep(750);

    const categoryPlan =
      categoryEntries.length > 0 ? categoryEntries : [[1, null]];

    for (const dateStr of datesToProcess) {
      console.log(`\ℹ️ Hämtar matcher för ${dateStr} (yesterday-läge).`);

      const targetDate = parseYmdStrict(dateStr);
      if (!targetDate) {
        console.warn(`⚠️ Ogiltigt datum '${dateStr}' – hoppar.`);
        continue;
      }

      const dayStartTimestamp = Math.floor(targetDate.getTime() / 1000);
      const dayEndTimestamp = Math.floor(
        addDaysUTC(targetDate, 1).getTime() / 1000
      );

      const aggregatedMatches = [];
      const aggregatedSources = new Map();
      const seenMatchIds = new Set();
      let scheduledCalls = 0;

      for (const [categoryId, leagueSet] of categoryPlan) {
        const leagueList =
          leagueSet && leagueSet.size
            ? Array.from(leagueSet).join(", ")
            : "alla ligor (standard)";
        console.log(
          `ℹ️ Hämtar matcher för categoryId ${categoryId} (ligor: ${leagueList}).`
        );

        const scheduled = await fetchScheduledMatches(dateStr, context, {
          categoryId,
          includeGlobalEndpoint: categoryEntries.length === 0,
        });
        scheduledCalls += scheduled?.calls || 0;

        const categoryMatches = Array.isArray(scheduled?.matches)
          ? scheduled.matches
          : [];
        const categorySource = scheduled?.source || "okänd";
        const categorySourceText = formatSourceWithKey(
          categorySource,
          scheduled?.apiKey || null
        );

        console.log(
          `✅  categoryId ${categoryId}: ${categoryMatches.length} matcher (källa: ${categorySourceText}).`
        );

        aggregatedSources.set(categoryId, {
          source: categorySource,
          apiKey: scheduled?.apiKey || null,
        });

        for (const match of categoryMatches) {
          const keyCandidate = [
            match?.id,
            match?.eventId,
            match?.matchId,
            match?.event?.id,
          ].find(
            (value) =>
              value !== null &&
              typeof value !== "undefined" &&
              (typeof value === "number" || typeof value === "string")
          );

          const key =
            keyCandidate !== undefined && keyCandidate !== null
              ? String(keyCandidate)
              : null;
          if (key && seenMatchIds.has(key)) continue;
          if (key) seenMatchIds.add(key);
          aggregatedMatches.push(match);
        }
      }

      apiCalls += scheduledCalls;

      const sourceLabel = aggregatedSources.size
        ? Array.from(aggregatedSources.entries())
            .map(
              ([catId, info]) =>
                `category ${catId}: ${formatSourceWithKey(
                  info.source,
                  info.apiKey
                )}`
            )
            .join(", ")
        : "okänd";

      console.log(
        `✅  Hämtade totalt ${aggregatedMatches.length} matcher (källor: ${sourceLabel}).`
      );

      const matches = aggregatedMatches;

      const filtered = [];

      const statusLooksFinished = (event) => {
        const candidates = [
          event?.status?.type,
          event?.status?.description,
          event?.status?.code,
          event?.status,
        ]
          .map((value) =>
            typeof value === "string" ? value.toLowerCase() : undefined
          )
          .filter(Boolean);

        if (!candidates.length) return true;
        return candidates.some((value) =>
          ["finished", "after", "full", "ended", "ft"].some((token) =>
            value.includes(token)
          )
        );
      };

      for (const match of matches) {
        if (!eventMatchesLookups(match, lookups)) {
          const leagueInfo = describeEventLeague(match);
          const leagueTag = leagueInfo.id
            ? `${leagueInfo.name} #${leagueInfo.id}`
            : leagueInfo.name;
          continue;
        }

        const normalized = normalizeEvent(match);
        if (!normalized?.id) continue;

        const timestamp = resolveStartTimestamp(match, normalized);
        if (timestamp < dayStartTimestamp || timestamp >= dayEndTimestamp) {
          continue;
        }

        if (!statusLooksFinished(match)) {
          continue;
        }

        filtered.push({
          rawEvent: match,
          normalizedEvent: normalized,
          timestamp,
        });
      }

      if (!filtered.length) {
        console.log(
          `✅ Inga matcher att bearbeta för ${dateStr} efter filtrering.`
        );
        processedDates.push(dateStr);
        await sleep(300);
        continue;
      }

      console.log(
        `🎯 ${filtered.length} matcher återstår efter filter. Bearbetar …`
      );

      for (const { rawEvent, normalizedEvent, timestamp } of filtered) {
        const matchId = normalizedEvent.id;
        const leagueInfo = describeEventLeague(rawEvent);
        console.log(
          `\n⚽ Match ${matchId}: ${normalizedEvent.homeTeamName || "?"} vs ${
            normalizedEvent.awayTeamName || "?"
          } (${leagueInfo.name}${leagueInfo.id ? ` #${leagueInfo.id}` : ""})`
        );

        const existingHome = normalizedEvent.homeTeamName
          ? await getExistingMatchRecord(normalizedEvent.homeTeamName, matchId)
          : null;
        const existingAway = normalizedEvent.awayTeamName
          ? await getExistingMatchRecord(normalizedEvent.awayTeamName, matchId)
          : null;

        const plan = buildFetchPlan([
          existingHome?.record,
          existingAway?.record,
        ]);

        if (!plan.matches && !plan.incidents && !plan.shotmap && !plan.odds) {
          console.log(
            `✅ Match ${matchId} har redan alla efterfrågade delar. Hoppar.`
          );
          await sleep(300);
          continue;
        }

        const fetched =
          plan.matches || plan.incidents || plan.shotmap
            ? await fetchMatchDataSofascore(page, matchId, context, plan)
            : null;
        if (plan.matches && !(fetched?.info && fetched?.stats)) {
          console.warn(
            `⏭️ Kunde inte hämta basdata för match ${matchId}, hoppar.`
          );
          await sleep(300);
          continue;
        }

        const {
          value: odds,
          source: oddsSource,
          market: oddsMarket,
          apiKey: oddsApiKey,
        } = plan.odds
          ? await fetchMatchOdds(context, matchId)
          : { value: undefined, source: null, market: null, apiKey: null };

        const eventInfo = fetched?.info;
        const home = eventInfo?.homeTeam;
        const away = eventInfo?.awayTeam;

        if (plan.matches && (!home?.name || !away?.name)) {
          console.warn(
            `⏭️ Saknar laginformation för match ${matchId}, hoppar.`
          );
          await sleep(300);
          continue;
        }

        const record = {
          matchId,
          timestamp,
        };

        if (plan.matches && home?.name && away?.name) {
          Object.assign(record, {
            date: ymdUTC(new Date(timestamp * 1000)),
            savedAt: new Date().toISOString(),
            homeTeamId: home.id,
            homeTeamName: home.name,
            awayTeamId: away.id,
            awayTeamName: away.name,
            matchDetails: formatMatchDetails(fetched.stats),
          });
        }

        if (typeof fetched?.incidents !== "undefined") {
          record.incidents = fetched.incidents;
        }
        if (typeof fetched?.shotmap !== "undefined") {
          record.shotmap = fetched.shotmap;
        }
        if (typeof odds !== "undefined") {
          record.odds = odds ?? null;
        }

        const homeTeamName =
          record.homeTeamName ??
          existingHome?.record?.homeTeamName ??
          existingAway?.record?.homeTeamName;
        const awayTeamName =
          record.awayTeamName ??
          existingAway?.record?.awayTeamName ??
          existingHome?.record?.awayTeamName;

        const savedHome = homeTeamName
          ? await sparaMatch(homeTeamName, "home", [record])
          : false;
        const savedAway = awayTeamName
          ? await sparaMatch(awayTeamName, "away", [record])
          : false;

        if (savedHome || savedAway) {
          if (plan.matches && fetched?.stats) {
            const statsSourceText = formatSourceWithKey(
              fetched?.statsSource,
              fetched?.statsApiKey
            );
            console.log(`✅ Statistik sparad via ${statsSourceText}.`);
          }

          if (plan.incidents && typeof fetched?.incidents !== "undefined") {
            const incidentsSourceText = formatSourceWithKey(
              fetched?.incidentsSource,
              fetched?.incidentsApiKey
            );
            console.log(`✅ Incidents sparade via ${incidentsSourceText}.`);
          }

          if (plan.shotmap && typeof fetched?.shotmap !== "undefined") {
            const shotmapSourceText = formatSourceWithKey(
              fetched?.shotmapSource,
              fetched?.shotmapApiKey
            );
            console.log(`✅ Shotmap sparad via ${shotmapSourceText}.`);
          }

          if (typeof odds !== "undefined") {
            const oddsMarketText = oddsMarket ? ` (market ${oddsMarket})` : "";
            const oddsSourceText = formatSourceWithKey(oddsSource, oddsApiKey);
            console.log(
              `✅ Odds sparade via ${oddsSourceText}${oddsMarketText}.`
            );
          }
        }

        await sleep(400);
      }
      processedDates.push(dateStr);
    }
    runCompleted = true;
  } finally {
    await browser.close();
  }

  if (runCompleted) {
    await writeLastRunInfo({
      runDate: runDateStr,
      processedDates,
      previousHistory: history,
    });

    console.log(
      `\ℹ️  Yesterday-läget klart! Totala API-anrop: ${apiCalls} (RapidAPI: ${
        rapidApiState.calls || 0
      })`
    );
    logApiCallSummary();
    console.log(
      `⏳ Last-run uppdaterad (${runDateStr}) med ${processedDates.length} dag(ar).`
    );
  }
}

// ---------- DB-SYNC EFTER KÖRNING ------------------------------

function roleFromFilename(name) {
  const n = name.toLowerCase();
  if (n.endsWith("_home_match_stats.json")) return "home";
  if (n.endsWith("_away_match_stats.json")) return "away";
  return null;
}

function pickTeamMetaFromFull(full, role) {
  if (!Array.isArray(full) || full.length === 0) return { teamId: null, teamName: null };
  const m = full[0] || {};
  if (role === "home") {
    return { teamId: m.homeTeamId ?? null, teamName: m.homeTeamName ?? null };
  }
  if (role === "away") {
    return { teamId: m.awayTeamId ?? null, teamName: m.awayTeamName ?? null };
  }
  return { teamId: null, teamName: null };
}

async function ensureIndexes(col) {
  const tryCreate = async (key, name, opts = {}) => {
    try {
      await col.createIndex(key, { name, background: true, ...opts });
    } catch (e) {
      // ignorera index-konflikter tyst
    }
  };
  await tryCreate({ "_importMeta.sourceFile": 1 }, "idx_sourceFile");
  await tryCreate({ "_importMeta.teamName": 1 }, "idx_teamName");
  await tryCreate({ "_importMeta.teamRole": 1 }, "idx_teamRole");
  await tryCreate({ "full.matchId": 1 }, "idx_full_matchId", { sparse: true });
  await tryCreate({ "_importMeta.importedAt": -1 }, "idx_importedAt");
}

async function readFullFromAnyDir(basename) {
  for (const dir of READ_DIRS) {
    const p = path.join(dir, basename);
    if (existsSync(p)) {
      try {
        const json = JSON.parse(await fs.readFile(p, "utf-8"));
        return Array.isArray(json.full) ? json.full : [];
      } catch {
        // testa nästa dir
      }
    }
  }
  return [];
}

async function syncTeamstatsToDbForFiles(fileNames) {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "app";
  if (!uri) {
    console.error("❌ MONGODB_URI saknas i .env.local");
    return;
  }

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db(dbName).collection("teamstats");

  let upserts = 0, updates = 0, failures = 0;

  for (const fname of fileNames) {
    const role = roleFromFilename(fname);
    if (!role) {
      console.warn(`⏭️ Hoppar (okänt filnamnsmönster): ${fname}`);
      continue;
    }

    try {
      const full = await readFullFromAnyDir(fname);
      const meta = pickTeamMetaFromFull(full, role);
      const now = new Date().toISOString();

      const doc = {
        full,
        _importMeta: {
          sourceFile: fname,
          teamRole: role,
          teamId: meta.teamId,
          teamName: meta.teamName,
          importedAt: now,
          createdAt: now,
        },
      };

      // säker skrivning utan unik-index: ta bort tidigare dubbletter → lägg in nytt dokument
      const delRes = await col.deleteMany({ "_importMeta.sourceFile": fname });
      const insRes = await col.insertOne(doc);
      if (delRes.deletedCount > 0) {
        updates++;
        console.log(`♻️  Överskrev '${fname}' (tog bort ${delRes.deletedCount} dubblett(er)).`);
      } else {
        upserts++;
        console.log(`🆕  La in '${fname}'.`);
      }
    } catch (e) {
      failures++;
      console.warn(`❌ Misslyckades importera '${fname}': ${e.message}`);
    }
  }

  await ensureIndexes(col);
  await client.close(true);
  console.log(`🗃  DB-sync klar. 🆕 ${upserts}  ♻️ ${updates}  ❌ ${failures}`);
}

// ---------- Huvudprogram --------------------------------------
async function main() {
  const leagues = JSON.parse(
    await fs.readFile(
      path.join(__dirname, "..", "data", "leagues-and-teams.json"),
      "utf-8"
    )
  );

  const lookups = buildLeagueTeamLookups(leagues);

  if (wantYesterdayMode && positionalArgs.length === 0) {
    await runYesterdayMode(lookups, leagues);
  } else {
    if (!ligaNamnInput) {
      console.error("❌ Ange ett liganamn!");
      process.exit(1);
    }

    const teamArg = positionalArgs[1];
    const teamNameInput =
      teamArg && isNaN(parseInt(teamArg)) ? teamArg.toLowerCase() : null;
    const antalMatcherInput = teamNameInput
      ? positionalArgs[2]
      : positionalArgs[1];
    const antalMatcher = isNaN(parseInt(antalMatcherInput))
      ? antalMatcherCLI
      : +antalMatcherInput;

    const effectiveBackfill = singleFlagBackfillMode
      ? Math.max(backfill, antalMatcher)
      : backfill;

    const ligorAttKöra =
      ligaNamnInput.toLowerCase() === "all"
        ? Object.entries(leagues)
        : Object.entries(leagues).filter(
            ([n]) => n.toLowerCase() === ligaNamnInput.toLowerCase()
          );

    if (!ligorAttKöra.length) {
      console.error(`❌ Ligan '${ligaNamnInput}' hittades ej!`);
      process.exit(1);
    }

    console.log(`\n✅ Valda ligor: ${ligorAttKöra.map(([n]) => n).join(", ")}`);
    if (teamNameInput) console.log(`✅ Endast lag: ${teamNameInput}`);
    console.log(`✅ Matcher per lag: ${antalMatcher}`);
    if (modeLimited) {
      console.log(
        `✅ Selektiv hämtning: ${[
          WANT_MATCHES && "matches",
          WANT_INCIDENTS && "incidents",
          WANT_SHOTMAP && "shotmap",
          WANT_ODDS && "odds",
        ]
          .filter(Boolean)
          .join(", ")}`
      );
      if (singleFlagBackfillMode) {
        console.log(
          `✅ Enskild extraflagga upptäckt – backfill tvingas till minst ${effectiveBackfill}`
        );
      }
    } else {
      console.log("✅ Hämtar alla delar (matches + incidents + shotmap + odds)");
    }
    console.log("⏳ Startar om 10 s … (Ctrl+C för att avbryta)");
    await sleep(10_000);

    const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--no-zygote","--no-first-run"] });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
    );

    const context = {
      rapidApiKeys,
      rapidApiState,
      page,
      apiCallStats,
      logger: console,
    };

    for (const [ligaNamn, ligaData] of ligorAttKöra) {
      const ligaSlug = ligaData.slug;
      console.log(`\n➡️ Liga: ${ligaNamn}`);

      const teamsToRun = teamNameInput
        ? ligaData.teams.filter((t) => t.name.toLowerCase() === teamNameInput)
        : ligaData.teams;

      if (!teamsToRun.length) {
        console.error(`❌ Laget '${teamNameInput}' hittades ej i ${ligaNamn}`);
        continue;
      }

      for (const team of teamsToRun) {
        console.log(`\n⚽ Hämtar för ${team.name}…`);

        const {
          maxTimestamp: teamMaxTs,
          matchesNeedingEnrichment,
          existingIds,
        } = await getTeamDataState(team.name);
        const matchIds = await fetchMatchIdsSofascore(
          page,
          team,
          ligaNamn,
          ligaSlug,
          context
        );

        let backfilledOlder = 0;

        for (const { id, ts } of matchIds.slice(0, antalMatcher)) {
          const needsEnrichment = matchesNeedingEnrichment.has(id);
          const forceUpdateBecauseSelective = modeLimited;
          if (
            ts <= teamMaxTs &&
            !needsEnrichment &&
            !forceUpdateBecauseSelective
          ) {
            if (effectiveBackfill > 0 && backfilledOlder < effectiveBackfill) {
              console.log(
                `⏬ Backfillar äldre match för ${team.name}: ${id} (ts ${ts})`
              );
              backfilledOlder++;
            } else {
              console.log(
                `⏭️ Hoppar: ${team.name} match ${id} (ts ${ts}) ≤ sparat max ${teamMaxTs}`
              );
              continue;
            }
          } else if (needsEnrichment || forceUpdateBecauseSelective) {
            console.log(`♻️ Uppdaterar selektivt för ${team.name}: ${id}`);
          }

          const existingRecordInfo = await getExistingMatchRecord(team.name, id);
          const existingMatch = existingRecordInfo?.record;
          const plan = buildFetchPlan(existingMatch);

          if (!plan.matches && !plan.incidents && !plan.shotmap && !plan.odds) {
            console.log(
              `✅ ${team.name} match ${id} har redan alla efterfrågade delar.`
            );
            continue;
          }

          if (plan.odds && !plan.matches && !plan.incidents && !plan.shotmap) {
            const {
              value: odds,
              source: oddsSource,
              market: oddsMarket,
              apiKey: oddsApiKey,
            } = await fetchMatchOdds(context, id);

            if (!existingRecordInfo) {
              console.log(
                `⏭️ Hoppar odds (ingen befintlig post) för ${team.name}, match ${id}`
              );
              continue;
            }

            const partial = {
              matchId: id,
              timestamp: ts,
              ...(typeof odds !== "undefined" ? { odds: odds ?? null } : {}),
            };

            const savedTeam = await sparaMatch(
              team.name,
              existingRecordInfo.matchType,
              [partial]
            );

            const oppName =
              existingMatch?.homeTeamId === team.id
                ? existingMatch?.awayTeamName
                : existingMatch?.homeTeamName;
            const oppType =
              existingMatch?.homeTeamId === team.id ? "home" : "away";

            let savedOpp = false;
            if (oppName && oppType) {
              savedOpp = await sparaMatch(oppName, oppType, [partial]);
            }

            if ((savedTeam || savedOpp) && typeof odds !== "undefined") {
              const oddsMarketText = oddsMarket ? ` (market ${oddsMarket})` : "";
              const oddsSourceText = formatSourceWithKey(oddsSource, oddsApiKey);
              console.log(
                `✅ Odds sparade för match ${id} via ${oddsSourceText}${oddsMarketText}`
              );
            }

            if (!savedTeam && !savedOpp) {
              if (effectiveBackfill > 0) {
                console.log("⏭️ Redan sparad – fortsätter (backfill aktiv)");
                continue;
              }
              console.log("⏩ Ingen uppdatering skedd – hoppar till nästa lag");
              break;
            }
            await sleep(1_000);
            continue;
          }

          const oddsPromise = plan.odds
            ? fetchMatchOdds(context, id)
            : Promise.resolve({
                value: undefined,
                source: null,
                market: null,
                apiKey: null,
              });
          const fetched =
            plan.matches || plan.incidents || plan.shotmap
              ? await fetchMatchDataSofascore(page, id, context, plan)
              : null;
          const {
            value: odds,
            source: oddsSource,
            market: oddsMarket,
            apiKey: oddsApiKey,
          } = await oddsPromise;

          if (!fetched && !plan.odds) continue;

          const data = {
            matchId: id,
            timestamp: ts,
          };

          if (fetched?.info && fetched?.stats) {
            const home = fetched.info.homeTeam;
            const away = fetched.info.awayTeam;
            Object.assign(data, {
              date: new Date(ts * 1000).toISOString().split("T")[0],
              savedAt: new Date().toISOString(),
              homeTeamId: home.id,
              homeTeamName: home.name,
              awayTeamId: away.id,
              awayTeamName: away.name,
              matchDetails: formatMatchDetails(fetched.stats),
            });
          }

          if (typeof fetched?.incidents !== "undefined") {
            data.incidents = fetched.incidents;
          }
          if (typeof fetched?.shotmap !== "undefined") {
            data.shotmap = fetched.shotmap;
          }
          if (typeof odds !== "undefined") {
            data.odds = odds ?? null;
          }

          const canSaveTeam =
            ("homeTeamName" in data && "awayTeamName" in data) ||
            existingRecordInfo;
          if (!canSaveTeam) {
            console.log(
              `⏭️ Hoppar (ingen baspost) för ${team.name}, match ${id}`
            );
            continue;
          }

          let isHome = false;
          if ("homeTeamId" in data) {
            isHome = data.homeTeamId === team.id;
          } else {
            isHome = existingRecordInfo
              ? existingRecordInfo.matchType === "home"
              : false;
          }

          const savedTeam = await sparaMatch(
            team.name,
            isHome ? "home" : "away",
            [data]
          );

          let oppName = null;
          let oppType = null;
          if ("homeTeamName" in data && "awayTeamName" in data) {
            oppName = isHome ? data.awayTeamName : data.homeTeamName;
            oppType = isHome ? "home" : "away";
          } else {
            if (existingRecordInfo) {
              oppName =
                existingMatch?.homeTeamId === team.id
                  ? existingMatch?.awayTeamName
                  : existingMatch?.homeTeamName;
              oppType = existingMatch?.homeTeamId === team.id ? "home" : "away";
            }
          }

          let savedOpp = false;
          if (oppName && oppType) {
            savedOpp = await sparaMatch(oppName, oppType, [data]);
          }

          if (savedTeam || savedOpp) {
            if (plan.matches && fetched?.stats) {
              const statsSourceText = formatSourceWithKey(
                fetched?.statsSource,
                fetched?.statsApiKey
              );
              console.log(
                `✅ Statistik sparad för match ${id} via ${statsSourceText}.`
              );
            }

            if (plan.incidents && typeof fetched?.incidents !== "undefined") {
              const incidentsSourceText = formatSourceWithKey(
                fetched?.incidentsSource,
                fetched?.incidentsApiKey
              );
              console.log(
                `✅ Incidents sparade för match ${id} via ${incidentsSourceText}.`
              );
            }

            if (plan.shotmap && typeof fetched?.shotmap !== "undefined") {
              const shotmapSourceText = formatSourceWithKey(
                fetched?.shotmapSource,
                fetched?.shotmapApiKey
              );
              console.log(
                `✅ Shotmap sparad för match ${id} via ${shotmapSourceText}.`
              );
            }

            if (typeof odds !== "undefined") {
              const oddsMarketText = oddsMarket ? ` (market ${oddsMarket})` : "";
              const oddsSourceText = formatSourceWithKey(oddsSource, oddsApiKey);
              console.log(
                `✅ Odds sparade för match ${id} via ${oddsSourceText}${oddsMarketText}`
              );
            }
          }

          if (!savedTeam && !savedOpp) {
            if (effectiveBackfill > 0) {
              console.log("⏭️ Redan sparad – fortsätter (backfill aktiv)");
              continue;
            }
            console.log(
              "⏩ Senaste matchen redan sparad – hoppar till nästa lag"
            );
            break;
          }
          await sleep(1_000);
        }
      }
    }

    await browser.close();
    console.log(`\n✅ Färdigt! Totala API-anrop: ${apiCalls}`);
    logApiCallSummary();
  }

  // 👇 EFTER ATT ALLT ÄR KLART: synka ENDAST filerna som faktiskt skrevs
  if (WRITTEN_FILES.size > 0) {
    console.log("🗄  Synkar uppdaterade teamstats-filer till databasen …");
    await syncTeamstatsToDbForFiles(Array.from(WRITTEN_FILES));
  } else {
    console.log("ℹ️  Inga filer uppdaterades under körningen – hoppar DB-sync.");
  }
}

main();
