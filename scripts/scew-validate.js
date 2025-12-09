import clientPromise from '../lib/mongo.js';

async function main() {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");

  // Fetch teamprofiles
  const teamProfiles = await db.collection('teamprofiles').find({
    'meta.lagnamn': process.argv[2] || 'Sunderland'
  }).toArray();

  const teamName = process.argv[2] || 'Sunderland';
  console.log(`Found ${teamProfiles.length} ${teamName} profiles`);

  // Count backtests with team cornerKicks
  const backtests = await db.collection('unibet-backtest').find({}).toArray();
  let count = 0;
  for (const bt of backtests) {
    if (!bt.lines) continue;
    const hasTeam = bt.homeTeam === teamName || bt.awayTeam === teamName;
    const hasCorners = bt.lines.some(l => l.statKey === 'cornerKicks' && l.scope === 'total');
    if (hasTeam && hasCorners) count++;
  }
  console.log(`Backtests with ${teamName} cornerKicks total: ${count}`);

  for (const profile of teamProfiles) {
    const type = profile.meta.matchType; // home or away
    console.log(`\n${type.toUpperCase()} matches:`);
    const yellowCards = profile.statistics.for.yellowCards.ALL;
    const cornerKicks = profile.statistics.for.cornerKicks.ALL;
    console.log(`League avg: ${cornerKicks.value}`);
    console.log('Match | Date | Corner Kicks');
    console.log('-'.repeat(30));
    for (const match of cornerKicks.history) {
      console.log(`${match.matchId} | ${match.date} | ${match.val}`);
    }
  }

  await client.close();
}

main().catch(console.error);