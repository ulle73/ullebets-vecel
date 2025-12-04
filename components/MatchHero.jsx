"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function MatchHero() {
  return (
    <div className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0f172a] to-black p-8">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[url('/images/grid-pattern.svg')] opacity-10" />
      <div className="absolute left-1/4 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[100px]" />
      <div className="absolute right-1/4 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-purple-500/10 blur-[100px]" />

      <div className="relative z-10 flex items-center justify-between">
        <button className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/50 text-white transition-colors hover:bg-white/10">
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="flex flex-1 items-center justify-center gap-12">
          {/* Home Team */}
          <div className="flex flex-col items-center gap-4">
            <div className="relative h-24 w-24">
              <div className="absolute inset-0 animate-pulse rounded-full bg-blue-500/20 blur-xl" />
              <Image
                src="/images/teams/17.png" // Man City ID placeholder
                alt="Manchester City"
                width={96}
                height={96}
                className="relative object-contain drop-shadow-2xl"
                unoptimized
              />
            </div>
            <span className="text-xl font-bold text-white">Manchester City</span>
          </div>

          {/* Center Info */}
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-[#00f2ea] shadow-[0_0_10px_#00f2ea]" />
              <span className="text-xs font-medium text-gray-300">Premier League</span>
            </div>

            <div className="my-4 flex flex-col items-center">
              <span className="text-5xl font-black tracking-tighter text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.2)]">
                85%
              </span>
              <span className="text-sm font-medium tracking-widest text-[#00f2ea]">
                WIN PROBABILITY
              </span>
            </div>

            <button className="rounded-xl bg-[#2563eb] px-6 py-2.5 text-sm font-bold text-white shadow-[0_0_20px_rgba(37,99,235,0.3)] transition-all hover:bg-[#1d4ed8] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)]">
              View Analysis
            </button>
          </div>

          {/* Away Team */}
          <div className="flex flex-col items-center gap-4">
            <div className="relative h-24 w-24">
              <div className="absolute inset-0 animate-pulse rounded-full bg-purple-500/20 blur-xl" />
              <Image
                src="/images/teams/86.png" // Real Madrid ID placeholder
                alt="Real Madrid"
                width={96}
                height={96}
                className="relative object-contain drop-shadow-2xl"
                unoptimized
              />
            </div>
            <span className="text-xl font-bold text-white">Real Madrid</span>
          </div>
        </div>

        <button className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/50 text-white transition-colors hover:bg-white/10">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
