import { fetchTeamMatches } from "./lib/backtest/data.js";

async function run() {
  try {
    console.log("Fetching matches for Arsenal...");
    const matches = await fetchTeamMatches("Arsenal", "home");
    console.log(`Successfully fetched ${matches.length} matches.`);
    if (matches.length > 0) {
      console.log("First match date:", matches[0].date || matches[0].matchDate);
    }
  } catch (err) {
    console.error("Error fetching matches:", err);
  }
}

run();
