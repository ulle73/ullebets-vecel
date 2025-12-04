// ```javascript
// app/page.jsx
export const dynamic = "force-dynamic";

import { SWRConfig } from "swr";
import MatchesClient from "./matches-client";
import { todaySE, tomorrowSE } from "@/lib/utils/date";
import { getMatchesForDate } from "@/lib/repos/fixtures";
import ErrorBoundary from "@/components/ErrorBoundary";
import { buildMatchesByDateKey } from "@/lib/utils/apiKeys";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";

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
    <div className="flex h-screen w-full overflow-hidden bg-black">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />

        <main className="flex-1 overflow-y-auto bg-black p-6">
          <SWRConfig value={{ fallback }}>
            <ErrorBoundary resetKeys={[today, tomorrow]}>
              <MatchesClient defaultDate={today} initialFallback={fallback} />
            </ErrorBoundary>
          </SWRConfig>
        </main>
      </div>
    </div>
  );
}
// ```