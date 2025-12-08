/**
 * Validate LeagueAvg consistency
 * Find cases where primaryEv == evPctLeagueAvg, then compare snapshots[0] vs snapshots[last]
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.local' });

async function validateLeagueAvgConsistency() {
  console.log('🔍 Validating LeagueAvg consistency...\n');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI not found');
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  console.log('✅ Connected to MongoDB\n');

  const db = client.db(process.env.MONGODB_DB || 'app');

  // Find ai-generated-bets with snapshots
  const col = db.collection('ai-generated-bets');
  const docs = await col.find({
    'snapshots.1': { $exists: true } // Has at least 2 snapshots
  }).limit(100).toArray(); // Limit for testing

  console.log(`📊 Analyzing ${docs.length} matches...\n`);

  let totalComparisons = 0;
  let leagueAvgMatches = 0;
  let consistentPredictions = 0;
  let oddsDroppedWhenLeagueAvg = 0;
  let oddsDroppedWhenNotLeagueAvg = 0;

  for (const match of docs) {
    const snapshots = match.snapshots;
    if (!Array.isArray(snapshots) || snapshots.length < 2) continue;

    const openingSnapshot = snapshots[0];
    const closingSnapshot = snapshots[snapshots.length - 1];

    if (!openingSnapshot.lines?.length || !closingSnapshot.lines?.length) continue;

    for (const openingBet of openingSnapshot.lines) {
      const closingBet = closingSnapshot.lines.find(cb =>
        cb.statKey === openingBet.statKey &&
        cb.scope === openingBet.scope &&
        cb.period === openingBet.period &&
        cb.direction === openingBet.direction &&
        Math.abs(cb.line - openingBet.line) < 0.1
      );

      if (!closingBet) continue;

      const primaryEv = openingBet.primaryEv;
      const leagueAvgEv = openingBet.evPctLeagueAvg;

      if (primaryEv == null || leagueAvgEv == null) continue;

      totalComparisons++;

      // Check what SHOULD be primary for cornerKicks (LeagueAvg)
      const shouldBeLeagueAvg = openingBet.statKey === 'cornerKicks';

      if (shouldBeLeagueAvg) {
        leagueAvgMatches++;

        // Check odds movement
        const openingOdds = openingBet.odds;
        const closingOdds = closingBet.odds;

        if (openingOdds && closingOdds) {
          const oddsDropped = closingOdds < openingOdds;

          if (oddsDropped) {
            oddsDroppedWhenLeagueAvg++;
          }

          // Check if LeagueAvg prediction was correct for odds movement
          if ((leagueAvgEv > 0 && oddsDropped) || (leagueAvgEv <= 0 && !oddsDropped)) {
            consistentPredictions++;
          }
        }

        if (totalComparisons < 3) {
          console.log(`CornerKicks case (should use LeagueAvg):`);
          console.log(`  ${openingBet.statKey} ${openingBet.direction} ${openingBet.line}`);
          console.log(`  WAS primary: ${primaryEv.toFixed(3)}, SHOULD BE LeagueAvg: ${leagueAvgEv.toFixed(3)}`);
          console.log(`  Opening odds: ${openingBet.odds}, Closing odds: ${closingBet.odds}`);
          console.log(`  Odds dropped: ${closingOdds < openingBet.odds}`);
          console.log('');
        }
      } else {
        // Check odds movement for non-cornerKicks cases
        const openingOdds = openingBet.odds;
        const closingOdds = closingBet.odds;

        if (openingOdds && closingOdds && closingOdds < openingOdds) {
          oddsDroppedWhenNotLeagueAvg++;
        }
      }
    }
  }

  console.log('📊 LEAGUEAVG CONSISTENCY RESULTS:\n');
  console.log(`Total comparisons: ${totalComparisons}`);
  console.log(`LeagueAvg as primary: ${leagueAvgMatches} (${(leagueAvgMatches/totalComparisons*100).toFixed(1)}%)`);
  console.log(`Odds dropped when LeagueAvg primary: ${oddsDroppedWhenLeagueAvg} (${(oddsDroppedWhenLeagueAvg/leagueAvgMatches*100).toFixed(1)}%)`);
  console.log(`Odds dropped when not LeagueAvg: ${oddsDroppedWhenNotLeagueAvg} (${(oddsDroppedWhenNotLeagueAvg/(totalComparisons-leagueAvgMatches)*100).toFixed(1)}%)`);
  console.log(`Consistent predictions: ${consistentPredictions} (${(consistentPredictions/leagueAvgMatches*100).toFixed(1)}%)`);

  await client.close();
  console.log('\n✅ Validation complete!');
}

// Run if called directly
validateLeagueAvgConsistency()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });