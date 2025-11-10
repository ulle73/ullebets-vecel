"use client";

import DatePicker from "@/components/DatePicker";
import LeagueTable from "@/components/LeagueTable";

export default function LeagueTables({
  date,
  onDateChange,
  items,
  formatTime,
  onSelectMatch,
  selectedMatchId,
  isLoading,
  error,
  onPrefetchMatch,
  matchesCount = 0,
  className = "",
}) {
  const statusLabel = error
    ? "Fel vid hämtning."
    : isLoading
    ? "Laddar…"
    : `Matcher: ${matchesCount}`;

  const containerClass = [
    "flex flex-col rounded-lg border border-gray-200 bg-white shadow-sm",
    "lg:h-full lg:min-h-0",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClass}>
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
          Dagens matcher
        </h2>
      </div>
      <div className="flex flex-col overflow-hidden p-4 lg:flex-1 lg:min-h-0">
        <div className="mb-4 flex items-center gap-3">
          <DatePicker value={date} onChange={onDateChange} />
          <div className="text-xs text-gray-500">{statusLabel}</div>
        </div>
        <div className="overflow-hidden lg:flex-1 lg:min-h-0">
          <div className="overflow-auto pr-1 lg:h-full">
            <LeagueTable
              items={items}
              formatTime={formatTime}
              onSelectMatch={onSelectMatch}
              onPrefetchMatch={onPrefetchMatch}
              selectedMatchId={selectedMatchId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
