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
  const hasLoggedRef = useRef(false);

  // Calculate position relative to trigger
  useEffect(() => {
    const updatePosition = () => {
      if (isOpen && triggerRef?.current) {
        const rect = triggerRef.current.getBoundingClientRect();

        // Use fixed positioning relative to viewport (no scrollY)
        let top = rect.top - 10; // 10px gap above button
        let left = rect.left + rect.width / 2;

        // Adjust if it goes off screen
        if (left < 200) left = 200;
        if (window.innerWidth - left < 200) left = window.innerWidth - 200;

        setPosition({ top, left });
      }
    };

    updatePosition();

    // Update position on scroll to keep popup attached to button
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
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

  const { backtest, teams, direction, line: lineValue, statKey, period, scope } = line;
  const homeTeam = teams?.home || "Hemmalag";
  const awayTeam = teams?.away || "Bortalag";
  const isOver = direction === 'over';
  const isTotalScope = scope === 'total';

  const teamName = scope === 'away' ? awayTeam : homeTeam;
  const opponentName = scope === 'away' ? homeTeam : awayTeam;
  const teamRole = scope === 'away' ? 'Borta' : 'Hemma';
  const opponentRole = scope === 'away' ? 'Hemma' : 'Borta';
  // Extract data
  const teamStats = backtest?.teamStats || {};
  const opponentStats = backtest?.opponentStats || {};

  console.log("--- AIStatsPopup DEBUG ---");
  console.log("Team:", teamName, "Role:", teamRole);
  console.log("Opponent:", opponentName, "Role:", opponentRole);
  console.log("StatKey:", statKey, "Period:", period, "Scope:", scope);
  console.log("Backtest Object:", backtest);
  console.log("Team Stats History Length:", teamStats.history?.length);
  console.log("Opponent Stats History Length:", opponentStats.history?.length);
  if (teamStats.history?.length > 0) {
    console.log("First Team Match:", teamStats.history[0]);
  }

  // History
  // Trusting the order from engine.js/database which should be sorted by date descending
  const sortedTeamHistory = Array.isArray(teamStats.history) ? teamStats.history : [];
  const sortedOppHistory = Array.isArray(opponentStats.history) ? opponentStats.history : [];

  // Debug log to trace history ordering issues
  useEffect(() => {
    if (isOpen && !hasLoggedRef.current) {
      hasLoggedRef.current = true;
      const dbg = {
        statKey,
        period,
        scope,
        isTotalScope,
        teamHistory: sortedTeamHistory.slice(0, 15).map((m) => ({
          date: m.date,
          ts: m.timestamp,
          val: m.val,
          oppVal: m.oppVal,
          opp: m.opp,
        })),
        oppHistory: sortedOppHistory.slice(0, 15).map((m) => ({
          date: m.date,
          ts: m.timestamp,
          val: m.val,
          oppVal: m.oppVal,
          opp: m.opp,
        })),
      };
      console.log("[AIStatsPopup] history debug", dbg);
    }
    if (!isOpen) {
      hasLoggedRef.current = false;
    }
  }, [isOpen, sortedTeamHistory, sortedOppHistory, statKey, period, scope, isTotalScope]);

  if (!isOpen) return null;

  // Helper to render hits
  const renderHits = (hits, values) => (
    <div className="flex gap-1.5">
      {hits.map((hit, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5">
          {hit ? <CheckIcon className="w-4 h-4 text-emerald-500" /> : <XIcon className="w-4 h-4 text-red-500" />}
          <span className="text-[10px] text-slate-600 font-mono leading-none">
            {values[i] ?? ""}
          </span>
        </div>
      ))}
    </div>
  );

  // --- RENDER LOGIC ---

  if (isTotalScope) {
    // --- TOTAL SCOPE CALCULATIONS ---
    // For total scope, show match totals for each team separately
    // Team A match total = val (which already contains the total for that match)

    // 1. Team A match totals (val + oppVal = total för hela matchen)
    const teamAMatchTotals = [];
    for (let i = 0; i < sortedTeamHistory.length; i++) {
      const match = sortedTeamHistory[i];
      const teamVal = match.val;
      const oppVal = match.oppVal;
      if (typeof teamVal === 'number' && typeof oppVal === 'number') {
        teamAMatchTotals.push(teamVal + oppVal); // Total för matchen
      }
    }

    const teamAAvg = calculateAverage(teamAMatchTotals);
    const teamAMedian = calculateMedian(teamAMatchTotals);

    const teamATotalMatches = teamAMatchTotals.length;
    const teamAHits = teamAMatchTotals.filter(total => isOver ? total > lineValue : total < lineValue).length;
    const teamAHitRatePercent = teamATotalMatches > 0 ? Math.round((teamAHits / teamATotalMatches) * 100) : 0;

    const teamALast5Values = teamAMatchTotals.slice(0, 5);
    const teamALast5Hits = teamALast5Values.map(total => isOver ? total > lineValue : total < lineValue);

    const teamALast10Values = teamAMatchTotals.slice(0, 10);
    const teamALast10Hits = teamALast10Values.map(total => isOver ? total > lineValue : total < lineValue);

    // 2. Team B match totals (val + oppVal = total för hela matchen)
    const teamBMatchTotals = [];
    for (let i = 0; i < sortedOppHistory.length; i++) {
      const match = sortedOppHistory[i];
      const teamVal = match.val;
      const oppVal = match.oppVal;
      if (typeof teamVal === 'number' && typeof oppVal === 'number') {
        teamBMatchTotals.push(teamVal + oppVal); // Total för matchen
      }
    }

    const teamBAvg = calculateAverage(teamBMatchTotals);
    const teamBMedian = calculateMedian(teamBMatchTotals);

    const teamBTotalMatches = teamBMatchTotals.length;
    const teamBHits = teamBMatchTotals.filter(total => isOver ? total > lineValue : total < lineValue).length;
    const teamBHitRatePercent = teamBTotalMatches > 0 ? Math.round((teamBHits / teamBTotalMatches) * 100) : 0;

    const teamBLast5Values = teamBMatchTotals.slice(0, 5);
    const teamBLast5Hits = teamBLast5Values.map(total => isOver ? total > lineValue : total < lineValue);

    const teamBLast10Values = teamBMatchTotals.slice(0, 10);
    const teamBLast10Hits = teamBLast10Values.map(total => isOver ? total > lineValue : total < lineValue);

    // Blended odds for total scope: snitta träffprocent från båda lagen (totals)
    const blendedProbTotal =
      teamATotalMatches > 0 && teamBTotalMatches > 0
        ? (teamAHitRatePercent / 100 + teamBHitRatePercent / 100) / 2
        : teamATotalMatches > 0
        ? teamAHitRatePercent / 100
        : teamBTotalMatches > 0
        ? teamBHitRatePercent / 100
        : null;
    const blendedFairOddsTotal =
      blendedProbTotal && blendedProbTotal > 0 ? (1 / blendedProbTotal).toFixed(2) : null;

    // 3. H2H Total
    const h2hMatch = sortedTeamHistory.find(m => {
      if (!m.opp || !opponentName) return false;
      const hOpp = m.opp.toLowerCase();
      const cOpp = opponentName.toLowerCase();
      return hOpp.includes(cOpp) || cOpp.includes(hOpp);
    });

    const h2hTotalValue = h2hMatch ? h2hMatch.val + (h2hMatch.oppVal || 0) : null;
    const h2hText = h2hMatch && h2hTotalValue !== null
      ? `I senaste mötet (${h2hMatch.date}) fick matchen ${h2hTotalValue} totala ${translateStatKey(statKey)}.`
      : "Ingen senaste H2H hittades.";

    return createPortal(
      <div
        ref={popupRef}
        className="fixed z-50 w-[350px] -translate-x-1/2 -translate-y-full transform rounded-3xl border border-white/20 bg-slate-900/50 backdrop-blur-2xl p-6 shadow-2xl transition-all duration-200 animate-in fade-in zoom-in-95"
        style={{ top: position.top, left: position.left }}
      >
        {/* Header / Title */}
        <div className="mb-5 flex items-start justify-between border-b border-white/10 pb-4">
          <div>
            <h4 className="text-xl font-bold text-white leading-tight">
              [Match] – {isOver ? 'Över' : 'Under'} {lineValue} {translateStatKey(statKey)}
            </h4>
            <p className="text-sm text-slate-400 mt-1 uppercase tracking-wide">
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

          {/* 1. Team A Match Totals */}
          <div>
            <h5 className="font-bold text-emerald-400 mb-2 flex items-center gap-2 text-base">
              1. Totala {translateStatKey(statKey)} – {teamName} (historiskt per match)
            </h5>
            <p className="text-sm text-slate-400 mb-3 pl-2">Summan av båda lagens {translateStatKey(statKey)} i {teamName}:s matcher</p>

            <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-slate-300 pl-2 border-l-2 border-emerald-500/20">
              <div className="flex justify-between">
                <span>Snitt:</span>
                <span className="font-mono text-white">{teamAAvg}</span>
              </div>
              <div className="flex justify-between">
                <span>Median:</span>
                <span className="font-mono text-white">{teamAMedian}</span>
              </div>
              <div className="flex justify-between col-span-2">
                <span>Andel {isOver ? '>' : '≤'} {lineValue}:</span>
                <span className="font-mono text-white">{teamAHits}/{teamATotalMatches} ({teamAHitRatePercent}%)</span>
              </div>
              <div className="flex justify-between col-span-2 items-start mt-1">
                <span>Senaste 5:</span>
                {renderHits(teamALast5Hits, teamALast5Values)}
              </div>
              <div className="flex justify-between col-span-2 items-start">
                <span>Senaste 10:</span>
                {renderHits(teamALast10Hits, teamALast10Values)}
              </div>
            </div>
          </div>

          {/* 2. Team B Match Totals */}
          <div>
            <h5 className="font-bold text-indigo-400 mb-2 flex items-center gap-2 text-base">
              2. Totala {translateStatKey(statKey)} – {opponentName} (historiskt per match)
            </h5>
            <p className="text-sm text-slate-400 mb-3 pl-2">Summan av båda lagens {translateStatKey(statKey)} i {opponentName}:s matcher</p>

            <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-slate-300 pl-2 border-l-2 border-indigo-500/20">
              <div className="flex justify-between">
                <span>Snitt:</span>
                <span className="font-mono text-white">{teamBAvg}</span>
              </div>
              <div className="flex justify-between">
                <span>Median:</span>
                <span className="font-mono text-white">{teamBMedian}</span>
              </div>
              <div className="flex justify-between col-span-2">
                <span>Andel {isOver ? '>' : '≤'} {lineValue}:</span>
                <span className="font-mono text-white">{teamBHits}/{teamBTotalMatches} ({teamBHitRatePercent}%)</span>
              </div>
              <div className="flex justify-between col-span-2 items-start mt-1">
                <span>Senaste 5:</span>
                {renderHits(teamBLast5Hits, teamBLast5Values)}
              </div>
              <div className="flex justify-between col-span-2 items-start">
                <span>Senaste 10:</span>
                {renderHits(teamBLast10Hits, teamBLast10Values)}
              </div>
            </div>
          </div>

          {/* 3. H2H */}
          <div>
            <h5 className="font-bold text-slate-200 mb-2 text-sm uppercase tracking-wider">
              INBÖRDES MÖTEN ({translatePeriod(period)})
            </h5>
            <p className="text-sm text-slate-400 pl-2">
              {h2hText}
            </p>
            <div className="my-3 h-px bg-white/10"></div>
            <div className="pl-2 text-sm text-slate-300 space-y-1.5">
              <div className="flex justify-between">
                <span>Uppskattat korrekt odds:</span>
                <span className="font-mono text-white">
                  {blendedFairOddsTotal ?? "N/A"}
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Baserat på {teamAHits}/{teamATotalMatches} ({teamAHitRatePercent}%)
                {" + "}
                {teamBHits}/{teamBTotalMatches} ({teamBHitRatePercent}%) / 2
              </p>
            </div>
          </div>

        </div>

        {/* Arrow at bottom */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-4 w-4 rotate-45 border-b border-r border-white/10 bg-[#1a1b26]"></div>
      </div>,
      document.body
    );

  } else {
    // --- STANDARD SCOPE CALCULATIONS (Existing Logic) ---

    // Team Stats
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

    // Opponent Stats (Conceded)
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

    // Quick blended probability from the two hit rates (falls back if only one side has data)
    const teamHitProb = teamTotalMatches > 0 ? teamHits / teamTotalMatches : null;
    const oppHitProb = oppTotalMatches > 0 ? oppHits / oppTotalMatches : null;
    const combinedProb =
      teamHitProb != null && oppHitProb != null
        ? (teamHitProb + oppHitProb) / 2
        : teamHitProb ?? oppHitProb;
    const estimatedFairOdds =
      combinedProb && combinedProb > 0 ? (1 / combinedProb).toFixed(2) : null;

    // H2H
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

    return createPortal(
      <div
        ref={popupRef}
        className="fixed z-50 w-[350px] -translate-x-1/2 -translate-y-full transform rounded-3xl border border-white/20 bg-slate-900/50 backdrop-blur-2xl p-6 shadow-2xl transition-all duration-200 animate-in fade-in zoom-in-95"
        style={{ top: position.top, left: position.left }}
      >
        {/* Header / Title */}
        <div className="mb-5 flex items-start justify-between border-b border-white/10 pb-4">
          <div>
            <h4 className="text-xl font-bold text-white leading-tight">
              {teamName} – {isOver ? 'Över' : 'Under'} {lineValue} {translateStatKey(statKey)}
            </h4>
            <p className="text-sm text-slate-400 mt-1 uppercase tracking-wide">
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

        <div className="space-y-7 text-base">

          {/* 1. Team Stats */}
          <div>
            <h5 className="font-bold text-emerald-400 mb-2 flex items-center gap-2 text-base">
              1. {teamName} {translateStatKey(statKey)} ({teamRole})
            </h5>
            <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-slate-300 pl-2 border-l-2 border-emerald-500/20">
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
            <h5 className="font-bold text-indigo-400 mb-2 flex items-center gap-2 text-base">
              2. {opponentName} {translateStatKey(statKey)} emot ({opponentRole})
            </h5>
            <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-slate-300 pl-2 border-l-2 border-indigo-500/20">
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
            <h5 className="font-bold text-slate-200 mb-2 text-sm uppercase tracking-wider">
              Inbördes möten ({translatePeriod(period)})
            </h5>
            <p className="text-sm text-slate-400 pl-2">
              {h2hText}
            </p>
            <div className="my-3 h-px bg-white/10"></div>
            <div className="pl-2 text-sm text-slate-300 space-y-1.5">
              <div className="flex justify-between">
                <span>Uppskattat korrekt odds:</span>
                <span className="font-mono text-white">
                  {estimatedFairOdds ?? "N/A"}
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Baserat på {teamHits}/{teamTotalMatches} ({teamHitRatePercent}%)
                {" + "}
                {oppHits}/{oppTotalMatches} ({oppHitRatePercent}%) / 2
              </p>
            </div>
          </div>

        </div>

        {/* Arrow at bottom */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-4 w-4 rotate-45 border-b border-r border-white/10 bg-[#1a1b26]"></div>
      </div>,
      document.body
    );
  }
}
