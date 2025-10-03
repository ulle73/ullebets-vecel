import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { MongoClient } from "mongodb";
const client = new MongoClient(process.env.MONGODB_URI);

const run = async () => {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "app");
  const col = db.collection("teamstats");
  const n = await col.estimatedDocumentCount();
  console.log("teamstats documents:", n);
  await client.close();
};
run().catch(e => { console.error(e); process.exit(1); });
