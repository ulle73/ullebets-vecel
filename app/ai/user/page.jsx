export const dynamic = "force-dynamic";

import { SWRConfig } from "swr";
import ErrorBoundary from "@/components/ErrorBoundary";
import { AIUserWorkspace } from "@/ai/components/AIWorkspace";
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
    <main className="flex min-h-screen flex-col bg-black text-white">
      <SWRConfig value={{ fallback }}>
        <ErrorBoundary resetKeys={[today, tomorrow]}>
          <AIUserWorkspace defaultDate={today} />
        </ErrorBoundary>
      </SWRConfig>
    </main>
  );
}
