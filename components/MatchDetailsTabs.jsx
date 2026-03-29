"use client";

import { useEffect, useRef, useState } from "react";
import TeamCompare, { PERIOD_OPTIONS } from "@/components/TeamCompare";
import Lineups from "@/components/Lineups";
import BacktestPanel from "@/components/BacktestPanel";
import Image from "next/image";
import { FormBadges } from "@/components/TeamOddsHistory";

const TABS = [
  { id: "stats", label: "STATISTIK" },
  { id: "lineups", label: "LAG & ODDS" },
  { id: "backtest", label: "BACKTEST" },
];

function TopNavBar({ activeTab, setActiveTab }) {
  return (
    <div className="relative z-30 flex h-12 w-full shrink-0 items-center justify-center border-b border-white/5 bg-black/40 backdrop-blur-md">
      <div className="flex h-full gap-8">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative h-full px-2 text-[11px] font-bold uppercase tracking-[0.15em] transition-all duration-300 ${
                isActive ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {tab.label}
              {isActive ? (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] animate-in fade-in slide-in-from-bottom-1 bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)] duration-300" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PeriodSelector({ selectedPeriod, onChange }) {
  return (
    <div className="inline-flex items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/40 backdrop-blur-sm divide-x divide-white/5">
      {PERIOD_OPTIONS.map((option) => {
        const isActive = selectedPeriod === option.value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`relative px-5 py-2 text-[10px] font-bold uppercase tracking-wider transition-all duration-300 ${
              isActive
                ? "bg-white/10 text-white"
                : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SummaryPill({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "positive"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : tone === "accent"
        ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
        : "border-white/10 bg-black/30 text-slate-300";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${toneClass}`}
    >
      {label}: {value}
    </span>
  );
}

function MatchHeader({
  match,
  selectedPeriod,
  onPeriodChange,
  activeTab,
  backtestSummary,
}) {
  const getLogo = (id) => {
    if (!id) return "/images/teams/placeholder.png";
    return `/images/teams/${id}.png`;
  };

  const bestBet = backtestSummary?.bestBet ?? null;

  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden pt-10 pb-8 shrink-0">
      <div className="z-10 flex items-center gap-12 scale-90 sm:scale-100">
        <div className="group flex w-40 flex-col items-center gap-3 text-center md:w-56">
          <div className="relative h-20 w-20 transition-transform duration-500 md:h-28 md:w-28">
            <div className="absolute inset-0 scale-125 blur-lg opacity-40">
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
              className="z-10 object-contain drop-shadow-2xl"
              unoptimized
            />
          </div>
          <h2 className="text-base font-bold leading-tight tracking-wide text-white drop-shadow-md md:text-lg">
            {match.homeTeamName}
          </h2>
          <FormBadges teamName={match.homeTeamName} />
        </div>

        <div className="flex flex-col items-center gap-2">
          <span className="font-mono text-3xl font-black tracking-tighter text-slate-800 opacity-50 mix-blend-screen md:text-4xl">
            VS
          </span>
          <span className="rounded-full border border-cyan-500/20 bg-black/40 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.1)] backdrop-blur-md">
            {match.leagueName || "MATCH"}
          </span>
        </div>

        <div className="group flex w-40 flex-col items-center gap-3 text-center md:w-56">
          <div className="relative h-20 w-20 transition-transform duration-500 md:h-28 md:w-28">
            <div className="absolute inset-0 scale-125 blur-lg opacity-40">
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
              className="z-10 object-contain drop-shadow-2xl"
              unoptimized
            />
          </div>
          <h2 className="text-base font-bold leading-tight tracking-wide text-white drop-shadow-md md:text-lg">
            {match.awayTeamName}
          </h2>
          <FormBadges teamName={match.awayTeamName} />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 px-4">
        {bestBet ? (
          <>
            <SummaryPill label="Auto-förslag" value={bestBet.headline} tone="accent" />
            <SummaryPill
              label="EV"
              value={`+${bestBet.primaryEv?.toFixed(1)}%`}
              tone="positive"
            />
            <SummaryPill
              label="Confidence"
              value={`${bestBet.confidenceScore}/100`}
              tone="positive"
            />
          </>
        ) : activeTab === "backtest" ? (
          <SummaryPill
            label="Backtest"
            value="Kör för att få auto-förslag"
            tone="neutral"
          />
        ) : null}
      </div>

      {activeTab === "stats" ? (
        <div className="mt-8 animate-in fade-in slide-in-from-top-1 duration-500">
          <PeriodSelector selectedPeriod={selectedPeriod} onChange={onPeriodChange} />
        </div>
      ) : null}
    </div>
  );
}

export default function MatchDetailsTabs({ match, isLoading, error }) {
  const [activeTab, setActiveTab] = useState("stats");
  const [selectedPeriod, setSelectedPeriod] = useState("ALL");
  const [backtestSummary, setBacktestSummary] = useState(null);
  const contentRef = useRef(null);

  useEffect(() => {
    setBacktestSummary(null);
  }, [match?.matchId, match?.id]);

  if (!match) return null;

  return (
    <div className="relative isolate flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/5 bg-[#030304] shadow-2xl">
      <TopNavBar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div
        ref={contentRef}
        className="custom-scrollbar flex-1 overflow-y-auto overflow-x-hidden scroll-smooth p-0"
      >
        <div className="border-b border-white/5 bg-black/20 pb-2 backdrop-blur-md">
          <MatchHeader
            match={match}
            selectedPeriod={selectedPeriod}
            onPeriodChange={setSelectedPeriod}
            activeTab={activeTab}
            backtestSummary={backtestSummary}
          />
        </div>

        <div className="mx-auto min-h-full w-full max-w-[98%]">
          {activeTab === "stats" ? (
            <div className="h-full animate-in fade-in slide-in-from-bottom-2 p-4 duration-500 md:p-6">
              <TeamCompare
                match={match}
                isLoading={isLoading}
                error={error}
                period={selectedPeriod}
                className="!p-0 border-0 bg-transparent shadow-none"
              />
            </div>
          ) : null}

          {activeTab === "lineups" ? (
            <div className="h-full animate-in fade-in slide-in-from-bottom-2 space-y-8 p-4 duration-500 md:p-6">
              <div className="grid grid-cols-1 gap-6">
                <section>
                  <Lineups match={match} isLoading={isLoading} />
                </section>
              </div>
            </div>
          ) : null}

          {activeTab === "backtest" ? (
            <div className="h-full animate-in fade-in slide-in-from-bottom-2 p-4 duration-500 md:p-6">
              <BacktestPanel match={match} onSummaryChange={setBacktestSummary} />
            </div>
          ) : null}
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
