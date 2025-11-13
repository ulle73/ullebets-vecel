"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import LeagueTables from "@/components/LeagueTables";
import AIWorkspace from "@/ai/components/AIWorkspace";
import { buildMatchesByDateKey } from "@/lib/utils/apiKeys";

const fetcher = async (input) => {
  if (!input) return null;
  const response = await fetch(input);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

function makeFormatter() {
  return new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Stockholm",
  });
}

export default function AIClient({ defaultDate, initialFallback = {} }) {
  const [date, setDate] = useState(defaultDate);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const formatter = useMemo(() => makeFormatter(), []);
  const matchesKey = useMemo(() => buildMatchesByDateKey(date), [date]);
  const fallbackData = initialFallback[matchesKey];
  const { data, error } = useSWR(matchesKey, fetcher, {
    fallbackData,
    revalidateOnFocus: false,
  });

  const matchesState = data ?? fallbackData;
  const items = matchesState?.items ?? [];
  const isLoading = !data && !error;

  const formatTime = useCallback(
    (timestamp) => {
      if (!timestamp) return "—";
      const numeric = Number(timestamp);
      if (!Number.isFinite(numeric)) return "—";
      return formatter.format(new Date(numeric));
    },
    [formatter]
  );

  const handleSelectMatch = useCallback((match) => {
    if (!match) {
      setSelectedMatchId(null);
      return;
    }
    setSelectedMatchId(match.id ?? match.matchId ?? null);
  }, []);

  return (
    <div className="flex w-full flex-col overflow-x-hidden lg:h-full lg:min-h-0">
      <div className="mx-auto flex w-full flex-1 flex-col overflow-x-hidden pb-6 px-4 sm:px-6 lg:px-8">
        <div className="grid w-full gap-4 lg:grid-cols-2 lg:auto-rows-[minmax(0,1fr)]">
          <LeagueTables
            date={date}
            onDateChange={setDate}
            items={items}
            formatTime={formatTime}
            onSelectMatch={handleSelectMatch}
            onPrefetchMatch={() => {}}
            selectedMatchId={selectedMatchId}
            isLoading={isLoading}
            error={error}
            matchesCount={items.length}
          />
          <AIWorkspace date={date} matches={items} />
        </div>
      </div>
    </div>
  );
}
