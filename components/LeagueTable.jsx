// // // "use client";

// // // const LEAGUE_ORDER = [17, 8, 35, 23, 325, 34]

// // // function pick(v, paths, fallback = null) {
// // //   for (const p of paths) {
// // //     const val = p.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), v);
// // //     if (val != null) return val;
// // //   }
// // //   return fallback;
// // // }

// // // function normalize(item) {
// // //   const id = String(pick(item, ["id", "matchId", "event.id", "event.matchId"], crypto.randomUUID()));
// // //   const leagueId = Number(pick(item, [
// // //     "tournament.uniqueTournament.id",
// // //     "uniqueTournament.id",
// // //     "tournament.id",
// // //     "event.tournament.uniqueTournament.id",
// // //     "event.tournament.id",
// // //   ], 0)) || 0;

// // //   const leagueName = pick(item, [
// // //     "tournament.name",
// // //     "event.tournament.name",
// // //     "league.name"
// // //   ], "Unknown");

// // //   const home = pick(item, ["homeTeam.name", "event.homeTeam.name", "home.name", "teams.home.name"], "—");
// // //   const away = pick(item, ["awayTeam.name", "event.awayTeam.name", "away.name", "teams.away.name"], "—");
// // //   const ts = Number(pick(item, ["startTimestamp", "event.startTimestamp", "timestamp", "kickoffTime"], null)) || null;

// // //   return { id, leagueId, leagueName, home, away, ts };
// // // }

// // // export default function LeagueTable({ items, formatTime /* fn(ts)->"HH:mm" */ }) {
// // //   const rows = (items || []).map(normalize);
  
// // //   //rows.sort((a, b) => (a.leagueName.localeCompare(b.leagueName)) || ((a.ts || 0) - (b.ts || 0)));

// // //   // group by leagueName
// // //   const groups = new Map();
// // //   for (const r of rows) {
// // //     const key = `${r.leagueId}:${r.leagueName}`;
// // //     if (!groups.has(key)) groups.set(key, []);
// // //     groups.get(key).push(r);
// // //   }

// // //   if (!rows.length) {
// // //     return <div style={{ marginTop: 24, padding: 16, border: "1px solid #eee", borderRadius: 8, background: "#fafafa" }}>
// // //       Inga matcher för valt datum.
// // //     </div>;
// // //   }

// // //   return (
// // //     <div style={{ marginTop: 16 }}>
// // //       {[...groups.entries()].map(([key, list]) => {
// // //         const [, leagueName] = key.split(":");
// // //         return (
// // //           <section key={key} style={{ marginBottom: 24 }}>
// // //             <h2 style={{ margin: "12px 0 8px", fontSize: 18 }}>{leagueName}</h2>
// // //             <table style={{ width: "100%", borderCollapse: "collapse" }}>
// // //               <thead>
// // //                 <tr>
// // //                   <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #eee", width: 70 }}>Tid</th>
// // //                   <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #eee" }}>Match</th>
// // //                   <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid #eee", width: 140 }}>ID</th>
// // //                 </tr>
// // //               </thead>
// // //               <tbody>
// // //                 {list.map(r => (
// // //                   <tr key={r.id}>
// // //                     <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4", fontVariantNumeric: "tabular-nums" }}>
// // //                       {r.ts ? formatTime(r.ts) : "—"}
// // //                     </td>
// // //                     <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4" }}>
// // //                       <strong>{r.home}</strong> <span style={{ color: "#999" }}>vs</span> <strong>{r.away}</strong>
// // //                     </td>
// // //                     <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4", textAlign: "right", color: "#777" }}>
// // //                       <code style={{ background: "#f6f6f6", padding: "2px 6px", borderRadius: 4 }}>{r.id}</code>
// // //                     </td>
// // //                   </tr>
// // //                 ))}
// // //               </tbody>
// // //             </table>
// // //           </section>
// // //         );
// // //       })}
// // //     </div>
// // //   );
// // // }


// // "use client";

// // // HÅRDKODAD ORDNING (ligor som inte finns här hamnar sist, alfabetiskt)
// // const LEAGUE_ORDER = [17, 8, 35, 23, 325, 34];

// // function pick(v, paths, fallback = null) {
// //   for (const p of paths) {
// //     const val = p.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), v);
// //     if (val != null) return val;
// //   }
// //   return fallback;
// // }

// // function normalize(item) {
// //   const id = String(pick(item, ["id", "matchId", "event.id", "event.matchId"], crypto.randomUUID()));
// //   const leagueId = Number(
// //     pick(item, [
// //       "tournament.uniqueTournament.id",
// //       "uniqueTournament.id",
// //       "tournament.id",
// //       "event.tournament.uniqueTournament.id",
// //       "event.tournament.id",
// //     ], 0)
// //   ) || 0;

// //   const leagueName = pick(item, [
// //     "tournament.name",
// //     "event.tournament.name",
// //     "league.name",
// //   ], "Unknown");

// //   const home = pick(item, ["homeTeam.name", "event.homeTeam.name", "home.name", "teams.home.name"], "—");
// //   const away = pick(item, ["awayTeam.name", "event.awayTeam.name", "away.name", "teams.away.name"], "—");
// //   const ts = Number(pick(item, ["startTimestamp", "event.startTimestamp", "timestamp", "kickoffTime"], null)) || null;

// //   return { id, leagueId, leagueName, home, away, ts };
// // }

// // export default function LeagueTable({ items, formatTime }) {
// //   const rows = (items || []).map(normalize);

// //   // group by leagueId+name
// //   const groups = new Map();
// //   for (const r of rows) {
// //     const key = `${r.leagueId}:${r.leagueName}`;
// //     if (!groups.has(key)) groups.set(key, []);
// //     groups.get(key).push(r);
// //   }

// //   const entries = [...groups.entries()];

// //   // sortera grupper enligt LEAGUE_ORDER, okända sist (alfabetiskt)
// //   const indexOf = (id) => {
// //     const i = LEAGUE_ORDER.indexOf(Number(id));
// //     return i === -1 ? Number.POSITIVE_INFINITY : i;
// //   };
// //   entries.sort((a, b) => {
// //     const [akey] = a;
// //     const [bkey] = b;
// //     const [aid, aname] = akey.split(":");
// //     const [bid, bname] = bkey.split(":");
// //     const ai = indexOf(aid);
// //     const bi = indexOf(bid);
// //     if (ai !== bi) return ai - bi;               // primär sortering: hårdkodad ordning
// //     return aname.localeCompare(bname, "sv");     // sekundär: namn
// //   });

// //   if (rows.length === 0) {
// //     return (
// //       <div style={{ marginTop: 24, padding: 16, border: "1px solid #eee", borderRadius: 8, background: "#fafafa" }}>
// //         Inga matcher för valt datum.
// //       </div>
// //     );
// //   }

// //   return (
// //     <div style={{ marginTop: 16 }}>
// //       {entries.map(([key, list]) => {
// //         const [, leagueName] = key.split(":");
// //         list.sort((x, y) => (x.ts ?? 0) - (y.ts ?? 0)); // sortera matcher i ligan på tid
// //         return (
// //           <section key={key} style={{ marginBottom: 24 }}>
// //             <h2 style={{ margin: "12px 0 8px", fontSize: 18 }}>{leagueName}</h2>
// //             <table style={{ width: "100%", borderCollapse: "collapse" }}>
// //               <thead>
// //                 <tr>
// //                   <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #eee", width: 70 }}>Tid</th>
// //                   <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #eee" }}>Match</th>
// //                   <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid #eee", width: 140 }}>ID</th>
// //                 </tr>
// //               </thead>
// //               <tbody>
// //                 {list.map(r => (
// //                   <tr key={r.id}>
// //                     <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4", fontVariantNumeric: "tabular-nums" }}>
// //                       {r.ts ? formatTime(r.ts) : "—"}
// //                     </td>
// //                     <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4" }}>
// //                       <strong>{r.home}</strong> <span style={{ color: "#999" }}>vs</span> <strong>{r.away}</strong>
// //                     </td>
// //                     <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4", textAlign: "right", color: "#777" }}>
// //                       <code style={{ background: "#f6f6f6", padding: "2px 6px", borderRadius: 4 }}>{r.id}</code>
// //                     </td>
// //                   </tr>
// //                 ))}
// //               </tbody>
// //             </table>
// //           </section>
// //         );
// //       })}
// //     </div>
// //   );
// // }

// "use client";

// import { useMemo, useState } from "react";
// import Image from "next/image";

// // HÅRDKODAD ORDNING (ligor som inte finns här hamnar sist, alfabetiskt)
// const LEAGUE_ORDER = [17, 8, 35, 23, 325, 34];

// /* ----------------------------- helpers ----------------------------- */

// function pick(v, paths, fallback = null) {
//   for (const p of paths) {
//     const val = p.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), v);
//     if (val != null) return val;
//   }
//   return fallback;
// }

// function slugify(s) {
//   return String(s || "")
//     .toLowerCase()
//     .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // ta bort diakritiska tecken
//     .replace(/[^a-z0-9]+/g, "-")
//     .replace(/(^-|-$)/g, "");
// }

// function normalize(item) {
//   const id = String(
//     pick(item, ["id", "matchId", "event.id", "event.matchId"], crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
//   );

//   const leagueId =
//     Number(
//       pick(item, [
//         "tournament.uniqueTournament.id",
//         "uniqueTournament.id",
//         "tournament.id",
//         "event.tournament.uniqueTournament.id",
//         "event.tournament.id",
//       ], 0)
//     ) || 0;

//   const leagueName = pick(item, [
//     "tournament.name",
//     "event.tournament.name",
//     "league.name",
//   ], "Unknown");

//   const home = pick(item, ["homeTeam.name", "event.homeTeam.name", "home.name", "teams.home.name"], "—");
//   const away = pick(item, ["awayTeam.name", "event.awayTeam.name", "away.name", "teams.away.name"], "—");

//   const homeId = Number(pick(item, ["homeTeam.id", "event.homeTeam.id", "home.id", "teams.home.id"], 0)) || 0;
//   const awayId = Number(pick(item, ["awayTeam.id", "event.awayTeam.id", "away.id", "teams.away.id"], 0)) || 0;

//   const ts = Number(pick(item, ["startTimestamp", "event.startTimestamp", "timestamp", "kickoffTime"], null)) || null;

//   return { id, leagueId, leagueName, home, away, homeId, awayId, ts };
// }

// /** Kandidater för laglogga i /public */
// function teamLogoCandidates(id) {
//   if (!id) return ["/images/teams/placeholder.png"];
//   return [
//     `/images/teams/${id}.png`,
//     `/images/teams/${id}.svg`,
//     `/images/teams/${id}@2x.png`,
//     "/images/teams/placeholder.png",
//   ];
// }

// /** Kandidater för ligalogo i /public
//  *  Försöker: slug (t.ex. "ligue-1"), png, svg, fall­back till id-baserad fil och sedan placeholder.
//  */
// function leagueLogoCandidates(leagueId, leagueName) {
//   const slug = slugify(leagueName);
//   return [
//     `/images/league/${slug}.png`,
//     `/images/league/${slug}.svg`,
//     `/images/league/${leagueId}.png`,
//     `/images/league/${leagueId}.svg`,
//     "/images/placeholder.png",
//   ];
// }

// /** <Image> med fallback-lista: provar kandidater i ordning tills en laddar */
// function ImgWithFallback({ candidates, alt = "", size = 20, style }) {
//   const [idx, setIdx] = useState(0);
//   const src = candidates[idx] || "/images/placeholder.png";
//   return (
//     <Image
//       src={src}
//       alt={alt}
//       width={size}
//       height={size}
//       loading="lazy"
//       onError={() => setIdx((i) => Math.min(i + 1, candidates.length - 1))}
//       style={{ objectFit: "contain", borderRadius: 3, ...style }}
//     />
//   );
// }

// /* --------------------------------- UI ---------------------------------- */

// export default function LeagueTable({ items, formatTime /* fn(ts)->"HH:mm" */ }) {
//   const rows = useMemo(() => {
//     const arr = Array.isArray(items) ? items.map(normalize) : [];
//     return arr;
//   }, [items]);

//   // group by leagueId:name
//   const groups = useMemo(() => {
//     const m = new Map();
//     for (const r of rows) {
//       const key = `${r.leagueId}:${r.leagueName}`;
//       if (!m.has(key)) m.set(key, []);
//       m.get(key).push(r);
//     }
//     return m;
//   }, [rows]);

//   // sortera grupper enligt LEAGUE_ORDER; okända sist (alfabetiskt)
//   const entries = useMemo(() => {
//     const list = [...groups.entries()];
//     const indexOf = (id) => {
//       const i = LEAGUE_ORDER.indexOf(Number(id));
//       return i === -1 ? Number.POSITIVE_INFINITY : i;
//     };
//     list.sort((a, b) => {
//       const [akey] = a;
//       const [bkey] = b;
//       const [aid, aname] = akey.split(":");
//       const [bid, bname] = bkey.split(":");
//       const ai = indexOf(aid);
//       const bi = indexOf(bid);
//       if (ai !== bi) return ai - bi;                 // primär: hårdkodad ordning
//       return aname.localeCompare(bname, "sv");       // sekundär: namn
//     });
//     return list;
//   }, [groups]);

//   if (!rows.length) {
//     return (
//       <div style={{ marginTop: 24, padding: 16, border: "1px solid #eee", borderRadius: 8, background: "#fafafa" }}>
//         Inga matcher för valt datum.
//       </div>
//     );
//   }

//   return (
//     <div style={{ marginTop: 16 }}>
//       {entries.map(([key, list]) => {
//         const [leagueIdStr, leagueName] = key.split(":");
//         const leagueId = Number(leagueIdStr) || 0;

//         // sortera matcher i ligan på tid
//         list.sort((x, y) => (x.ts ?? 0) - (y.ts ?? 0));

//         return (
//           <section key={key} style={{ marginBottom: 28 }}>
//             <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 10px" }}>
//               <ImgWithFallback
//                 candidates={leagueLogoCandidates(leagueId, leagueName)}
//                 alt={leagueName}
//                 size={22}
//                 style={{ background: "#fff", border: "1px solid #eee" }}
//               />
//               <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{leagueName}</h2>
//             </div>

//             <table style={{ width: "100%", borderCollapse: "collapse" }}>
//               <thead>
//                 <tr>
//                   <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #eee", width: 70, fontWeight: 600 }}>
//                     Tid
//                   </th>
//                   <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #eee", fontWeight: 600 }}>
//                     Match
//                   </th>
//                   <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid #eee", width: 140, fontWeight: 600 }}>
//                     ID
//                   </th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {list.map((r) => (
//                   <tr key={r.id}>
//                     <td
//                       style={{
//                         padding: "10px 6px",
//                         borderBottom: "1px solid #f4f4f4",
//                         fontVariantNumeric: "tabular-nums",
//                         color: "#333",
//                       }}
//                     >
//                       {r.ts ? formatTime(r.ts) : "—"}
//                     </td>

//                     <td style={{ padding: "10px 6px", borderBottom: "1px solid #f4f4f4" }}>
//                       <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
//                         <ImgWithFallback
//                           candidates={teamLogoCandidates(r.homeId)}
//                           alt={r.home}
//                           size={20}
//                           style={{ background: "#fff", border: "1px solid #eee" }}
//                         />
//                         <strong style={{ whiteSpace: "nowrap" }}>{r.home}</strong>
//                         <span style={{ color: "#999" }}>vs</span>
//                         <ImgWithFallback
//                           candidates={teamLogoCandidates(r.awayId)}
//                           alt={r.away}
//                           size={20}
//                           style={{ background: "#fff", border: "1px solid #eee" }}
//                         />
//                         <strong style={{ whiteSpace: "nowrap" }}>{r.away}</strong>
//                       </div>
//                     </td>

//                     <td
//                       style={{
//                         padding: "10px 6px",
//                         borderBottom: "1px solid #f4f4f4",
//                         textAlign: "right",
//                         color: "#777",
//                       }}
//                     >
//                       <code style={{ background: "#f6f6f6", padding: "2px 6px", borderRadius: 4 }}>
//                         {r.id}
//                       </code>
//                     </td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           </section>
//         );
//       })}
//     </div>
//   );
// }



"use client";

import { useMemo, useState, useCallback } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

// HÅRDKODAD ORDNING (ligor som inte finns här hamnar sist, alfabetiskt)
const LEAGUE_ORDER = [17, 8, 35, 23, 325, 34];

/* ----------------------------- helpers ----------------------------- */

function pick(v, paths, fallback = null) {
  for (const p of paths) {
    const val = p.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), v);
    if (val != null) return val;
  }
  return fallback;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalize(item) {
  const id = String(
    pick(item, ["id", "matchId", "event.id", "event.matchId"], crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
  );

  const leagueId =
    Number(
      pick(item, [
        "tournament.uniqueTournament.id",
        "uniqueTournament.id",
        "tournament.id",
        "event.tournament.uniqueTournament.id",
        "event.tournament.id",
      ], 0)
    ) || 0;

  const leagueName = pick(item, [
    "tournament.name",
    "event.tournament.name",
    "league.name",
  ], "Unknown");

  const home = pick(item, ["homeTeam.name", "event.homeTeam.name", "home.name", "teams.home.name"], "—");
  const away = pick(item, ["awayTeam.name", "event.awayTeam.name", "away.name", "teams.away.name"], "—");

  const homeId = Number(pick(item, ["homeTeam.id", "event.homeTeam.id", "home.id", "teams.home.id"], 0)) || 0;
  const awayId = Number(pick(item, ["awayTeam.id", "event.awayTeam.id", "away.id", "teams.away.id"], 0)) || 0;

  const ts = Number(pick(item, ["startTimestamp", "event.startTimestamp", "timestamp", "kickoffTime"], null)) || null;

  return { id, leagueId, leagueName, home, away, homeId, awayId, ts };
}

/** Kandidater för laglogga i /public */
function teamLogoCandidates(id) {
  if (!id) return ["/images/teams/placeholder.png"];
  return [
    `/images/teams/${id}.png`,
    `/images/teams/${id}.svg`,
    `/images/teams/${id}@2x.png`,
    "/images/teams/placeholder.png",
  ];
}

/** Kandidater för ligalogo i /public */
function leagueLogoCandidates(leagueId, leagueName) {
  const slug = slugify(leagueName);
  return [
    `/images/league/${slug}.png`,
    `/images/league/${slug}.svg`,
    `/images/league/${leagueId}.png`,
    `/images/league/${leagueId}.svg`,
    "/images/placeholder.png",
  ];
}

/** <Image> med fallback-lista: provar kandidater i ordning tills en laddar */
function ImgWithFallback({ candidates, alt = "", size = 20, style }) {
  const [idx, setIdx] = useState(0);
  const src = candidates[idx] || "/images/placeholder.png";
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setIdx((i) => Math.min(i + 1, candidates.length - 1))}
      style={{ objectFit: "contain", borderRadius: 3, ...style }}
    />
  );
}

/* --------------------------------- UI ---------------------------------- */

export default function LeagueTable({ items, formatTime /* fn(ts)->"HH:mm" */ }) {
  const router = useRouter();

  const rows = useMemo(() => {
    const arr = Array.isArray(items) ? items.map(normalize) : [];
    return arr;
  }, [items]);

  // group by leagueId:name
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const key = `${r.leagueId}:${r.leagueName}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(r);
    }
    return m;
  }, [rows]);

  // sortera grupper enligt LEAGUE_ORDER; okända sist (alfabetiskt)
  const entries = useMemo(() => {
    const list = [...groups.entries()];
    const indexOf = (id) => {
      const i = LEAGUE_ORDER.indexOf(Number(id));
      return i === -1 ? Number.POSITIVE_INFINITY : i;
    };
    list.sort((a, b) => {
      const [akey] = a;
      const [bkey] = b;
      const [aid, aname] = akey.split(":");
      const [bid, bname] = bkey.split(":");
      const ai = indexOf(aid);
      const bi = indexOf(bid);
      if (ai !== bi) return ai - bi;
      return aname.localeCompare(bname, "sv");
    });
    return list;
  }, [groups]);

  const onRowClick = useCallback((matchId) => {
    // Navigera vidare när man klickar på raden; matchId används här men visas inte för användaren
    router.push(`/match/${matchId}`);
  }, [router]);

  if (!rows.length) {
    return (
      <div style={{ marginTop: 24, padding: 16, border: "1px solid #eee", borderRadius: 8, background: "#fafafa" }}>
        Inga matcher för valt datum.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      {entries.map(([key, list]) => {
        const [leagueIdStr, leagueName] = key.split(":");
        const leagueId = Number(leagueIdStr) || 0;

        // sortera matcher i ligan på tid
        list.sort((x, y) => (x.ts ?? 0) - (y.ts ?? 0));

        return (
          <section key={key} style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 10px" }}>
              <ImgWithFallback
                candidates={leagueLogoCandidates(leagueId, leagueName)}
                alt={leagueName}
                size={22}
                style={{ background: "#fff", border: "1px solid #eee" }}
              />
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{leagueName}</h2>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 6px",
                      borderBottom: "1px solid #eee",
                      width: 70,
                      fontWeight: 600,
                    }}
                  >
                    Tid
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 6px",
                      borderBottom: "1px solid #eee",
                      fontWeight: 600,
                    }}
                  >
                    Match
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onRowClick(r.id)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onRowClick(r.id)}
                    style={{ cursor: "pointer" }}
                    data-matchid={r.id} // ID kvar i DOM men ej visat
                    title={`Öppna match ${r.id}`}
                  >
                    <td
                      style={{
                        padding: "10px 6px",
                        borderBottom: "1px solid #f4f4f4",
                        fontVariantNumeric: "tabular-nums",
                        color: "#333",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.ts ? formatTime(r.ts) : "—"}
                    </td>

                    {/* MATCHCELL: 3-kolumners grid → home (vänster), vs (centrerad), away (vänster) */}
                    <td
                      style={{
                        padding: "10px 6px",
                        borderBottom: "1px solid #f4f4f4",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "0.75fr 32px 1fr",
                          alignItems: "center",
                          columnGap: 12,
                          whiteSpace: "nowrap",          // ingen radbrytning
                          overflow: "hidden",            // aldrig overflow
                        }}
                      >
                        {/* Hemma – vänsterjusterad, logga + namn */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                            justifyContent: "flex-start",
                            overflow: "hidden",
                          }}
                        >
                          <ImgWithFallback
                            candidates={teamLogoCandidates(r.homeId)}
                            alt={r.home}
                            size={20}
                            style={{ background: "#fff", border: "1px solid #eee" }}
                          />
                          <strong
                            style={{
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {r.home}
                          </strong>
                        </div>

                        {/* VS – centrerad */}
                        <div
                          style={{
                            textAlign: "center",
                            color: "#999",
                            fontWeight: 500,
                            marginRight: "10px",
                          }}
                        >
                          vs
                        </div>

                        {/* Borta – vänsterjusterad, logga + namn */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                            justifyContent: "flex-start",
                            overflow: "hidden",
                            paddingLeft: "30px",
                          }}
                        >
                          <ImgWithFallback
                            candidates={teamLogoCandidates(r.awayId)}
                            alt={r.away}
                            size={20}
                            style={{
                              background: "#fff", border: "1px solid #eee"}}
                                />
                                <strong
                                  style={{
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {r.away}
                                </strong>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  )
}

