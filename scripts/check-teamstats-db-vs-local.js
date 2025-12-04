import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

if (!process.env.VERCEL) {
  dotenv.config({ path: ".env.local" });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const TEAMSTATS_DIR = path.join(ROOT, "data", "teamstats");
const DB_NAME = process.env.MONGODB_DB || "app";
const SYNC = process.argv.includes("--sync");

function matchKey(match) {
  const primary = match?.matchId ?? match?.id ?? match?.eventId;
  if (primary != null) return String(primary);
  return `${match?.homeTeamName || ""}__${match?.awayTeamName || ""}__${
    match?.timestamp || match?.startTimestamp || match?.date || ""
  }`;
}

async function loadLocalFull(file) {
  const fullPath = path.join(TEAMSTATS_DIR, file);
  const raw = await fs.readFile(fullPath, "utf-8");
  const json = JSON.parse(raw);
  if (Array.isArray(json?.full)) return json.full;
  if (Array.isArray(json?.matches)) return json.matches;
  console.warn(`${file}: ingen 'full' array, raknar 0 matcher`);
  return [];
}

function buildIndex(list = []) {
  const idx = new Map();
  for (const match of list) {
    const key = matchKey(match);
    const safeKey = key && String(key).trim() ? String(key).trim() : null;
    if (!safeKey) continue;
    if (!idx.has(safeKey)) {
      idx.set(safeKey, { json: JSON.stringify(match), match });
    }
  }
  return idx;
}

function diffMatches(localFull, dbFull) {
  const localIdx = buildIndex(localFull);
  const dbIdx = buildIndex(dbFull);
  const keys = new Set([...localIdx.keys(), ...dbIdx.keys()]);

  const changedKeys = [];
  const onlyInLocal = [];
  const onlyInDb = [];

  for (const key of keys) {
    const localMatch = localIdx.get(key);
    const dbMatch = dbIdx.get(key);
    if (localMatch && dbMatch) {
      if (localMatch.json !== dbMatch.json) changedKeys.push(key);
    } else if (localMatch) {
      onlyInLocal.push(key);
    } else if (dbMatch) {
      onlyInDb.push(key);
    }
  }

  return {
    changed: changedKeys,
    onlyInLocal,
    onlyInDb,
    localCount: localFull.length,
    dbCount: dbFull.length,
  };
}

async function fetchDbDocs() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI saknas i .env.local");
  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db(DB_NAME).collection("teamstats");
  const docs = await col
    .find({}, { projection: { full: 1, "_importMeta.sourceFile": 1 } })
    .toArray();
  return { client, docs };
}

async function syncFromDb(docs) {
  let written = 0;
  let skippedNoSource = 0;
  let skippedDup = 0;
  let skippedOutside = 0;
  const seen = new Set();

  for (const doc of docs) {
    const source = doc?._importMeta?.sourceFile;
    if (!source) {
      skippedNoSource++;
      continue;
    }
    if (seen.has(source)) {
      skippedDup++;
      continue;
    }
    seen.add(source);

    const outPath = path.resolve(TEAMSTATS_DIR, source);
    if (!outPath.startsWith(TEAMSTATS_DIR)) {
      skippedOutside++;
      continue;
    }

    const payload = {
      full: Array.isArray(doc.full) ? doc.full : [],
    };

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + "\n");
    written++;
  }

  console.log("--------------------------------------------------------");
  console.log("Sync från DB → lokala filer");
  console.log(`  📤 Skrev:              ${written}`);
  console.log(`  ⏭️  Utan sourceFile:    ${skippedNoSource}`);
  console.log(`  ⏭️  Dubbletter:         ${skippedDup}`);
  console.log(`  ⏭️  Ignorerade path:    ${skippedOutside}`);
  console.log("--------------------------------------------------------");
}

function logDiff(file, diff) {
  const diffCount =
    diff.changed.length + diff.onlyInDb.length + diff.onlyInLocal.length;
  if (diffCount === 0) {
    console.log(
      `OK   ${file} | db=${diff.dbCount} local=${diff.localCount} | matchar`
    );
    return;
  }

  const parts = [];
  if (diff.changed.length) parts.push(`andrade=${diff.changed.length}`);
  if (diff.onlyInDb.length) parts.push(`endast_db=${diff.onlyInDb.length}`);
  if (diff.onlyInLocal.length)
    parts.push(`endast_local=${diff.onlyInLocal.length}`);

  const examples = [
    ...diff.changed.slice(0, 2),
    ...diff.onlyInDb.slice(0, 2),
    ...diff.onlyInLocal.slice(0, 2),
  ].filter(Boolean);
  const hint = examples.length ? ` ex: ${examples.join(", ")}` : "";

  console.log(
    `DIFF ${file} | db=${diff.dbCount} local=${diff.localCount} | diff=${diffCount} (${parts.join(
      ", "
    )})${hint}`
  );
}

async function main() {
  const { client, docs } = await fetchDbDocs();

  try {
    if (SYNC) {
      await syncFromDb(docs);
    }

    const files = (await fs.readdir(TEAMSTATS_DIR))
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .sort();

    if (!files.length) {
      console.error(`Inga .json-filer hittades i ${TEAMSTATS_DIR}`);
      return;
    }

    const dbBySource = new Map();
    const missingSourceDocs = [];

    for (const doc of docs) {
      const source = doc?._importMeta?.sourceFile;
      if (source) dbBySource.set(source, doc);
      else missingSourceDocs.push(doc);
    }

    console.log("--------------------------------------------------------");
    console.log(`Lokala filer: ${files.length}`);
    console.log(`DB docs:      ${docs.length} (${DB_NAME}.teamstats)`);
    console.log("--------------------------------------------------------");

    const seenDbSources = new Set();

    for (const file of files) {
      const dbDoc = dbBySource.get(file);
      const localFull = await loadLocalFull(file);

      if (!dbDoc) {
        console.log(
          `MISS ${file} | inget dokument i DB | local=${localFull.length}`
        );
        continue;
      }
      seenDbSources.add(file);

      const dbFull = Array.isArray(dbDoc.full) ? dbDoc.full : [];
      const diff = diffMatches(localFull, dbFull);
      logDiff(file, diff);
    }

    const extras = [];
    for (const [source] of dbBySource.entries()) {
      if (!seenDbSources.has(source)) extras.push(source);
    }

    if (extras.length) {
      console.log("--------------------------------------------------------");
      console.log(
        `DB har dokument utan motsvarande fil (${extras.length} st), visar max 20:`
      );
      extras.slice(0, 20).forEach((s) => console.log(`  - ${s}`));
      if (extras.length > 20) console.log("  - ...");
    }

    if (missingSourceDocs.length) {
      console.log("--------------------------------------------------------");
      console.log(
        `Dokument utan _importMeta.sourceFile: ${missingSourceDocs.length}`
      );
    }
  } finally {
    await client.close(true);
  }
}

main().catch((err) => {
  console.error("Fatal:", err?.stack || err);
  process.exit(1);
});
