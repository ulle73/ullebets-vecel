import { fetchTeamMatches } from "./lib/backtest/data.js";

async function run() {
  try {
    const matches = await fetchTeamMatches("Arsenal", "home", { limit: 1 });
    if (matches.length > 0) {
      console.log("Match Object Keys:", Object.keys(matches[0]));
      console.log("Match Date Fields:", {
        date: matches[0].date,
        matchDate: matches[0].matchDate,
        timestamp: matches[0].timestamp,
        kickoff: matches[0].kickoff
      });
      console.log("Full Object:", JSON.stringify(matches[0], null, 2));
    }
  } catch (err) {
    console.error(err);
  }
}

run();
