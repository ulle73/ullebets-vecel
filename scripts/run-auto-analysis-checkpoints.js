import { clientPromise } from "../lib/db.js";
import { getMatchesForDateFiltered } from "../lib/engines/fixtures-engine.js";
import { coerceDate } from "../lib/utils/date.js";
import {
  buildAutoAnalysisCheckpointTargets,
  getAutoAnalysisCheckpoint,
} from "../lib/autoAnalysis/checkpoints.js";
import { executeAndPersistAutoAnalysisRun } from "../lib/autoAnalysis/executeRun.js";

const DB_NAME = process.env.MONGODB_DB || "app";

function parseArgs(argv) {
  const args = {
    checkpointKey: null,
    matchDate: null,
    now: null,
    strategyId: "balanced",
  };

  for (const arg of argv.slice(2)) {
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
      continue;
    }
    if (arg.startsWith("--strategy=")) {
      args.strategyId = arg.split("=")[1] || "balanced";
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

function sanitizeMatches(matches = []) {
  return matches
    .map((match) => ({
      ...match,
      matchId: match?.matchId ?? match?.id ?? match?.event?.id ?? null,
    }))
    .filter((match) => match?.matchId && (match?.homeTeamName || match?.homeTeam?.name || match?.event?.homeName) && (match?.awayTeamName || match?.awayTeam?.name || match?.event?.awayName));
}

function buildTargets(args, now) {
  if (args.matchDate) {
    const checkpoints = args.checkpointKey
      ? [getAutoAnalysisCheckpoint(args.checkpointKey)].filter(Boolean)
      : buildAutoAnalysisCheckpointTargets({ now }).map(({ key }) => getAutoAnalysisCheckpoint(key)).filter(Boolean);

    return checkpoints.map((checkpoint) => ({
      ...checkpoint,
      date: args.matchDate,
    }));
  }

  return buildAutoAnalysisCheckpointTargets({ now, checkpointKey: args.checkpointKey });
}

async function main() {
  const args = parseArgs(process.argv);
  const now = args.now ? coerceDate(args.now) : new Date();
  if (!now || !Number.isFinite(now.getTime())) {
    throw new Error("Invalid --now timestamp");
  }

  let client;
  try {
    client = await clientPromise;
    const db = client.db(DB_NAME);
    const targetLeagues = await loadTargetLeagues(db);
    const targets = buildTargets(args, now);

    console.log(`\n🎯 AUTO ANALYSIS CHECKPOINT RUN`);
    console.log(`🕒 Now: ${now.toISOString()}`);
    console.log(`🎚️ Strategy: ${args.strategyId}`);
    console.log(`📅 Targets: ${targets.map((target) => `${target.key}:${target.date}`).join(", ")}`);

    let totalRuns = 0;
    let totalMatches = 0;
    let totalCandidates = 0;

    for (const checkpoint of targets) {
      const matches = sanitizeMatches(
        await getMatchesForDateFiltered(checkpoint.date, {
          leagues: targetLeagues,
        })
      );

      if (!matches.length) {
        console.log(`ℹ️ ${checkpoint.key}: inga matcher för ${checkpoint.date}`);
        continue;
      }

      console.log(`\n🚀 ${checkpoint.key} -> ${checkpoint.date}`);
      console.log(`📥 Matches: ${matches.length}`);

      const result = await executeAndPersistAutoAnalysisRun({
        db,
        date: checkpoint.date,
        matches,
        strategyId: args.strategyId,
        source: `scheduled-${checkpoint.key}`,
        checkpoint,
        now,
        deterministicRunId: true,
      });

      totalRuns += 1;
      totalMatches += matches.length;
      totalCandidates += result?.summary?.qualifyingCandidateCount || 0;

      console.log(
        `✅ Saved ${checkpoint.key}: shortlist=${result?.summary?.shortlistCount || 0}, qualified=${result?.summary?.qualifyingCandidateCount || 0}, marketCount=${result?.summary?.marketCount || 0}`
      );
    }

    console.log(`\n🏁 AUTO ANALYSIS CHECKPOINT SUMMARY`);
    console.log(`Runs: ${totalRuns}`);
    console.log(`Matches: ${totalMatches}`);
    console.log(`Qualified candidates: ${totalCandidates}`);
  } finally {
    if (client) {
      await client.close(true).catch(() => {});
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ run-auto-analysis-checkpoints failed:", error);
    process.exit(1);
  });
