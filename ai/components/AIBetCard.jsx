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

  // Determine subject based on scope
  let subject = "";
  if (line.scope === "home") subject = homeTeam;
  else if (line.scope === "away") subject = awayTeam;
  else subject = `${homeTeam} vs ${awayTeam}`;

  // Construct sentence: "Barcelona över 4.5 hörnor (1:a halvlek)"
  let sentence = `${subject} ${direction} ${lineValue} ${stat}`;
  if (period) sentence += ` (${period})`;

  return sentence;
}

// Icons
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

/**
 * AIBetCard - Shared bet card component
 * @param {Object} betDoc - The bet document with lines array
 * @param {number} index - Index in the list
 * @param {boolean} showOutcome - Whether to show win/loss/push outcome (for history)
 * @param {boolean} showUnibetButton - Whether to show "Bet on Unibet" button
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
  const primaryLine = lines[0];
  if (!primaryLine) return null;

  const evPercent = primaryLine.primaryEv || 0;
  const matchupScore = primaryLine.matchupScore || 0;
  const rank = primaryLine.comboRank || index + 1;

  // Determine outcome styling (for history mode)
  let themeColor = "slate";
  let glowShadow = "";
  let borderColor = "border-slate-800";
  let headerGradient = "bg-slate-900";
  let statusText = "PENDING";
  let statusColor = "text-slate-400";

  if (showOutcome) {
    const isLoss = lines.some(l => l.outcome === 'loss');
    const isWin = !isLoss && lines.every(l => l.outcome === 'win');
    const isPush = !isLoss && !isWin && lines.every(l => l.outcome === 'push');

    if (isWin) {
      themeColor = "emerald";
      glowShadow = "shadow-[0_0_15px_rgba(16,185,129,0.25)]";
      borderColor = "border-emerald-500/50";
      headerGradient = "bg-gradient-to-r from-emerald-900/40 to-emerald-950/60";
      statusText = "VINST";
      statusColor = "text-emerald-400";
    } else if (isLoss) {
      themeColor = "rose";
      glowShadow = "shadow-[0_0_15px_rgba(244,63,94,0.25)]";
      borderColor = "border-rose-500/50";
      headerGradient = "bg-gradient-to-r from-rose-900/40 to-rose-950/60";
      statusText = "FÖRLUST";
      statusColor = "text-rose-400";
    } else if (isPush) {
      themeColor = "amber";
      borderColor = "border-amber-500/50";
      headerGradient = "bg-gradient-to-r from-amber-900/40 to-amber-950/60";
      statusText = "PUSH";
      statusColor = "text-amber-400";
    }
  }

  // Build Unibet URLs
  const buildMatchUrlEntries = (lines = []) => {
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
  };

  const matchUrlEntries = showUnibetButton ? buildMatchUrlEntries(lines) : [];

  return (
    <article
      className={clsx(
        "overflow-hidden rounded-2xl bg-[#020617] transition-all duration-300 w-full border",
        borderColor,
        glowShadow
      )}
    >
      {/* HEADER SECTION */}
      <div className={`${headerGradient} border-b border-white/5 p-6`}>
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">
              AI Rank #{rank}
            </span>
            {showOutcome ? (
              <span className={clsx("text-2xl font-black tracking-tight", statusColor)}>
                {statusText}
              </span>
            ) : (
              <span className="text-2xl font-black tracking-tight text-slate-300">
                COMBO
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-3xl font-bold text-slate-200">{evPercent.toFixed(1)}%</span>
              <span className="text-[10px] font-medium text-slate-500 uppercase">EV</span>
            </div>
            <div className="h-8 w-px bg-white/10"></div>
            <div className="flex flex-col items-end">
              <span className="text-3xl font-bold text-slate-200">{matchupScore.toFixed(0)}</span>
              <span className="text-[10px] font-medium text-slate-500 uppercase">Score</span>
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

            // Outcome specific styling for line (history mode)
            let outcomeColor = "text-slate-400";
            if (showOutcome) {
              if (line.outcome === 'win') outcomeColor = "text-emerald-400";
              else if (line.outcome === 'loss') outcomeColor = "text-rose-400";
              else if (line.outcome === 'push') outcomeColor = "text-amber-400";
            }

            return (
              <li key={uniqueKey} className="relative overflow-hidden rounded-xl p-2">
                <div className="flex items-start justify-between gap-4">
                  {/* LEFT: Icons & Info */}
                  <div className="flex flex-col gap-3">
                    {/* Team Icons */}
                    <div className="flex items-center gap-4">
                      <TeamIcon
                        teamId={homeTeamId}
                        alt={homeTeam}
                        className="h-12 w-12 object-contain drop-shadow-lg opacity-80"
                      />
                      <span className="text-xs font-bold text-slate-600">vs</span>
                      <TeamIcon
                        teamId={awayTeamId}
                        alt={awayTeam}
                        className="h-12 w-12 object-contain drop-shadow-lg opacity-80"
                      />
                    </div>

                    {/* Description Sentence */}
                    <div>
                      <p className="text-lg font-bold text-slate-100 leading-tight">
                        {description}
                      </p>
                    </div>

                    {/* Stats Row */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <GlobeIcon />
                        <span className="text-slate-300">{formatStatText(line.statKey)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <PinIcon />
                        <span className="text-slate-300">{line.scope || "total"}</span>
                      </div>

                      {/* Info Button */}
                      <div className="relative">
                        <button
                          ref={(el) => (triggerRefs.current[uniqueKey] = el)}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInfoClick(lineIndex);
                          }}
                          className="flex items-center gap-1.5 rounded-full bg-slate-800/50 px-2 py-0.5 text-slate-400 transition-all hover:bg-slate-700 hover:text-white"
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

                  {/* RIGHT: Result & Odds */}
                  <div className="flex flex-col items-end gap-2">
                    {showOutcome && line.actual !== null && line.actual !== undefined && (
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Utfall</span>
                        <span className={clsx("text-xl font-bold", outcomeColor)}>
                          {line.actual}
                        </span>
                      </div>
                    )}

                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Odds</span>
                      <span className="text-2xl font-bold text-slate-300">{line.odds?.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* FOOTER SECTION - Unibet buttons (live mode only) */}
      {showUnibetButton && matchUrlEntries.length > 0 && (
        <div className="border-t border-white/5 p-6">
          <div className="flex flex-col gap-3">
            {matchUrlEntries.map((entry, idx) => (
              <div key={idx} className="flex flex-col gap-2">
                <span className="text-xs font-medium text-slate-500">{entry.label}</span>
                <div className="flex flex-wrap gap-2">
                  {entry.urls.map((url, urlIdx) => (
                    <a
                      key={urlIdx}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-md transition-all hover:shadow-lg hover:scale-105"
                    >
                      Spela på Unibet
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
