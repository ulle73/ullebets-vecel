import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import clientPromise from "../lib/mongo.js";
import dotenv from "dotenv";


if (!process.env.VERCEL) {
  dotenv.config({ path: ".env.local" });
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const col = db.collection("teamstats");

  const folder = path.join(__dirname, "../data/teamstats");
  const files = fs.readdirSync(folder).filter(f => f.endsWith(".json"));

  console.log(`📂 Hittade ${files.length} filer i teamstats/`);

  const ops = [];

  for (const file of files) {
    const filepath = path.join(folder, file);
    const raw = fs.readFileSync(filepath, "utf8");
    if (!raw.trim()) {
      console.log(`⚠️ Tom fil: ${file}`);
      continue;
    }

    let doc;
    try {
      doc = JSON.parse(raw);         // <-- dina filer är ett enda objekt
    } catch (e) {
      console.error(`❌ JSON-fel i ${file}:`, e.message);
      continue;
    }

    // Plocka ut ett stabilt matchId (finns i dina filer)
    const matchId =
      doc.matchId ??
      doc.full?.[0]?.matchId ??
      doc.incidents?.matchId ??
      null;

    if (!matchId) {
      console.warn(`⚠️ matchId saknas i ${file} – hoppar över`);
      continue;
    }

    // metadata + deterministiskt _id för att undvika dubletter
    doc._importMeta = {
      sourceFile: file,
      importedAt: new Date(),
    };

    ops.push({
      updateOne: {
        filter: { _id: String(matchId) },          // unikt per match
        update: { $set: { ...doc, _id: String(matchId) } },
        upsert: true,
      },
    });

    // Skicka i batchar om många filer
    if (ops.length >= 500) {
      await col.bulkWrite(ops, { ordered: false });
      ops.length = 0;
      console.log("✅ 500 upserts skrivna…");
    }
  }

  if (ops.length) {
    await col.bulkWrite(ops, { ordered: false });
  }

  // Index för snabba sökningar
  await col.createIndex({ _id: 1 });
  await col.createIndex({ "full.matchId": 1 });
  await col.createIndex({ "full.0.homeTeamId": 1, "full.0.awayTeamId": 1 });

  console.log("🎉 Import klar");
  process.exit(0);
}

run().catch(err => {
  console.error("Importfel:", err);
  process.exit(1);
});
