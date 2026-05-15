
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import {
  buildRapidContext,
  enrichMatchupsForDate,
  expandDateRange,
} from "../lib/matchupsEnrichment.js";

dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB ?? "app";

function resolveDateArg() {
  const arg = process.argv.find((value) => value.startsWith("--date="));
  if (arg) return arg.split("=", 2)[1];
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  if (!MONGODB_URI) throw new Error("MONGODB_URI missing");

  const dateArg = resolveDateArg();
  const dates = expandDateRange(dateArg);
  const rapidContext = buildRapidContext();

  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    for (const date of dates) {
      await enrichMatchupsForDate(db, date, rapidContext, { persistFiles: true, logger: console });
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("enrich-matchups-results failed:", error);
  process.exit(1);
});
