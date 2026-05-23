import fs from "fs";

const filePath = "scripts/update-teams-v2.js";
let source = fs.readFileSync(filePath, "utf8");

const start = source.indexOf("async function syncTeamstatsToDbForFiles(fileNames) {");
const endMarker = "\n// ---------- Huvudprogram --------------------------------------";
const end = source.indexOf(endMarker, start);

if (start === -1 || end === -1) {
  throw new Error("Could not find syncTeamstatsToDbForFiles block");
}

const replacement = `const isTransientMongoSyncError = (error) => {
  const message = String(error?.message || error || "").toLowerCase();
  return [
    "request terminated due to shutdown",
    "connection pool closed",
    "server selection timed out",
    "connection closed",
    "network timeout",
    "socket timeout",
    "econnreset",
    "etimedout",
  ].some((token) => message.includes(token));
};

async function syncTeamstatsToDbForFiles(fileNames) {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "app";
  if (!uri) {
    console.error("❌ MONGODB_URI saknas i .env.local");
    return;
  }

  let client = null;
  let col = null;

  const connect = async () => {
    if (client && col) return;
    client = new MongoClient(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 30_000,
      socketTimeoutMS: 120_000,
    });
    await client.connect();
    col = client.db(dbName).collection("teamstats");
  };

  const disconnect = async () => {
    if (!client) return;
    try {
      await client.close(true);
    } catch {}
    client = null;
    col = null;
  };

  const reconnect = async () => {
    await disconnect();
    await sleep(3_000);
    await connect();
  };

  await connect();

  let upserts = 0,
    updates = 0,
    unchanged = 0,
    failures = 0,
    retries = 0;

  const importOne = async (fname) => {
    const role = roleFromFilename(fname);
    if (!role) {
      console.warn(\`⏭️ Hoppar (okänt filnamnsmönster): \${fname}\`);
      return "skipped";
    }

    const fullRaw = await readFullFromAnyDir(fname);
    const fullIncoming = dedupeMatches(fullRaw);
    const filter = { "_importMeta.sourceFile": fname };
    const existing = await col.findOne(filter, {
      projection: { _id: 0, full: 1, _importMeta: 1 },
    });
    const { merged: mergedFull, changed } = mergeFullArrays(
      existing?.full,
      fullIncoming
    );
    mergedFull.sort(
      (a, b) => Number(b?.timestamp ?? 0) - Number(a?.timestamp ?? 0)
    );
    const metaSource = mergedFull.length > 0 ? mergedFull : fullIncoming;
    const { teamId, teamName } = pickTeamMetaFromFull(metaSource, role);
    const now = new Date().toISOString();
    const existingMeta = existing?._importMeta ?? {};
    const resolvedTeamId =
      teamId != null
        ? String(teamId)
        : existingMeta.teamId != null
        ? String(existingMeta.teamId)
        : null;
    const resolvedTeamName = teamName ?? existingMeta.teamName ?? null;

    const res = await col.updateOne(
      filter,
      {
        $set: {
          full: mergedFull,
          "_importMeta.sourceFile": fname,
          "_importMeta.teamRole": role,
          "_importMeta.teamId": resolvedTeamId,
          "_importMeta.teamName": resolvedTeamName,
          "_importMeta.importedAt": now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    if (res.upsertedCount) {
      console.log(
        \`🆕  La in '\${fname}' → teamId=\${resolvedTeamId ?? "n/a"} (full=\${mergedFull.length}).\`
      );
      return "upsert";
    }

    if (changed) {
      console.log(
        \`♻️  Uppdaterade '\${fname}' → teamId=\${resolvedTeamId ?? "n/a"} (full=\${mergedFull.length}).\`
      );
      return "update";
    }

    console.log(\`⏭️  Inga förändringar i '\${fname}' (full=\${mergedFull.length}).\`);
    return "unchanged";
  };

  for (const fname of fileNames) {
    let imported = false;

    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await connect();
        const status = await importOne(fname);
        if (status === "upsert") upserts++;
        else if (status === "update") updates++;
        else if (status === "unchanged") unchanged++;
        imported = true;
        break;
      } catch (e) {
        const transient = isTransientMongoSyncError(e);
        if (transient && attempt < 4) {
          retries++;
          console.warn(
            \`⚠️ Tillfälligt DB-fel för '\${fname}' (försök \${attempt}/4): \${e.message}. Återansluter och försöker igen …\`
          );
          await reconnect();
          continue;
        }

        failures++;
        console.warn(\`❌ Misslyckades importera '\${fname}': \${e.message}\`);
        break;
      }
    }

    if (!imported) {
      await sleep(250);
    }
  }

  try {
    await connect();
    await ensureIndexes(col);
  } catch (e) {
    console.warn(\`⚠️ Kunde inte säkerställa Mongo-index: \${e.message}\`);
  }

  await disconnect();
  console.log(
    \`🗃  DB-sync klar. 🆕 \${upserts}  ♻️ \${updates}  ⏭️ \${unchanged}  🔁 \${retries}  ❌ \${failures}\`
  );
}
`;

source = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
fs.writeFileSync(filePath, source, "utf8");
console.log(`Patched ${filePath}`);
