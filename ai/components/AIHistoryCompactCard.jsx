"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

function getTeamIconCandidates(teamId) {
  if (!teamId) return ["/images/teams/placeholder.png"];
  const base = String(teamId);
  return [
    `/images/teams/${base}.png`,
    `/images/teams/${base}.webp`,
    `/images/teams/${base}.svg`,
    `/images/teams/${base}@2x.png`,
    "/images/teams/placeholder.png",
  ];
}

function TeamIcon({ teamId, alt, className }) {
  const candidates = useMemo(() => getTeamIconCandidates(teamId), [teamId]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
  }, [candidates]);
  const src = candidates[Math.min(index, candidates.length - 1)];

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => {
        setIndex((prev) => (prev < candidates.length - 1 ? prev + 1 : prev));
      }}
    />
  );
}

function formatPeriodText(period) {
  if (period === "1ST" || period === "1st") return "1:a halvlek";
  if (period === "2ND" || period === "2nd") return "2:a halvlek";
  return "";
}

function formatStatText(statKey) {
  const statNames = {
    cornerKicks: "hörnor",
    yellowCards: "gula kort",
    fouls: "fouls",
    shotsOnGoal: "skott på mål",
    totalShots: "skott",
    freeKicks: "frisparkar",
    throwIns: "inkast",
    offsides: "offsides",
    totalTackle: "tacklingar",
  };
  return statNames[statKey] || statKey;
}

function getBetDescription(line) {
  const homeTeam = line.teams?.home || line.homeTeam || "";
  const awayTeam = line.teams?.away || line.awayTeam || "";
  const direction = line.direction === "over" ? "över" : "under";
  const stat = formatStatText(line.statKey);
  const period = formatPeriodText(line.period);
  const lineValue = line.line;

  let subject = "";
  if (line.scope === "home") subject = homeTeam;
  else if (line.scope === "away") subject = awayTeam;
  else subject = `${homeTeam} vs ${awayTeam}`;

  let sentence = `${subject} ${direction} ${lineValue} ${stat}`;
  if (period) sentence += ` (${period})`;

  return sentence;
}

export default function AIHistoryCompactCard({ betDoc, index = 0 }) {
  const lines = betDoc?.lines || [];
  const primaryLine = lines[0] || {};
  const homeTeam = primaryLine.teams?.home || primaryLine.homeTeam || betDoc.homeTeam || "";
  const awayTeam = primaryLine.teams?.away || primaryLine.awayTeam || betDoc.awayTeam || "";
  const homeTeamId = primaryLine.teams?.homeId || primaryLine.homeTeamId || betDoc.homeTeamId;
  const awayTeamId = primaryLine.teams?.awayId || primaryLine.awayTeamId || betDoc.awayTeamId;
  const odds = Number(primaryLine.odds) || 0;
  const evPercent = Number(primaryLine.primaryEv ?? primaryLine.value ?? 0);
  const description = getBetDescription(primaryLine);
  const displayRank = betDoc.comboRank ?? primaryLine.comboRank ?? index + 1;
  const displayScore = betDoc.comboScore ?? primaryLine.comboScore ?? null;
  // Format outcome value with stat context
  const actualValue = primaryLine.actual ?? betDoc.actual;
  const outcomeVal = actualValue != null
    ? `${actualValue} ${formatStatText(primaryLine.statKey)}`
    : "Pending";

  // Check if all lines have win: true
  const allLinesWin = lines.length > 0 && lines.every(l => l.win === true || l.win === "true");
  const anyLineWin = lines.some(l => l.win === true || l.win === "true");
  const anyLineLoss = lines.some(l => l.win === false || l.win === "false");

  let outcomeLabel = "PENDING";
  let accent = "emerald";

  if (allLinesWin) {
    outcomeLabel = "WIN";
  } else if (anyLineLoss) {
    outcomeLabel = "LOSS";
    accent = "rose";
  } else if (anyLineWin) {
    outcomeLabel = "WIN"; // At least one win, show as WIN
  }

  const accentClasses = {
    emerald: {
      text: "text-emerald-400",
      bg: "bg-emerald-500/15",
      ring: "ring-emerald-500/40",
    },
    rose: {
      text: "text-rose-400",
      bg: "bg-rose-500/15",
      ring: "ring-rose-500/40",
    },
    amber: {
      text: "text-amber-400",
      bg: "bg-amber-500/15",
      ring: "ring-amber-500/40",
    },
  }[accent];

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-800 bg-[#050816] shadow-xl shadow-emerald-900/20 ring-1 ring-emerald-500/10">
      <div className="flex flex-col sm:flex-row">
        {/* Outcome strip */}
        <div
          className={clsx(
            "sm:w-1/4 flex items-center justify-center px-4 py-6 sm:py-10",
            "bg-gradient-to-b from-slate-900 to-slate-950 border-r border-slate-800"
          )}
        >
          <div className="text-center space-y-2">
            <div className={clsx("text-4xl sm:text-5xl font-extrabold tracking-tight", accentClasses.text)}>
              {outcomeLabel}
            </div>
            <div className="text-sm text-slate-400">
              {outcomeVal !== "Pending" ? (
                <>
                  {primaryLine.scope === "home" ? homeTeam :
                   primaryLine.scope === "away" ? awayTeam :
                   `${homeTeam} vs ${awayTeam}`} {outcomeVal} {formatPeriodText(primaryLine.period)}
                </>
              ) : (
                "Pending"
              )}
            </div>
            {/* <div className={clsx("inline-flex rounded-full px-3 py-1 text-xs font-semibold", accentClasses.bg, accentClasses.text, accentClasses.ring)}>
              Combo {displayRank}
              {displayScore != null ? ` (${Number(displayScore).toFixed ? Number(displayScore).toFixed(1) : displayScore})` : ""}
            </div> */}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1">
          <div className="flex items-center justify-between px-6 pt-5">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Combo {displayRank}
              {displayScore != null ? ` (${Number(displayScore).toFixed(1)})` : ""}
            </div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              {lines.length} spel
            </div>
          </div>

          <div className="flex items-center gap-6 px-6 pb-4">
            <div className="flex flex-col">
              <span className={clsx("text-5xl font-bold tracking-tighter", accentClasses.text)}>
                {evPercent.toFixed(1)}%
              </span>
            </div>
            <div className="relative flex-1">
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800/50">
                <div
                  className={clsx(
                    "h-full rounded-full",
                    outcomeLabel === "LOSS"
                      ? "bg-gradient-to-r from-rose-400 via-rose-300 to-rose-200 shadow-[0_0_20px_rgba(244,63,94,0.8)]"
                      : "bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-200 shadow-[0_0_20px_rgba(52,211,153,0.8)]"
                  )}
                  style={{ width: `${Math.min(100, Math.abs(evPercent))}%` }}
                />
              </div>
            </div>
            <div className={clsx("inline-flex rounded-full px-3 py-1 text-xs font-semibold", accentClasses.bg, accentClasses.text, accentClasses.ring)}>
             {primaryLine.matchupScore ?? 0}
            </div>
          </div>

          <div className="flex items-center justify-between px-6 pb-6">
            <div className="flex items-center gap-3">
              <TeamIcon teamId={homeTeamId} alt={homeTeam} className="h-14 w-14 object-contain" />
              <span className="text-xs font-bold text-slate-500">vs</span>
              <TeamIcon teamId={awayTeamId} alt={awayTeam} className="h-14 w-14 object-contain" />
            </div>
            <div className="text-right">
              <div className="text-sm uppercase tracking-widest text-slate-400">ODDS</div>
              <div className={clsx("text-4xl font-bold", accentClasses.text)}>{odds.toFixed(2)}</div>
            </div>
          </div>

          <div className="px-6 pb-6 space-y-1">
            <div className="text-lg font-bold text-white leading-tight">{description}</div>
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-400">
              <span className={accentClasses.text}>EV: {evPercent.toFixed(1)}%</span>
              <span className="capitalize">{formatStatText(primaryLine.statKey)}</span>
              <span className="uppercase">{primaryLine.scope || "total"}</span>
              <span>{primaryLine.direction === "over" ? "Över" : "Under"} {primaryLine.line}</span>
              <span className="uppercase">{primaryLine.period}</span>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
