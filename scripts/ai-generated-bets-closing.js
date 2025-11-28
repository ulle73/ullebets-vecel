/**
 * För varje rad i ai-generated-bets: hitta motsvarande match i unibet-backtest,
 * ta senaste closing-snapshot och markera beatClosing + spara closingOdds.
 *
 * Definition: beatClosing = (ursprungligt odds) > (closing odds) för samma lina/sida.
 *
 * Usage:
 *   node scripts/ai-generated-bets-closing.js
 */

import dotenv from "dotenv";
import { MongoClient } from "mongodb";
dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "app";
const AI_COL = "ai-generated-bets";
const UNIBET_COL = "unibet-backtest";

function normalizeString(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSlug(home, away, dateStr) {
  return `${normalizeString(home)}-${normalizeString(away)}-${dateStr}`;
}

function toDateString(input) {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

function matchCondition(direction) {
  const d = String(direction || "").toLowerCase();
  return d.startsWith("o") ? "över" : "under";
}

function findClosingLine(closingSnapshot, line) {
  if (!closingSnapshot?.lines) return null;
  if (line.betKey) {
    const byKey = closingSnapshot.lines.find((l) => l.betKey === line.betKey);
    if (byKey) return byKey;
  }
  const wantCond = matchCondition(line.direction || line.condition);
  return closingSnapshot.lines.find(
    (l) =>
      l.statKey === line.statKey &&
      l.scope === line.scope &&
      (l.period || "ALL") === (line.period || "ALL") &&
      l.condition === wantCond &&
      Number(l.line) === Number(line.line)
  );
}

async function run() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI saknas");
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const aiCol = db.collection(AI_COL);
  const unibetCol = db.collection(UNIBET_COL);

  const cursor = aiCol.find({}, { noCursorTimeout: true, batchSize: 200 });
  let docs = 0;
  let linesUpdated = 0;
  let matchesWithoutClosing = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) continue;
    docs += 1;

    const dateStr = toDateString(doc.date || doc.matchDate);
    const updatedLines = [];

    // cache closing snapshot per doc to avoid multiple DB hits per line
    let closingSnapshot = null;
    let closingFetched = false;
    let closingDocSlug = null;
    let loggedNoClosing = false;
    let closingUnavailable = false;

    for (const line of doc.lines || []) {
      // reuse existing beatClosing if already set
      if (line.beatClosing !== undefined && line.closingOdds !== undefined) {
        updatedLines.push(line);
        continue;
      }

      // Om vi redan vet att det saknas closing: hoppa snabbare
      if (closingUnavailable) {
        updatedLines.push({
          ...line,
          closingOdds: null,
          beatClosing: null,
        });
        continue;
      }

      if (!closingFetched) {
        if (!dateStr || !line.homeTeamName || !line.awayTeamName) {
          closingFetched = true; // cannot fetch
        } else {
          const slug = buildSlug(line.homeTeamName, line.awayTeamName, dateStr);
          closingDocSlug = slug;
          const unibetDoc = await unibetCol.findOne({ _id: slug }, { projection: { snapshots: 1 } });
          if (unibetDoc?.snapshots?.length) {
            const closings = unibetDoc.snapshots
              .filter((s) => s?.type === "closing")
              .sort((a, b) => new Date(a.fetchedAt) - new Date(b.fetchedAt));
            closingSnapshot = closings[closings.length - 1] || null;
          }
          closingFetched = true;
        }
      }

      let beatClosing = null;
      let closingOdds = null;

      if (closingSnapshot) {
        const closingLine = findClosingLine(closingSnapshot, line);
        if (closingLine && closingLine.odds != null) {
          closingOdds = Number(closingLine.odds);
          const origOdds = Number(line.odds);
          if (Number.isFinite(origOdds) && Number.isFinite(closingOdds)) {
            beatClosing = origOdds > closingOdds;
          }
        }
      } else if (closingFetched) {
        if (!loggedNoClosing) {
          console.log(
            `[AI Bets Closing] Ingen closing-snapshot för ${closingDocSlug || "okänd slug"} (match ${line.homeTeamName} vs ${line.awayTeamName})`
          );
          loggedNoClosing = true;
          matchesWithoutClosing += 1;
        }
        closingUnavailable = true;
      }

      updatedLines.push({
        ...line,
        closingOdds,
        beatClosing,
      });

      if (beatClosing !== null || closingOdds !== null) {
        linesUpdated += 1;
      }
    }

    await aiCol.updateOne({ _id: doc._id }, { $set: { lines: updatedLines } });
  }

  console.log(
    `✅ Klar. Processade ${docs} dokument. Linjer med closing-data: ${linesUpdated}. Matcher utan closing: ${matchesWithoutClosing}`
  );
  await client.close();
}

run().catch((err) => {
  console.error("❌ Fel i ai-generated-bets-closing:", err);
  process.exit(1);
});
