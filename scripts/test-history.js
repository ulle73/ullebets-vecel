/**
 * Simple test to show teamprofile history structure
 */
import clientPromise from '../lib/mongo.js';

const STAT_KEY_MAP = {
  totalShots: 'totalShotsOnGoal',
  shotsOnGoal: 'shotsOnGoal',
  cornerKicks: 'cornerKicks',
  yellowCards: 'yellowCards',
  offsides: 'offsides',
  fouls: 'fouls'
};

async function main() {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  
  // Get RB Leipzig home (first in top 20)
  const profile = await db.collection('teamprofiles').findOne({
    'meta.lagnamn': 'RB Leipzig',
    'meta.matchType': 'home'
  });
  
  if (!profile) {
    console.log('❌ Profile not found');
    await client.close();
    return;
  }
  
  console.log('✅ Found RB Leipzig home teamprofile\n');
  
  const prop = 'cornerKicks';
  const period = '1ST';
  const statKey = STAT_KEY_MAP[prop];
  
  console.log(`Looking for: ${prop} → ${statKey}, period: ${period}\n`);
  
  console.log('Profile structure:');
  console.log('- statistics exists:', !!profile.statistics);
  console.log('- statistics.for exists:', !!profile.statistics?.for);
  console.log('- statistics.for keys:', Object.keys(profile.statistics?.for || {}));
  
  const statObj = profile.statistics?.for?.[statKey];
  console.log(`\n${statKey} structure:`);
  console.log('- exists:', !!statObj);
  
  if (statObj) {
    console.log('- keys:', Object.keys(statObj));
    
    const periodObj = statObj[period];
    console.log(`\n${period} structure:`);
    console.log('- exists:', !!periodObj);
    
    if (periodObj) {
      console.log('- keys:', Object.keys(periodObj));
      console.log('- value:', periodObj.value);
      console.log('- history exists:', !!periodObj.history);
      console.log('- history length:', periodObj.history?.length || 0);
      
      if (periodObj.history && periodObj.history.length > 0) {
        console.log('\n✅ HISTORY FOUND!');
        console.log('Last 10:', periodObj.history.slice(-10));
        
        const leagueAvg = periodObj.value;
        const last10 = periodObj.history.slice(-10);
        const above = last10.filter(v => v > leagueAvg).length;
        const below = last10.filter(v => v < leagueAvg).length;
        
        console.log(`\nLeague avg: ${leagueAvg}`);
        console.log(`Above: ${above}/10`);
        console.log(`Below: ${below}/10`);
        console.log(`\nFor OVER edge, should show: ${above}/10`);
        console.log(`For UNDER edge, should show: ${below}/10`);
      }
    }
  }
  
  await client.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
