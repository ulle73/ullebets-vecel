
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import fs from "fs/promises";
import path from "path";

dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB ?? "app";

const RESULTS_DIR = path.join(process.cwd(), "data", "matchups");
const SCORE_DIR = path.join(RESULTS_DIR, "matchup-score");
const LEAGUE_DIR = path.join(RESULTS_DIR, "matchup-league-avg");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function buildKey(row) {
  return `${row.matchId}:${row.statKey}:${row.period}:${row.scope}:${row.condition}`;
}

function annotateRows(rows, map) {
  return rows?.map((row) => {
    const key = buildKey(row);
    const enriched = map.get(key);
    return enriched ? { ...row, outcome: enriched.outcome } : row;
  });
}

function resolveDateArg() {
  const arg = process.argv.find((value) => value.startsWith("--date="));
  if (arg) return arg.split("=", 2)[1];
  return new Date().toISOString().slice(0, 10);
}



async function loadTeamstats(client, matchId) {
  const collection = client.db(DB_NAME).collection("teamstats");
  const looksNumeric =
    typeof matchId === "number" || /^\d+$/.test(String(matchId));
  const exactId = looksNumeric ? Number(matchId) : String(matchId);

  const doc = await collection.findOne(
    { "full.matchId": exactId },
    { projection: { full: 1 } }
  );
  if (!doc) return [];
  const full = Array.isArray(doc.full) ? doc.full : [doc.full].filter(Boolean);
  return full;
}

function toStatNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function findActualFromFull(fullArr, wantedMatchId, period, statKey) {
  const looksNumeric =
    typeof wantedMatchId === "number" || /^\d+$/.test(String(wantedMatchId));
  const wantedNum = looksNumeric ? Number(wantedMatchId) : null;
  const wantedStr = String(wantedMatchId);

  const candidatesFull = fullArr.filter((node) => {
    const nid = node?.matchId;
    if (nid == null) return false;
    if (typeof nid === "number" && looksNumeric) return nid === wantedNum;
    if (typeof nid === "string" && !looksNumeric) return nid === wantedStr;
    return false;
  });

  for (const snap of candidatesFull) {
    const statistics =
      snap?.matchDetails?.statistics ??
      snap?.statistics ??
      snap?.matchDetails?.statisticsItems ??
      [];

    if (!Array.isArray(statistics)) continue;

    const nodesToCheck = statistics.filter(
      (entry) =>
        entry?.period === period || (!entry?.period && period === "ALL")
    );

    for (const node of nodesToCheck) {
      for (const group of node?.groups ?? []) {
        for (const item of group?.statisticsItems ?? []) {
          if (item?.key === statKey) {
            const home = toStatNumber(item.homeValue ?? item.home);
            const away = toStatNumber(item.awayValue ?? item.away);
            return { home, away };
          }
        }
      }
    }
  }
  return null;
}

function evaluateMatchup(row, actual) {
  if (!actual) return null;
  let value = null;
  if (row.scope === "home") value = actual.home;
  else if (row.scope === "away") value = actual.away;
  else if (row.scope === "total") {
    if (Number.isFinite(actual.home) || Number.isFinite(actual.away)) {
      value = (actual.home ?? 0) + (actual.away ?? 0);
    }
  }
  if (!Number.isFinite(value)) return null;
  return {
    actualValue: value,
    homeValue: actual.home ?? null,
    awayValue: actual.away ?? null,
  };
}

async function enrichTop50(client, top50) {
  const rows = [...(top50?.over ?? []), ...(top50?.under ?? [])];
  const outcomeMap = new Map();

  for (const row of rows) {
    const fullArr = await loadTeamstats(client, row.matchId);
    if (!fullArr.length) {
      console.warn(`[enrich] teamstats missing for match ${row.matchId}`);
    }
    const actual = findActualFromFull(
      fullArr,
      row.matchId,
      row.period,
      row.statKey
    );
    const outcome = evaluateMatchup(row, actual);
    outcomeMap.set(buildKey(row), { outcome });
  }

  return {
    over: annotateRows(top50?.over ?? [], outcomeMap),
    under: annotateRows(top50?.under ?? [], outcomeMap),
  };
}

async function enrichMatchupsForDate(db, client, date) {
  const scoreDoc = await db
    .collection("matchups-score")
    .findOne({ _id: date }, { projection: { data: 1 } });

  if (!scoreDoc?.data) {
    console.warn(
      `[enrich] no matchups-score.data for ${date} — skipping score update`
    );
  }

  const leagueDoc = await db
    .collection("matchups-league-avg")
    .findOne({ _id: date }, { projection: { data: 1 } });

  if (!leagueDoc?.data) {
    console.warn(
      `[enrich] no matchups-league-avg.data for ${date} — skipping league avg update`
    );
  }

  if (scoreDoc?.data) {
    const newTop50 = await enrichTop50(client, scoreDoc.data.top50);

    await db.collection("matchups-score").updateOne(
      { _id: date },
      {
        $set: {
          "data.top50.over": newTop50.over,
          "data.top50.under": newTop50.under,
          "data.updatedAt": new Date(),
        },
      }
    );
    console.log(`[enrich] updated matchups-score for ${date}`);

    const scoreFilePayload = {
      ...scoreDoc.data,
      top50: newTop50,
      updatedAt: new Date().toISOString(),
    };
    await ensureDir(SCORE_DIR);
    await fs.writeFile(
      path.join(SCORE_DIR, `${date}.json`),
      JSON.stringify(scoreFilePayload, null, 2)
    );
  }

  if (leagueDoc?.data) {
    const newTop50 = await enrichTop50(client, leagueDoc.data.top50);

    await db.collection("matchups-league-avg").updateOne(
      { _id: date },
      {
        $set: {
          "data.top50.over": newTop50.over,
          "data.top50.under": newTop50.under,
          "data.updatedAt": new Date(),
        },
      }
    );
    console.log(`[enrich] updated matchups-league-avg for ${date}`);

    const leagueFilePayload = {
      ...leagueDoc.data,
      top50: newTop50,
      updatedAt: new Date().toISOString(),
    };
    await ensureDir(LEAGUE_DIR);
    await fs.writeFile(
      path.join(LEAGUE_DIR, `${date}.json`),
      JSON.stringify(leagueFilePayload, null, 2)
    );
  }
}

async function main() {
  if (!MONGODB_URI) throw new Error("MONGODB_URI missing");

  const dateArg = resolveDateArg();
  const dates = expandDateRange(dateArg);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    for (const date of dates) {
      await enrichMatchupsForDate(db, client, date);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("enrich-matchups-results failed:", error);
  process.exit(1);
});

// --- NYTT: hjälpare för att expandera ett datumspann (YYYY-MM-DD-YYYY-MM-DD) ---
function expandDateRange(maybeRange) {
  const re = /^\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}$/;
  if (!re.test(maybeRange)) return [maybeRange];
  const [y1, m1, d1, y2, m2, d2] = maybeRange.split("-").map(Number);
  const start = new Date(Date.UTC(y1, m1 - 1, d1));
  const end = new Date(Date.UTC(y2, m2 - 1, d2));
  const out = [];
  for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}
// ------------------------------------------------------------------------------
