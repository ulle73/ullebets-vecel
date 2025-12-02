"use client";

import AIBetCard from "./AIBetCard";
import AIHistoryCompactCard from "./AIHistoryCompactCard";

export default function AIHistoryList({ bets }) {
  if (!bets || !bets.length) {
    return (
      <div className="rounded border border-dashed border-slate-700 bg-slate-950/40 p-4 text-center text-xs uppercase tracking-wider text-slate-400">
        Inga historiska spel hittades för detta datum
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto">
      {bets.map((bet, i) => (
        <AIHistoryCompactCard key={bet._id || i} betDoc={bet} index={i} />
      ))}
    </div>
  );
}
