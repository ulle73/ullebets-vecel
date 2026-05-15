import { runBacktest } from "../lib/runners/backtest-runner.js";
import { getMatchesForMultipleDates } from "../lib/engines/fixtures-engine.js";
import { clientPromise } from "../lib/db.js";
import { coerceDate, formatDateInZone } from "../lib/utils/date.js";
import { pickDueCheckpoint } from "../lib/unibet/oddsCheckpoints.js";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "unibet-backtest";
const TIME_ZONE = "Europe/Stockholm";
const DEFAULT_DAYS_AHEAD = 7;
const DEFAULT_SNAPSHOT_LIMIT = 40;

function parseArgs(argv) {
  const args = {
    daysAhead: DEFAULT_DAYS_AHEAD,
    checkpointKey: null,
    matchDate: null,
    now: null,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--days-ahead=")) {
      const value = Number(arg.split("=")[1]);
      if (Number.isFinite(value) && value >= 0) {
        args.daysAhead = Math.floor(value);
      }
      continue;
    }
    if (arg.startsWith("--checkpoint=")) {
      args.checkpointKey = arg.split("=")[1] || null;
      continue;
    }
    if (arg.startsWith("--date=")) {
      args.matchDate = arg.split("=")[1] || null;
      continue;
    }
    if (arg.startsWith("--now=")) {
      args.now = arg.split("=")[1] || null;
    }
  }

  return args;
}

async function loadTargetLeagues(db) {
  const leaguesDoc = await db.collection("leages-and-teams").findOne({});
  if (leaguesDoc) {
    return Object.keys(leaguesDoc).filter((key) => key !== "_id");
  }
  console.warn("⚠️ Could not load leagues from DB, falling back to defaults");
  return [
    "Premier League",
    "LaLiga",
    "Bundesliga",
    "Serie A",
    "Brasileirão",
    "Ligue 1",
    "A-League Men",
  ];
}

function buildDateRange({ now, daysAhead, matchDate }) {
  if (matchDate) {
    return [matchDate];
  }

  const dates = [];
  for (let offset = 0; offset <= daysAhead; offset += 1) {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    dates.push(formatDateInZone(date, TIME_ZONE));
  }
  return dates;
}

function toMatchIdCandidates(matchIds = []) {
  const candidates = new Set();
  for (const matchId of matchIds) {
    if (matchId == null) continue;
    const asString = String(matchId);
    if (!asString) continue;
    candidates.add(asString);
    if (/^\d+$/.test(asString)) {
      candidates.add(Number(asString));
    }
  }
  return [...candidates];
}

async function loadSnapshotDocsByMatchId(db, matchIds = []) {
  const candidates = toMatchIdCandidates(matchIds);
  if (!candidates.length) return new Map();

  const docs = await db
    .collection(COLLECTION)
    .find(
      { matchId: { $in: candidates } },
      {
        projection: {
          matchId: 1,
          matchDate: 1,
          snapshots: 1,
        },
      }
    )
    .toArray();

  const map = new Map();
  for (const doc of docs) {
    if (doc?.matchId == null) continue;
    map.set(String(doc.matchId), doc);
  }
  return map;
}

function normalizeFixtureMatch(match = {}) {
  const matchId = match.matchId || match.id || match.event?.id;
  const matchDate =
    match.matchDate ||
    match.timestamp ||
    match.start ||
    match.startTimestamp ||
    match.event?.start ||
    null;
  const kickoff = coerceDate(matchDate);
  if (!matchId || !kickoff) {
    return null;
  }

  return {
    ...match,
    matchId: String(matchId),
    homeTeamName: match.homeTeamName || match.homeTeam?.name || match.event?.homeName || null,
    awayTeamName: match.awayTeamName || match.awayTeam?.name || match.event?.awayName || null,
    leagueName:
      match.leagueName ||
      match.league?.name ||
      match.tournament?.name ||
      match.uniqueTournament?.name ||
      match.event?.tournament?.name ||
      null,
    matchDate: kickoff.toISOString(),
    kickoff,
  };
}

function collectDueMatches(matchesByDate, snapshotsByMatchId, now, checkpointFilter = null) {
  const dueMatches = [];

  for (const matches of Object.values(matchesByDate)) {
    for (const rawMatch of matches) {
      const match = normalizeFixtureMatch(rawMatch);
      if (!match?.homeTeamName || !match?.awayTeamName) continue;

      const existingDoc = snapshotsByMatchId.get(String(match.matchId)) || null;
      const checkpoint = pickDueCheckpoint({
        matchStart: match.kickoff,
        now,
        snapshots: existingDoc?.snapshots || [],
      });
      if (!checkpoint) continue;
      if (checkpointFilter && checkpoint.key !== checkpointFilter) continue;

      const minutesToKickoff = Math.round((match.kickoff.getTime() - now.getTime()) / 60000);
      dueMatches.push({
        ...match,
        checkpointKey: checkpoint.key,
        checkpointLabel: checkpoint.label,
        checkpointTargetDays: checkpoint.targetDays,
        checkpointSnapshotType: checkpoint.snapshotType,
        minutesToKickoff,
      });
    }
  }

  return dueMatches.sort((left, right) => left.kickoff.getTime() - right.kickoff.getTime());
}

function groupMatchesBySnapshotType(matches = []) {
  const groups = new Map();
  for (const match of matches) {
    const key = match.checkpointSnapshotType || "forward";
    const list = groups.get(key) || [];
    list.push(match);
    groups.set(key, list);
  }
  return groups;
}

async function main() {
  const args = parseArgs(process.argv);
  const now = args.now ? new Date(args.now) : new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Invalid --now timestamp");
  }

  const client = await clientPromise;
  const db = client.db(DB_NAME);
  const targetLeagues = await loadTargetLeagues(db);
  const dates = buildDateRange({
    now,
    daysAhead: args.daysAhead,
    matchDate: args.matchDate,
  });

  console.log(`\n🎯 UNIBET CHECKPOINT CAPTURE`);
  console.log(`🕒 Now: ${now.toISOString()}`);
  console.log(`📅 Scanning dates: ${dates.join(", ")}`);
  if (args.checkpointKey) {
    console.log(`🎚️ Checkpoint filter: ${args.checkpointKey}`);
  }

  const matchesByDate = await getMatchesForMultipleDates(dates, {
    leagues: targetLeagues,
  });
  const allMatches = Object.values(matchesByDate).flat();
  const matchIds = allMatches
    .map((match) => match.matchId || match.id || match.event?.id)
    .filter(Boolean)
    .map(String);

  console.log(`📥 Loaded ${allMatches.length} fixture matches across ${dates.length} dates`);

  const snapshotsByMatchId = await loadSnapshotDocsByMatchId(db, matchIds);
  const dueMatches = collectDueMatches(matchesByDate, snapshotsByMatchId, now, args.checkpointKey);

  if (!dueMatches.length) {
    console.log("ℹ️ No due checkpoint captures right now.");
    process.exit(0);
  }

  const dueSummary = dueMatches.reduce((acc, match) => {
    acc[match.checkpointKey] = (acc[match.checkpointKey] || 0) + 1;
    return acc;
  }, {});
  console.log(`✅ Due matches: ${dueMatches.length}`, dueSummary);

  const grouped = groupMatchesBySnapshotType(dueMatches);
  const runDate = formatDateInZone(now, TIME_ZONE);

  for (const [snapshotType, matches] of grouped.entries()) {
    console.log(`\n🚀 Running ${snapshotType} capture for ${matches.length} matches`);
    await runBacktest({
      type: snapshotType,
      leagues: targetLeagues,
      matches,
      runDate,
      snapshotLimit: DEFAULT_SNAPSHOT_LIMIT,
      exitOnComplete: false,
      metadataBuilder: async ({ match }) => ({
        captureMode: "checkpoint",
        checkpointKey: match.checkpointKey,
        checkpointLabel: match.checkpointLabel,
        checkpointTargetDays: match.checkpointTargetDays,
        minutesToKickoff: match.minutesToKickoff,
        capturedAt: now.toISOString(),
        targetMatchDate: formatDateInZone(match.matchDate, TIME_ZONE),
      }),
    });
  }
}

main().catch((error) => {
  console.error("❌ run-unibet-odds-checkpoints failed:", error);
  process.exit(1);
});
