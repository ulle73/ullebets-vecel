/**
 * Debug teamprofile history structure
 */
import clientPromise from '../lib/mongo.js';

async function main() {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  
  // Get Sevilla away teamprofile
  const profile = await db.collection('teamprofiles').findOne({
    'meta.lagnamn': { $regex: /^sevilla$/i },
    'meta.matchType': 'away'
  });
  
  if (!profile) {
    console.log('❌ No profile found for Sevilla away');
    return;
  }
  
  console.log('✅ Found Sevilla away teamprofile\n');
  console.log('Profile structure:');
  console.log('meta:', profile.meta);
  console.log('\nstatistics.for keys:', Object.keys(profile.statistics.for));
  
  // Check cornerKicks
  const cornerKicks = profile.statistics.for.cornerKicks;
  console.log('\ncornerKicks structure:', Object.keys(cornerKicks));
  
  // Check 1ST period
  const first = cornerKicks['1ST'];
  console.log('\n1ST period:', first);
  
  if (first && first.history) {
    console.log('\n✅ History found!');
    console.log('History length:', first.history.length);
    console.log('Last 10 values:', first.history.slice(-10));
    console.log('League avg:', first.value);
    
    const leagueAvg = first.value;
    const last10 = first.history.slice(-10);
    const above = last10.filter(v => v > leagueAvg).length;
    const below = last10.filter(v => v < leagueAvg).length;
    
    console.log(`\nCalc: ${above} above, ${below} below league avg (${leagueAvg})`);
    console.log(`Should show: ${above}/${last10.length} for Over edge OR ${below}/${last10.length} for Under edge`);
  } else {
    console.log('\n❌ No history found in 1ST period');
    console.log('Full 1ST object:', JSON.stringify(first, null, 2));
  }
  
  await client.close();
}

main().catch(console.error);
