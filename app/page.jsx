// app/page.jsx
export const dynamic = "force-dynamic";

import { SWRConfig } from "swr";
import MatchesClient from "./matches-client";
import { todaySE, tomorrowSE } from "@/lib/utils/date";
import { getMatchesForDate } from "@/lib/repos/fixtures";
import ErrorBoundary from "@/components/ErrorBoundary";
import { buildMatchesByDateKey } from "@/lib/utils/apiKeys";

export default async function Page() {
  const today = todaySE();
  const tomorrow = tomorrowSE();
  
  //testt föra tt see att ändringar sparas

  const [todayItems, tomorrowItems] = await Promise.all([
    getMatchesForDate(today),
    getMatchesForDate(tomorrow),
  ]);

  const todayKey = buildMatchesByDateKey(today);
  const tomorrowKey = buildMatchesByDateKey(tomorrow);

  const fallback = {
    [todayKey]: { date: today, items: todayItems },
    [tomorrowKey]: { date: tomorrow, items: tomorrowItems },
  };

  return (
    <main className="flex min-h-screen flex-col overflow-x-hidden bg-gray-50 lg:h-screen lg:overflow-hidden">
      <header className="flex-shrink-0 px-4 pt-6 pb-2 sm:px-6">
        <h1 className="text-xl font-black uppercase tracking-widest text-slate-100/90">Dagens Matcher</h1>
        <div className="h-0.5 w-12 bg-cyan-500/50 mt-2 mb-2 rounded-full" />
      </header>

      <SWRConfig value={{ fallback }}>
        <section className="flex-1 overflow-visible lg:overflow-hidden">
          <ErrorBoundary resetKeys={[today, tomorrow]}>
            <MatchesClient defaultDate={today} initialFallback={fallback} />
          </ErrorBoundary>
        </section>
      </SWRConfig>
    </main>
  );
}