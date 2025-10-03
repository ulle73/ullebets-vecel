// // if (process.env.NEXT_RUNTIME) {
// //   await import("server-only");
// // }
// // import { clientPromise } from "../db.js";
// // import { performance } from "node:perf_hooks";

// // const DB = process.env.MONGODB_DB || "app";
// // const COL = "teamstats";

// // // Styr logg med env. Sätt LOG_TEAMSTATS=0 för att tysta.
// // const LOG = process.env.LOG_TEAMSTATS !== "0";
// // const tag = "[repo:teamstats]";
// // const t0 = () => performance.now();
// // const dt = (t) => `${(performance.now() - t).toFixed(1)}ms`;
// // const log = (...args) => { if (LOG) console.log(tag, ...args); };

// // const asArray = (v) =>
// //   Array.isArray(v) ? v : (Array.isArray(v?.shots) ? v.shots : []);

// // function mapMatchDoc(doc) {
// //   const f0 = Array.isArray(doc.full) ? (doc.full[0] ?? {}) : {};
// //   return {
// //     matchId: doc._id,
// //     timestamp: f0.timestamp ?? null,
// //     homeTeamId: f0.homeTeamId ?? null,
// //     homeTeamName: f0.homeTeamName ?? null,
// //     awayTeamId: f0.awayTeamId ?? null,
// //     awayTeamName: f0.awayTeamName ?? null,
// //     incidents: Array.isArray(f0.incidents) ? f0.incidents : [],
// //     shotmap: asArray(f0.shotmap),
// //     odds: (f0.odds && typeof f0.odds === "object") ? f0.odds : null,
// //     statistics: Array.isArray(f0.matchDetails?.statistics) ? f0.matchDetails.statistics : [],
// //   };
// // }

// // export async function getMatch(matchId) {
// //   const t = t0();
// //   log("getMatch:start", { matchId: String(matchId) });
// //   try {
// //     const client = await clientPromise;
// //     const col = client.db(DB).collection(COL);
// //     const doc = await col.findOne(
// //       { _id: String(matchId) },
// //       { projection: { _id: 1, full: { $slice: 1 } } }
// //     );
// //     const found = !!doc;
// //     const mapped = doc ? mapMatchDoc(doc) : null;
// //     log("getMatch:done", { matchId: String(matchId), found, dur: dt(t) });
// //     return mapped;
// //   } catch (err) {
// //     log("getMatch:error", { matchId: String(matchId), err: String(err) });
// //     throw err;
// //   }
// // }

// // export async function getShotmap(matchId) {
// //   const t = t0();
// //   log("getShotmap:start", { matchId: String(matchId) });
// //   try {
// //     const client = await clientPromise;
// //     const col = client.db(DB).collection(COL);
// //     const doc = await col.findOne(
// //       { _id: String(matchId) },
// //       { projection: { _id: 1, full: { $slice: 1 } } }
// //     );
// //     const f0 = doc?.full?.[0] || {};
// //     const arr = asArray(f0.shotmap);
// //     log("getShotmap:done", { matchId: String(matchId), count: arr.length, dur: dt(t) });
// //     return arr;
// //   } catch (err) {
// //     log("getShotmap:error", { matchId: String(matchId), err: String(err) });
// //     throw err;
// //   }
// // }

// // export async function getIncidents(matchId) {
// //   const t = t0();
// //   log("getIncidents:start", { matchId: String(matchId) });
// //   try {
// //     const client = await clientPromise;
// //     const col = client.db(DB).collection(COL);
// //     const doc = await col.findOne(
// //       { _id: String(matchId) },
// //       { projection: { _id: 1, full: { $slice: 1 } } }
// //     );
// //     const arr = Array.isArray(doc?.full?.[0]?.incidents) ? doc.full[0].incidents : [];
// //     log("getIncidents:done", { matchId: String(matchId), count: arr.length, dur: dt(t) });
// //     return arr;
// //   } catch (err) {
// //     log("getIncidents:error", { matchId: String(matchId), err: String(err) });
// //     throw err;
// //   }
// // }

// // export async function getStatistics(matchId) {
// //   const t = t0();
// //   log("getStatistics:start", { matchId: String(matchId) });
// //   try {
// //     const client = await clientPromise;
// //     const col = client.db(DB).collection(COL);
// //     const doc = await col.findOne(
// //       { _id: String(matchId) },
// //       { projection: { _id: 1, full: { $slice: 1 } } }
// //     );
// //     const stats = doc?.full?.[0]?.matchDetails?.statistics;
// //     const arr = Array.isArray(stats) ? stats : [];
// //     log("getStatistics:done", { matchId: String(matchId), groups: arr.length, dur: dt(t) });
// //     return arr;
// //   } catch (err) {
// //     log("getStatistics:error", { matchId: String(matchId), err: String(err) });
// //     throw err;
// //   }
// // }

// // /**
// //  * Sök matcher med filter + pagination.
// //  * Filtrerar direkt i Mongo på din struktur (full[0].*), och returnerar lättviktiga items.
// //  */
// // export async function searchMatches({ homeTeamId, awayTeamId, incidentType, page = 1, limit = 20 }) {
// //   const t = t0();
// //   const params = { homeTeamId, awayTeamId, incidentType, page, limit };
// //   log("searchMatches:start", params);
// //   try {
// //     const client = await clientPromise;
// //     const col = client.db(DB).collection(COL);

// //     const filter = {};
// //     if (Number.isFinite(homeTeamId)) filter["full.0.homeTeamId"] = homeTeamId;
// //     if (Number.isFinite(awayTeamId)) filter["full.0.awayTeamId"] = awayTeamId;
// //     if (incidentType) filter["full.0.incidents.incidentType"] = incidentType;

// //     const skip = (Math.max(1, page) - 1) * Math.max(1, limit);
// //     const lim = Math.max(1, Math.min(100, limit));

// //     const cursor = col
// //       .find(filter, { projection: { _id: 1, full: { $slice: 1 } } })
// //       .sort({ "full.0.timestamp": -1, _id: -1 })
// //       .skip(skip)
// //       .limit(lim);

// //     const [docs, total] = await Promise.all([cursor.toArray(), col.countDocuments(filter)]);

// //     const items = docs.map((d) => {
// //       const f0 = Array.isArray(d.full) ? (d.full[0] ?? {}) : {};
// //       return {
// //         matchId: d._id,
// //         homeTeamId: f0.homeTeamId ?? null,
// //         homeTeamName: f0.homeTeamName ?? null,
// //         awayTeamId: f0.awayTeamId ?? null,
// //         awayTeamName: f0.awayTeamName ?? null,
// //         timestamp: f0.timestamp ?? null,
// //       };
// //     });

// //     log("searchMatches:done", {
// //       total,
// //       returned: items.length,
// //       page: Math.max(1, page),
// //       limit: lim,
// //       dur: dt(t),
// //       filter,
// //     });

// //     return { total, items };
// //   } catch (err) {
// //     log("searchMatches:error", { err: String(err) });
// //     throw err;
// //   }
// // }


// // lib/repos/teamstats.js
// // Gör filen säker i Next, men körbar direkt med `node` (utan server-only installerat)
// if (process.env.NEXT_RUNTIME) {
//   await import("server-only");
// }

// import { clientPromise } from "../db.js";
// import { performance } from "node:perf_hooks";

// // ====== Konfig ======
// const DB = process.env.MONGODB_DB || "app";
// const COL = "teamstats";

// // Styr logg med env. Sätt LOG_TEAMSTATS=0 för att tysta.
// const LOG = process.env.LOG_TEAMSTATS !== "0";
// const tag = "[repo:teamstats]";
// const t0 = () => performance.now();
// const dt = (t) => `${(performance.now() - t).toFixed(1)}ms`;
// const log = (...args) => { if (LOG) console.log(tag, ...args); };

// // ====== Helpers ======
// const asArray = (v) =>
//   Array.isArray(v) ? v : (Array.isArray(v?.shots) ? v.shots : []);

// function mapMatchDoc(doc) {
//   const f0 = Array.isArray(doc.full) ? (doc.full[0] ?? {}) : {};
//   return {
//     matchId: doc._id,
//     timestamp: f0.timestamp ?? null,
//     homeTeamId: f0.homeTeamId ?? null,
//     homeTeamName: f0.homeTeamName ?? null,
//     awayTeamId: f0.awayTeamId ?? null,
//     awayTeamName: f0.awayTeamName ?? null,
//     incidents: Array.isArray(f0.incidents) ? f0.incidents : [],
//     shotmap: asArray(f0.shotmap),
//     odds: (f0.odds && typeof f0.odds === "object") ? f0.odds : null,
//     statistics: Array.isArray(f0.matchDetails?.statistics) ? f0.matchDetails.statistics : [],
//   };
// }

// // ====== Publika repo-funktioner ======
// export async function getMatch(matchId) {
//   const t = t0();
//   log("getMatch:start", { matchId: String(matchId) });
//   try {
//     const client = await clientPromise;
//     const col = client.db(DB).collection(COL);
//     const doc = await col.findOne(
//       { _id: String(matchId) },
//       { projection: { _id: 1, full: { $slice: 1 } } }
//     );
//     const found = !!doc;
//     const mapped = doc ? mapMatchDoc(doc) : null;
//     log("getMatch:done", { matchId: String(matchId), found, dur: dt(t) });
//     return mapped;
//   } catch (err) {
//     log("getMatch:error", { matchId: String(matchId), err: String(err) });
//     throw err;
//   }
// }

// export async function getShotmap(matchId) {
//   const t = t0();
//   log("getShotmap:start", { matchId: String(matchId) });
//   try {
//     const client = await clientPromise;
//     const col = client.db(DB).collection(COL);
//     const doc = await col.findOne(
//       { _id: String(matchId) },
//       { projection: { _id: 1, full: { $slice: 1 } } }
//     );
//     const f0 = doc?.full?.[0] || {};
//     const arr = asArray(f0.shotmap);
//     log("getShotmap:done", { matchId: String(matchId), count: arr.length, dur: dt(t) });
//     return arr;
//   } catch (err) {
//     log("getShotmap:error", { matchId: String(matchId), err: String(err) });
//     throw err;
//   }
// }

// export async function getIncidents(matchId) {
//   const t = t0();
//   log("getIncidents:start", { matchId: String(matchId) });
//   try {
//     const client = await clientPromise;
//     const col = client.db(DB).collection(COL);
//     const doc = await col.findOne(
//       { _id: String(matchId) },
//       { projection: { _id: 1, full: { $slice: 1 } } }
//     );
//     const arr = Array.isArray(doc?.full?.[0]?.incidents) ? doc.full[0].incidents : [];
//     log("getIncidents:done", { matchId: String(matchId), count: arr.length, dur: dt(t) });
//     return arr;
//   } catch (err) {
//     log("getIncidents:error", { matchId: String(matchId), err: String(err) });
//     throw err;
//   }
// }

// export async function getStatistics(matchId) {
//   const t = t0();
//   log("getStatistics:start", { matchId: String(matchId) });
//   try {
//     const client = await clientPromise;
//     const col = client.db(DB).collection(COL);
//     const doc = await col.findOne(
//       { _id: String(matchId) },
//       { projection: { _id: 1, full: { $slice: 1 } } }
//     );
//     const stats = doc?.full?.[0]?.matchDetails?.statistics;
//     const arr = Array.isArray(stats) ? stats : [];
//     log("getStatistics:done", { matchId: String(matchId), groups: arr.length, dur: dt(t) });
//     return arr;
//   } catch (err) {
//     log("getStatistics:error", { matchId: String(matchId), err: String(err) });
//     throw err;
//   }
// }

// /**
//  * Sök matcher med filter + pagination.
//  * Filtrerar direkt i Mongo på din struktur (full[0].*), och returnerar lättviktiga items.
//  */
// export async function searchMatches({ homeTeamId, awayTeamId, incidentType, page = 1, limit = 20 }) {
//   const t = t0();
//   const params = { homeTeamId, awayTeamId, incidentType, page, limit };
//   log("searchMatches:start", params);
//   try {
//     const client = await clientPromise;
//     const col = client.db(DB).collection(COL);

//     const filter = {};
//     if (Number.isFinite(homeTeamId)) filter["full.0.homeTeamId"] = homeTeamId;
//     if (Number.isFinite(awayTeamId)) filter["full.0.awayTeamId"] = awayTeamId;
//     if (incidentType) filter["full.0.incidents.incidentType"] = incidentType;

//     const skip = (Math.max(1, page) - 1) * Math.max(1, limit);
//     const lim = Math.max(1, Math.min(100, limit));

//     const cursor = col
//       .find(filter, { projection: { _id: 1, full: { $slice: 1 } } })
//       .sort({ "full.0.timestamp": -1, _id: -1 })
//       .skip(skip)
//       .limit(lim);

//     const [docs, total] = await Promise.all([cursor.toArray(), col.countDocuments(filter)]);

//     const items = docs.map((d) => {
//       const f0 = Array.isArray(d.full) ? (d.full[0] ?? {}) : {};
//       return {
//         matchId: d._id,
//         homeTeamId: f0.homeTeamId ?? null,
//         homeTeamName: f0.homeTeamName ?? null,
//         awayTeamId: f0.awayTeamId ?? null,
//         awayTeamName: f0.awayTeamName ?? null,
//         timestamp: f0.timestamp ?? null,
//       };
//     });

//     log("searchMatches:done", {
//       total,
//       returned: items.length,
//       page: Math.max(1, page),
//       limit: lim,
//       dur: dt(t),
//       filter,
//     });

//     return { total, items };
//   } catch (err) {
//     log("searchMatches:error", { err: String(err) });
//     throw err;
//   }
// }

// // ====== CLI TEST RUNNER ======
// // Gör att du kan köra: node lib/repos/teamstats.js <cmd> [arg1] [--key=value ...]
// import { fileURLToPath, pathToFileURL } from "url";
// import path from "path";

// function parseKV(args) {
//   const out = {};
//   for (const a of args) {
//     const m = /^--([^=]+)=(.+)$/.exec(a);
//     if (m) out[m[1]] = m[2];
//   }
//   return out;
// }

// async function mainCLI() {
//   const argv = process.argv.slice(2);
//   const cmd = argv[0]; // "get" | "shotmap" | "incidents" | "stats" | "search"
//   const id  = argv[1]; // matchId (för get/shotmap/incidents/stats)
//   const kv  = parseKV(argv.slice(2));

//   const client = await clientPromise; // init tidigt för att se connect-logg
//   try {
//     if (!cmd || cmd === "help") {
//       console.log(`
// Usage:
//   node lib/repos/teamstats.js get <matchId>
//   node lib/repos/teamstats.js shotmap <matchId>
//   node lib/repos/teamstats.js incidents <matchId>
//   node lib/repos/teamstats.js stats <matchId>
//   node lib/repos/teamstats.js search [--homeTeamId=5981] [--awayTeamId=1954] [--incidentType=goal] [--page=1] [--limit=5]
// `);
//       return;
//     }

//     if (cmd === "get") {
//       const data = await getMatch(id);
//       console.dir(data, { depth: 3 });
//       return;
//     }
//     if (cmd === "shotmap") {
//       const data = await getShotmap(id);
//       console.dir({ count: data.length, sample: data.slice(0, 3) }, { depth: 3 });
//       return;
//     }
//     if (cmd === "incidents") {
//       const data = await getIncidents(id);
//       console.dir({ count: data.length, sample: data.slice(0, 5) }, { depth: 3 });
//       return;
//     }
//     if (cmd === "stats") {
//       const data = await getStatistics(id);
//       console.dir({ groups: data.length, sampleGroup: data[0] }, { depth: 5 });
//       return;
//     }
//     if (cmd === "search") {
//       const homeTeamId = kv.homeTeamId ? Number(kv.homeTeamId) : undefined;
//       const awayTeamId = kv.awayTeamId ? Number(kv.awayTeamId) : undefined;
//       const page = kv.page ? Number(kv.page) : 1;
//       const limit = kv.limit ? Number(kv.limit) : 5;
//       const incidentType = kv.incidentType;
//       const res = await searchMatches({ homeTeamId, awayTeamId, page, limit, incidentType });
//       console.dir({ total: res.total, items: res.items }, { depth: 2 });
//       return;
//     }

//     console.error("Unknown command:", cmd);
//   } finally {
//     // Stäng anslutningen så processen inte hänger
//     await client.close(true);
//   }
// }

// // Kör endast när filen körs direkt med node (inte vid import)
// const isDirect = import.meta.url === pathToFileURL(process.argv[1]).href
//   || fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "");

// if (isDirect) {
//   mainCLI().catch((e) => {
//     console.error("CLI error:", e);
//     process.exit(1);
//   });
// }


// lib/repos/teamstats.js
// Gör filen säker i Next, men körbar direkt med `node` (utan server-only installerat)
if (process.env.NEXT_RUNTIME) {
  await import("server-only");
}

import { clientPromise } from "../db.js";
import { performance } from "node:perf_hooks";

// ====== Konfig ======
const DB = process.env.MONGODB_DB || "app";
const COL = "teamstats";

// Styr logg med env. Sätt LOG_TEAMSTATS=0 för att tysta.
const LOG = process.env.LOG_TEAMSTATS !== "0";
const tag = "[repo:teamstats]";
const t0 = () => performance.now();
const dt = (t) => `${(performance.now() - t).toFixed(1)}ms`;
const log = (...args) => { if (LOG) console.log(tag, ...args); };

// ====== Helpers ======
// Normalisera olika shotmap-format till en array
function arrifyShotmap(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v.shotmap)) return v.shotmap; // ditt exempel: { shotmap: [...] }
  if (Array.isArray(v.shots)) return v.shots;     // alternativt: { shots: [...] }
  if (Array.isArray(v.data)) return v.data;       // defensiv fallback
  return [];
}

function extractShotmapFromF0(f0) {
  // prova flera sannolika path: f0.shotmap eller f0.matchDetails.shotmap
  const cands = [f0?.shotmap, f0?.matchDetails?.shotmap];
  for (const v of cands) {
    const arr = arrifyShotmap(v);
    if (arr.length) return arr;
  }
  return [];
}

function normalizeOdds(v) {
  if (!v) return null;
  // Tillåt både objekt och array (vissa källor exponerar providers som lista)
  if (Array.isArray(v)) return v;
  if (typeof v === "object") return v;
  return null;
}


function mapMatchDoc(doc) {
  const f0 = Array.isArray(doc.full) ? (doc.full[0] ?? {}) : {};
  const oddsRaw = f0.odds ?? f0.matchDetails?.odds ?? null;

  return {
    matchId: doc._id,
    timestamp: f0.timestamp ?? null,
    homeTeamId: f0.homeTeamId ?? null,
    homeTeamName: f0.homeTeamName ?? null,
    awayTeamId: f0.awayTeamId ?? null,
    awayTeamName: f0.awayTeamName ?? null,
    incidents: Array.isArray(f0.incidents) ? f0.incidents : [],
    shotmap: extractShotmapFromF0(f0),
    odds: normalizeOdds(oddsRaw), // ⬅️ här
    statistics: Array.isArray(f0.matchDetails?.statistics) ? f0.matchDetails.statistics : [],
  };
}


// ====== Publika repo-funktioner ======
export async function getMatch(matchId) {
  const t = t0();
  log("getMatch:start", { matchId: String(matchId) });
  try {
    const client = await clientPromise;
    const col = client.db(DB).collection(COL);
    const doc = await col.findOne(
      { _id: String(matchId) },
      { projection: { _id: 1, full: { $slice: 1 } } }
    );
    const found = !!doc;
    const mapped = doc ? mapMatchDoc(doc) : null;
    log("getMatch:done", { matchId: String(matchId), found, dur: dt(t) });
    return mapped;
  } catch (err) {
    log("getMatch:error", { matchId: String(matchId), err: String(err) });
    throw err;
  }
}

export async function getShotmap(matchId) {
  const t = t0();
  log("getShotmap:start", { matchId: String(matchId) });
  try {
    const client = await clientPromise;
    const col = client.db(DB).collection(COL);
    const doc = await col.findOne(
      { _id: String(matchId) },
      { projection: { _id: 1, full: { $slice: 1 } } }
    );
    const f0 = doc?.full?.[0] || {};
    const arr = extractShotmapFromF0(f0);

    if (!arr.length) {
      // Extra debug för att se hur det ser ut när tomt
      const keys = f0.shotmap ? Object.keys(f0.shotmap) : [];
      log("getShotmap:empty", { hasShotmap: !!f0.shotmap, shotmapKeys: keys, dur: dt(t) });
    } else {
      log("getShotmap:done", { matchId: String(matchId), count: arr.length, dur: dt(t) });
    }
    return arr;
  } catch (err) {
    log("getShotmap:error", { matchId: String(matchId), err: String(err) });
    throw err;
  }
}

export async function getIncidents(matchId) {
  const t = t0();
  log("getIncidents:start", { matchId: String(matchId) });
  try {
    const client = await clientPromise;
    const col = client.db(DB).collection(COL);
    const doc = await col.findOne(
      { _id: String(matchId) },
      { projection: { _id: 1, full: { $slice: 1 } } }
    );
    const arr = Array.isArray(doc?.full?.[0]?.incidents) ? doc.full[0].incidents : [];
    log("getIncidents:done", { matchId: String(matchId), count: arr.length, dur: dt(t) });
    return arr;
  } catch (err) {
    log("getIncidents:error", { matchId: String(matchId), err: String(err) });
    throw err;
  }
}

export async function getStatistics(matchId) {
  const t = t0();
  log("getStatistics:start", { matchId: String(matchId) });
  try {
    const client = await clientPromise;
    const col = client.db(DB).collection(COL);
    const doc = await col.findOne(
      { _id: String(matchId) },
      { projection: { _id: 1, full: { $slice: 1 } } }
    );
    const stats = doc?.full?.[0]?.matchDetails?.statistics;
    const arr = Array.isArray(stats) ? stats : [];
    log("getStatistics:done", { matchId: String(matchId), groups: arr.length, dur: dt(t) });
    return arr;
  } catch (err) {
    log("getStatistics:error", { matchId: String(matchId), err: String(err) });
    throw err;
  }
}


export async function getOdds(matchId) {
  const t = t0();
  log("getOdds:start", { matchId: String(matchId) });
  try {
    const client = await clientPromise;
    const col = client.db(DB).collection(COL);
    const doc = await col.findOne(
      { _id: String(matchId) },
      { projection: { _id: 1, full: { $slice: 1 } } }
    );
    const f0 = doc?.full?.[0] || {};
    // odds kan ligga direkt på f0 eller (ibland) under matchDetails
    const raw = f0.odds ?? f0.matchDetails?.odds ?? null;
    const odds = normalizeOdds(raw);

    // Logga lite insikt utan att dumpa hela strukturen
    const shape = odds
      ? (Array.isArray(odds) ? `array(${odds.length})` : `object(${Object.keys(odds).length} keys)`)
      : "null";
    log("getOdds:done", { matchId: String(matchId), shape, dur: dt(t) });

    return odds;
  } catch (err) {
    log("getOdds:error", { matchId: String(matchId), err: String(err) });
    throw err;
  }
}


/**
 * Sök matcher med filter + pagination.
 * Filtrerar direkt i Mongo på din struktur (full[0].*), och returnerar lättviktiga items.
 */
export async function searchMatches({ homeTeamId, awayTeamId, incidentType, page = 1, limit = 20 }) {
  const t = t0();
  const params = { homeTeamId, awayTeamId, incidentType, page, limit };
  log("searchMatches:start", params);
  try {
    const client = await clientPromise;
    const col = client.db(DB).collection(COL);

    const filter = {};
    if (Number.isFinite(homeTeamId)) filter["full.0.homeTeamId"] = homeTeamId;
    if (Number.isFinite(awayTeamId)) filter["full.0.awayTeamId"] = awayTeamId;
    if (incidentType) filter["full.0.incidents.incidentType"] = incidentType;

    const skip = (Math.max(1, page) - 1) * Math.max(1, limit);
    const lim = Math.max(1, Math.min(100, limit));

    const cursor = col
      .find(filter, { projection: { _id: 1, full: { $slice: 1 } } })
      .sort({ "full.0.timestamp": -1, _id: -1 })
      .skip(skip)
      .limit(lim);

    const [docs, total] = await Promise.all([cursor.toArray(), col.countDocuments(filter)]);

    const items = docs.map((d) => {
      const f0 = Array.isArray(d.full) ? (d.full[0] ?? {}) : {};
      return {
        matchId: d._id,
        homeTeamId: f0.homeTeamId ?? null,
        homeTeamName: f0.homeTeamName ?? null,
        awayTeamId: f0.awayTeamId ?? null,
        awayTeamName: f0.awayTeamName ?? null,
        timestamp: f0.timestamp ?? null,
      };
    });

    log("searchMatches:done", {
      total,
      returned: items.length,
      page: Math.max(1, page),
      limit: lim,
      dur: dt(t),
      filter,
    });

    return { total, items };
  } catch (err) {
    log("searchMatches:error", { err: String(err) });
    throw err;
  }
}

// ====== CLI TEST RUNNER ======
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";

function parseKV(args) {
  const out = {};
  for (const a of args) {
    const m = /^--([^=]+)=(.+)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function mainCLI() {
  const argv = process.argv.slice(2);
  const cmd = argv[0]; // "get" | "shotmap" | "incidents" | "stats" | "search"
  const id  = argv[1]; // matchId (för get/shotmap/incidents/stats)
  const kv  = parseKV(argv.slice(2));

  const client = await clientPromise; // init tidigt för att se connect-logg
  try {
    if (!cmd || cmd === "help") {
      console.log(`
Usage:
  node lib/repos/teamstats.js get <matchId>
  node lib/repos/teamstats.js shotmap <matchId>
  node lib/repos/teamstats.js incidents <matchId>
  node lib/repos/teamstats.js stats <matchId>
  node lib/repos/teamstats.js search [--homeTeamId=5981] [--awayTeamId=1954] [--incidentType=goal] [--page=1] [--limit=5]
`);
      return;
    }

    if (cmd === "get") {
      const data = await getMatch(id);
      console.dir(data, { depth: 3 });
      return;
    }
    if (cmd === "shotmap") {
      const data = await getShotmap(id);
      console.dir({ count: data.length, sample: data.slice(0, 3) }, { depth: 3 });
      return;
    }
    if (cmd === "incidents") {
      const data = await getIncidents(id);
      console.dir({ count: data.length, sample: data.slice(0, 5) }, { depth: 3 });
      return;
    }
    if (cmd === "stats") {
      const data = await getStatistics(id);
      console.dir({ groups: data.length, sampleGroup: data[0] }, { depth: 5 });
      return;
    }

        if (cmd === "odds") {
      const data = await getOdds(id);
      // visa en liten, säker sammanfattning
      if (Array.isArray(data)) {
        console.dir({ type: "array", len: data.length, sample: data.slice(0, 2) }, { depth: 4 });
      } else {
        console.dir({ type: data ? "object" : "null", keys: data ? Object.keys(data).slice(0, 10) : [] }, { depth: 2 });
      }
      return;
    }

    if (cmd === "search") {
      const homeTeamId = kv.homeTeamId ? Number(kv.homeTeamId) : undefined;
      const awayTeamId = kv.awayTeamId ? Number(kv.awayTeamId) : undefined;
      const page = kv.page ? Number(kv.page) : 1;
      const limit = kv.limit ? Number(kv.limit) : 5;
      const incidentType = kv.incidentType;
      const res = await searchMatches({ homeTeamId, awayTeamId, page, limit, incidentType });
      console.dir({ total: res.total, items: res.items }, { depth: 2 });
      return;
    }

    console.error("Unknown command:", cmd);
  } finally {
    // Stäng anslutningen så processen inte hänger
    await client.close(true);
  }
}

// Kör endast när filen körs direkt med node (inte vid import)
const isDirect = import.meta.url === pathToFileURL(process.argv[1]).href
  || fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "");

if (isDirect) {
  mainCLI().catch((e) => {
    console.error("CLI error:", e);
    process.exit(1);
  });
}
