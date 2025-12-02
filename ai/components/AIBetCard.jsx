"use client";

import { buildLineKey } from "@/lib/core/keys";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import AIStatsPopup from "./AIStatsPopup";

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

const GlobeIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-3 w-3"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="2" x2="22" y1="12" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const PinIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-3 w-3"
  >
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

function buildMatchUrlEntries(lines = []) {
  const map = new Map();
  lines.forEach((line) => {
    const url = line?.unibetUrl;
    if (!url) return;
    const label = line.matchLabel || line.match || "Match";
    if (!map.has(label)) {
      map.set(label, new Set());
    }
    map.get(label).add(url);
  });
  return Array.from(map.entries()).map(([label, urls]) => ({
    label,
    urls: Array.from(urls),
  }));
}

/**
 * AIBetCard - Shared bet card component with full styling
 * @param {Object} betDoc - The bet document with lines array
 * @param {number} index - Index in the list
 * @param {boolean} showOutcome - Whether to show win/loss/push outcome (for history)
 * @param {boolean} showUnibetButton - Whether to show "Bet on Unibet" button
 * @param {Object} priorityMap - Map of line priorities/scores
 */
export default function AIBetCard({ betDoc, index, showOutcome = false, showUnibetButton = true, priorityMap = {} }) {
  const [activePopup, setActivePopup] = useState(null);
  const triggerRefs = useRef({});

  const handleInfoClick = (lineIndex) => {
    const key = `${betDoc._id}-${lineIndex}`;
    if (activePopup === key) {
      setActivePopup(null);
    } else {
      setActivePopup(key);
    }
  };

  const lines = betDoc.lines || [];
  if (!lines.length) return null;

  const matchUrlEntries = showUnibetButton ? buildMatchUrlEntries(lines) : [];
  const evPercent = betDoc.totalEv || lines[0]?.primaryEv || 0;
  const primaryLine = lines[0];
  const displayRank = betDoc.comboRank ?? primaryLine?.comboRank ?? index + 1;
  const displayScore = betDoc.comboScore ?? primaryLine?.comboScore ?? null;

  // Calculate average matchup score
  const matchupScores = lines.map((line) => {
    return Number(line.matchupScore ?? priorityMap[buildLineKey(line)] ?? 0);
  });
  const avgMatchupScore =
    matchupScores.reduce((a, b) => a + b, 0) / matchupScores.length || 0;

  // Determine theme
  let themeColor = "emerald";
  let glowShadow = "shadow-[0_0_12px_rgba(16,185,129,0.35)]";
  let borderColor = "border-emerald-400/40";
  let headerGradient = "bg-gradient-to-r from-emerald-900/20 to-emerald-950/40";
  let progressBarGradient = "bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-200";
  let evTextColor = "text-emerald-300";
  let buttonBorderColor = "border-emerald-400/30";
  let buttonHoverGlow = "hover:shadow-[0_0_15px_rgba(52,211,153,0.4)]";
  let statusText = "";
  let showStatus = false;
  let outcomeValue = null;

  // Override theme for history mode
  if (showOutcome) {
    const normalizedOutcome = lines.map((l) => {
      if (l.outcome) return l.outcome;
      if (l.win === true || l.win === "true") return "win";
      if (l.win === false || l.win === "false") return "loss";
      return "pending";
    });
    const isLoss = normalizedOutcome.some((o) => o === "loss");
    const isWin = !isLoss && normalizedOutcome.every((o) => o === "win");
    const isPush = !isLoss && !isWin && normalizedOutcome.every((o) => o === "push");

    // outcome value from first line
    outcomeValue = lines[0]?.actual ?? null;

    showStatus = true;
    if (isWin) {
      statusText = "WIN";
      themeColor = "emerald";
      glowShadow = "shadow-[0_0_15px_rgba(16,185,129,0.35)]";
      borderColor = "border-emerald-500/50";
      headerGradient = "bg-gradient-to-r from-emerald-900/20 to-emerald-950/40";
      evTextColor = "text-emerald-300";
    } else if (isLoss) {
      statusText = "LOSS";
      themeColor = "rose";
      glowShadow = "shadow-[0_0_15px_rgba(244,63,94,0.35)]";
      borderColor = "border-rose-500/50";
      headerGradient = "bg-gradient-to-r from-rose-900/20 to-rose-950/40";
      progressBarGradient = "bg-gradient-to-r from-rose-400 via-rose-300 to-rose-200";
      evTextColor = "text-rose-300";
    } else if (isPush) {
      statusText = "PUSH";
      themeColor = "amber";
      borderColor = "border-amber-500/50";
      headerGradient = "bg-gradient-to-r from-amber-900/20 to-amber-950/40";
      progressBarGradient = "bg-gradient-to-r from-amber-400 via-amber-300 to-amber-200";
      evTextColor = "text-amber-300";
    } else {
      statusText = "PENDING";
      // keep status strip visible for pending
    }
  } else {
    // Live mode themes
    const isCombo = lines.length > 1;
    const isAllUnder = lines.every((l) => l.direction === "under");

    if (isCombo) {
      themeColor = "blue";
      glowShadow = "shadow-[0_0_12px_rgba(59,130,246,0.35)]";
      borderColor = "border-blue-400/40";
      headerGradient = "bg-gradient-to-r from-blue-900/20 to-blue-950/40";
      progressBarGradient = "bg-gradient-to-r from-blue-400 via-blue-300 to-blue-200";
      evTextColor = "text-blue-300";
      buttonBorderColor = "border-blue-400/30";
      buttonHoverGlow = "hover:shadow-[0_0_15px_rgba(96,165,250,0.4)]";
    } else if (isAllUnder) {
      themeColor = "purple";
      glowShadow = "shadow-[0_0_12px_rgba(168,85,247,0.35)]";
      borderColor = "border-purple-400/40";
      headerGradient = "bg-gradient-to-r from-purple-900/20 to-purple-950/40";
      progressBarGradient = "bg-gradient-to-r from-purple-400 via-purple-300 to-purple-200";
      evTextColor = "text-purple-300";
      buttonBorderColor = "border-purple-400/30";
      buttonHoverGlow = "hover:shadow-[0_0_15px_rgba(192,132,252,0.4)]";
    }
  }

  return (
    <article
      className={clsx(
        "overflow-hidden rounded-2xl bg-[#020617] transition-all duration-300 w-full",
        borderColor,
        glowShadow
      )}
    >
      {/* HEADER SECTION */}
        <div className={`${headerGradient} border-b border-white/5 p-6 flex flex-col sm:flex-row`}>
          {/* Status strip */}
          {showStatus && (
            <div className="mr-4 flex-shrink-0 border-r border-white/10 pr-4">
              <div className="text-4xl font-extrabold tracking-tight text-emerald-300">
                {statusText}
              </div>
              <div className="text-xs uppercase text-slate-400">
                Outcome {outcomeValue != null ? outcomeValue : "—"}
              </div>
              <div className="mt-2 inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-slate-200">
                Combo {displayRank}
                {displayScore != null
                  ? ` (${Number(displayScore).toFixed ? Number(displayScore).toFixed(1) : displayScore})`
                  : ""}
              </div>
            </div>
          )}

          <div className="flex-1">
            <div className="mb-2 flex justify-between text-[11px] font-bold tracking-widest text-slate-400">
              <span>
                {showStatus ? "" : `COMBO ${displayRank}`}
                {!showStatus && displayScore != null
                  ? ` (${Number(displayScore).toFixed ? Number(displayScore).toFixed(1) : displayScore})`
                  : ""}
              </span>
              <span>{lines.length} SPEL</span>
            </div>

            <div className="flex items-center gap-6">
              {/* EV Percentage */}
              <div className="flex flex-col">
                <span
                  className={`text-6xl font-bold tracking-tighter ${evTextColor} drop-shadow-[0_0_15px_rgba(110,231,183,0.4)]`}
                >
                  {evPercent.toFixed(1)}%
                </span>
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                  {betDoc.totalEv ? "Total EV för kombon" : "Expected Value"}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="relative flex-1">
                <div className="h-4 w-full overflow-hidden rounded-full bg-slate-800/50 shadow-inner drop-shadow-[0_0_15px_rgba(110,231,183,0.2)]">
                  <div
                    className={`h-full rounded-full ${progressBarGradient} shadow-[0_0_20px_rgba(52,211,153,0.8)]`}
                    style={{
                      width: `${Math.min(100, avgMatchupScore)}%`,
                    }}
                  />
                </div>
              </div>

              {/* Score Badge */}
              <div
                className={clsx(
                  "flex h-8 w-14 items-center justify-center rounded-full text-sm font-bold ring-1",
                  {
                    "bg-emerald-500/20 text-emerald-400 ring-emerald-500/30":
                      themeColor === "emerald",
                    "bg-blue-500/20 text-blue-400 ring-blue-500/30":
                      themeColor === "blue",
                    "bg-purple-500/20 text-purple-400 ring-purple-500/30":
                      themeColor === "purple",
                    "bg-rose-500/20 text-rose-400 ring-rose-500/30":
                      themeColor === "rose",
                    "bg-amber-500/20 text-amber-400 ring-amber-500/30":
                      themeColor === "amber",
                  }
                )}
              >
                {avgMatchupScore.toFixed(0)}
              </div>
            </div>
          </div>
        </div>

      {/* BODY SECTION */}
      <div className="p-6">
        <ul className="space-y-6">
          {lines.map((line, lineIndex) => {
            const homeTeam = line.teams?.home || line.homeTeam || "";
            const awayTeam = line.teams?.away || line.awayTeam || "";
            const homeTeamId = line.teams?.homeId || line.homeTeamId;
            const awayTeamId = line.teams?.awayId || line.awayTeamId;
            const uniqueKey = `${betDoc._id}-${lineIndex}`;
            const description = getBetDescription(line);

            let oddsColor = "text-emerald-400";
            if (showOutcome) {
              if (line.outcome === 'win') oddsColor = "text-emerald-400";
              else if (line.outcome === 'loss') oddsColor = "text-rose-400";
              else if (line.outcome === 'push') oddsColor = "text-amber-400";
            } else {
              const isCombo = lines.length > 1;
              if (isCombo) {
                oddsColor = "text-blue-400";
              } else if (line.direction === "under") {
                oddsColor = "text-purple-400";
              }
            }

            return (
              <li key={uniqueKey} className="relative overflow-hidden rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  {/* LEFT */}
                  <div className="flex flex-col gap-3">
                    {/* Team Icons */}
                    <div className="flex items-center gap-4">
                      <TeamIcon
                        teamId={homeTeamId}
                        alt={homeTeam}
                        className="h-16 w-16 object-contain drop-shadow-lg"
                      />
                      <span className="text-sm font-bold text-slate-500">vs</span>
                      <TeamIcon
                        teamId={awayTeamId}
                        alt={awayTeam}
                        className="h-16 w-16 object-contain drop-shadow-lg"
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <p className="text-xl font-bold text-slate-100 leading-tight">
                        {description}
                      </p>
                    </div>

                    {/* Stats Row */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-slate-400">
                      <span className="text-slate-300">
                        EV: <span className={oddsColor}>{line.primaryEv?.toFixed(1)}%</span>
                      </span>

                      <div className="flex items-center gap-1.5">
                        <GlobeIcon />
                        <span className="text-slate-300">{formatStatText(line.statKey)}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <PinIcon />
                        <span className="text-slate-300">{line.scope || "total"}</span>
                      </div>

                      {showOutcome && line.actual !== null && line.actual !== undefined && (
                        <span className="text-slate-300">
                          Utfall: <span className={oddsColor}>{line.actual}</span>
                        </span>
                      )}

                      {/* Info Button */}
                      <div className="relative">
                        <button
                          ref={(el) => (triggerRefs.current[uniqueKey] = el)}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInfoClick(lineIndex);
                          }}
                          className={clsx(
                            "flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-all",
                            activePopup === uniqueKey
                              ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50"
                              : "bg-slate-800/50 text-slate-400 hover:bg-slate-700 hover:text-white"
                          )}
                        >
                          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px] font-bold">i</span>
                          <span>Info</span>
                        </button>

                        <AIStatsPopup
                          line={line}
                          isOpen={activePopup === uniqueKey}
                          onClose={() => setActivePopup(null)}
                          triggerRef={{ current: triggerRefs.current[uniqueKey] }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* RIGHT: Odds */}
                  <div className="flex min-w-[80px] flex-col items-end justify-center">
                    <span className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Odds
                    </span>
                    <span
                      className={`text-6xl font-bold ${oddsColor} tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]`}
                    >
                      {line.odds?.toFixed(2)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Unibet Buttons */}
        {showUnibetButton && matchUrlEntries.length > 0 && (
          <div className="mt-2 space-y-3 pt-2">
            {matchUrlEntries.map(({ label, urls }) => (
              <div key={`${betDoc._id}-${label}`} className="space-y-2">
                {urls.map((url, idx) => (
                  <a
                    key={idx}
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={`group relative block w-full overflow-hidden rounded-full border ${buttonBorderColor} bg-transparent py-3 text-center text-sm font-bold text-${themeColor}-300 transition-all hover:bg-${themeColor}-950/30 hover:text-${themeColor}-200 ${buttonHoverGlow}`}
                  >
                    <span className="relative z-10">Bet on Unibet</span>
                  </a>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
