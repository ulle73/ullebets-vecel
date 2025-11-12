// #!/usr/bin/env node

// import fs from "fs/promises";
// import path from "path";
// import dotenv from "dotenv";
// import { MongoClient } from "mongodb";

// dotenv.config({ path: ".env.local" });

// const RESULTS_DIR = path.join(process.cwd(), "data", "matchups");
// const SCORE_DIR = path.join(RESULTS_DIR, "matchup-score");
// const LEAGUE_DIR = path.join(RESULTS_DIR, "matchup-league-avg");
// const HISTORY_COLLECTION = "matchups-history";

// function buildKey(row) {
//   return `${row.matchId}:${row.statKey}:${row.period}:${row.scope}:${row.condition}`;
// }

// function annotateRows(rows, map) {
//   return rows?.map((row) => {
//     const key = buildKey(row);
//     const enriched = map.get(key);
//     return enriched ? { ...row, outcome: enriched.outcome } : row;
//   });
// }

// const MONGODB_URI = process.env.MONGODB_URI;
// const DB_NAME = process.env.MONGODB_DB ?? "app";

// function resolveDateArg() {
//   const arg = process.argv.find((value) => value.startsWith("--date="));
//   if (arg) return arg.split("=", 2)[1];
//   return new Date().toISOString().slice(0, 10);
// }

// async function loadMatchups(date) {
//   const scorePath = path.join(SCORE_DIR, `${date}.json`);
//   const raw = await fs.readFile(scorePath, "utf8");
//   return JSON.parse(raw);
// }

// async function loadTeamstats(client, matchId) {
//   const collection = client.db(DB_NAME).collection("teamstats");
//   const looksNumeric =
//     typeof matchId === "number" || /^\d+$/.test(String(matchId));
//   const exactId = looksNumeric ? Number(matchId) : String(matchId);

//   const doc = await collection.findOne(
//     { "full.matchId": exactId },
//     { projection: { full: 1 } }
//   );
//   if (!doc) return [];
//   const full = Array.isArray(doc.full) ? doc.full : [doc.full].filter(Boolean);
//   return full;
// }

// function toStatNumber(value) {
//   if (value == null) return null;
//   if (typeof value === "number") return Number.isFinite(value) ? value : null;
//   const parsed = Number(String(value).replace(/[^0-9.+-]/g, ""));
//   return Number.isFinite(parsed) ? parsed : null;
// }

// function findActualFromFull(fullArr, wantedMatchId, period, statKey) {
//   const looksNumeric =
//     typeof wantedMatchId === "number" || /^\d+$/.test(String(wantedMatchId));
//   const wantedNum = looksNumeric ? Number(wantedMatchId) : null;
//   const wantedStr = String(wantedMatchId);

//   const candidatesFull = fullArr.filter((node) => {
//     const nid = node?.matchId;
//     if (nid == null) return false;
//     if (typeof nid === "number" && looksNumeric) return nid === wantedNum;
//     if (typeof nid === "string" && !looksNumeric) return nid === wantedStr;
//     return false;
//   });

//   for (const snap of candidatesFull) {
//     const statistics =
//       snap?.matchDetails?.statistics ??
//       snap?.statistics ??
//       snap?.matchDetails?.statisticsItems ??
//       [];

//     if (!Array.isArray(statistics)) continue;

//     const nodesToCheck = statistics.filter(
//       (entry) =>
//         entry?.period === period || (!entry?.period && period === "ALL")
//     );

//     for (const node of nodesToCheck) {
//       for (const group of node?.groups ?? []) {
//         for (const item of group?.statisticsItems ?? []) {
//           if (item?.key === statKey) {
//             const home = toStatNumber(item.homeValue ?? item.home);
//             const away = toStatNumber(item.awayValue ?? item.away);
//             return { home, away };
//           }
//         }
//       }
//     }
//   }
//   return null;
// }

// function evaluateMatchup(row, actual) {
//   if (!actual) return null;
//   let value = null;
//   if (row.scope === "home") value = actual.home;
//   else if (row.scope === "away") value = actual.away;
//   else if (row.scope === "total") {
//     if (Number.isFinite(actual.home) || Number.isFinite(actual.away)) {
//       value = (actual.home ?? 0) + (actual.away ?? 0);
//     }
//   }
//   if (!Number.isFinite(value)) return null;
//   return {
//     actualValue: value,
//     homeValue: actual.home ?? null,
//     awayValue: actual.away ?? null,
//   };
// }

// async function persistHistory(client, date, enrichedRows, stats) {
//   const collection = client.db(DB_NAME).collection(HISTORY_COLLECTION);
//   return collection.updateOne(
//     { _id: date },
//     {
//       $set: {
//         date,
//         updatedAt: new Date(),
//         stats,
//         rows: enrichedRows,
//       },
//     },
//     { upsert: true }
//   );
// }

// async function main() {
//   if (!MONGODB_URI) throw new Error("MONGODB_URI missing");
//   const date = resolveDateArg();
//   const client = new MongoClient(MONGODB_URI);
//   await client.connect();
//   try {
//     const matchups = await loadMatchups(date);

//     // league avg (optional)
//     let leagueAvg = null;
//     try {
//       const leaguePath = path.join(LEAGUE_DIR, `${date}.json`);
//       leagueAvg = JSON.parse(await fs.readFile(leaguePath, "utf8"));
//     } catch {
//       leagueAvg = null;
//     }

//     const rows = [
//       ...(matchups.top50?.over ?? []),
//       ...(matchups.top50?.under ?? []),
//     ];

//     const enriched = [];
//     const outcomeMap = new Map();
//     let processed = 0;

//     for (const row of rows) {
//       console.log(
//         `[enrich] matchId=${row.matchId} stat=${row.statKey} period=${row.period} scope=${row.scope}`
//       );

//       const fullArr = await loadTeamstats(client, row.matchId);
//       if (!fullArr.length) {
//         console.warn(`[enrich] teamstats missing for match ${row.matchId}`);
//       }

//       const actual = findActualFromFull(
//         fullArr,
//         row.matchId,
//         row.period,
//         row.statKey
//       );
//       const outcome = evaluateMatchup(row, actual);
//       console.log(
//         `[enrich] outcome match=${row.matchId} stat=${row.statKey} period=${row.period} scope=${row.scope} ->`,
//         outcome
//       );

//       enriched.push({ ...row, outcome });
//       outcomeMap.set(buildKey(row), { outcome });
//       processed++;
//     }

//     const annotatedScore = {
//       ...matchups,
//       top50: {
//         over: annotateRows(matchups.top50?.over ?? [], outcomeMap),
//         under: annotateRows(matchups.top50?.under ?? [], outcomeMap),
//       },
//     };

//     await fs.writeFile(
//       path.join(SCORE_DIR, `${date}.json`),
//       JSON.stringify(annotatedScore, null, 2)
//     );

//     let annotatedLeagueAvg = null;
//     if (leagueAvg) {
//       annotatedLeagueAvg = {
//         ...leagueAvg,
//         top50: {
//           over: annotateRows(leagueAvg.top50?.over ?? [], outcomeMap),
//           under: annotateRows(leagueAvg.top50?.under ?? [], outcomeMap),
//         },
//       };
//       await fs.writeFile(
//         path.join(LEAGUE_DIR, `${date}.json`),
//         JSON.stringify(annotatedLeagueAvg, null, 2)
//       );
//     }

//     await persistHistory(client, date, enriched, { processed });

//     // Behåll separata collections
//     await client
//       .db(DB_NAME)
//       .collection("matchups-score")
//       .updateOne(
//         { _id: date },
//         {
//           $set: {
//             "score.top50.over": annotatedScore.top50.over,
//             "score.top50.under": annotatedScore.top50.under,
//             "score.updatedAt": new Date(),
//           },
//         },
//         { upsert: true }
//       );

//     if (annotatedLeagueAvg) {
//       await client
//         .db(DB_NAME)
//         .collection("matchups-league-avg")
//         .updateOne(
//           { _id: date },
//           {
//             $set: {
//               "leagueAvg.top50.over": annotatedLeagueAvg.top50.over,
//               "leagueAvg.top50.under": annotatedLeagueAvg.top50.under,
//               "leagueAvg.updatedAt": new Date(),
//             },
//           },
//           { upsert: true }
//         );
//     }

//     // ---- NYTT: skriv ett konsoliderat dokument i "matchups" UTAN att läsa filer ----
//     const matchupsDoc = {
//       _id: date,
//       date,
//       updatedAt: new Date(),
//       score: annotatedScore, // exakt payload vi skrev till data/matchups/matchup-score/<date>.json
//       ...(annotatedLeagueAvg && { leagueAvg: annotatedLeagueAvg }), // samma för league-avg om den fanns
//     };

//     // replaceOne => tar bort legacy-fält som "top50" i roten
//     await client
//       .db(DB_NAME)
//       .collection("matchups")
//       .replaceOne({ _id: date }, matchupsDoc, { upsert: true });

//     console.log(`enriched ${processed} rows for ${date}`);
//   } finally {
//     await client.close();
//   }
// }

// main().catch((error) => {
//   console.error("enrich-matchups-results failed:", error);
//   process.exit(1);
// });




import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB ?? "app";

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
      (entry) => entry?.period === period || (!entry?.period && period === "ALL")
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

async function main() {
  if (!MONGODB_URI) throw new Error("MONGODB_URI missing");
  const date = resolveDateArg();
  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  try {
    const db = client.db(DB_NAME);

    // 1) Hämta befintligt score-dokument för datumet
    const scoreDoc = await db
      .collection("matchups-score")
      .findOne({ _id: date }, { projection: { data: 1 } });

    if (!scoreDoc?.data) {
      console.warn(`[enrich] no matchups-score.data for ${date} — skipping score update`);
    }

    // 2) Hämta ev. befintligt league-avg-dokument
    const leagueDoc = await db
      .collection("matchups-league-avg")
      .findOne({ _id: date }, { projection: { data: 1 } });

    if (!leagueDoc?.data) {
      console.warn(`[enrich] no matchups-league-avg.data for ${date} — skipping league avg update`);
    }

    // Funktion som enrichar ett top50-objekt in-place (utan att skapa något nytt dokument)
    const enrichTop50 = async (top50) => {
      const rows = [...(top50?.over ?? []), ...(top50?.under ?? [])];
      const outcomeMap = new Map();

      for (const row of rows) {
        const fullArr = await loadTeamstats(client, row.matchId);
        if (!fullArr.length) {
          console.warn(`[enrich] teamstats missing for match ${row.matchId}`);
        }
        const actual = findActualFromFull(fullArr, row.matchId, row.period, row.statKey);
        const outcome = evaluateMatchup(row, actual);
        outcomeMap.set(buildKey(row), { outcome });
      }

      return {
        over: annotateRows(top50?.over ?? [], outcomeMap),
        under: annotateRows(top50?.under ?? [], outcomeMap),
      };
    };

    // 3) Uppdatera matchups-score.data (om det finns)
    if (scoreDoc?.data) {
      const newTop50 = await enrichTop50(scoreDoc.data.top50);
      await db.collection("matchups-score").updateOne(
        { _id: date },
        {
          $set: {
            "data.top50.over": newTop50.over,
            "data.top50.under": newTop50.under,
            "data.updatedAt": new Date(),
          },
        }, // inga upserts -> skapar inte nytt
      );
      console.log(`[enrich] updated matchups-score for ${date}`);
    }

    // 4) Uppdatera matchups-league-avg.data (om det finns)
    if (leagueDoc?.data) {
      const newTop50 = await enrichTop50(leagueDoc.data.top50);
      await db.collection("matchups-league-avg").updateOne(
        { _id: date },
        {
          $set: {
            "data.top50.over": newTop50.over,
            "data.top50.under": newTop50.under,
            "data.updatedAt": new Date(),
          },
        }, // inga upserts -> skapar inte nytt
      );
      console.log(`[enrich] updated matchups-league-avg for ${date}`);
    }

  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("enrich-matchups-results failed:", error);
  process.exit(1);
});
