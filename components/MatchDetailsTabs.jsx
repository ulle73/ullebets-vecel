"use client";

import { useState, useRef, useEffect } from "react";
import TeamCompare, { PERIOD_OPTIONS } from "@/components/TeamCompare";
import Lineups from "@/components/Lineups";
import BacktestPage from "@/components/BacktestPage";
import ClosingOddsCard from "@/components/ClosingOddsCard";
import Image from "next/image";

const TABS = [
  { id: "stats", label: "STATISTIK" },
  { id: "lineups", label: "LAG & ODDS" },
  { id: "backtest", label: "BACKTEST" },
];

function MatchHeader({ match }) {
  // Safe helper for team logos
  const getLogo = (id) => {
    if (!id) return "/images/teams/placeholder.png";
    return `/images/teams/${id}.png`;
  };

  return (
    <div className="flex flex-col items-center justify-center py-8 relative overflow-hidden">
      {/* Dynamic Background Gradient acting as a subtle spotlight behind logos */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-gradient-to-r from-cyan-900/10 via-blue-900/5 to-indigo-900/10 blur-3xl rounded-full -z-10" />

      <div className="flex items-center gap-12 z-10">
        <div className="flex flex-col items-center gap-4 w-40 md:w-56 text-center group">
          <div className="relative w-24 h-24 md:w-32 md:h-32 transition-transform duration-500 group-hover:scale-110">
            {/* Strong colored glow using the image itself */}
            <div className="absolute inset-0 blur-3xl opacity-60 scale-125">
              <Image
                src={getLogo(match.homeTeamId)}
                alt=""
                fill
                className="object-contain"
                unoptimized
              />
            </div>
            <Image
              src={getLogo(match.homeTeamId)}
              alt={match.homeTeamName}
              fill
              className="object-contain drop-shadow-2xl z-10"
              unoptimized
            />
          </div>
          <h2 className="text-lg md:text-xl font-bold text-white leading-tight tracking-wide drop-shadow-md">
            {match.homeTeamName}
          </h2>
        </div>

        <div className="flex flex-col items-center gap-2">
          <span className="text-3xl md:text-5xl font-black text-slate-800 font-mono tracking-tighter mix-blend-screen opacity-50">VS</span>
          <span className="text-xs uppercase tracking-[0.2em] text-cyan-400 font-bold border border-cyan-500/20 px-4 py-1.5 rounded-full bg-black/40 backdrop-blur-md shadow-[0_0_15px_rgba(6,182,212,0.1)]">
            {match.leagueName || "MATCH"}
          </span>
        </div>

        <div className="flex flex-col items-center gap-4 w-40 md:w-56 text-center group">
          <div className="relative w-24 h-24 md:w-32 md:h-32 transition-transform duration-500 group-hover:scale-110">
            {/* Strong colored glow */}
            <div className="absolute inset-0 blur-3xl opacity-60 scale-125">
              <Image
                src={getLogo(match.awayTeamId)}
                alt=""
                fill
                className="object-contain"
                unoptimized
              />
            </div>
            <Image
              src={getLogo(match.awayTeamId)}
              alt={match.awayTeamName}
              fill
              className="object-contain drop-shadow-2xl z-10"
              unoptimized
            />
          </div>
          <h2 className="text-lg md:text-xl font-bold text-white leading-tight tracking-wide drop-shadow-md">
            {match.awayTeamName}
          </h2>
        </div>
      </div>
    </div>
  );
}

export default function MatchDetailsTabs({ match, isLoading, error }) {
  const [activeTab, setActiveTab] = useState("stats");
  const [selectedPeriod, setSelectedPeriod] = useState("ALL"); // Default to ALL

  // Ref for the content container
  const contentRef = useRef(null);

  if (!match) return null;

  return (
    <div className="flex flex-col h-full w-full bg-[#030304] relative isolate overflow-hidden rounded-2xl shadow-2xl border border-white/5">

      {/* 1. Global Background Effects */}
      {/* Subtle refined noise texture could go here if assets allowed, sticking to gradients */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-[#050505] to-black -z-20" />

      {/* Top Accent Line */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent z-20" />

      {/* 2. Header Section */}
      <div className="flex-none bg-black/20 backdrop-blur-md border-b border-white/5 z-10 relative">
        <MatchHeader match={match} />

        {/* Period Selector - Centered below logos */}
        {activeTab === "stats" && PERIOD_OPTIONS && (
          <div className="flex justify-center pb-6 -mt-2 relative z-10">
            <div className="flex gap-1 p-1 bg-black/40 backdrop-blur-md rounded-full border border-white/5 shadow-lg">
              {PERIOD_OPTIONS.map((opt) => {
                const isPeriodActive = selectedPeriod === opt.value;
                // Simplistic labels for buttons: "ALL", "1ST", "2ND" based on options
                // Or use the full label. Let's use short logic if possible, or full. User screenshot showed "ALL", "1ST", "2ND".
                // The export from TeamCompare has "Hela matchen", "Första halvlek". I should map them to short labels for the pill look.
                const shortLabel = opt.value === "ALL" ? "ALL" : opt.value === "1ST" ? "1ST" : "2ND";

                return (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedPeriod(opt.value)}
                    className={`
                                   px-6 py-1.5 rounded-full text-[10px] font-extrabold uppercase tracking-widest transition-all duration-300
                                   ${isPeriodActive
                        ? "bg-cyan-400 text-black shadow-[0_0_15px_rgba(34,211,238,0.5)] scale-105"
                        : "text-slate-500 hover:text-slate-300 hover:bg-white/5"}
                               `}
                  >
                    {shortLabel}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Navigation Tabs - Top Right Absolute */}
        <div className="absolute top-6 right-6 z-20">
          <div className="relative p-1 bg-white/5 rounded-full border border-white/5 flex gap-1 shadow-inner backdrop-blur-md">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                       relative px-4 py-1.5 rounded-full text-[10px] font-bold transition-all duration-300 z-10 uppercase tracking-wide
                       ${isActive ? "text-cyan-950" : "text-slate-300 hover:text-white hover:bg-white/5"}
                     `}
                >
                  {isActive && (
                    <div className="absolute inset-0 bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.4)] rounded-full -z-10 animate-in fade-in zoom-in-105 duration-200" />
                  )}
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. Main Content Area */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-0 custom-scrollbar scroll-smooth"
      >
        <div className="max-w-7xl mx-auto min-h-full">

          {/* Tab: STATISTICS */}
          {activeTab === "stats" && (
            <div className="h-full animate-in fade-in slide-in-from-bottom-2 duration-500 p-4 md:p-6">
              <TeamCompare
                match={match}
                isLoading={isLoading}
                error={error}
                period={selectedPeriod}
                className="bg-transparent border-0 shadow-none !p-0" // Removing internal card styles to blend
              />
            </div>
          )}

          {/* Tab: LINEUPS & ODDS */}
          {activeTab === "lineups" && (
            <div className="h-full animate-in fade-in slide-in-from-bottom-2 duration-500 p-4 md:p-6 space-y-8">
              <div className="grid grid-cols-1 gap-6">
                <section>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 pl-1">Closing Odds</h3>
                  <div className="bg-[#0A0A0A] rounded-xl border border-white/5 shadow-lg overflow-hidden">
                    <ClosingOddsCard match={match} />
                  </div>
                </section>
                <section>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 pl-1">Laguppställningar</h3>
                  <Lineups match={match} isLoading={isLoading} />
                </section>
              </div>
            </div>
          )}

          {/* Tab: BACKTEST */}
          {activeTab === "backtest" && (
            <div className="h-full animate-in fade-in slide-in-from-bottom-2 duration-500">
              <BacktestPage match={match} />
            </div>
          )}

        </div>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 99px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
