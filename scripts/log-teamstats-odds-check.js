import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// const ROOT_DIR = __dirname;
const DATA_DIR = path.join(__dirname, "..", "data");
const TEAMSTATS_DIR = path.join(DATA_DIR, 'teamstats');
const LEAGUES_FILE = path.join(DATA_DIR, 'leagues-and-teams.json');
const REQUIRED_MATCH_COUNT = 7;

function ensureFileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function loadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Kunde inte läsa JSON från ${filePath}:`, error.message);
    return null;
  }
}

function toTeamFileBase(teamName) {
  return teamName
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/__+/g, '_')
    .replace(/\//g, '_')
    .replace(/&/g, '&')
    .trim();
}

function buildMatchEntry(match, source) {
  const matchDate = typeof match.date === 'string' && match.date.length > 0 ? match.date : null;
  const timestampRaw = typeof match.timestamp === 'number' ? match.timestamp * 1000 : Date.parse(matchDate ?? '');
  const timestamp = Number.isFinite(timestampRaw) ? timestampRaw : 0;
  const odds = match.odds;
  const hasOdds = odds !== undefined && odds !== null;

  return {
    id: match.matchId ?? `${match.date}-${match.homeTeamName}-${match.awayTeamName}`,
    date: matchDate ?? 'okänt datum',
    savedAt: match.savedAt ?? 'okänt spar-datum',
    homeTeam: match.homeTeamName ?? 'okänt hemmalag',
    awayTeam: match.awayTeamName ?? 'okänt bortalag',
    timestamp,
    hasOdds,
    oddsType: Array.isArray(odds) ? 'array' : typeof odds,
    source,
  };
}

function loadMatchesForTeam(team) {
  const matchesById = new Map();

  ['home', 'away'].forEach((venue) => {
    const baseName = toTeamFileBase(team.name);
    const filePath = path.join(TEAMSTATS_DIR, `${baseName}_${venue}_match_stats.json`);

    if (!ensureFileExists(filePath)) {
      return;
    }

    const data = loadJson(filePath);
    if (!data || !Array.isArray(data.full)) {
      console.warn(`Filen ${filePath} saknar en giltig 'full'-lista.`);
      return;
    }

    data.full.forEach((matchRaw) => {
      const match = buildMatchEntry(matchRaw, venue);
      const previous = matchesById.get(match.id);
      if (!previous || match.timestamp > previous.timestamp) {
        matchesById.set(match.id, match);
      }
    });
  });

  const matches = Array.from(matchesById.values()).sort((a, b) => b.timestamp - a.timestamp);
  return { matches };
}

function analyzeTeam(team) {
  const { matches } = loadMatchesForTeam(team);
  const latestMatches = matches.slice(0, REQUIRED_MATCH_COUNT);
  return {
    teamName: team.name,
    latestMatches,
  };
}

function logTeamAnalysis(result) {
  const matchesWithOdds = result.latestMatches.filter((match) => match.hasOdds).length;
  console.log(`${result.teamName}: ${matchesWithOdds}/${REQUIRED_MATCH_COUNT} senaste har odds`);
}

function logLeague(_leagueName, teams) {
  teams.forEach((team) => {
    const analysis = analyzeTeam(team);
    logTeamAnalysis(analysis);
  });
}

function main() {
  if (!ensureFileExists(LEAGUES_FILE)) {
    console.error('Kunde inte hitta filen med ligor och lag.');
    process.exit(1);
  }

  const leaguesData = loadJson(LEAGUES_FILE);
  if (!leaguesData || typeof leaguesData !== 'object') {
    console.error('Ogiltigt format på leagues-and-teams.json.');
    process.exit(1);
  }

  Object.entries(leaguesData).forEach(([leagueName, leagueInfo]) => {
    if (!leagueInfo || !Array.isArray(leagueInfo.teams)) {
      console.warn(`Hoppar över ${leagueName} eftersom inga lag hittades.`);
      return;
    }

    logLeague(leagueName, leagueInfo.teams);
  });
}

main();
