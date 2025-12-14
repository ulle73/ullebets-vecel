"use client";

import Image from "next/image";
import { deriveScopeLabel } from "@/lib/utils/matchups";

export const DEFAULT_SCORE_THRESHOLDS = { high: 95, medium: 70 };

export function ScoreChip({ score, formatScore, thresholds }) {
  const high = thresholds?.high ?? DEFAULT_SCORE_THRESHOLDS.high;
  const medium = thresholds?.medium ?? DEFAULT_SCORE_THRESHOLDS.medium;

  let colorClass = "text-slate-400";
  let glowClass = "shadow-[0_0_15px_rgba(0,0,0,0.5)]";
  let bgClass = "bg-black/60";

  if (score >= high) {
    colorClass = "text-yellow-400"; // Gold/Yellow as in reference
    glowClass = "shadow-[0_0_20px_rgba(234,179,8,0.25)] ring-1 ring-yellow-500/30";
  } else if (score >= medium) {
    colorClass = "text-amber-400";
    glowClass = "ring-1 ring-amber-500/30";
  }

  const label = formatScore ? formatScore(score) : score.toFixed(1);

  return (
    <div className={`flex items-center justify-center min-w-[3.5rem] px-3 py-1.5 rounded-xl backdrop-blur-md ${bgClass} ${glowClass}`}>
      <span className={`text-xl font-black tracking-tighter ${colorClass}`}>
        {label}
      </span>
    </div>
  );
}

export function Badge({ badge }) {
  if (!badge) return null;
  const tone =
    badge.tone === "perfect"
      ? "bg-yellow-950/40 text-yellow-200 border-yellow-500/20 shadow-[0_0_10px_rgba(234,179,8,0.1)]"
      : badge.tone === "almost"
        ? "bg-amber-950/40 text-amber-200 border-amber-500/20"
        : "bg-blue-950/40 text-blue-200 border-blue-500/20";

  return (
    <span className={`rounded-lg px-2.5 py-1 text-[10px] uppercase tracking-widest font-black border ${tone}`}>
      {badge.label}
    </span>
  );
}

export function FilterChips({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-full border px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${active
              ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.2)]"
              : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-slate-200"
              }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SignalBar({ label, value, color, icon }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[10px] w-full">
      <div className="flex items-center gap-2">
        <div className={`w-1 h-3 rounded-full ${color}`} />
        <span className="text-slate-400 font-medium">{label}</span>
      </div>
      <span className="text-slate-200 font-bold flex items-center gap-1">
        {icon && <span>{icon}</span>}
        {value}
      </span>
    </div>
  );
}

export function RowAvg({ r, showHistoricalOutcome = false, highlightPct = 0 }) {
  const scopeLabel = r.scopeLabel ?? deriveScopeLabel(r.scope, r.matchLabel);
  const highlightThreshold = r.scoreThresholds?.high ?? 95;
  const isHighParams = r.score >= highlightThreshold;

  const borderHighlight = isHighParams
    ? "border-emerald-500/30 bg-[#0a0a0a]"
    : "border-white/5 hover:border-white/10 bg-black/40";

  const formatOutcomeNumber = (value) => {
    if (!Number.isFinite(value)) return null;
    return Number.isInteger(value) ? value : value.toFixed(1);
  };

  const formattedOutcomeValue = formatOutcomeNumber(r.outcomeValue);
  const homeVal = formatOutcomeNumber(r.outcomeHomeValue);
  const awayVal = formatOutcomeNumber(r.outcomeAwayValue);
  const showOutcome = showHistoricalOutcome && formattedOutcomeValue != null;
  const leagueBaselineValue = Number.isFinite(r.leagueBaseline) ? r.leagueBaseline : null;
  const formattedLeagueBaseline = formatOutcomeNumber(leagueBaselineValue);

  const hasComparison = showOutcome && leagueBaselineValue != null && leagueBaselineValue !== 0;
  const pctDelta = hasComparison
    ? ((r.outcomeValue - leagueBaselineValue) / leagueBaselineValue) * 100
    : null;
  const formattedPct = pctDelta != null ? `${pctDelta >= 0 ? "+" : ""}${pctDelta.toFixed(1)}%` : null;

  const condition = (r.condition ?? "").toLowerCase();
  const isOver = condition === "over";
  const isUnder = condition === "under";
  const isGreen = (isOver && pctDelta > 0) || (isUnder && pctDelta < 0);
  const isRed = (isOver && pctDelta < 0) || (isUnder && pctDelta > 0);
  const pctTone = isGreen ? "text-emerald-400" : isRed ? "text-rose-400" : "text-slate-400";

  const [homeName, awayName] = r.matchLabel.split(" vs ");
  const getLogo = (id) => id ? `/images/teams/${id}.png` : "/images/teams/placeholder.png";

  return (
    <li className={`flex flex-col gap-4 rounded-2xl border p-5 shadow-2xl transition-all duration-200 group ${borderHighlight}`}>

      {/* ROW 1: League/Tier Badge LEFT, Score RIGHT */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {r.leagueName && (
            <span className="text-[10px] font-black uppercase tracking-widest text-cyan-400/90 bg-cyan-950/30 px-2 py-1 rounded-lg border border-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.1)]">
              {r.leagueName}
            </span>
          )}
          <Badge badge={r.badge} />
        </div>
        <ScoreChip score={r.score} formatScore={r.scoreFormat} thresholds={r.scoreThresholds} />
      </div>

      {/* ROW 2: TEAMS (Large & Centered/Prominent) */}
      <div className="flex items-center justify-start gap-4 py-1">
        <div className="flex items-center justify-end gap-3 flex-1 min-w-0 text-right">
          <span className="text-sm md:text-base font-bold text-white truncate leading-tight">{homeName}</span>
          <div className="relative w-8 h-8 shrink-0 drop-shadow-lg">
            <Image src={getLogo(r.homeTeamId)} alt="" fill className="object-contain" unoptimized />
          </div>
        </div>

        <span className="text-slate-600 font-bold text-xs shrink-0 tracking-wider">VS</span>

        <div className="flex items-center justify-start gap-3 flex-1 min-w-0">
          <div className="relative w-8 h-8 shrink-0 drop-shadow-lg">
            <Image src={getLogo(r.awayTeamId)} alt="" fill className="object-contain" unoptimized />
          </div>
          <span className="text-sm md:text-base font-bold text-white truncate leading-tight">{awayName}</span>
        </div>
      </div>

      {/* SEPARATOR */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* ROW 3: TAGS ROW */}
      <div className="flex flex-wrap items-center justify-center gap-2 py-4">
        {/* Target Badge */}
        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border shadow-sm ${isOver ? 'bg-emerald-950/30 text-emerald-400 border-emerald-500/30' : 'bg-rose-950/30 text-rose-400 border-rose-500/30'}`}>
          {condition}
        </span>

        {/* Stat Key Badge - PURPLE */}
        <span className="px-3 py-1 rounded-full bg-purple-950/30 border border-purple-500/30 text-[10px] font-bold uppercase tracking-wider text-purple-300 shadow-sm">
          {r.statLabel}
        </span>

        {/* Scope Badge */}
        <span className="px-3 py-1 rounded-full bg-blue-950/20 border border-blue-500/20 text-[10px] font-bold uppercase tracking-wider text-blue-300 shadow-sm">
          {scopeLabel}
        </span>

        {/* Period Badge - GRAY (Lighter Text) */}
        <span className="px-3 py-1 rounded-full bg-[#18181b] border border-white/10 text-[10px] font-bold uppercase tracking-wider text-slate-200 shadow-sm">
          {r.period}
        </span>
      </div>

      {/* ROW 4: SPLIT INFO / STATS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">

        {/* LEFT: Biases */}
        <div className="flex flex-col gap-2 relative">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 opacity-50">BIASES</span>
          <div className="flex flex-col gap-2">
            {/* Market Bias */}
            {r.marketBias && (r.marketBias.home || r.marketBias.away ?
              (<>
                {r.marketBias.home && <SignalBar label="Market (H)" value={r.marketBias.home.direction} color={r.marketBias.home.direction === 'over' ? "bg-emerald-500" : "bg-rose-500"} />}
                {r.marketBias.away && <SignalBar label="Market (A)" value={r.marketBias.away.direction} color={r.marketBias.away.direction === 'over' ? "bg-emerald-500" : "bg-rose-500"} />}
              </>) :
              (r.marketBias.direction && <SignalBar label="Market" value={r.marketBias.direction} color={r.marketBias.direction === 'over' ? "bg-emerald-500" : "bg-rose-500"} />)
            )}

            {/* Behaviour */}
            {(r.homeBehaviour?.label || r.awayBehaviour?.label) && (
              <>
                {r.homeBehaviour?.label && (
                  <div className="flex items-center justify-between gap-3 text-[10px] w-full">
                    <span className="text-slate-400 font-medium">Trend (H)</span>
                    <span className="text-slate-200">{r.homeBehaviour.emoji} {r.homeBehaviour.label.replace(/Very Strong|Strong/, '').trim()}</span>
                  </div>
                )}
                {r.awayBehaviour?.label && (
                  <div className="flex items-center justify-between gap-3 text-[10px] w-full">
                    <span className="text-slate-400 font-medium">Trend (A)</span>
                    <span className="text-slate-200">{r.awayBehaviour.emoji} {r.awayBehaviour.label.replace(/Very Strong|Strong/, '').trim()}</span>
                  </div>
                )}
              </>
            )}
            {!r.marketBias && !r.homeBehaviour && !r.awayBehaviour && (
              <span className="text-[10px] text-slate-600 italic">— No strong biases</span>
            )}
          </div>
        </div>

        {/* RIGHT: Stats / Outcome */}
        <div className="flex flex-col gap-2 items-end text-right relative md:border-l md:border-white/5 md:pl-6">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 opacity-50">STATISTICS</span>

          {formattedLeagueBaseline != null && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 font-medium">Ligasnitt:</span>
              <span className="text-white font-mono font-bold">{formattedLeagueBaseline}</span>
            </div>
          )}

          {showOutcome && (
            <div className="flex flex-col items-end gap-1 mt-1">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium text-xs">Utfall:</span>
                <span className="text-xl font-black text-white leading-none">{formattedOutcomeValue}</span>

                {/* Pct Badge + Validated Arrow */}
                {formattedPct && (
                  <div className="flex items-center gap-2">
                    {/* Badge */}
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isGreen ? 'bg-emerald-500/20 text-emerald-400' : isRed ? 'bg-rose-500/20 text-rose-400' : 'text-slate-400'}`}>
                      {formattedPct}
                    </span>

                    {/* Trend Arrow (Results based) */}
                    {pctDelta !== 0 && (
                      <svg
                        className={`w-5 h-5 ${isGreen ? 'text-emerald-500' : isRed ? 'text-rose-500' : 'text-slate-500'}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        {pctDelta > 0 ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                        )}
                      </svg>
                    )}
                  </div>
                )}
              </div>
              {(homeVal != null || awayVal != null) && (
                <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono">
                  {homeVal != null && <span>H: {homeVal}</span>}
                  {awayVal != null && <span>B: {awayVal}</span>}
                </div>
              )}
            </div>
          )}
          {!showOutcome && formattedLeagueBaseline == null && (
            <span className="text-[10px] text-slate-600 italic mt-2">— Inväntar data</span>
          )}
        </div>
      </div>

    </li>
  );
}
