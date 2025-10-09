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
    <main className="flex h-screen flex-col overflow-hidden bg-gray-50">
      <header className="flex-shrink-0 px-4 pt-6 pb-2 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Matcher</h1>
        <p className="mt-1 text-sm text-gray-600">
          Prefetch: <code className="bg-gray-100 px-1 py-0.5 rounded">{today}</code> &nbsp;och&nbsp;
          <code className="bg-gray-100 px-1 py-0.5 rounded">{tomorrow}</code>
        </p>
      </header>

      <SWRConfig value={{ fallback }}>
        <section className="flex-1 overflow-hidden pb-8">
          <ErrorBoundary resetKeys={[today, tomorrow]}>
            <MatchesClient defaultDate={today} initialFallback={fallback} />
          </ErrorBoundary>
        </section>
      </SWRConfig>
    </main>
  );
}