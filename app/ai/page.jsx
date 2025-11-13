import { SWRConfig } from "swr";
import { todaySE, tomorrowSE } from "@/lib/utils/date";
import { getMatchesForDate } from "@/lib/repos/fixtures";
import { buildMatchesByDateKey } from "@/lib/utils/apiKeys";
import AIClient from "@/ai/AIClient";

export const dynamic = "force-dynamic";

export default async function AIPage() {
  const today = todaySE();
  const tomorrow = tomorrowSE();
  const [todayItems, tomorrowItems] = await Promise.all([
    getMatchesForDate(today),
    getMatchesForDate(tomorrow),
  ]);

  const fallback = {
    [buildMatchesByDateKey(today)]: { date: today, items: todayItems },
    [buildMatchesByDateKey(tomorrow)]: { date: tomorrow, items: tomorrowItems },
  };

  return (
    <SWRConfig value={{ fallback }}>
      <AIClient defaultDate={today} initialFallback={fallback} />
    </SWRConfig>
  );
}
