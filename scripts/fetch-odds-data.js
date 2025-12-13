import { clientPromise } from "../lib/db.js";

const client = await clientPromise;
const db = client.db(process.env.MONGODB_DB || 'app');
const collection = db.collection(process.env.BACKTEST_COLLECTION || "unibet-backtest");

// Query for documents where at least one line has odds between 1.8 and 2.2
const query = {
  lines: {
    $elemMatch: {
      odds: { $gte: 1.8, $lte: 2.2 }
    }
  }
};

console.log("Fetching all documents with odds between 1.8 and 2.2...");

const documents = await collection.find(query).toArray();

console.log(`Found ${documents.length} documents matching the criteria.`);

// Count team occurrences
const teamCounts = {};

// Count team+statkey+scope+period combinations
const comboCounts = {};

for (const doc of documents) {
  const homeTeam = doc.homeTeam;
  const awayTeam = doc.awayTeam;

  // Count teams
  if (homeTeam) {
    teamCounts[homeTeam] = (teamCounts[homeTeam] || 0) + 1;
  }
  if (awayTeam) {
    teamCounts[awayTeam] = (teamCounts[awayTeam] || 0) + 1;
  }

  // Count combos from lines with odds in range
  for (const line of doc.lines || []) {
    const odds = Number(line.odds);
    if (odds >= 1.8 && odds <= 2.2) {
      const statKey = line.statKey;
      const scope = line.scope;
      const period = line.period;

      let team = null;
      if (scope === 'home') {
        team = homeTeam;
      } else if (scope === 'away') {
        team = awayTeam;
      } else if (scope === 'total') {
        // For total, count for both teams
        team = `${homeTeam}+${awayTeam}`;
      }

      if (team && statKey && scope && period) {
        const comboKey = `${team}|${statKey}|${scope}|${period}`;
        comboCounts[comboKey] = (comboCounts[comboKey] || 0) + 1;
      }
    }
  }
}

// Find the team with the most occurrences
let maxCount = 0;
let topTeam = null;

for (const [team, count] of Object.entries(teamCounts)) {
  if (count > maxCount) {
    maxCount = count;
    topTeam = team;
  }
}

console.log(`\nTeam with the most occurrences: ${topTeam} (${maxCount} times)`);

// Optional: Show top 10 teams
const sortedTeams = Object.entries(teamCounts)
  .sort(([,a], [,b]) => b - a)
  .slice(0, 10);

console.log("\nTop 10 teams by occurrence:");
sortedTeams.forEach(([team, count], index) => {
  console.log(`${index + 1}. ${team}: ${count}`);
});

// Show top 20 combos
const sortedCombos = Object.entries(comboCounts)
  .sort(([,a], [,b]) => b - a)
  .slice(0, 20);

console.log("\nTop 20 team+statkey+scope+period combos by occurrence:");
sortedCombos.forEach(([combo, count], index) => {
  const [team, statKey, scope, period] = combo.split('|');
  console.log(`${index + 1}. ${team} | ${statKey} | ${scope} | ${period}: ${count}`);
});