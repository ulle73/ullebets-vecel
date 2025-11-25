import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "app";

async function run() {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI is missing");
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    const col = db.collection("ai-generated-bets");

    // Index to speed corrections and lookups by source + matchId
    await col.createIndex(
      { source: 1, "lines.matchId": 1 },
      { name: "source_lines_matchId" }
    );

    console.log("Created index source_lines_matchId on ai-generated-bets");
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error("Fatal error creating indexes:", err);
  process.exit(1);
});
