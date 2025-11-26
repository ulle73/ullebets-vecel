"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

const CloseIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const CheckIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const XIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// Swedish translations for stat keys
const STAT_TRANSLATIONS = {
  cornerKicks: "hörnor",
  totalShotsOnGoal: "skott på mål",
  shotsOnGoal: "skott på mål",
  yellowCards: "gula kort",
  throwIns: "inkast",
  freeKicks: "frisparkar",
  fouls: "frisparkar",
  totalTackle: "tacklingar",
  offsides: "offsides",
};

// Period translations
const PERIOD_TRANSLATIONS = {
  ALL: "Hela matchen",
  "1ST": "1:a halvlek",
  "2ND": "2:a halvlek",
};

// Helper to translate stat key
function translateStatKey(statKey) {
  return STAT_TRANSLATIONS[statKey] || statKey;
}

// Helper to translate period
function translatePeriod(period) {
  return PERIOD_TRANSLATIONS[period] || period;
}

// Helper to calculate median
function calculateMedian(values) {
  if (!values || values.length === 0) return "N/A";
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : ((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1);
}

// Helper to calculate average
function calculateAverage(values) {
  if (!values || values.length === 0) return "N/A";
  const sum = values.reduce((a, b) => a + b, 0);
  return (sum / values.length).toFixed(2);
}

export default function AIStatsPopup({ line, isOpen, onClose, triggerRef }) {
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const popupRef = useRef(null);

  // Calculate position relative to trigger
  useEffect(() => {
    if (isOpen && triggerRef?.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const scrollY = window.scrollY;

      // Default to showing above the trigger, centered
      let top = rect.top + scrollY - 10; // 10px gap
      let left = rect.left + rect.width / 2;

      // Adjust if it goes off screen (simplified logic)
      if (left < 150) left = 150;
      if (window.innerWidth - left < 150) left = window.innerWidth - 150;

      setPosition({ top, left });
    }
  }, [isOpen, triggerRef]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popupRef.current && !popupRef.current.contains(event.target) && !triggerRef.current.contains(event.target)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  const { backtest, teams, direction, line: lineValue, statKey, period, scope } = line;
  const homeTeam = teams?.home || "Hemmalag";
  const awayTeam = teams?.away || "Bortalag";
  const isOver = direction === 'over';
  const teamName = scope === 'away' ? awayTeam : homeTeam;
  const opponentName = scope === 'away' ? homeTeam : awayTeam;
  const teamRole = scope === 'away' ? 'Borta' : 'Hemma';
  const opponentRole = scope === 'away' ? 'Hemma' : 'Borta';

  // Extract data
  const teamStats = backtest?.teamStats || {};
  const opponentStats = backtest?.opponentStats || {};

  // History
  const teamHistory = Array.isArray(teamStats.history) ? teamStats.history : [];
  const sortedTeamHistory = [...teamHistory].sort((a, b) => new Date(b.date) - new Date(a.date));

  const opponentHistory = Array.isArray(opponentStats.history) ? opponentStats.history : [];
  const sortedOppHistory = [...opponentHistory].sort((a, b) => new Date(b.date) - new Date(a.date));

  // --- TEAM CALCULATIONS ---
  const teamValues = sortedTeamHistory.map(m => m.val);
  const teamAvg = calculateAverage(teamValues);
  const teamMedian = calculateMedian(teamValues);

  const teamTotalMatches = sortedTeamHistory.length;
  const teamHits = sortedTeamHistory.filter(m => isOver ? m.val > lineValue : m.val < lineValue).length;
  const teamHitRatePercent = teamTotalMatches > 0 ? Math.round((teamHits / teamTotalMatches) * 100) : 0;

  const teamLast5 = sortedTeamHistory.slice(0, 5);
  const teamLast5Hits = teamLast5.map(m => isOver ? m.val > lineValue : m.val < lineValue);

  const teamLast10 = sortedTeamHistory.slice(0, 10);
  const teamLast10Hits = teamLast10.map(m => isOver ? m.val > lineValue : m.val < lineValue);

  // --- OPPONENT CALCULATIONS (Conceded) ---
  // Using oppVal from opponent history
  const oppValues = sortedOppHistory.map(m => m.oppVal);
  const oppAvg = calculateAverage(oppValues);
  const oppMedian = calculateMedian(oppValues);

  const oppTotalMatches = sortedOppHistory.length;
  const oppHits = sortedOppHistory.filter(m => isOver ? m.oppVal > lineValue : m.oppVal < lineValue).length;
  const oppHitRatePercent = oppTotalMatches > 0 ? Math.round((oppHits / oppTotalMatches) * 100) : 0;

  const oppLast5 = sortedOppHistory.slice(0, 5);
  const oppLast5Hits = oppLast5.map(m => isOver ? m.oppVal > lineValue : m.oppVal < lineValue);

  const oppLast10 = sortedOppHistory.slice(0, 10);
  const oppLast10Hits = oppLast10.map(m => isOver ? m.oppVal > lineValue : m.oppVal < lineValue);

  // --- H2H ---
  const currentOpponentName = opponentName;
  const h2hMatch = sortedTeamHistory.find(m => {
    if (!m.opp || !currentOpponentName) return false;
    const hOpp = m.opp.toLowerCase();
    const cOpp = currentOpponentName.toLowerCase();
    return hOpp.includes(cOpp) || cOpp.includes(hOpp);
  });

  const h2hText = h2hMatch
    ? `I senaste mötet (${h2hMatch.date}) fick ${teamName} ${h2hMatch.val} ${translateStatKey(statKey)}.`
    : "Ingen senaste H2H hittades.";


  const renderHits = (hits, values) => (
    <div className="flex gap-1.5">
      {hits.map((hit, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5">
          {hit ? <CheckIcon className="w-3 h-3 text-emerald-500" /> : <XIcon className="w-3 h-3 text-red-500" />}
          <span className="text-[9px] text-slate-600 font-mono leading-none">
            {values[i] ?? ""}
          </span>
        </div>
      ))}
    </div>
  );

  return createPortal(
    <div
      ref={popupRef}
      className="absolute z-50 w-96 -translate-x-1/2 -translate-y-full transform rounded-2xl border border-white/10 bg-[#1a1b26]/95 p-5 shadow-2xl backdrop-blur-md transition-all duration-200 animate-in fade-in zoom-in-95"
      style={{ top: position.top, left: position.left }}
    >
      {/* Header / Title */}
      <div className="mb-4 flex items-start justify-between border-b border-white/5 pb-3">
        <div>
          <h4 className="text-base font-bold text-white leading-tight">
            {teamName} – {isOver ? 'Över' : 'Under'} {lineValue} {translateStatKey(statKey)}
          </h4>
          <p className="text-xs text-slate-400 mt-0.5 uppercase tracking-wide">
            {translatePeriod(period)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-full bg-white/5 p-1 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-6 text-sm">

        {/* 1. Team Stats */}
        <div>
          <h5 className="font-bold text-emerald-400 mb-2 flex items-center gap-2">
            1. {teamName} {translateStatKey(statKey)} ({teamRole})
          </h5>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-300 pl-2 border-l-2 border-emerald-500/20">
            <div className="flex justify-between">
              <span>Snitt:</span>
              <span className="font-mono text-white">{teamAvg}</span>
            </div>
            <div className="flex justify-between">
              <span>Median:</span>
              <span className="font-mono text-white">{teamMedian}</span>
            </div>
            <div className="flex justify-between col-span-2">
              <span>Andel {isOver ? '≥' : '<'} {lineValue}:</span>
              <span className="font-mono text-white">{teamHits}/{teamTotalMatches} ({teamHitRatePercent}%)</span>
            </div>
            <div className="flex justify-between col-span-2 items-start mt-1">
              <span>Senaste 5:</span>
              {renderHits(teamLast5Hits, teamLast5.map(m => m.val))}
            </div>
            <div className="flex justify-between col-span-2 items-start">
              <span>Senaste 10:</span>
              {renderHits(teamLast10Hits, teamLast10.map(m => m.val))}
            </div>
          </div>
        </div>

        {/* 2. Opponent Stats */}
        <div>
          <h5 className="font-bold text-indigo-400 mb-2 flex items-center gap-2">
            2. {opponentName} {translateStatKey(statKey)} emot ({opponentRole})
          </h5>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-300 pl-2 border-l-2 border-indigo-500/20">
            <div className="flex justify-between">
              <span>Snitt:</span>
              <span className="font-mono text-white">{oppAvg}</span>
            </div>
            <div className="flex justify-between">
              <span>Median:</span>
              <span className="font-mono text-white">{oppMedian}</span>
            </div>
            <div className="flex justify-between col-span-2">
              <span>Andel {isOver ? '≥' : '<'} {lineValue} emot:</span>
              <span className="font-mono text-white">{oppHits}/{oppTotalMatches} ({oppHitRatePercent}%)</span>
            </div>
            <div className="flex justify-between col-span-2 items-start mt-1">
              <span>Senaste 5:</span>
              {renderHits(oppLast5Hits, oppLast5.map(m => m.oppVal))}
            </div>
            <div className="flex justify-between col-span-2 items-start">
              <span>Senaste 10:</span>
              {renderHits(oppLast10Hits, oppLast10.map(m => m.oppVal))}
            </div>
          </div>
        </div>

        {/* 3. H2H */}
        <div>
          <h5 className="font-bold text-slate-200 mb-1 text-xs uppercase tracking-wider">
            Inbördes möten ({translatePeriod(period)})
          </h5>
          <p className="text-xs text-slate-400 pl-2">
            {h2hText}
          </p>
        </div>

      </div>

      {/* Arrow at bottom */}
      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-4 w-4 rotate-45 border-b border-r border-white/10 bg-[#1a1b26]"></div>
    </div>,
    document.body
  );
}
