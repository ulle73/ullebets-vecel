import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// Direct API test for Genoa vs other teams
async function testTeamStatsAPI(teamName) {
  console.log(`\n=== Testing API for ${teamName} ===`);

  try {
    const response = await fetch('http://localhost:3000/api/backtest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'team-stats',
        teamName: teamName,
        matchType: 'all'
      })
    });

    const data = await response.json();

    console.log(`Status: ${response.status}`);
    console.log(`Matches returned: ${data.matches?.length || 0}`);

    if (data.matches && data.matches.length > 0) {
      const matchesWithOdds = data.matches.filter(match => {
        // Check if match has odds in full.varje
        return match.full?.varje?.odds;
      });

      console.log(`Matches with odds in full.varje: ${matchesWithOdds.length}`);

      if (matchesWithOdds.length > 0) {
        console.log('Sample match with odds:');
        console.log(JSON.stringify(matchesWithOdds[0].full.varje.odds, null, 2));
      } else {
        console.log('Sample match structure:');
        console.log(JSON.stringify(data.matches[0], null, 2).slice(0, 1000));
      }
    }

  } catch (error) {
    console.error(`Error testing ${teamName}:`, error.message);
  }
}

async function runTests() {
  await testTeamStatsAPI('Genoa');
  await testTeamStatsAPI('Sassuolo');
  await testTeamStatsAPI('Juventus');
}

runTests();