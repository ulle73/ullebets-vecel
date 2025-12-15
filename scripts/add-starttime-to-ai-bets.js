/**
 * Add startTime field retroactively to all ai-generated-bets documents
 *
 * This script finds all documents in ai-generated-bets that don't have startTime,
 * looks up the match data using matchId, and adds the startTime field.
 *
 * Usage:
 *   node scripts/add-starttime-to-ai-bets.js
 */

import clientPromise from '../lib/mongo.js';
import { coerceDate } from '../lib/utils/date.js';

const DB = process.env.MONGODB_DB || 'app';

async function addStartTimeToAIBets() {
  console.log('🔄 Starting to add startTime to ai-generated-bets documents...\n');

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || 'app');
  const collection = db.collection('ai-generated-bets');

  // Find all documents that don't have startTime OR have startTime at midnight (wrong value)
  const documentsToFix = await collection
    .find({
      $or: [
        { startTime: { $exists: false } },
        { startTime: { $gte: new Date('2025-01-01T00:00:00.000Z'), $lt: new Date('2025-12-31T00:00:01.000Z') } }
      ]
    })
    .toArray();

  console.log(`📊 Found ${documentsToFix.length} documents that need startTime fixes\n`);

  if (documentsToFix.length === 0) {
    console.log('✅ All documents have correct startTime. Nothing to do.');
    return;
  }

  let updatedCount = 0;
  let errorCount = 0;

  for (const doc of documentsToFix) {
    try {
      const matchId = doc.matchId;

      if (!matchId) {
        console.warn(`⚠️ Document ${doc._id} missing matchId, skipping`);
        continue;
      }

      console.log(`🔍 Looking up matchId ${matchId} in teamstats for ${doc._id}`);

      // Find match in teamstats collection (try both string and number)
      const matchIdCandidates = [String(matchId)];
      if (!isNaN(Number(matchId))) {
        matchIdCandidates.push(Number(matchId));
      }

      const teamstatsDoc = await client.db(DB).collection('teamstats').findOne(
        { 'full.matchId': { $in: matchIdCandidates } },
        { projection: { full: { $elemMatch: { matchId: { $in: matchIdCandidates } } } } }
      );

      if (!teamstatsDoc?.full?.[0]) {
        console.warn(`⚠️ Match ${matchId} not found in teamstats`);
        continue;
      }

      const match = teamstatsDoc.full[0];
      const timestamp = match.timestamp;

      if (!timestamp) {
        console.warn(`⚠️ No timestamp found for match ${matchId}`);
        continue;
      }

      // Convert timestamp to Date object
      const startTime = coerceDate(timestamp);

      if (!startTime) {
        console.warn(`⚠️ Could not parse timestamp ${timestamp} for match ${matchId}`);
        continue;
      }

      console.log(`✅ Found startTime for ${doc._id}: ${startTime.toISOString()}`);

      // Update the document with both timestamp and startTime
      const updateResult = await collection.updateOne(
        { _id: doc._id },
        { $set: { timestamp, startTime } }
      );

      if (updateResult.modifiedCount > 0) {
        updatedCount++;
      } else {
        console.warn(`⚠️ No document updated for ${doc._id}`);
      }

    } catch (error) {
      console.error(`❌ Error updating document ${doc._id}:`, error.message);
      errorCount++;
    }
  }

  console.log(`\n📈 Summary:`);
  console.log(`   ✅ Updated: ${updatedCount} documents`);
  console.log(`   ❌ Errors: ${errorCount} documents`);
  console.log(`   📊 Total processed: ${documentsToFix.length} documents`);

  if (updatedCount > 0) {
    console.log('\n🎉 Successfully added startTime to existing ai-generated-bets documents!');
  }

  await client.close();
}

addStartTimeToAIBets().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});