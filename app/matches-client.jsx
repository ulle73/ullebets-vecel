// "use client";

//   import useSWR from "swr";
//   import { useState, useMemo, useMemo as useMemo2 } from "react";
//   import DatePicker from "@/components/DatePicker";
//   import LeagueTable from "@/components/LeagueTable";

//   const fetcher = (url) => fetch(url).then(r => {
//     if (!r.ok) throw new Error(`HTTP ${r.status}`);
//     return r.json();
//   });

//   export default function MatchesClient({ defaultDate }) {
//     const [date, setDate] = useState(defaultDate);

//     const { data, error, isLoading } = useSWR(
//       date ? `/api/matches/by-date?date=${date}` : null,
//       fetcher,
//       {
//         revalidateOnFocus: false,
//         dedupingInterval: 60_000,
//         keepPreviousData: true,
//       }
//     );

//     const items = useMemo(() => data?.items ?? [], [data]);

//     // Lokal formatterare på klienten (svensk tid)
//     const fmt = useMemo2(
//       () =>
//         new Intl.DateTimeFormat("sv-SE", {
//           hour: "2-digit",
//           minute: "2-digit",
//           hour12: false,
//           timeZone: "Europe/Stockholm",
//         }),
//       []
//     );
//     const formatTime = (ts) => (ts ? fmt.format(new Date(ts * 1000)) : "—");

//     return (
//       <div>
//         <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "12px 0 8px" }}>
//           <DatePicker value={date} onChange={setDate} />
//           <div style={{ color: "#888", fontSize: 14 }}>
//             {error ? "Fel vid hämtning." : isLoading ? "Laddar…" : `Matcher: ${items.length}`}
//           </div>
//         </div>

//         <LeagueTable items={items} formatTime={formatTime} />
//       </div>
//     );
//   }
 

"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";
import DatePicker from "@/components/DatePicker";
import LeagueTable from "@/components/LeagueTable";

const fetcher = (url) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

// Hjälp: plocka ut timestamp från "rå" fixture
const getTs = (e) =>
  Number(
    e?.startTimestamp ??
    e?.event?.startTimestamp ??
    e?.timestamp ??
    e?.kickoffTime ??
    0
  ) || 0;

// Format "HH:mm" i svensk tid
function makeFmtSE() {
  return new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Stockholm",
  });
}

// YYYY-MM-DD i svensk tid
function ymdSEFromTs(ts) {
  const d = new Date(ts * 1000);
  // toLocaleDateString('sv-SE') ger redan "YYYY-MM-DD"
  return d.toLocaleDateString("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function MatchesClient({ defaultDate }) {
  const [date, setDate] = useState(defaultDate);

  const { data, error, isLoading } = useSWR(
    date ? `/api/matches/by-date?date=${date}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
      keepPreviousData: true,
    }
  );

  const allItems = useMemo(() => data?.items ?? [], [data]);

  // *** Viktigt: visa bara matcher vars lokala (SE) datum === valt datum ***
  const items = useMemo(
    () => allItems.filter((e) => {
      const ts = getTs(e);
      if (!ts) return false;
      return ymdSEFromTs(ts) === date;
    }),
    [allItems, date]
  );

  const fmt = useMemo(makeFmtSE, []);
  const formatTime = (ts) => (ts ? fmt.format(new Date(ts * 1000)) : "—");

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "12px 0 8px" }}>
        <DatePicker value={date} onChange={setDate} />
        <div style={{ color: "#888", fontSize: 14 }}>
          {error ? "Fel vid hämtning." : isLoading ? "Laddar…" : `Matcher: ${items.length}`}
        </div>
      </div>

      <LeagueTable items={items} formatTime={formatTime} />
    </div>
  );
}