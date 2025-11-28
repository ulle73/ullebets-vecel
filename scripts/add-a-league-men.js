/**
 * Upserts A-League Men into the leagues-and-teams document with _id 68dfad34e65ff6006c3a5a91.
 *
 * Usage:
 *   node scripts/add-a-league-men.js
 *
 * Needs .env.local with MONGODB_URI (and optional MONGODB_DB).
 */

import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "leages-and-teams";
const TARGET_ID = "68dfad34e65ff6006c3a5a91";

const leaguePayload = {
  leagueId: 136,
  country: "Australia",
  seasonId: 82603,
  groupId: 1000182606,
  categoryId: 34,
  teams: [
    {
      name: "Melbourne City",
      id: 42210,
      slug: "melbourne-city",
      imageUrl: "/images/teams/42210.png",
      optaId: 5664,
      optaRank: 725,
      optaRating: 71.0212251922,
    },
    {
      name: "Wellington Phoenix",
      id: 7568,
      slug: "wellington-phoenix",
      imageUrl: "/images/teams/7568.png",
      optaId: 2655,
      optaRank: 1565,
      optaRating: 64.7544061041,
    },
    {
      name: "Auckland FC",
      id: 800224,
      slug: "auckland-fc",
      imageUrl: "/images/teams/800224.png",
      optaId: 21568,
      optaRank: 884,
      optaRating: 69.5826149812,
    },
    {
      name: "Newcastle Jets",
      id: 2934,
      slug: "newcastle-jets",
      imageUrl: "/images/teams/2934.png",
      optaId: 2319,
      optaRank: 1394,
      optaRating: 65.7341313455,
    },
    {
      name: "Sydney FC",
      id: 5971,
      slug: "sydney-fc",
      imageUrl: "/images/teams/5971.png",
      optaId: 1962,
      optaRank: 916,
      optaRating: 69.2798798422,
    },
    {
      name: "Adelaide United",
      id: 2946,
      slug: "adelaide-united",
      imageUrl: "/images/teams/2946.png",
      optaId: 2309,
      optaRank: 1364,
      optaRating: 65.8944923212,
    },
    {
      name: "Brisbane Roar",
      id: 5968,
      slug: "brisbane-roar",
      imageUrl: "/images/teams/5968.png",
      optaId: 2248,
      optaRank: 2130,
      optaRating: 62.2160273055,
    },
    {
      name: "Macarthur FC",
      id: 371682,
      slug: "macarthur-fc",
      imageUrl: "/images/teams/371682.png",
      optaId: 15049,
      optaRank: 1347,
      optaRating: 66.1129589015,
    },
    {
      name: "Central Coast Mariners",
      id: 5966,
      slug: "central-coast-mariners",
      imageUrl: "/images/teams/5966.png",
      optaId: 1988,
      optaRank: 1572,
      optaRating: 64.7076802558,
    },
    {
      name: "Western Sydney Wanderers",
      id: 72926,
      slug: "western-sydney-wanderers",
      imageUrl: "/images/teams/72926.png",
      optaId: 7062,
      optaRank: 976,
      optaRating: 68.797515713,
    },
    {
      name: "Melbourne Victory",
      id: 5970,
      slug: "melbourne-victory",
      imageUrl: "/images/teams/5970.png",
      optaId: 2237,
      optaRank: 1041,
      optaRating: 68.2688261467,
    },
    {
      name: "Perth Glory",
      id: 2945,
      slug: "perth-glory",
      imageUrl: "/images/teams/2945.png",
      optaId: 989,
      optaRank: 2821,
      optaRating: 60.1515998498,
    },
  ],
  imageUrl: "/images/league/a-league-men.png",
};

async function run() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI saknas i .env.local");
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    const col = db.collection(COLLECTION);
    const filter = { _id: new ObjectId(TARGET_ID) };
    const update = { $set: { "A-League Men": leaguePayload } };

    const res = await col.updateOne(filter, update, { upsert: false });

    if (res.matchedCount === 0) {
      console.warn(`⚠️ Hittade inget dokument med _id=${TARGET_ID} i ${COLLECTION}. Ingen ändring gjordes.`);
      return;
    }

    if (res.modifiedCount) {
      console.log(`🔄 Uppdaterade A-League Men i dokumentet ${TARGET_ID} (${COLLECTION}).`);
    } else {
      console.log(`ℹ️ Inga ändringar – A-League Men var redan identisk i dokumentet ${TARGET_ID}.`);
    }
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error("❌ Misslyckades att skriva till leagues-and-teams:", err);
  process.exit(1);
});
