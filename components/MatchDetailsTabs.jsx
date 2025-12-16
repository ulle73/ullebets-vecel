"use client";

import { useState, useRef, useEffect } from "react";
import TeamCompare, { PERIOD_OPTIONS } from "@/components/TeamCompare";
import Lineups from "@/components/Lineups";
import BacktestPage from "@/components/BacktestPage";
import ClosingOddsCard from "@/components/ClosingOddsCard";
import Image from "next/image";
import { FormBadges } from "@/components/TeamOddsHistory";

const TABS = [
  { id: "stats", label: "STATISTIK" },
  { id: "lineups", label: "LAG & ODDS" },
  { id: "backtest", label: "BACKTEST" },
];

function TopNavBar({ activeTab, setActiveTab }) {
  return (
    <div className="flex h-12 w-full items-center justify-center border-b border-white/5 bg-black/40 backdrop-blur-md z-30 relative shrink-0">
      <div className="flex h-full gap-8">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                relative h-full px-2 text-[11px] font-bold uppercase tracking-[0.15em] transition-all duration-300
                ${isActive ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"}
              `}
            >
              {tab.label}
              {/* Active Indicator Line */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)] animate-in fade-in slide-in-from-bottom-1 duration-300" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PeriodSelector({ selectedPeriod, onChange }) {
  return (
    <div className="inline-flex items-center justify-center border border-white/10 rounded-full bg-black/40 backdrop-blur-sm overflow-hidden divide-x divide-white/5">
      {PERIOD_OPTIONS.map((option) => {
        const isActive = selectedPeriod === option.value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`
              relative px-5 py-2 transition-all duration-300 text-[10px] font-bold uppercase tracking-wider
              ${isActive ? "text-white bg-white/10" : "text-slate-500 hover:text-slate-300 hover:bg-white/5"}
            `}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function MatchHeader({ match, selectedPeriod, onPeriodChange, activeTab }) {
  // Safe helper for team logos
  const getLogo = (id) => {
    if (!id) return "/images/teams/placeholder.png";
    return `/images/teams/${id}.png`;
  };

  return (
    <div className="flex flex-col items-center justify-center pt-10 pb-8 relative overflow-hidden shrink-0">
      {/* Dynamic Background Gradient acting as a subtle spotlight behind logos - REMOVED */}

      <div className="flex items-center gap-12 z-10 sm:scale-100 scale-90">
        <div className="flex flex-col items-center gap-3 w-40 md:w-56 text-center group">
          <div className="relative w-20 h-20 md:w-28 md:h-28 transition-transform duration-500">
            {/* Strong colored glow using the image itself */}
            <div className="absolute inset-0 blur-lg opacity-40 scale-125">
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
          <h2 className="text-base md:text-lg font-bold text-white leading-tight tracking-wide drop-shadow-md">
            {match.homeTeamName}
          </h2>
          <FormBadges teamName={match.homeTeamName} />
        </div>

        <div className="flex flex-col items-center gap-2">
          <span className="text-3xl md:text-4xl font-black text-slate-800 font-mono tracking-tighter mix-blend-screen opacity-50">VS</span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-bold border border-cyan-500/20 px-3 py-1 rounded-full bg-black/40 backdrop-blur-md shadow-[0_0_15px_rgba(6,182,212,0.1)]">
            {match.leagueName || "MATCH"}
          </span>
        </div>

        <div className="flex flex-col items-center gap-3 w-40 md:w-56 text-center group">
          <div className="relative w-20 h-20 md:w-28 md:h-28 transition-transform duration-500">
            {/* Strong colored glow */}
            <div className="absolute inset-0 blur-lg opacity-40 scale-125">
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
          <h2 className="text-base md:text-lg font-bold text-white leading-tight tracking-wide drop-shadow-md">
            {match.awayTeamName}
          </h2>
          <FormBadges teamName={match.awayTeamName} />
        </div>
      </div>

      {/* Period Selector restored and placed below logos */}
      {activeTab === 'stats' && (
        <div className="mt-8 animate-in fade-in slide-in-from-top-1 duration-500">
          <PeriodSelector selectedPeriod={selectedPeriod} onChange={onPeriodChange} />
        </div>
      )}
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
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-[#050505] to-black -z-20" />
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent z-20" />

      {/* 2. Top Navigation Bar - FIXED */}
      <TopNavBar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* 3. Main Content Area (Scrollable) */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-0 custom-scrollbar scroll-smooth"
      >
        {/* MatchHeader moved INSIDE scrollable area to scroll with content */}
        <div className="bg-black/20 backdrop-blur-md border-b border-white/5 pb-2">
          <MatchHeader
            match={match}
            selectedPeriod={selectedPeriod}
            onPeriodChange={setSelectedPeriod}
            activeTab={activeTab}
          />
        </div>

        <div className="w-full max-w-[98%] mx-auto min-h-full">

          {/* Tab: STATISTICS */}
          {activeTab === "stats" && (
            <div className="h-full animate-in fade-in slide-in-from-bottom-2 duration-500 p-4 md:p-6">
              <TeamCompare
                match={match}
                isLoading={isLoading}
                error={error}
                period={selectedPeriod}
                className="bg-transparent border-0 shadow-none !p-0"
              />
            </div>
          )}

          {/* Tab: LINEUPS & ODDS */}
          {activeTab === "lineups" && (
            <div className="h-full animate-in fade-in slide-in-from-bottom-2 duration-500 p-4 md:p-6 space-y-8">
              <div className="grid grid-cols-1 gap-6">
                <section>

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
