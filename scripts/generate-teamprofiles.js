import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STAT_KEYS = [
  "totalShotsOnGoal",
  "shotsOnGoal",
  "cornerKicks",
  "yellowCards",
  "throwIns",
  "freeKicks",
  "fouls",
  "totalTackle",
  "goalKicks",
  "offsides",
  "accurateCross",
  "accurateLongBalls",
  "accuratePasses",
  "accurateThroughBall",
  "aerialDuelsPercentage",
  "ballPossession",
  "ballRecovery",
  "bigChanceCreated",
  "bigChanceMissed",
  "bigChanceScored",
  "blockedScoringAttempt",
  "dispossessed",
  "diveSaves",
  "dribblesPercentage",
  "duelWonPercent",
  "errorsLeadToGoal",
  "errorsLeadToShot",
  "expectedGoals",
  "finalThirdEntries",
  "finalThirdPhaseStatistic",
  "fouledFinalThird",
  "goalkeeperSaves",
  "goalsPrevented",
  "groundDuelsPercentage",
  "highClaims",
  "hitWoodwork",
  "interceptionWon",
  "passes",
  "punches",
  "redCards",
  "shotsOffGoal",
  "totalClearance",
  "totalShotsInsideBox",
  "totalShotsOutsideBox",
  "touchesInOppBox",
  "wonTacklePercent",
];

const PERIODS = ["ALL", "1ST", "2ND"];
const MATCH_TYPES = ["home", "away"];

async function readJSON(filePath) {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

function average(values) {
  if (!values.length) {
    return null;
  }
  const sum = values.reduce((total, current) => total + current, 0);
  return sum / values.length;
}

function formatTeamNameForStats(teamName) {
  return teamName.toLowerCase().replace(/\s+/g, "_");
}

function sanitizeFileComponent(value) {
  return value
    .toLowerCase()
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getStatisticsItems(statistics, period) {
  if (!Array.isArray(statistics)) {
    return [];
  }
  const periodEntry = statistics.find((entry) => entry.period === period);
  if (!periodEntry || !Array.isArray(periodEntry.groups)) {
    return [];
  }
  return periodEntry.groups.flatMap((group) => group?.statisticsItems ?? []);
}

function extractStatValues(matches, statKey, period, matchPerspective) {
  const values = [];
  if (!Array.isArray(matches)) {
    return values;
  }
  const loweredKey = statKey.toLowerCase();

  for (const match of matches) {
    const items = getStatisticsItems(match?.matchDetails?.statistics, period);
    if (!items.length) {
      continue;
    }

    const statItem = items.find((item) => item.key?.toLowerCase() === loweredKey);
    if (!statItem) {
      continue;
    }

    let value = matchPerspective === "home" ? statItem.homeValue : statItem.awayValue;

    if (loweredKey === "freekicks") {
      const offsidesItem = items.find((item) => item.key?.toLowerCase() === "offsides");
      if (typeof value !== "number") {
        continue;
      }
      const opponentOffsides =
        matchPerspective === "home" ? offsidesItem?.awayValue : offsidesItem?.homeValue;
      if (typeof opponentOffsides === "number") {
        value += opponentOffsides;
      }
    }

    if (typeof value === "number") {
      values.push(value);
    }
  }

  return values;
}

function computeStatistics(matches, matchType) {
  const stats = {
    for: {},
    against: {},
  };
  const opponentPerspective = matchType === "home" ? "away" : "home";

  for (const statKey of STAT_KEYS) {
    stats.for[statKey] = {};
    stats.against[statKey] = {};

    for (const period of PERIODS) {
      const forValues = extractStatValues(matches, statKey, period, matchType);
      const againstValues = extractStatValues(matches, statKey, period, opponentPerspective);

      stats.for[statKey][period] = { value: average(forValues) };
      stats.against[statKey][period] = { value: average(againstValues) };
    }
  }

  return stats;
}

function buildGames(matches) {
  if (!Array.isArray(matches)) {
    return [];
  }
  return matches.map((match) => ({
    matchId: match.matchId,
    date: match.date,
    timestamp: match.timestamp,
  }));
}

function resolveLatestSavedAt(matches) {
  if (!Array.isArray(matches)) {
    return null;
  }
  const timestamps = matches
    .map((match) => {
      const value = match?.savedAt;
      const numeric = value ? Date.parse(value) : Number.NaN;
      return Number.isFinite(numeric) ? numeric : null;
    })
    .filter((value) => value !== null);

  if (!timestamps.length) {
    return null;
  }

  const latest = Math.max(...timestamps);
  return new Date(latest).toISOString();
}

function assignRanks(profiles, statGroup) {
  for (const statKey of STAT_KEYS) {
    for (const period of PERIODS) {
      const entries = profiles
        .map((profile, index) => {
          const statNode = profile.statistics?.[statGroup]?.[statKey]?.[period];
          const value = statNode ? statNode.value : null;
          return { index, value };
        })
        .filter((entry) => entry.value !== null);

      entries.sort((a, b) => b.value - a.value);

      let rank = 1;
      for (const entry of entries) {
        const statNode = profiles[entry.index].statistics[statGroup][statKey][period];
        statNode.rank = rank;
        rank += 1;
      }

      for (const entry of profiles) {
        const statNode = entry.statistics?.[statGroup]?.[statKey]?.[period];
        if (statNode && statNode.rank === undefined) {
          statNode.rank = null;
        }
      }
    }
  }
}

function applyLeagueRankings(leagueProfilesByMatchType) {
  for (const matchType of MATCH_TYPES) {
    const profiles = leagueProfilesByMatchType[matchType];
    if (!profiles.length) {
      continue;
    }

    assignRanks(profiles, "for");
    assignRanks(profiles, "against");
  }
}

async function main() {
  const dataDir = path.resolve(__dirname, "../data");
  const teamStatsDir = path.join(dataDir, "teamstats");
  const teamProfilesDir = path.join(dataDir, "teamprofiles");
  const leaguesPath = path.join(dataDir, "leagues-and-teams.json");

  const leaguesData = await readJSON(leaguesPath);
  if (!leaguesData) {
    throw new Error("Could not load leagues-and-teams.json");
  }

  await fs.mkdir(teamProfilesDir, { recursive: true });

  for (const [leagueName, leagueInfo] of Object.entries(leaguesData)) {
    const leagueDirName = sanitizeFileComponent(leagueName).replace(/\s+/g, "-");
    const leagueOutputDir = path.join(teamProfilesDir, leagueDirName);
    await fs.mkdir(leagueOutputDir, { recursive: true });

    const leagueProfilesByMatchType = {
      home: [],
      away: [],
    };
    const filesToWrite = [];

    for (const team of leagueInfo.teams) {
      for (const matchType of MATCH_TYPES) {
        const teamStatsFileName = `${formatTeamNameForStats(team.name)}_${matchType}_match_stats.json`;
        const teamStatsPath = path.join(teamStatsDir, teamStatsFileName);
        const teamStats = await readJSON(teamStatsPath);

        if (!teamStats || !Array.isArray(teamStats.full) || !teamStats.full.length) {
          console.warn(
            `Warning: Skipping ${team.name} (${matchType}) - no stats file or no matches found at ${teamStatsFileName}`
          );
          continue;
        }

        const matches = teamStats.full;
        const games = buildGames(matches);
        const savedAt = resolveLatestSavedAt(matches) ?? new Date().toISOString();
        const statistics = computeStatistics(matches, matchType);
        const teamFileName = `${sanitizeFileComponent(team.name)}_${matchType}.json`;
        const outputPath = path.join(leagueOutputDir, teamFileName);

        const profile = {
          meta: {
            lagnamn: team.name,
            lagId: team.id,
            ligaId: leagueInfo.leagueId,
            imageUrl: team.imageUrl,
            categoryId: leagueInfo.categoryId,
            matchType,
            savedAt,
          },
          games,
          statistics,
        };

        leagueProfilesByMatchType[matchType].push(profile);
        filesToWrite.push({ profile, outputPath });
      }
    }

    applyLeagueRankings(leagueProfilesByMatchType);

    for (const file of filesToWrite) {
      await fs.writeFile(file.outputPath, JSON.stringify(file.profile, null, 2), "utf-8");
      console.log(`Success: Created profile ${path.relative(dataDir, file.outputPath)}`);
    }
  }
}

main().catch((error) => {
  console.error("Ett fel uppstod när teamprofiler genererades:", error);
  process.exit(1);
});