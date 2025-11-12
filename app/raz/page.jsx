import { todaySE, tomorrowSE } from "@/lib/utils/date";
import { getMatchesForDate } from "@/lib/repos/fixtures";
import { buildMatchesByDateKey } from "@/lib/utils/apiKeys";
import RazShell from "./RazShell";

export const dynamic = "force-dynamic";

export default async function RazPage() {
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
    <RazShell
      fallback={fallback}
      defaultDate={today}
      resetKeys={[today, tomorrow]}
    />
  );
}
