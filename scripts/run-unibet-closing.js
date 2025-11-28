import { runBacktest } from "../lib/runners/backtest-runner.js";
import { clientPromise } from "../lib/db.js";

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

// No league filter = fetch all matches for the day
await runBacktest({
  type: "closing",
  leagues: targetLeagues,
  snapshotLimit: 5,
});
