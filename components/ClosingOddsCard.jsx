"use client";

import TeamOddsHistory from "@/components/TeamOddsHistory";

export default function ClosingOddsCard({ match }) {
  return (
    <div className="lg:hidden flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
          Closing-odds
        </h2>
      </div>
      <TeamOddsHistory
        match={match}
        showHeader={false}
        className="flex-1 min-h-0 bg-gray-50/60"
        contentClassName="px-4 py-3"
      />
    </div>
  );
}
