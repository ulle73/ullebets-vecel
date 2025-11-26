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
    const col = db.collection("teamstats");

    await col.createIndex(
      { "full.matchId": 1, "_importMeta.teamRole": 1 },
      { name: "full_matchId_role" }
    );

    // Also index numeric/string together via sparse compound
    await col.createIndex(
      { "_importMeta.teamRole": 1, "full.matchId": 1 },
      { name: "role_full_matchId" }
    );

    console.log("Created index full_matchId_role on teamstats");
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error("Fatal error creating indexes:", err);
  process.exit(1);
});
