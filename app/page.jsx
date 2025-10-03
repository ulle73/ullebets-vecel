// app/page.jsx
export const dynamic = "force-dynamic";

import { SWRConfig } from "swr";
import MatchesClient from "./matches-client";
import { todaySE, tomorrowSE } from "@/lib/utils/date";
import { getMatchesForDate } from "@/lib/repos/fixtures";

export default async function Page() {
  const today = todaySE();
  const tomorrow = tomorrowSE();

  const [todayItems, tomorrowItems] = await Promise.all([
    getMatchesForDate(today),
    getMatchesForDate(tomorrow),
  ]);

  const fallback = {
    [`/api/matches/by-date?date=${today}`]: { date: today, items: todayItems },
    [`/api/matches/by-date?date=${tomorrow}`]: { date: tomorrow, items: tomorrowItems },
  };

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Matcher</h1>
      <p style={{ marginTop: 8, color: "#666" }}>
        Prefetch: <code>{today}</code> &nbsp;och&nbsp; <code>{tomorrow}</code>
      </p>

      <SWRConfig value={{ fallback }}>
        <MatchesClient defaultDate={today} />
      </SWRConfig>
    </main>
  );
}