import fs from "node:fs";

const filePath = "scripts/update-teams-v2.js";
let source = fs.readFileSync(filePath, "utf8");
let changed = false;

const oldReconnect = `  const reconnect = async () => {
    await disconnect();
    await sleep(3_000);
    await connect();
  };

  await connect();`;

const newReconnect = `  const reconnect = async () => {
    await disconnect();
    await sleep(3_000);
    try {
      await connect();
      return true;
    } catch (e) {
      console.warn(
        \`⚠️ Återanslutning till MongoDB misslyckades: \${e?.message || e}. Försöker vidare med nästa retry …\`
      );
      await disconnect();
      return false;
    }
  };

  try {
    await connect();
  } catch (e) {
    if (!isTransientMongoSyncError(e)) {
      throw e;
    }
    console.warn(
      \`⚠️ Tillfälligt DB-fel vid första Mongo-anslutning: \${e?.message || e}. Fortsätter med per-fil retry …\`
    );
    await disconnect();
    await sleep(5_000);
  }`;

if (source.includes(oldReconnect)) {
  source = source.replace(oldReconnect, newReconnect);
  changed = true;
}

const oldRetry = `          await reconnect();
          continue;`;
const newRetry = `          await reconnect();
          await sleep(Math.min(15_000, 2_000 * attempt));
          continue;`;

if (source.includes(oldRetry)) {
  source = source.replace(oldRetry, newRetry);
  changed = true;
}

if (!changed) {
  throw new Error("Patch hittade inte förväntade Mongo reconnect-block i scripts/update-teams-v2.js");
}

fs.writeFileSync(filePath, source, "utf8");
console.log("Patched Mongo reconnect handling in scripts/update-teams-v2.js");
