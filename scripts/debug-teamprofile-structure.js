/**
 * Debug teamprofile structure to fix bulk write filter
 */
import clientPromise from '../lib/mongo.js';

async function main() {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  
  // Get a sample teamprofile
  const sample = await db.collection('teamprofiles').findOne({});
  
  console.log('Sample teamprofile structure:\n');
  console.log('meta keys:', Object.keys(sample.meta));
  console.log('meta:', JSON.stringify(sample.meta, null, 2));
  
  // Check if teamId exists
  console.log('\nTeamId field:', sample.meta.teamId);
  console.log('MatchType field:', sample.meta.matchType);
  console.log('Lagnamn field:', sample.meta.lagnamn);
  
  // Count teamprofiles by matchType
  const homeCoun = await db.collection('teamprofiles').countDocuments({ 'meta.matchType': 'home' });
  const awayCount = await db.collection('teamprofiles').countDocuments({ 'meta.matchType': 'away' });
  
  console.log(`\nTeamprofiles by matchType:`);
  console.log(`  home: ${homeCount}`);
  console.log(`  away: ${awayCount}`);
  
  await client.close();
}

main().catch(console.error);
