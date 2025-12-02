"use client";

import AIBetCard from "./AIBetCard";

export default function AIComboList({ combos, priorityMap = {} }) {
  if (!combos || combos.length === 0) {
    return (
      <div className="rounded border border-dashed border-slate-700 bg-slate-950/40 p-4 text-center text-xs uppercase tracking-wider text-slate-400">
        Inga kombinationer hittades ännu
      </div>
    );
  }

  // Transform combos to match betDoc format
  const transformedCombos = combos.map((combo, index) => ({
    _id: combo.id || `combo-${index}`,
    lines: combo.lines,
    totalEv: combo.totalEv,
    comboRank: combo.comboRank,
    comboScore: combo.comboScore,
  }));

  // Sort by total EV descending
  const sortedCombos = [...transformedCombos].sort((a, b) => (b.totalEv || 0) - (a.totalEv || 0));

  return (
    <div className="flex flex-col gap-8 w-full max-w-4xl mx-auto">
      {sortedCombos.map((combo, i) => (
        <AIBetCard
          key={combo._id}
          betDoc={combo}
          index={i}
          showOutcome={false}
          showUnibetButton={true}
          priorityMap={priorityMap}
        />
      ))}
    </div>
  );
}
