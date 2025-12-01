
import { readSnapshotDocument } from './lib/repos/snapshots.js';

async function check() {
  // Use a slug from the previous run output
  // e.g. "brentford-burnley-2025-11-29" (assuming date is part of slug)
  // Wait, the slug format is home-away-date.
  // Let's try to find one.
  
  const collection = "unibet-backtest";
  // We need a valid ID. I'll try to list one or guess one.
  // Let's try to find ANY document.
  
  const { clientPromise } = await import('./lib/db.js');
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || 'app');
  const col = db.collection(collection);
  
  const doc = await col.findOne({ matchDate: "2025-11-29" });
  
  if (!doc) {
    console.log("No documents found in collection:", collection);
  } else {
    console.log("Document ID:", doc._id);
    console.log("Root fields:", Object.keys(doc));
    console.log("Root lines count:", doc.lines?.length);
    console.log("Snapshots count:", doc.snapshots?.length);
    if (doc.snapshots?.length > 0) {
      console.log("First snapshot keys:", Object.keys(doc.snapshots[0]));
      console.log("First snapshot type:", doc.snapshots[0].type);
      console.log("First snapshot horizonDays:", doc.snapshots[0].horizonDays);
      console.log("First snapshot runDate:", doc.snapshots[0].runDate);
      console.log("First snapshot lines count:", doc.snapshots[0].lines?.length);
      
      if (doc.snapshots.length > 1) {
         console.log("Last snapshot type:", doc.snapshots[doc.snapshots.length-1].type);
         console.log("Last snapshot runDate:", doc.snapshots[doc.snapshots.length-1].runDate);
      }
    }
  }
  
  process.exit(0);
}

check();
