// file: scripts/check-teamstats-in-db-smart.js
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

if (!process.env.VERCEL) {
  dotenv.config({ path: ".env.local" });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function stripDiacritics(s) {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function punctNormalize(s) {
  // normalisera path/filnamn till "sluggigt" format
  return s
    .replace(/\\/g, "/")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // diakritik
    .replace(/&/g, "and")
    .replace(/[^a-z0-9._/]+/g, "_") // ersätt “allt” med underscore men behåll . _ /
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function basename(p) {
  return p.replace(/\\/g, "/").split("/").pop() || p;
}

function buildKeysFor(value) {
  const vPath = value.replace(/\\/g, "/");
  const vBase = basename(vPath);

  const keys = new Map();

  // 1) exakta
  keys.set("exact:path", vPath);
  keys.set("exact:base", vBase);

  // 2) lower
  keys.set("lower:path", vPath.toLowerCase());
  keys.set("lower:base", vBase.toLowerCase());

  // 3) diakritik bort
  keys.set("ascii:path", stripDiacritics(vPath.toLowerCase()));
  keys.set("ascii:base", stripDiacritics(vBase.toLowerCase()));

  // 4) punct-normalized
  keys.set("norm:path", punctNormalize(vPath));
  keys.set("norm:base", punctNormalize(vBase));

  return keys;
}

async function main() {
  const ROOT = process.cwd();
  const folder = path.resolve(ROOT, "data", "teamstats");

  const diskFiles = (await fs.readdir(folder)).filter((f) =>
    f.toLowerCase().endsWith(".json")
  );
  if (!diskFiles.length) {
    console.error(`⚠️  Inga .json-filer hittades i ${folder}`);
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ MONGODB_URI saknas (.env.local).");
    process.exit(1);
  }
  const dbName = process.env.MONGODB_DB || "app";
  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db(dbName).collection("teamstats");

  // Hämta ALLA sourceFile (effektivt nog för rimliga storlekar)
  const docs = await col
    .find({}, { projection: { _id: 1, "_importMeta.sourceFile": 1 } })
    .toArray();

  // Bygg index över många normaliseringsnycklar på DB-sidan
  const index = new Map(); // key -> array of { _id, sourceFile, rule }
  function addIndex(key, rule, doc) {
    const arr = index.get(key) || [];
    arr.push({
      _id: doc._id,
      sourceFile: doc._importMeta?.sourceFile ?? "",
      rule,
    });
    index.set(key, arr);
  }

  for (const d of docs) {
    const sfRaw = String(d?._importMeta?.sourceFile ?? "").trim();
    if (!sfRaw) continue;

    const dbKeys = buildKeysFor(sfRaw);
    // Lägg in samtliga nycklar
    for (const [rule, keyVal] of dbKeys.entries()) {
      addIndex(`${rule}:${keyVal}`, rule, d);
    }
  }

  const results = [];
  const duplicates = [];
  const missing = [];

  for (const file of diskFiles) {
    const keys = buildKeysFor(file);

    // Pröva i prioriterad ordning
    const order = [
      "exact:base",
      "exact:path",
      "lower:base",
      "lower:path",
      "ascii:base",
      "ascii:path",
      "norm:base",
      "norm:path",
    ];

    let hit = null;
    for (const rule of order) {
      const k = keys.get(rule);
      const arr = index.get(`${rule}:${k}`);
      if (arr && arr.length) {
        // flera träffar == dubblett på denna nyckel
        if (arr.length > 1) {
          duplicates.push({ file, rule, matches: arr });
        }
        hit = { file, rule, match: arr[0] };
        break;
      }
    }

    if (hit) {
      results.push(hit);
    } else {
      // sista chans: matcha mot DB-path som slutar med filnamn (regex-variant via index “norm:path”)
      const normBase = keys.get("norm:base");
      // gå igenom nycklar i index som slutar med normBase (dyrare), begränsa storlek
      let fallback = null;
      for (const [k, arr] of index.entries()) {
        if (!k.startsWith("norm:path:")) continue;
        if (k.endsWith("/" + normBase) || k.endsWith(normBase)) {
          fallback = { file, rule: "fallback:suffix-norm-path", match: arr[0] };
          if (arr.length > 1) {
            duplicates.push({
              file,
              rule: "fallback:suffix-norm-path",
              matches: arr,
            });
          }
          break;
        }
      }
      if (fallback) results.push(fallback);
      else missing.push(file);
    }
  }

  // Rapport
  console.log("────────────────────────────────────────────────────────");
  console.log(`📂 Katalog: ${folder}`);
  console.log(`🗃  DB: ${dbName}.teamstats`);
  console.log(`📄 Antal filer på disk: ${diskFiles.length}`);
  console.log(`✅ Hittade i DB:        ${results.length}`);
  console.log(`❌ Saknas i DB:         ${missing.length}`);
  console.log(`⚠️  Pot. dubbletter:     ${duplicates.length}`);
  console.log("────────────────────────────────────────────────────────");

  // Visa några exempel
  const showN = 15;

  if (results.length) {
    console.log(`✅ Exempel på träffar (${Math.min(showN, results.length)}):`);
    for (const r of results.slice(0, showN)) {
      console.log(
        `  • ${r.file}  →  ${r.match.sourceFile}  [${r.rule}]  _id=${r.match._id}`
      );
    }
    console.log("────────────────────────────────────────────────────────");
  }

  if (duplicates.length) {
    console.log(`⚠️ Dubblett-exempel (${Math.min(showN, duplicates.length)}):`);
    for (const d of duplicates.slice(0, showN)) {
      const ids = d.matches.map((m) => m._id).join(", ");
      const samplesf = d.matches[0]?.sourceFile ?? "";
      console.log(
        `  • ${d.file}  rule=${d.rule}  matches=${d.matches.length}  e.g. ${samplesf}  _ids=[${ids}]`
      );
    }
    console.log("────────────────────────────────────────────────────────");
  }

  if (missing.length) {
    console.log(`❌ Saknas-exempel (${Math.min(showN, missing.length)}):`);
    for (const m of missing.slice(0, showN)) console.log(`  • ${m}`);
    console.log("────────────────────────────────────────────────────────");
    console.log(
      "Tips: många ‘saknas’ med diakritik (t.ex. köln, málaga). Skriptet försöker redan normalisera,"
    );
    console.log(
      "men om DB lagrar sökväg (…/liga/fil.json), se till att importen skriver exakt filnamn i _importMeta.sourceFile."
    );
  }

  await client.close(true);
}

main().catch((err) => {
  console.error("💥 Fel:", err?.stack || err);
  process.exit(1);
});
