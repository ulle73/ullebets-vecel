import { fetchTeamMatches } from "./lib/backtest/data.js";

async function inspectMatchData() {
  const matches = await fetchTeamMatches("Arsenal", "home", { limit: 1 });
  
  if (matches.length > 0 && matches[0].matchDetails?.statistics?.[0]?.groups) {
    const groups = matches[0].matchDetails.statistics[0].groups;
    
    console.log("Available stats in match data:\n");
    
    for (const group of groups) {
      console.log(`\nGroup: ${group.groupName}`);
      console.log("Keys:");
      group.statisticsItems?.forEach(item => {
        console.log(`  - ${item.key}`);
      });
    }
  }
}

inspectMatchData();
