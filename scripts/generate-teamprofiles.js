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
const SCORE_STATES = ["leading", "trailing", "tied"];
const BASE_WINDOW_LABELS = ["0-10", "11-20", "21-30", "31-40", "41-50", "51-60", "61-70", "71-80", "81-90"];


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

function normalizeAddedMinutes(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 60) {
    return 0;
  }
  return value;
}

function resolveIncidentTimeSeconds(incident) {
  if (!incident || typeof incident.time !== "number") {
    return null;
  }
  const added = normalizeAddedMinutes(incident.addedTime);
  return Math.max(0, incident.time * 60 + added * 60);
}

function resolveShotTimeSeconds(shot) {
  if (!shot) {
    return null;
  }
  if (typeof shot.timeSeconds === "number" && Number.isFinite(shot.timeSeconds)) {
    return shot.timeSeconds;
  }
  if (typeof shot.time !== "number") {
    return null;
  }
  const added = normalizeAddedMinutes(shot.addedTime);
  return Math.max(0, shot.time * 60 + added * 60);
}

function resolveMatchDuration(shotEntries, incidents) {
  const defaultDuration = 90 * 60;
  const incidentTimes = Array.isArray(incidents)
    ? incidents
        .map((incident) => resolveIncidentTimeSeconds(incident))
        .filter((value) => Number.isFinite(value))
    : [];
  const shotTimes = Array.isArray(shotEntries)
    ? shotEntries
        .map((shot) => resolveShotTimeSeconds(shot))
        .filter((value) => Number.isFinite(value))
    : [];
  const ftIncident = Array.isArray(incidents)
    ? incidents.find(
        (incident) => incident?.text === "FT" && incident?.incidentType === "period"
      )
    : null;
  const ftTime = resolveIncidentTimeSeconds(ftIncident);
  const maxIncidentTime = incidentTimes.length ? Math.max(...incidentTimes) : 0;
  const maxShotTime = shotTimes.length ? Math.max(...shotTimes) : 0;
  return Math.max(defaultDuration, ftTime ?? 0, maxIncidentTime, maxShotTime);
}

function determineScoreState(homeScore, awayScore, teamIsHome) {
  const teamScore = teamIsHome ? homeScore : awayScore;
  const opponentScore = teamIsHome ? awayScore : homeScore;
  if (teamScore > opponentScore) {
    return "leading";
  }
  if (teamScore < opponentScore) {
    return "trailing";
  }
  return "tied";
}

function buildScoreSegments(incidents, teamIsHome, matchDuration) {
  const goals = Array.isArray(incidents)
    ? incidents
        .filter((incident) => incident?.incidentType === "goal")
        .map((incident) => ({
          seconds: resolveIncidentTimeSeconds(incident),
          homeScore: typeof incident.homeScore === "number" ? incident.homeScore : null,
          awayScore: typeof incident.awayScore === "number" ? incident.awayScore : null,
          isHome: incident.isHome === true,
        }))
        .filter((goal) => Number.isFinite(goal.seconds))
        .sort((a, b) => a.seconds - b.seconds)
    : [];

  let currentHome = 0;
  let currentAway = 0;
  let currentState = "tied";
  const segments = [];
  let previousTime = 0;

  for (const goal of goals) {
    const segmentEnd = Math.min(Math.max(goal.seconds, previousTime), matchDuration);
    if (segmentEnd > previousTime) {
      segments.push({ start: previousTime, end: segmentEnd, state: currentState });
    }
    if (typeof goal.homeScore === "number" && typeof goal.awayScore === "number") {
      currentHome = goal.homeScore;
      currentAway = goal.awayScore;
    } else if (goal.isHome) {
      currentHome += 1;
    } else {
      currentAway += 1;
    }
    currentState = determineScoreState(currentHome, currentAway, teamIsHome);
    previousTime = segmentEnd;
  }

  if (!segments.length || matchDuration > previousTime) {
    const start = segments.length ? previousTime : 0;
    const end = matchDuration;
    if (end > start) {
      segments.push({ start, end, state: currentState });
    }
  }

  if (!segments.length) {
    segments.push({ start: 0, end: matchDuration, state: currentState });
  }

  return segments;
}

function findStateForTime(segments, matchDuration, timeSeconds) {
  if (!segments.length) {
    return "tied";
  }
  const clamped = Math.min(Math.max(timeSeconds, 0), matchDuration);
  for (const segment of segments) {
    if (clamped >= segment.start && clamped < segment.end) {
      return segment.state;
    }
  }
  return segments[segments.length - 1].state;
}

function countShotsByState(shots, segments, matchDuration) {
  const counts = {
    leading: 0,
    trailing: 0,
    tied: 0,
  };
  if (!Array.isArray(shots) || !segments.length) {
    return counts;
  }
  for (const shot of shots) {
    const seconds = resolveShotTimeSeconds(shot);
    if (!Number.isFinite(seconds)) {
      continue;
    }
    const state = findStateForTime(segments, matchDuration, seconds);
    counts[state] += 1;
  }
  return counts;
}

function accumulateWindowCounts(target, source) {
  for (const [label, count] of source.entries()) {
    target.set(label, (target.get(label) ?? 0) + count);
  }
}

function getWindowLabelFromMinute(minute) {
  if (!Number.isFinite(minute) || minute <= 0) {
    return BASE_WINDOW_LABELS[0];
  }
  if (minute <= 10) {
    return BASE_WINDOW_LABELS[0];
  }
  const index = Math.ceil(minute / 10) - 1;
  if (index <= 0) {
    return BASE_WINDOW_LABELS[0];
  }
  const labelStart = index * 10 + 1;
  const labelEnd = (index + 1) * 10;
  return labelStart + "-" + labelEnd;
}

function countShotsByWindow(shots) {
  const map = new Map();
  if (!Array.isArray(shots)) {
    return map;
  }
  for (const shot of shots) {
    const seconds = resolveShotTimeSeconds(shot);
    if (!Number.isFinite(seconds)) {
      continue;
    }
    const minute = seconds / 60;
    const label = getWindowLabelFromMinute(minute);
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return map;
}

function computeSpecials(matches, matchType) {
  const specials = {
    shotsPerMinute: {
      for: {
        leading: null,
        trailing: null,
        tied: null,
      },
      against: {
        leading: null,
        trailing: null,
        tied: null,
      },
    },
    firstGoal: {
      concedeFirstPercentage: null,
      scoreFirstPercentage: null,
      averageTimeScoredFirst: null,
      averageTimeConcededFirst: null,
    },
    shotsPerTenMinutes: {
      for: {},
      against: {},
    },
  };

  if (!Array.isArray(matches) || !matches.length) {
    for (const label of BASE_WINDOW_LABELS) {
      specials.shotsPerTenMinutes.for[label] = null;
      specials.shotsPerTenMinutes.against[label] = null;
    }
    return specials;
  }

  const teamIsHome = matchType === "home";
  const stateTotalsFor = {
    leading: { shots: 0, minutes: 0 },
    trailing: { shots: 0, minutes: 0 },
    tied: { shots: 0, minutes: 0 },
  };
  const stateTotalsAgainst = {
    leading: { shots: 0, minutes: 0 },
    trailing: { shots: 0, minutes: 0 },
    tied: { shots: 0, minutes: 0 },
  };
  const windowCountsFor = new Map();
  const windowCountsAgainst = new Map();
  let matchesWithShotmap = 0;

  const firstGoalStats = {
    total: 0,
    scoredFirst: 0,
    concededFirst: 0,
    scoredFirstTimeSum: 0,
    concededFirstTimeSum: 0,
    scoredFirstSamples: 0,
    concededFirstSamples: 0,
  };

  for (const match of matches) {
    const shotEntries = match?.shotmap?.shotmap;
    const incidents = match?.incidents?.incidents;
    const hasShotmap = Array.isArray(shotEntries);
    const hasIncidents = Array.isArray(incidents);

    if (hasShotmap) {
      matchesWithShotmap += 1;
      const teamShots = shotEntries.filter((shot) => shot?.isHome === teamIsHome);
      const opponentShots = shotEntries.filter((shot) => shot?.isHome === !teamIsHome);

      accumulateWindowCounts(windowCountsFor, countShotsByWindow(teamShots));
      accumulateWindowCounts(windowCountsAgainst, countShotsByWindow(opponentShots));

      if (hasIncidents) {
        const matchDuration = resolveMatchDuration(shotEntries, incidents);
        const segments = buildScoreSegments(incidents, teamIsHome, matchDuration);

        for (const segment of segments) {
          const minutes = (segment.end - segment.start) / 60;
          if (minutes <= 0) {
            continue;
          }
          stateTotalsFor[segment.state].minutes += minutes;
          stateTotalsAgainst[segment.state].minutes += minutes;
        }

        const teamShotsByState = countShotsByState(teamShots, segments, matchDuration);
        const oppShotsByState = countShotsByState(opponentShots, segments, matchDuration);

        for (const state of SCORE_STATES) {
          stateTotalsFor[state].shots += teamShotsByState[state];
          stateTotalsAgainst[state].shots += oppShotsByState[state];
        }
      }
    }

    if (hasIncidents) {
      const goalEvents = incidents
        .filter((incident) => incident?.incidentType === "goal")
        .map((incident) => ({
          seconds: resolveIncidentTimeSeconds(incident),
          isTeam: incident?.isHome === teamIsHome,
        }))
        .filter((event) => Number.isFinite(event.seconds))
        .sort((a, b) => a.seconds - b.seconds);

      if (goalEvents.length) {
        firstGoalStats.total += 1;
        const firstGoal = goalEvents[0];
        const minutes = firstGoal.seconds / 60;
        if (firstGoal.isTeam) {
          firstGoalStats.scoredFirst += 1;
          firstGoalStats.scoredFirstTimeSum += minutes;
          firstGoalStats.scoredFirstSamples += 1;
        } else {
          firstGoalStats.concededFirst += 1;
          firstGoalStats.concededFirstTimeSum += minutes;
          firstGoalStats.concededFirstSamples += 1;
        }
      }
    }
  }

  for (const state of SCORE_STATES) {
    const forMinutes = stateTotalsFor[state].minutes;
    const againstMinutes = stateTotalsAgainst[state].minutes;
    specials.shotsPerMinute.for[state] = forMinutes > 0 ? stateTotalsFor[state].shots / forMinutes : null;
    specials.shotsPerMinute.against[state] =
      againstMinutes > 0 ? stateTotalsAgainst[state].shots / againstMinutes : null;
  }

  if (firstGoalStats.total > 0) {
    specials.firstGoal.scoreFirstPercentage = firstGoalStats.scoredFirst / firstGoalStats.total;
    specials.firstGoal.concedeFirstPercentage = firstGoalStats.concededFirst / firstGoalStats.total;
  }
  if (firstGoalStats.scoredFirstSamples > 0) {
    specials.firstGoal.averageTimeScoredFirst =
      firstGoalStats.scoredFirstTimeSum / firstGoalStats.scoredFirstSamples;
  }
  if (firstGoalStats.concededFirstSamples > 0) {
    specials.firstGoal.averageTimeConcededFirst =
      firstGoalStats.concededFirstTimeSum / firstGoalStats.concededFirstSamples;
  }

  const windowLabels = new Set(BASE_WINDOW_LABELS);
  for (const key of windowCountsFor.keys()) {
    windowLabels.add(key);
  }
  for (const key of windowCountsAgainst.keys()) {
    windowLabels.add(key);
  }
  const sortedLabels = Array.from(windowLabels).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  for (const label of sortedLabels) {
    if (matchesWithShotmap > 0) {
      specials.shotsPerTenMinutes.for[label] = (windowCountsFor.get(label) ?? 0) / matchesWithShotmap;
      specials.shotsPerTenMinutes.against[label] =
        (windowCountsAgainst.get(label) ?? 0) / matchesWithShotmap;
    } else {
      specials.shotsPerTenMinutes.for[label] = null;
      specials.shotsPerTenMinutes.against[label] = null;
    }
  }

  return specials;
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

function computeLeagueAverages(profiles, statGroup) {
  const leagueAverage = {};

  for (const statKey of STAT_KEYS) {
    leagueAverage[statKey] = {};

    for (const period of PERIODS) {
      const values = profiles
        .map((profile) => profile.statistics?.[statGroup]?.[statKey]?.[period]?.value)
        .filter((value) => value !== null && value !== undefined);

      leagueAverage[statKey][period] = { value: average(values) };
    }
  }

  return leagueAverage;
}

function applyLeagueRankings(leagueProfilesByMatchType) {
  for (const matchType of MATCH_TYPES) {
    const profiles = leagueProfilesByMatchType[matchType];
    if (!profiles.length) {
      continue;
    }

    assignRanks(profiles, "for");
    assignRanks(profiles, "against");

    const leagueAverageFor = computeLeagueAverages(profiles, "for");
    const leagueAverageAgainst = computeLeagueAverages(profiles, "against");

    for (const profile of profiles) {
      profile.statistics.leagueAverage = {
        for: leagueAverageFor,
        against: leagueAverageAgainst,
      };
    }
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
        const specials = computeSpecials(matches, matchType);
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
          specials,
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