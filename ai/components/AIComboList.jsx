"use client";

export default function AIComboList({ combos }) {
  if (!combos || !combos.length) {
    return (
      <div className="rounded border border-dashed border-slate-700 bg-slate-950/40 p-4 text-center text-xs uppercase tracking-wider text-slate-400">
        Inga kombinationer hittades ännu
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {combos.map((combo, index) => (
        <article
          key={combo.id || `${index}-${combo.odds}`}
          className="rounded-lg border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-900/50 p-3 shadow shadow-slate-900/20"
        >
          <header className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <span>{`Combo ${index + 1}`}</span>
            <span>{`${combo.lines.length} spel`}</span>
          </header>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-2xl font-semibold text-emerald-300">{combo.odds.toFixed(2)}x</p>
              <p className="text-xs text-slate-400">{`Totalt EV ${combo.totalEv.toFixed(1)}%`}</p>
            </div>
            <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-200">
              {combo.lines.length} / {combo.lines.length}
            </span>
          </div>
          <ul className="mt-3 space-y-2 border-t border-slate-900/50 pt-2 text-sm text-slate-200">
            {combo.lines.map((line) => (
              <li key={`${combo.id}-${line.betKey ?? line.statKey}-${line.direction}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-slate-100">{line.matchLabel}</span>
                  <span className="text-xs uppercase tracking-wide text-slate-400">
                    {line.direction === "over" ? "Över" : "Under"} {line.line ?? "—"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span>
                    Odds: <span className="text-emerald-300">{line.odds?.toFixed(2) ?? "—"}x</span>
                  </span>
                  <span>
                    Stat: <span className="text-slate-200">{line.statKey ?? "–"}</span>
                  </span>
                  <span>
                    Period: <span className="text-slate-200">{line.period}</span>
                  </span>
                  <span>
                    Scope: <span className="text-slate-200">{line.scope}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
