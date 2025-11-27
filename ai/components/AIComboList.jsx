"use client";

import { buildLineKey } from "@/ai/utils/matchupUtils";
import clsx from "clsx";
import { useState, useRef } from "react";
import AIStatsPopup from "./AIStatsPopup";

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

function getTeamIconUrl(teamId) {
  if (!teamId) return null;
  return `/images/teams/${teamId}.png`;
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
  const homeTeam = line.teams?.home || "";
  const awayTeam = line.teams?.away || "";
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

const CalendarIcon = () => (
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
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
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

export default function AIComboList({ combos, priorityMap = {} }) {
  const [activePopup, setActivePopup] = useState(null); // { comboId, lineIndex }
  const triggerRefs = useRef({}); // Store refs for each info button

  const handleInfoClick = (comboId, lineIndex) => {
    const key = `${comboId}-${lineIndex}`;
    if (activePopup?.key === key) {
      setActivePopup(null);
    } else {
      setActivePopup({ key, comboId, lineIndex });
    }
  };

  if (!combos || !combos.length) {
    return (
      <div className="rounded border border-dashed border-slate-700 bg-slate-950/40 p-4 text-center text-xs uppercase tracking-wider text-slate-400">
        Inga kombinationer hittades ännu
      </div>
    );
  }

  const renderComboCard = (combo, index) => {
    const matchUrlEntries = buildMatchUrlEntries(combo.lines);
    const evPercent = combo.totalEv || 0;

    // Calculate average matchup score for combo
    const matchupScores = combo.lines.map((line) => {
      const lineKey = buildLineKey(line);
      return priorityMap[lineKey] || 0;
    });
    const avgMatchupScore =
      matchupScores.reduce((a, b) => a + b, 0) / matchupScores.length || 0;

    // Determine theme based on combo type
    let themeColor = "emerald"; // default green
    let glowShadow = "shadow-[0_0_12px_rgba(16,185,129,0.35)]";
    let borderColor = "border-emerald-400/40"; // smal border, mer glow
    let headerGradient =
      "bg-gradient-to-r from-emerald-900/20 to-emerald-950/40";
    let progressBarGradient =
      "bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-200";
    let evTextColor = "text-emerald-300";
    let buttonBorderColor = "border-emerald-400/30";
    let buttonHoverGlow =
      "hover:shadow-[0_0_15px_rgba(52,211,153,0.4)]";

    const isCombo = combo.lines.length > 1;
    const isAllUnder = combo.lines.every((l) => l.direction === "under");

    if (isCombo) {
      // Blue theme for combos
      themeColor = "blue";
      glowShadow = "shadow-[0_0_12px_rgba(59,130,246,0.35)]";
      borderColor = "border-blue-400/40";
      headerGradient =
        "bg-gradient-to-r from-blue-900/20 to-blue-950/40";
      progressBarGradient =
        "bg-gradient-to-r from-blue-400 via-blue-300 to-blue-200";
      evTextColor = "text-blue-300";
      buttonBorderColor = "border-blue-400/30";
      buttonHoverGlow =
        "hover:shadow-[0_0_15px_rgba(96,165,250,0.4)]";
    } else if (isAllUnder) {
      // Purple theme for under bets
      themeColor = "purple";
      glowShadow = "shadow-[0_0_12px_rgba(168,85,247,0.35)]";
      borderColor = "border-purple-400/40";
      headerGradient =
        "bg-gradient-to-r from-purple-900/20 to-purple-950/40";
      progressBarGradient =
        "bg-gradient-to-r from-purple-400 via-purple-300 to-purple-200";
      evTextColor = "text-purple-300";
      buttonBorderColor = "border-purple-400/30";
      buttonHoverGlow =
        "hover:shadow-[0_0_15px_rgba(192,132,252,0.4)]";
    }

    return (
      <article
        key={combo.id || `${index}-${combo.odds}`}
        className={clsx(
          "overflow-hidden rounded-2xl bg-[#020617] transition-all duration-300 w-full",
          borderColor,
          glowShadow
        )}
      >
        {/* HEADER SECTION */}
        <div className={`${headerGradient} border-b border-white/5 p-6`}>
          {/* Top Row: Label & Count */}
          <div className="mb-2 flex justify-between text-[11px] font-bold tracking-widest text-slate-400">
            <span>COMBO {index + 1}</span>
            <span>{combo.lines.length} SPEL</span>
          </div>

          {/* Main Row: EV & Progress Bar */}
          <div className="flex items-center gap-6">
            {/* EV Percentage */}
            <div className="flex flex-col">
              <span
                className={`text-6xl font-bold tracking-tighter ${evTextColor} drop-shadow-[0_0_15px_rgba(110,231,183,0.4)]`}
              >
                {evPercent.toFixed(1)}%
              </span>
              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                Total EV för kombon
              </span>
            </div>

            {/* Progress Bar */}
            <div className="relative flex-1">
              <div className="h-4 w-full overflow-hidden rounded-full bg-slate-800/50 shadow-inner drop-shadow-[0_0_15px_rgba(110,231,183,0.2)]">
                <div
                  className={`h-full rounded-full ${progressBarGradient} shadow-[0_0_20px_rgba(52,211,153,0.8)] `}
                  style={{
                    width: `${Math.min(100, avgMatchupScore)}%`,
                  }}
                />
              </div>
            </div>

            {/* Count Badge */}
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
                }
              )}
            >
              {combo.lines.length}/{combo.lines.length}
            </div>
          </div>
        </div>

        {/* BODY SECTION */}
        <div className="p-6">
          <ul className="space-y-6">
            {combo.lines.map((line, lineIndex) => {
              const homeTeam = line.teams?.home || "";
              const awayTeam = line.teams?.away || "";
              const homeTeamId = line.teams?.homeId;
              const awayTeamId = line.teams?.awayId;
              const homeIcon = getTeamIconUrl(homeTeamId);
              const awayIcon = getTeamIconUrl(awayTeamId);
              const uniqueKey = `${combo.id}-${lineIndex}`;

              const description = getBetDescription(line);

              // Determine line-specific glow color
              let oddsColor = "text-emerald-400";

              if (isCombo) {
                oddsColor = "text-blue-400";
              } else if (line.direction === "under") {
                oddsColor = "text-purple-400";
              }

              return (
                <li
                  key={uniqueKey}
                  className={`relative overflow-hidden rounded-xl p-5`}
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* LEFT: Icons & Info */}
                    <div className="flex flex-col gap-3">
                      {/* Team Icons */}
                      <div className="flex items-center gap-4">
                        {homeIcon && (
                          <img
                            src={homeIcon}
                            alt={homeTeam}
                            className="h-16 w-16 object-contain drop-shadow-lg"
                            onError={(e) => {
                              e.target.style.display = "none";
                            }}
                          />
                        )}
                        <span className="text-sm font-bold text-slate-500">
                          vs
                        </span>
                        {awayIcon && (
                          <img
                            src={awayIcon}
                            alt={awayTeam}
                            className="h-16 w-16 object-contain drop-shadow-lg"
                            onError={(e) => {
                              e.target.style.display = "none";
                            }}
                          />
                        )}
                      </div>

                      {/* Description Sentence */}
                      <div>
                        <p className="text-xl font-bold text-slate-100 leading-tight">
                          {description}
                        </p>
                      </div>

                      {/* Stats Row */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-slate-400">
                        <span className="text-slate-300">
                          EV:{" "}
                          <span className={oddsColor}>
                            {line.primaryEv?.toFixed(1)}%
                          </span>
                        </span>

                        <div className="flex items-center gap-1.5">
                          <GlobeIcon />
                          <span>
                            <span className="text-slate-300">
                              {formatStatText(line.statKey)}
                            </span>
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <PinIcon />
                          <span>
                            <span className="text-slate-300">
                              {line.scope || "total"}
                            </span>
                          </span>
                        </div>

                        {/* Info Button */}
                        <div className="relative">
                          <button
                            ref={(el) => (triggerRefs.current[uniqueKey] = el)}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInfoClick(combo.id, lineIndex);
                            }}
                            className={clsx(
                              "flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-all",
                              activePopup?.key === uniqueKey
                                ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50"
                                : "bg-slate-800/50 text-slate-400 hover:bg-slate-700 hover:text-white"
                            )}
                          >
                            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px] font-bold">i</span>
                            <span>Info</span>
                          </button>

                          <AIStatsPopup
                            line={line}
                            isOpen={activePopup?.key === uniqueKey}
                            onClose={() => setActivePopup(null)}
                            triggerRef={{ current: triggerRefs.current[uniqueKey] }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* RIGHT: Odds & Line */}
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

          {/* Links Section */}
          {matchUrlEntries.length > 0 && (
            <div className="mt-2 space-y-3 pt-2">
              {matchUrlEntries.map(({ label, urls }) => (
                <div key={`${combo.id}-${label}`} className="space-y-2">
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
  };

  // Sort all combos by total EV descending
  const sortedCombos = [...combos].sort((a, b) => (b.totalEv || 0) - (a.totalEv || 0));

  return (
    <div className="flex flex-col gap-8 w-full max-w-4xl mx-auto">
      {sortedCombos.map((combo, i) => renderComboCard(combo, i))}
    </div>
  );
}
