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
    <main className="min-h-screen bg-gray-50">
      <header className="px-4 pt-6 pb-2 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Matcher</h1>
        <p className="mt-1 text-sm text-gray-600">
          Prefetch: <code className="bg-gray-100 px-1 py-0.5 rounded">{today}</code> &nbsp;och&nbsp;
          <code className="bg-gray-100 px-1 py-0.5 rounded">{tomorrow}</code>
        </p>
      </header>

      {/* GRID: mobil = 1 kolumn, md = 2 kolumner, xl = 4 kolumner */}
      <SWRConfig value={{ fallback }}>
        <section className="grid grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-2 xl:grid-cols-4">
          {/* Panel 1: Dagens/valda datumets matcher (din befintliga vy) */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm md:min-h-[420px] xl:min-h-[520px]">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                Dagens matcher
              </h2>
            </div>
            <div className="p-4">
              <MatchesClient defaultDate={today} />
            </div>
          </div>

          {/* Panel 2: placeholder */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm md:min-h-[420px] xl:min-h-[520px]">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                Panel 2
              </h2>
            </div>
            <div className="p-4 text-gray-500 text-sm">
              Kommer snart
            </div>
          </div>

          {/* Panel 3: placeholder */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm md:min-h-[420px] xl:min-h-[520px]">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                Panel 3
              </h2>
            </div>
            <div className="p-4 text-gray-500 text-sm">
              Kommer snart
            </div>
          </div>

          {/* Panel 4: placeholder */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm md:min-h-[420px] xl:min-h-[520px]">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                Panel 4
              </h2>
            </div>
            <div className="p-4 text-gray-500 text-sm">
              Kommer snart
            </div>
          </div>
        </section>
      </SWRConfig>
    </main>
  );
}