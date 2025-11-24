/**
 * Cleanup Script: Fix line values > 100 in unibet-backtest collection
 * 
 * This script fixes a bug where Unibet API sometimes sends line values in
 * integer format (500 instead of 5000) which should be divided by 1000.
 * 
 * The bug has been fixed in unibetOddsMapper.js, but we need to cleanup
 * existing bad data in MongoDB.
 */

import clientPromise from '../lib/mongo.js';

async function main() {
  console.log('🧹 Starting cleanup of line values > 100...\n');

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || 'app');
  const collection = db.collection('unibet-backtest');

  // Find all documents with at least one line > 100
  const docs = await collection.find({
    'lines': {
      $elemMatch: {
        'line': { $gt: 100 }
      }
    }
  }).toArray();

  console.log(`Found ${docs.length} documents with bad line values\n`);

  let totalFixed = 0;
  let totalDocs = 0;

  for (const doc of docs) {
    let fixedCount = 0;
    const updatedLines = doc.lines.map(line => {
      if (line.line > 100) {
        const oldValue = line.line;
        const newValue = Number((line.line / 1000).toFixed(1));
        
        console.log(`  Fixing: ${doc.homeTeam} vs ${doc.awayTeam}`);
        console.log(`    ${line.statKey} ${line.scope}/${line.period}: ${oldValue} → ${newValue}`);
        
        fixedCount++;
        return {
          ...line,
          line: newValue
        };
      }
      return line;
    });

    if (fixedCount > 0) {
      await collection.updateOne(
        { _id: doc._id },
        { $set: { lines: updatedLines } }
      );
      
      totalFixed += fixedCount;
      totalDocs++;
    }
  }

  console.log('\n📊 Cleanup Summary:');
  console.log(`  Documents updated: ${totalDocs}`);
  console.log(`  Lines fixed: ${totalFixed}`);

  await client.close();
  console.log('\n✅ Cleanup complete!');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
