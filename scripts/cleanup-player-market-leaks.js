import clientPromise from "../lib/mongo.js";
import { isLikelyPlayerMarketLeak } from "../lib/autoAnalysis/marketValidity.js";

const DB_NAME = process.env.MONGODB_DB || "app";

const EMBEDDED_SHORTLIST_COLLECTIONS = [
  "analysis-snapshots",
  "auto-analysis-runs",
];

const FLAT_BET_COLLECTIONS = [
  "closing-line-tracking",
  "auto-analysis-bets",
  "result-loop-bets",
  "watchlist-items",
];

function hasLeakedBet(bet = {}) {
  return isLikelyPlayerMarketLeak(bet);
}

async function cleanupEmbeddedShortlists(db, collectionName) {
  const collection = db.collection(collectionName);
  const docs = await collection.find(
    {
      shortlist: {
        $elemMatch: {
          "bet.scope": "total",
          "bet.period": "ALL",
          "bet.statKey": { $in: ["totalShots", "shotsOnGoal"] },
          "bet.line": { $lt: 10 },
        },
      },
    },
    {
      projection: { shortlist: 1 },
    }
  ).toArray();

  let docsUpdated = 0;
  let rowsRemoved = 0;

  for (const doc of docs) {
    const shortlist = Array.isArray(doc?.shortlist) ? doc.shortlist : [];
    const cleaned = shortlist.filter((item) => !hasLeakedBet(item?.bet));
    const removed = shortlist.length - cleaned.length;
    if (!removed) continue;

    await collection.updateOne(
      { _id: doc._id },
      { $set: { shortlist: cleaned } }
    );

    docsUpdated += 1;
    rowsRemoved += removed;
  }

  return { collectionName, docsUpdated, rowsRemoved };
}

async function cleanupFlatBetDocs(db, collectionName) {
  const collection = db.collection(collectionName);
  const docs = await collection.find(
    {
      "bet.scope": "total",
      "bet.period": "ALL",
      "bet.statKey": { $in: ["totalShots", "shotsOnGoal"] },
      "bet.line": { $lt: 10 },
    },
    {
      projection: { _id: 1, bet: 1 },
    }
  ).toArray();

  const leakedIds = docs
    .filter((doc) => hasLeakedBet(doc?.bet))
    .map((doc) => doc._id);

  if (!leakedIds.length) {
    return { collectionName, docsDeleted: 0 };
  }

  const result = await collection.deleteMany({ _id: { $in: leakedIds } });
  return {
    collectionName,
    docsDeleted: result.deletedCount || 0,
  };
}

async function main() {
  const client = await clientPromise;
  const db = client.db(DB_NAME);

  const embeddedResults = [];
  for (const collectionName of EMBEDDED_SHORTLIST_COLLECTIONS) {
    embeddedResults.push(await cleanupEmbeddedShortlists(db, collectionName));
  }

  const flatResults = [];
  for (const collectionName of FLAT_BET_COLLECTIONS) {
    flatResults.push(await cleanupFlatBetDocs(db, collectionName));
  }

  console.log(JSON.stringify({
    database: DB_NAME,
    embeddedResults,
    flatResults,
  }, null, 2));

  await client.close();
}

main().catch((error) => {
  console.error("[cleanup-player-market-leaks] failed:", error);
  process.exitCode = 1;
});
