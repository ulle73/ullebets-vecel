// app/ai/page.jsx
export const dynamic = "force-dynamic";

import { SWRConfig } from "swr";
import AIWorkspace from "@/ai/components/AIWorkspace";
import ErrorBoundary from "@/components/ErrorBoundary";
import { todaySE, tomorrowSE } from "@/lib/utils/date";
import { getMatchesForDate } from "@/lib/repos/fixtures";
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
    <main className="flex min-h-screen flex-col overflow-x-hidden bg-slate-900 lg:h-screen lg:overflow-hidden">
      <header className="flex-shrink-0 px-4 pt-6 pb-2 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight text-emerald-300">AI Workspace</h1>
        <p className="mt-1 text-sm text-slate-400">
          Prefetched fixtures for <code className="rounded bg-slate-800 px-1 py-0.5 text-xs text-slate-200">{today}</code>
        </p>
      </header>

      <SWRConfig value={{ fallback }}>
        <section className="flex-1 overflow-visible lg:overflow-hidden">
          <ErrorBoundary resetKeys={[today, tomorrow]}>
            <AIWorkspace defaultDate={today} />
          </ErrorBoundary>
        </section>
      </SWRConfig>
    </main>
  );
}
