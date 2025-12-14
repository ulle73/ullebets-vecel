import { runBacktest } from "../lib/runners/backtest-runner.js";
import { getMatchesForDateFiltered } from "../lib/engines/fixtures-engine.js";
import { clientPromise } from "../lib/db.js";
import { coerceDate, formatDateInZone } from "../lib/utils/date.js";

// Fetch leagues from DB
const client = await clientPromise;
const db = client.db(process.env.MONGODB_DB || 'app');
const leaguesDoc = await db.collection("leages-and-teams").findOne({});

let targetLeagues = [];
if (leaguesDoc) {
  // Extract keys that are not _id
  targetLeagues = Object.keys(leaguesDoc).filter(key => key !== "_id");
  console.log(`Loaded ${targetLeagues.length} leagues from DB`);
} else {
  console.warn("⚠️ Could not load leagues from DB, falling back to defaults");
  targetLeagues = [
    "Premier League", "LaLiga", "Bundesliga", "Serie A",
    "Brasileirão", "Ligue 1", "A-League Men"
  ];
}

// Check for matches starting within 20 minutes
const today = formatDateInZone(new Date(), "Europe/Stockholm");
console.log(`\n🔍 Checking for matches starting within 20 minutes on ${today}...`);

const allMatches = await getMatchesForDateFiltered(today);
const now = new Date();
const twentyMinutesFromNow = new Date(now.getTime() + 20 * 60 * 1000);

console.log(`Found ${allMatches.length} total matches for ${today}`);
if (allMatches.length > 0) {
  console.log("📅 All matches for today:");
  allMatches.forEach((match, index) => {
    // Extract team names from various possible paths
    const homeTeam = match.homeTeamName || match.homeTeam?.name || match.event?.homeName || match.event?.homeTeam?.name || 'Unknown';
    const awayTeam = match.awayTeamName || match.awayTeam?.name || match.event?.awayName || match.event?.awayTeam?.name || 'Unknown';
    const league = match.leagueName || match.league?.name || match.tournament?.name || match.event?.tournament?.name || 'Unknown';

    const matchTime = coerceDate(match.matchDate || match.timestamp || match.start || match.startTimestamp || match.event?.start);
    const timeStr = matchTime ? matchTime.toLocaleTimeString('sv-SE', {
      timeZone: 'Europe/Stockholm',
      hour: '2-digit',
      minute: '2-digit'
    }) : 'Unknown';

    console.log(`  ${index + 1}. ${homeTeam} vs ${awayTeam} (${league}) - ${timeStr}`);
  });
  console.log("");
}

const upcomingMatches = allMatches.filter(match => {
  const matchTime = coerceDate(match.matchDate || match.timestamp || match.start || match.startTimestamp || match.event?.start);
  if (!matchTime) return false;
  // Only matches starting between 5-20 minutes from now (to avoid processing matches that might start during execution)
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
  return matchTime >= fiveMinutesFromNow && matchTime <= twentyMinutesFromNow;
});

console.log(`Found ${upcomingMatches.length} matches starting between 5-20 minutes from now`);

if (upcomingMatches.length > 0) {
  console.log("⏰ Upcoming matches within 5-20 minutes:");
  upcomingMatches.forEach((match, index) => {
    // Extract team names from various possible paths
    const homeTeam = match.homeTeamName || match.homeTeam?.name || match.event?.homeName || match.event?.homeTeam?.name || 'Unknown';
    const awayTeam = match.awayTeamName || match.awayTeam?.name || match.event?.awayName || match.event?.awayTeam?.name || 'Unknown';
    const league = match.leagueName || match.league?.name || match.tournament?.name || match.event?.tournament?.name || 'Unknown';

    const matchTime = coerceDate(match.matchDate || match.timestamp || match.start || match.startTimestamp || match.event?.start);
    const timeStr = matchTime ? matchTime.toLocaleTimeString('sv-SE', {
      timeZone: 'Europe/Stockholm',
      hour: '2-digit',
      minute: '2-digit'
    }) : 'Unknown';

    console.log(`  ${index + 1}. ${homeTeam} vs ${awayTeam} (${league}) - ${timeStr}`);
  });
  console.log("");
}

if (upcomingMatches.length === 0) {
  console.log("ℹ️ No matches starting within 5-20 minutes. Aborting closing odds capture.");
  process.exit(0);
}

// Proceed with closing odds capture for matches starting soon
console.log("✅ Found matches starting within 5-20 minutes. Proceeding with closing odds capture...\n");

await runBacktest({
  type: "closing",
  leagues: targetLeagues,
  snapshotLimit: 20,
});
