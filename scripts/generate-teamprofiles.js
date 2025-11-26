

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import clientPromise from "../lib/mongo.js";

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

async function loadTeamStats(teamstatsCollection, team, matchType, filePath) {
  const teamId = team?.id ?? team?.teamId;
  const idS = String(teamId);
  const idN = Number.isFinite(Number(teamId)) ? Number(teamId) : null;

  if (teamstatsCollection && teamId != null) {
    const orFilters = [
      { "_importMeta.teamId": idS, "_importMeta.teamRole": matchType },
      idN !== null
        ? { "_importMeta.teamId": idN, "_importMeta.teamRole": matchType }
        : null,
      idN !== null ? { "meta.lagId": idN, "meta.matchType": matchType } : null,
      idN !== null ? { "meta.lagId": idN, matchType } : null, // om matchType ligger top-level
    ].filter(Boolean);

    const document = await teamstatsCollection.findOne(
      { $or: orFilters },
      {
        projection: { full: 1, "_importMeta.importedAt": 1, "meta.savedAt": 1 },
      }
    );

    if (Array.isArray(document?.full) && document.full.length) {
      return {
        matches: document.full,
        source: "database",
        importedAt:
          document._importMeta?.importedAt ?? document.meta?.savedAt ?? null,
      };
    }
  }

  // (behåll din fil-fallback här; överväg ASCII-fallback som bonus)
  const teamStatsFromFile = await readJSON(filePath);
  if (Array.isArray(teamStatsFromFile?.full) && teamStatsFromFile.full.length) {
    return {
      matches: teamStatsFromFile.full,
      source: "file",
      importedAt: null,
    };
  }

  return null;
}


function average(values) {
  if (!values.length) {
    return null;
  }
  const sum = values.reduce((total, current) => total + current, 0);
  return sum / values.length;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
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

// --- FUNKTION FÖR ATT EXTRAHERA HISTORIKDATA (Korrigerad) ---
function computeMatchHistory(matches, matchType, teamId, statKeys, periods) {
  const history = {};

  for (const match of matches) {
    const matchId = match.matchId;
    
    // FIX: Fallback till timestamp om date-sträng saknas
    let date = match.date;
    if (!date && typeof match.timestamp === 'number') {
        // Konvertera Unix sekunder till YYYY-MM-DD sträng
        date = new Date(match.timestamp * 1000).toISOString().split('T')[0];
    }
    // SLUT PÅ FIX

    // Bestäm om laget (teamId) var hemma- eller bortalag i den RÅA matchdatan
    const isHomeMatch = match.homeTeamId === teamId;

    // Vi bygger profilen för matchType ("home" eller "away"). Vi inkluderar endast matcher som matchar profiltypen.
    const correctPerspective = (matchType === 'home' && isHomeMatch) || (matchType === 'away' && !isHomeMatch); 
    
    if (!correctPerspective) continue;

    const teamValueKey = isHomeMatch ? 'homeValue' : 'awayValue';
    const oppValueKey = isHomeMatch ? 'awayValue' : 'homeValue';
    const oppName = isHomeMatch ? match.awayTeamName : match.homeTeamName;

    if (!match.matchDetails || !match.matchDetails.statistics) continue;

    for (const period of periods) {
        const items = getStatisticsItems(match.matchDetails.statistics, period);
        
        for (const statKey of statKeys) {
            const loweredKey = statKey.toLowerCase();
            const statItem = items.find(item => item.key?.toLowerCase() === loweredKey);
            
            if (!statItem) continue;

            let teamValue = statItem[teamValueKey];
            let oppValue = statItem[oppValueKey];
            
            // Hantera specialfallet FreeKicks precis som i extractStatValues
            if (loweredKey === "freekicks") {
                const offsidesItem = items.find(item => item.key?.toLowerCase() === "offsides");
                
                if (typeof teamValue === "number") {
                    const opponentOffsides = isHomeMatch ? offsidesItem?.awayValue : offsidesItem?.homeValue;
                    if (typeof opponentOffsides === "number") {
                        teamValue += opponentOffsides;
                    }
                }
                if (typeof oppValue === "number") {
                    const teamOffsides = isHomeMatch ? offsidesItem?.homeValue : offsidesItem?.awayValue;
                    if (typeof teamOffsides === "number") {
                        oppValue += teamOffsides;
                    }
                }
            }

            if (typeof teamValue === 'number' && typeof oppValue === 'number') {
                const historyItem = {
                    matchId: matchId,
                    date: date, // ANVÄNDER DET KORRIGERADE DATUMET
                    opp: oppName,
                    val: teamValue, // Lagets värde
                    oppVal: oppValue // Motståndarens värde
                };

                const historyKey = `${statKey}_${period}`;

                if (!history[historyKey]) {
                    history[historyKey] = [];
                }
                
                // Lägg till historikposten (behåller ordningen från matches-arrayen)
                history[historyKey].push(historyItem);
            }
        }
    }
  }
  return history;
}
// --- SLUT PÅ FUNKTION ---

// --- FUNKTION FÖR ATT BYGGA GAMES ARRAY (Korrigerad) ---
function buildGames(matches) {
  if (!Array.isArray(matches)) {
    return [];
  }
  return matches.map((match) => {
    // FIX: Fallback till timestamp för date-fältet
    const dateValue = match.date ?? (typeof match.timestamp === 'number' ? new Date(match.timestamp * 1000).toISOString().split('T')[0] : null);
    
    return {
      matchId: match.matchId,
      date: dateValue, // ANVÄNDER DET KORRIGERADE DATUMET
      timestamp: match.timestamp,
    };
  });
}
// --- SLUT PÅ FUNKTION ---

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

function computeSpecialsLeagueAverage(profiles) {
  const leagueAverage = {
    shotsPerMinute: {
      for: {},
      against: {},
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

  if (!Array.isArray(profiles) || !profiles.length) {
    for (const state of SCORE_STATES) {
      leagueAverage.shotsPerMinute.for[state] = null;
      leagueAverage.shotsPerMinute.against[state] = null;
    }
    for (const label of BASE_WINDOW_LABELS) {
      leagueAverage.shotsPerTenMinutes.for[label] = null;
      leagueAverage.shotsPerTenMinutes.against[label] = null;
    }
    return leagueAverage;
  }

  const specialsList = profiles
    .map((profile) => profile.specials)
    .filter((specials) => specials && typeof specials === "object");

  for (const state of SCORE_STATES) {
    const forValues = specialsList
      .map((specials) => specials?.shotsPerMinute?.for?.[state])
      .filter(isFiniteNumber);
    const againstValues = specialsList
      .map((specials) => specials?.shotsPerMinute?.against?.[state])
      .filter(isFiniteNumber);

    leagueAverage.shotsPerMinute.for[state] = forValues.length ? average(forValues) : null;
    leagueAverage.shotsPerMinute.against[state] =
      againstValues.length ? average(againstValues) : null;
  }

  const firstGoalMetrics = [
    "concedeFirstPercentage",
    "scoreFirstPercentage",
    "averageTimeScoredFirst",
    "averageTimeConcededFirst",
  ];

  for (const metric of firstGoalMetrics) {
    const values = specialsList
      .map((specials) => specials?.firstGoal?.[metric])
      .filter(isFiniteNumber);
    leagueAverage.firstGoal[metric] = values.length ? average(values) : null;
  }

  const windowLabels = new Set(BASE_WINDOW_LABELS);

  for (const specials of specialsList) {
    const forWindows = specials?.shotsPerTenMinutes?.for;
    if (forWindows && typeof forWindows === "object") {
      for (const label of Object.keys(forWindows)) {
        windowLabels.add(label);
      }
    }

    const againstWindows = specials?.shotsPerTenMinutes?.against;
    if (againstWindows && typeof againstWindows === "object") {
      for (const label of Object.keys(againstWindows)) {
        windowLabels.add(label);
      }
    }
  }

  const sortedLabels = Array.from(windowLabels).sort((a, b) => {
    const parseLabel = (label) => {
      const match = label.match(/\d+/);
      return match ? parseInt(match[0], 10) : 0;
    };
    return parseLabel(a) - parseLabel(b);
  });

  for (const label of sortedLabels) {
    const forValues = specialsList
      .map((specials) => specials?.shotsPerTenMinutes?.for?.[label])
      .filter(isFiniteNumber);
    const againstValues = specialsList
      .map((specials) => specials?.shotsPerTenMinutes?.against?.[label])
      .filter(isFiniteNumber);

    leagueAverage.shotsPerTenMinutes.for[label] = forValues.length
      ? average(forValues)
      : null;
    leagueAverage.shotsPerTenMinutes.against[label] = againstValues.length
      ? average(againstValues)
      : null;
  }

  return leagueAverage;
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

function assignSpecialRanks(profiles) {
  if (!Array.isArray(profiles) || !profiles.length) {
    return;
  }

  const sides = ["for", "against"];

  for (const side of sides) {
    for (const state of SCORE_STATES) {
      const entries = [];

      for (let index = 0; index < profiles.length; index += 1) {
        const profile = profiles[index];
        const value = profile.specials?.shotsPerMinute?.[side]?.[state];
        if (isFiniteNumber(value)) {
          entries.push({ index, value });
        }
      }

      entries.sort((a, b) => b.value - a.value);

      const rankMap = new Map();
      let rank = 1;
      for (const entry of entries) {
        rankMap.set(entry.index, rank);
        rank += 1;
      }

      for (let index = 0; index < profiles.length; index += 1) {
        const profile = profiles[index];
        const container = profile.specials?.shotsPerMinute?.[side];
        if (!container || typeof container !== "object") {
          continue;
        }
        const rankValue = rankMap.get(index) ?? null;
        container[`rank-${state}`] = rankValue;
      }
    }
  }

  const windowLabelSets = {
    for: new Set(BASE_WINDOW_LABELS),
    against: new Set(BASE_WINDOW_LABELS),
  };

  for (const profile of profiles) {
    for (const side of sides) {
      const windows = profile.specials?.shotsPerTenMinutes?.[side];
      if (windows && typeof windows === "object") {
        for (const label of Object.keys(windows)) {
          windowLabelSets[side].add(label);
        }
      }
    }
  }

  for (const side of sides) {
    const labels = Array.from(windowLabelSets[side]).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    for (const label of labels) {
      const entries = [];

      for (let index = 0; index < profiles.length; index += 1) {
        const profile = profiles[index];
        const value = profile.specials?.shotsPerTenMinutes?.[side]?.[label];
        if (isFiniteNumber(value)) {
          entries.push({ index, value });
        }
      }

      entries.sort((a, b) => b.value - a.value);

      const rankMap = new Map();
      let rank = 1;
      for (const entry of entries) {
        rankMap.set(entry.index, rank);
        rank += 1;
      }

      for (let index = 0; index < profiles.length; index += 1) {
        const profile = profiles[index];
        const container = profile.specials?.shotsPerTenMinutes?.[side];
        if (!container || typeof container !== "object") {
          continue;
        }
        const rankValue = rankMap.get(index) ?? null;
        container[`rank-${label}`] = rankValue;
      }
    }
  }

  const firstGoalMetrics = [
    "concedeFirstPercentage",
    "scoreFirstPercentage",
    "averageTimeScoredFirst",
    "averageTimeConcededFirst",
  ];

  for (const metric of firstGoalMetrics) {
    const entries = [];

    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      const value = profile.specials?.firstGoal?.[metric];
      if (isFiniteNumber(value)) {
        entries.push({ index, value });
      }
    }

    const ascending = metric === "averageTimeScoredFirst" || metric === "averageTimeConcededFirst";
    entries.sort((a, b) => (ascending ? a.value - b.value : b.value - a.value));

    const rankMap = new Map();
    let rank = 1;
    for (const entry of entries) {
      rankMap.set(entry.index, rank);
      rank += 1;
    }

    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      const container = profile.specials?.firstGoal;
      if (!container || typeof container !== "object") {
        continue;
      }
      const rankValue = rankMap.get(index) ?? null;
      container[`rank-${metric}`] = rankValue;
    }
  }

  for (const profile of profiles) {
    if (profile.specials?.shotsPerMinute?.rank) {
      delete profile.specials.shotsPerMinute.rank;
    }
    if (profile.specials?.shotsPerTenMinutes?.rank) {
      delete profile.specials.shotsPerTenMinutes.rank;
    }
    if (profile.specials?.firstGoal?.rank) {
      delete profile.specials.firstGoal.rank;
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
    assignSpecialRanks(profiles);

    const leagueAverageFor = computeLeagueAverages(profiles, "for");
    const leagueAverageAgainst = computeLeagueAverages(profiles, "against");
    const leagueAverageSpecials = computeSpecialsLeagueAverage(profiles);

    for (const profile of profiles) {
      profile.statistics.leagueAverage = {
        for: leagueAverageFor,
        against: leagueAverageAgainst,
      };
      if (!profile.specials) {
        profile.specials = {};
      }
      profile.specials.leagueAverage = leagueAverageSpecials;
    }
  }
}

async function saveProfilesToDatabase(collection, profiles, generatedAt) {
  if (!Array.isArray(profiles) || !profiles.length) {
    console.log("Info: No team profiles to upsert into database.");
    return;
  }

  if (!collection) {
    throw new Error("Missing MongoDB collection for saving team profiles");
  }

  const timestamp = generatedAt ?? new Date().toISOString();
  const operations = profiles.map(({ leagueName, profile }) => {
    const meta = profile.meta ?? {};
    // ID:n behålls som orginal (utan -test)
    const identifier = `${meta.ligaId ?? "unknown"}:${meta.lagId ?? "unknown"}:${meta.matchType ?? "unknown"}`;
    const document = {
      _id: identifier,
      leagueName,
      generatedAt: timestamp,
      ...profile,
    };

    return {
      updateOne: {
        filter: { _id: identifier },
        update: { $set: document },
        upsert: true,
      },
    };
  });

  const chunkSize = 500;
  for (let i = 0; i < operations.length; i += chunkSize) {
    const chunk = operations.slice(i, i + chunkSize);
    await collection.bulkWrite(chunk, { ordered: false });
  }

  console.log(`Success: Upserted ${operations.length} team profiles into MongoDB collection: ${collection.collectionName}`);
}

async function main() {
  const dataDir = path.resolve(__dirname, "../data");
  const teamStatsDir = path.join(dataDir, "teamstats");
  const teamProfilesDir = path.join(dataDir, "teamprofiles"); // ORIGINAL: Spara till teamprofiles-mappen
  // const teamProfilesDir = path.join(dataDir, "teamprofiles-test"); // TEST: Spara till teamprofiles-test-mappen
  const leaguesPath = path.join(dataDir, "leagues-and-teams.json");

  const leaguesData = await readJSON(leaguesPath);
  if (!leaguesData) {
    throw new Error("Could not load leagues-and-teams.json");
  }

  await fs.mkdir(teamProfilesDir, { recursive: true });

  const client = await clientPromise;

  try {
    const db = client.db(process.env.MONGODB_DB || "app");
    const teamstatsCollection = db.collection("teamstats");
    const teamprofilesCollection = db.collection("teamprofiles"); // ORIGINAL: Spara till teamprofiles collection
    // const teamprofilesCollection = db.collection("teamprofiles-test"); // TEST: Spara till teamprofiles-test collection
    const profilesForDatabase = [];

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
          const teamStatsResult = await loadTeamStats(
            teamstatsCollection,
            team,
            matchType,
            teamStatsPath
          );

          if (!teamStatsResult) {
            console.warn(
              `Warning: Skipping ${team.name} (${matchType}) - no stats found in database or file (${teamStatsFileName})`
            );
            continue;
          }

          const { matches, importedAt } = teamStatsResult;
          const games = buildGames(matches);
          const savedAt =
            resolveLatestSavedAt(matches) ?? importedAt ?? new Date().toISOString();
          const statistics = computeStatistics(matches, matchType);
          const specials = computeSpecials(matches, matchType);
          
          // --- INTEGRATION AV HISTORIK-LOGIKEN HÄR (ÅTERINFÖRD) ---
          const teamId = team.id;
          const matchHistory = computeMatchHistory(matches, matchType, teamId, STAT_KEYS, PERIODS);
          
          // Mappa in historikdatan i den befintliga statistiken-strukturen
          for (const keyPeriod in matchHistory) {
              const [statKey, period] = keyPeriod.split('_'); 

              if (statistics.for[statKey] && statistics.for[statKey][period]) {
                  statistics.for[statKey][period].history = matchHistory[keyPeriod];
              }
              if (statistics.against[statKey] && statistics.against[statKey][period]) {
                  statistics.against[statKey][period].history = matchHistory[keyPeriod];
              }
          }
          // --- SLUT PÅ INTEGRATION ---
          
          // Filnamnet har INTE -test
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
          profilesForDatabase.push({ leagueName, profile });
        }
      }

      applyLeagueRankings(leagueProfilesByMatchType);

      for (const file of filesToWrite) {
        await fs.writeFile(file.outputPath, JSON.stringify(file.profile, null, 2), "utf-8");
        // Loggen visar sökvägen till test-mappen
        console.log(`Success: Created test profile ${path.relative(dataDir, file.outputPath)}`); 
      }
    }

    const generatedAt = new Date().toISOString();
    await saveProfilesToDatabase(teamprofilesCollection, profilesForDatabase, generatedAt);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Ett fel uppstod när teamprofiler genererades:", error);
  process.exit(1);
});