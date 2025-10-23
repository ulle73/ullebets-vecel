// file: scripts/import-teamstats-per-file.js
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: ".env.local" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isHomeFile(name) {
  return /_home_match_stats\.json$/i.test(name);
}
function isAwayFile(name) {
  return /_away_match_stats\.json$/i.test(name);
}
function basename(p) {
  return p.replace(/\\/g, "/").split("/").pop() || p;
}

async function readJsonSafe(fp) {
  const text = await fs.readFile(fp, "utf-8");
  return JSON.parse(text);
}

function extractFullArray(json, file) {
  if (Array.isArray(json?.full)) return json.full;
  if (Array.isArray(json?.matches)) return json.matches; // fallback
  throw new Error(`Ingen 'full' array i ${file}`);
}

function extractTeamIdentity(fullArray, role, file) {
  for (const m of fullArray) {
    if (role === "home" && m?.homeTeamId != null)
      return {
        teamId: String(m.homeTeamId),
        teamName: m?.homeTeamName ?? null,
      };
    if (role === "away" && m?.awayTeamId != null)
      return {
        teamId: String(m.awayTeamId),
        teamName: m?.awayTeamName ?? null,
      };
  }
  throw new Error(`Kunde inte extrahera ${role}TeamId från ${file}`);
}

// Unik nyckel per match: primärt matchId; fallback: enkel signatur
const matchKey = (m) => {
  const primary = m?.matchId ?? m?.id ?? m?.eventId;
  if (primary != null) {
    return String(primary);
  }
  return `${m?.homeTeamName || ""}__${m?.awayTeamName || ""}__${
    m?.timestamp || m?.startTimestamp || m?.date || ""
  }`;
};

// Dedup inom en lista
function dedup(list = []) {
  const seen = new Set();
  const out = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    const k = matchKey(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out.reverse();
}

/**
 * Index:
 *  - unique på _importMeta.sourceFile  → ett dokument per fil (home/away separata)
 *  - icke-unik på _importMeta.teamId   → sökbart per team
 *  - index på full.matchId             → snabba uppslag på matcher
 */
async function ensureIndexes(col) {
  const existing = await col.indexes();
  const have = new Set(existing.map((ix) => ix.name));
  const toCreate = [];

  if (!have.has("idx_sourceFile_unique")) {
    toCreate.push({
      name: "idx_sourceFile_unique",
      key: { "_importMeta.sourceFile": 1 },
      unique: true,
    });
  }
  if (!have.has("idx_teamId")) {
    toCreate.push({
      name: "idx_teamId",
      key: { "_importMeta.teamId": 1 },
    });
  }
  if (!have.has("idx_full_matchId")) {
    toCreate.push({
      name: "idx_full_matchId",
      key: { "full.matchId": 1 },
      sparse: true,
    });
  }

  if (toCreate.length) {
    await col.createIndexes(toCreate);
  }
}

async function main() {
  const ROOT = process.cwd();
  const folder = path.resolve(ROOT, "data", "teamstats");
  if (!existsSync(folder)) throw new Error(`Hittar inte mapp: ${folder}`);

  const files = (await fs.readdir(folder))
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .sort();

  if (!files.length) throw new Error("Inga .json-filer i data/teamstats");

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "app";
  if (!uri) throw new Error("MONGODB_URI saknas i .env.local");

  const client = new MongoClient(uri);
  await client.connect();
  await client.db(dbName).admin().ping();
  const col = client.db(dbName).collection("teamstats");

  console.log("────────────────────────────────────────────────────────");
  console.log(`📂 Katalog: ${folder}`);
  console.log(`🗃  DB: ${dbName}.teamstats`);
  console.log(`📄 Filer: ${files.length}`);
  console.log("────────────────────────────────────────────────────────");

  let upserted = 0,
    updated = 0,
    skipped = 0,
    failed = 0;

  for (const file of files) {
    const sourceFile = basename(file);
    const role = isHomeFile(sourceFile)
      ? "home"
      : isAwayFile(sourceFile)
      ? "away"
      : null;

    if (!role) {
      console.warn(`⏭️  Hoppar (okänd roll): ${sourceFile}`);
      skipped++;
      continue;
    }

    try {
      const json = await readJsonSafe(path.join(folder, file));
      const fullIncomingRaw = extractFullArray(json, sourceFile);
      const fullIncoming = dedup(fullIncomingRaw);
      const { teamId, teamName } = extractTeamIdentity(
        fullIncoming,
        role,
        sourceFile
      );
      const nowIso = new Date().toISOString();

      // Upsert PER FIL (separata dokument för home/away även om teamId är samma)
      const filter = { "_importMeta.sourceFile": sourceFile };

      // Hämta befintligt dokument för just denna fil
      const existing = await col.findOne(filter, {
        projection: { _id: 0, full: 1 },
      });

      const existingFull = Array.isArray(existing?.full) ? existing.full : [];
      let changed = existingFull.length === 0;
      if (!changed && existingFull.length) {
        const uniqueCount = new Set(existingFull.map((m) => matchKey(m))).size;
        if (uniqueCount !== existingFull.length) {
          changed = true;
        }
      }

      const base = [];
      const keyToIndex = new Map();
      for (const match of existingFull) {
        const key = matchKey(match);
        if (keyToIndex.has(key)) {
          changed = true;
          continue;
        }
        keyToIndex.set(key, base.length);
        base.push(match);
      }

      for (const match of fullIncoming) {
        const key = matchKey(match);
        if (keyToIndex.has(key)) {
          const idx = keyToIndex.get(key);
          const prev = base[idx];
          const prevJson = JSON.stringify(prev);
          const nextJson = JSON.stringify(match);
          if (prevJson !== nextJson) {
            base[idx] = match;
            changed = true;
          }
        } else {
          keyToIndex.set(key, base.length);
          base.push(match);
          changed = true;
        }
      }

      const nextFull = base;
      if (!changed) {
        console.log(`⏭️  Oförändrat (0 nya matcher): ${sourceFile}`);
        skipped++;
        continue;
      }

      const res = await col.updateOne(
        filter,
        {
          $set: {
            full: nextFull,
            "_importMeta.sourceFile": sourceFile,
            "_importMeta.importedAt": nowIso,
            "_importMeta.teamId": teamId != null ? String(teamId) : null,
            "_importMeta.teamName": teamName ?? null,
            "_importMeta.teamRole": role,
          },
          $setOnInsert: { createdAt: nowIso },
        },
        { upsert: true }
      );

      if (res.upsertedCount) {
        upserted++;
        console.log(
          `🆕 ${sourceFile} → teamId=${teamId} (full=${nextFull.length})`
        );
      } else {
        updated++;
        console.log(
          `✅ ${sourceFile} → teamId=${teamId} (full=${nextFull.length})`
        );
      }
    } catch (e) {
      failed++;
      console.warn(`⚠️  ${sourceFile}: ${e.message}`);
    }
  }

  await ensureIndexes(col);
  const total = await col.countDocuments();
  await client.close(true);

  console.log("────────────────────────────────────────────────────────");
  console.log(
    `🆕 Upserted: ${upserted}   ♻️ Updated: ${updated}   ⏭️ Skipped: ${skipped}   ❌ Failed: ${failed}`
  );
  console.log(`📊 Totalt i ${dbName}.teamstats: ${total} dokument`);
  console.log("Done.");
}

main().catch((e) => {
  console.error("❌ Fatal:", e);
  process.exit(1);
});
