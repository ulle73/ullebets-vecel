// "use client";

// const LEAGUE_ORDER = [17, 8, 35, 23, 325, 34]

// function pick(v, paths, fallback = null) {
//   for (const p of paths) {
//     const val = p.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), v);
//     if (val != null) return val;
//   }
//   return fallback;
// }

// function normalize(item) {
//   const id = String(pick(item, ["id", "matchId", "event.id", "event.matchId"], crypto.randomUUID()));
//   const leagueId = Number(pick(item, [
//     "tournament.uniqueTournament.id",
//     "uniqueTournament.id",
//     "tournament.id",
//     "event.tournament.uniqueTournament.id",
//     "event.tournament.id",
//   ], 0)) || 0;

//   const leagueName = pick(item, [
//     "tournament.name",
//     "event.tournament.name",
//     "league.name"
//   ], "Unknown");

//   const home = pick(item, ["homeTeam.name", "event.homeTeam.name", "home.name", "teams.home.name"], "—");
//   const away = pick(item, ["awayTeam.name", "event.awayTeam.name", "away.name", "teams.away.name"], "—");
//   const ts = Number(pick(item, ["startTimestamp", "event.startTimestamp", "timestamp", "kickoffTime"], null)) || null;

//   return { id, leagueId, leagueName, home, away, ts };
// }

// export default function LeagueTable({ items, formatTime /* fn(ts)->"HH:mm" */ }) {
//   const rows = (items || []).map(normalize);
  
//   //rows.sort((a, b) => (a.leagueName.localeCompare(b.leagueName)) || ((a.ts || 0) - (b.ts || 0)));

//   // group by leagueName
//   const groups = new Map();
//   for (const r of rows) {
//     const key = `${r.leagueId}:${r.leagueName}`;
//     if (!groups.has(key)) groups.set(key, []);
//     groups.get(key).push(r);
//   }

//   if (!rows.length) {
//     return <div style={{ marginTop: 24, padding: 16, border: "1px solid #eee", borderRadius: 8, background: "#fafafa" }}>
//       Inga matcher för valt datum.
//     </div>;
//   }

//   return (
//     <div style={{ marginTop: 16 }}>
//       {[...groups.entries()].map(([key, list]) => {
//         const [, leagueName] = key.split(":");
//         return (
//           <section key={key} style={{ marginBottom: 24 }}>
//             <h2 style={{ margin: "12px 0 8px", fontSize: 18 }}>{leagueName}</h2>
//             <table style={{ width: "100%", borderCollapse: "collapse" }}>
//               <thead>
//                 <tr>
//                   <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #eee", width: 70 }}>Tid</th>
//                   <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #eee" }}>Match</th>
//                   <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid #eee", width: 140 }}>ID</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {list.map(r => (
//                   <tr key={r.id}>
//                     <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4", fontVariantNumeric: "tabular-nums" }}>
//                       {r.ts ? formatTime(r.ts) : "—"}
//                     </td>
//                     <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4" }}>
//                       <strong>{r.home}</strong> <span style={{ color: "#999" }}>vs</span> <strong>{r.away}</strong>
//                     </td>
//                     <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4", textAlign: "right", color: "#777" }}>
//                       <code style={{ background: "#f6f6f6", padding: "2px 6px", borderRadius: 4 }}>{r.id}</code>
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

// HÅRDKODAD ORDNING (ligor som inte finns här hamnar sist, alfabetiskt)
const LEAGUE_ORDER = [17, 8, 35, 23, 325, 34];

function pick(v, paths, fallback = null) {
  for (const p of paths) {
    const val = p.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), v);
    if (val != null) return val;
  }
  return fallback;
}

function normalize(item) {
  const id = String(pick(item, ["id", "matchId", "event.id", "event.matchId"], crypto.randomUUID()));
  const leagueId = Number(
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
  const ts = Number(pick(item, ["startTimestamp", "event.startTimestamp", "timestamp", "kickoffTime"], null)) || null;

  return { id, leagueId, leagueName, home, away, ts };
}

export default function LeagueTable({ items, formatTime }) {
  const rows = (items || []).map(normalize);

  // group by leagueId+name
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.leagueId}:${r.leagueName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const entries = [...groups.entries()];

  // sortera grupper enligt LEAGUE_ORDER, okända sist (alfabetiskt)
  const indexOf = (id) => {
    const i = LEAGUE_ORDER.indexOf(Number(id));
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  entries.sort((a, b) => {
    const [akey] = a;
    const [bkey] = b;
    const [aid, aname] = akey.split(":");
    const [bid, bname] = bkey.split(":");
    const ai = indexOf(aid);
    const bi = indexOf(bid);
    if (ai !== bi) return ai - bi;               // primär sortering: hårdkodad ordning
    return aname.localeCompare(bname, "sv");     // sekundär: namn
  });

  if (rows.length === 0) {
    return (
      <div style={{ marginTop: 24, padding: 16, border: "1px solid #eee", borderRadius: 8, background: "#fafafa" }}>
        Inga matcher för valt datum.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      {entries.map(([key, list]) => {
        const [, leagueName] = key.split(":");
        list.sort((x, y) => (x.ts ?? 0) - (y.ts ?? 0)); // sortera matcher i ligan på tid
        return (
          <section key={key} style={{ marginBottom: 24 }}>
            <h2 style={{ margin: "12px 0 8px", fontSize: 18 }}>{leagueName}</h2>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #eee", width: 70 }}>Tid</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #eee" }}>Match</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid #eee", width: 140 }}>ID</th>
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id}>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4", fontVariantNumeric: "tabular-nums" }}>
                      {r.ts ? formatTime(r.ts) : "—"}
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4" }}>
                      <strong>{r.home}</strong> <span style={{ color: "#999" }}>vs</span> <strong>{r.away}</strong>
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4", textAlign: "right", color: "#777" }}>
                      <code style={{ background: "#f6f6f6", padding: "2px 6px", borderRadius: 4 }}>{r.id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}