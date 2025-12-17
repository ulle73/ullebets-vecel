"use client";

import Image from "next/image";
import * as Tooltip from "@radix-ui/react-tooltip";
import { deriveScopeLabel } from "@/lib/utils/matchups";

const BEHAVIOUR_EXPLANATIONS = {
  "VERY_STRONG_OVER": "Öser in mål och släpper in lika många.",
  "STRONG_OVER": "Tenderar att spela målrika matcher.",
  "NEUTRAL": "Ingen tydlig mål-bias.",
  "STRONG_UNDER": "Tenderar att hålla tätt bakåt.",
  "VERY_STRONG_UNDER": "Extremt defensiva, få mål."
};

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

function getTempoCategory(score) {
  if (!Number.isFinite(score)) return null;

  if (score >= 5) return { label: "EXTREME", color: "bg-red-500", icon: "🔥🔥" };
  if (score >= 2) return { label: "HIGH", color: "bg-orange-500", icon: "🔥" };
  if (score >= -1) return { label: "NEUTRAL", color: "bg-gray-300", icon: "⚪" };
  if (score >= -4) return { label: "LOW", color: "bg-blue-500", icon: "❄️" };
  return { label: "DEAD", color: "bg-gray-500", icon: "❄️❄️" };
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

  const [homeNameRaw = "", awayNameRaw = ""] = (r.matchLabel || "").split(" vs ");
  const homeName = homeNameRaw || r.homeTeamName || "Hemmalag";
  const awayName = awayNameRaw || r.awayTeamName || "Bortalag";
  const getLogo = (id) => id ? `/images/teams/${id}.png` : "/images/teams/placeholder.png";

  // Only show behaviour for stats related to shooting/goal activity
  const showBehaviour = ['totalShotsOnGoal', 'shotsOnGoal', 'cornerKicks'].includes(r.statKey);

  // Calculate tempo score only if showing behaviour
  const tempoScore = showBehaviour ? (r.homeBehaviour?.for?.score ?? 0) + (r.awayBehaviour?.for?.score ?? 0) + (r.homeBehaviour?.against?.score ?? 0) + (r.awayBehaviour?.against?.score ?? 0) : null;
  const tempoCategory = tempoScore !== null ? getTempoCategory(tempoScore) : null;
  const marketBiasRows = [];

  if (r.marketBias?.home?.direction) {
    marketBiasRows.push({ label: homeName, direction: r.marketBias.home.direction });
  }
  if (r.marketBias?.away?.direction) {
    marketBiasRows.push({ label: awayName, direction: r.marketBias.away.direction });
  }
  if (!marketBiasRows.length && r.marketBias?.direction) {
    marketBiasRows.push({ label: r.matchLabel, direction: r.marketBias.direction });
  }

  const calcDeltas = (context = {}) => {
    const pct = (val, avg) => {
      const v = Number(val);
      const a = Number(avg);
      if (!Number.isFinite(v) || !Number.isFinite(a) || a === 0) return null;
      return ((v - a) / a) * 100;
    };
    return {
      leading: pct(context.shots_leading, context.league_avg_leading),
      tied: pct(context.shots_tied, context.league_avg_tied),
      trailing: pct(context.shots_trailing, context.league_avg_trailing),
    };
  };

  const formatDelta = (val) => {
    if (!Number.isFinite(val)) return "—";
    const rounded = Math.round(val);
    return `${rounded > 0 ? "+" : ""}${rounded}%`;
  };

  const hasDeltaData = (deltas) =>
    deltas && (Number.isFinite(deltas.leading) || Number.isFinite(deltas.tied) || Number.isFinite(deltas.trailing));

  // Render a detailed row inside the tooltip
  const renderTooltipRow = (label, deltas) => {
    if (!hasDeltaData(deltas)) return null;
    return (
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 items-center">
        <span className="text-slate-300 font-medium">{label}</span>
        <div className="flex gap-2 text-xs font-mono">
          <span className={`${deltas.leading > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>L: {formatDelta(deltas.leading)}</span>
          <span className="text-slate-600">|</span>
          <span className={`${deltas.tied > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>T: {formatDelta(deltas.tied)}</span>
          <span className="text-slate-600">|</span>
          <span className={`${deltas.trailing > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>U: {formatDelta(deltas.trailing)}</span>
        </div>
      </div>
    );
  };

  const homeAttackDeltas = calcDeltas(r.homeBehaviour?.for?.context);
  const awayAttackDeltas = calcDeltas(r.awayBehaviour?.for?.context);
  const homeConcedeDeltas = calcDeltas(r.homeBehaviour?.against?.context);
  const awayConcedeDeltas = calcDeltas(r.awayBehaviour?.against?.context);

  const hasHomeData = hasDeltaData(homeAttackDeltas) || hasDeltaData(homeConcedeDeltas);
  const hasAwayData = hasDeltaData(awayAttackDeltas) || hasDeltaData(awayConcedeDeltas);
  const hasAnyBehaviour = hasHomeData || hasAwayData;

  const hasBehaviourContent = showBehaviour && (hasAnyBehaviour || tempoCategory);

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

        {/* Stat Key Badge */}
        <span className="px-3 py-1 rounded-full bg-purple-950/30 border border-purple-500/30 text-[10px] font-bold uppercase tracking-wider text-purple-300 shadow-sm">
          {r.statLabel}
        </span>

        {/* Scope Badge */}
        <span className="px-3 py-1 rounded-full bg-blue-950/20 border border-blue-500/20 text-[10px] font-bold uppercase tracking-wider text-blue-300 shadow-sm">
          {scopeLabel}
        </span>

        {/* Period Badge - GRAY */}
        <span className="px-3 py-1 rounded-full bg-[#18181b] border border-white/10 text-[10px] font-bold uppercase tracking-wider text-gray-400 shadow-sm">
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
            {marketBiasRows.map((row) => (
              <div key={`${row.label}-${row.direction}`} className="flex items-center gap-2 text-[11px] text-left">
                <div className={`h-3 w-1 rounded-full ${row.direction === 'over' ? "bg-emerald-500" : "bg-rose-500"}`} />
                <span className="text-slate-200 font-semibold truncate">{row.label}</span>
                <span className="text-slate-500">•</span>
                <span className={row.direction === 'over' ? "text-emerald-400" : "text-rose-400"}>{row.direction}</span>
              </div>
            ))}

            {/* Behaviour encapsulated in Tempo Tooltip */}
            {showBehaviour && (
              <div className="mt-1">
                <Tooltip.Provider delayDuration={0}>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button className="flex items-center gap-2 text-[10px] text-slate-300 py-1 hover:bg-white/5 rounded px-1 -ml-1 transition w-full text-left">
                        {tempoCategory ? (
                          <>
                            <div className={`h-2.5 w-1 rounded-full ${tempoCategory.color} shadow-[0_0_8px_currentColor] opacity-80`} />
                            <span className="text-slate-200 font-bold uppercase tracking-wide">Tempo</span>
                            <span className="text-lg leading-none">{tempoCategory.icon}</span>
                            <div className="ml-auto w-4 h-4 rounded flex items-center justify-center bg-white/10 text-[10px] font-bold text-slate-300 border border-white/10 italic font-serif">i</div>
                          </>
                        ) : (
                          <span className="text-slate-500 italic">View Behaviour Stats</span>
                        )}
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        side="right"
                        sideOffset={10}
                        align="center"
                        className="z-50 rounded-xl border border-white/10 bg-[#0A0A0B]/95 p-4 shadow-2xl backdrop-blur-xl text-xs text-slate-100 min-w-[240px]"
                      >
                        <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 border-b border-white/5 pb-2">
                          Behaviour Profile
                        </div>

                        <div className="flex flex-col gap-4">
                          {/* Home */}
                          {hasHomeData && (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2 mb-1">
                                <div className="relative w-4 h-4">
                                  <Image src={getLogo(r.homeTeamId)} alt="" fill className="object-contain" unoptimized />
                                </div>
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">{homeName}</span>
                              </div>
                              {renderTooltipRow("Attack", homeAttackDeltas)}
                              {renderTooltipRow("Concede", homeConcedeDeltas)}
                            </div>
                          )}

                          {/* Away */}
                          {hasAwayData && (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2 mb-1">
                                <div className="relative w-4 h-4">
                                  <Image src={getLogo(r.awayTeamId)} alt="" fill className="object-contain" unoptimized />
                                </div>
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">{awayName}</span>
                              </div>
                              {renderTooltipRow("Attack", awayAttackDeltas)}
                              {renderTooltipRow("Concede", awayConcedeDeltas)}
                            </div>
                          )}
                        </div>
                        <Tooltip.Arrow className="fill-[#0A0A0B]/95" />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </Tooltip.Provider>
              </div>
            )}

            {marketBiasRows.length === 0 && !hasBehaviourContent && (
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
              <span className="text-slate-50 font-mono font-semibold text-sm">{formattedLeagueBaseline}</span>
            </div>
          )}

          {showOutcome && (
            <div className="flex flex-col items-end gap-1 mt-1">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium text-xs">Utfall:</span>
                <span className="text-xl font-black text-slate-50 leading-none">{formattedOutcomeValue}</span>

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
