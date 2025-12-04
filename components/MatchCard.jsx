"use client";

import { useState } from "react";
import Image from "next/image";
import { MoreHorizontal } from "lucide-react";

function TeamLogo({ id, name, size = 40 }) {
  // Simple fallback logic similar to LeagueTable
  const src = id ? `/images/teams/${id}.png` : "/images/teams/placeholder.png";

  return (
    <div className="relative flex items-center justify-center rounded-full bg-white/5 p-2 ring-1 ring-white/10">
      <Image
        src={src}
        alt={name}
        width={size}
        height={size}
        className="object-contain"
        onError={(e) => {
          e.currentTarget.src = "/images/teams/placeholder.png";
        }}
        unoptimized
      />
    </div>
  );
}

export default function MatchCard({ match, onClick }) {
  const {
    homeTeamName,
    awayTeamName,
    homeTeamId,
    awayTeamId,
    leagueName,
    timestamp,
    homeScore,
    awayScore,
  } = match;

  const date = timestamp ? new Date(timestamp * 1000) : null;
  const dateStr = date ? date.toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" }) : "Unknown Date";

  // Placeholder win probability - in a real app this would come from the model
  const homeWinProb = 45;
  const awayWinProb = 35;
  const drawProb = 20;

  return (
    <div
      onClick={() => onClick && onClick(match)}
      className="group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] p-5 transition-all hover:border-[#00f2ea]/30 hover:shadow-[0_0_30px_-10px_rgba(0,242,234,0.15)]"
    >
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-center gap-2">
          {/* League Icon Placeholder */}
          <div className="flex h-6 w-6 items-center justify-center rounded bg-white/5 text-[10px] text-gray-400">
            L
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium text-gray-400">{leagueName}</span>
            <span className="text-[10px] text-gray-600">{dateStr}</span>
          </div>
        </div>
        <button className="text-gray-600 transition-colors hover:text-white">
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      {/* Teams */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex flex-col items-center gap-2">
          <TeamLogo id={homeTeamId} name={homeTeamName} />
          <span className="max-w-[80px] truncate text-center text-xs font-bold text-white">
            {homeTeamName}
          </span>
        </div>

        <div className="flex flex-col items-center gap-1">
          <span className="text-xs font-medium text-gray-500">VS</span>
          {typeof homeScore === 'number' && (
            <span className="text-lg font-bold text-white">
              {homeScore} - {awayScore}
            </span>
          )}
        </div>

        <div className="flex flex-col items-center gap-2">
          <TeamLogo id={awayTeamId} name={awayTeamName} />
          <span className="max-w-[80px] truncate text-center text-xs font-bold text-white">
            {awayTeamName}
          </span>
        </div>
      </div>

      {/* Stats / Probability */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[10px] font-medium text-gray-400">
          <span>{homeWinProb}%</span>
          <span className="text-[#00f2ea]">WIN PROBABILITY</span>
          <span>{awayWinProb}%</span>
        </div>
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full bg-blue-600"
            style={{ width: `${homeWinProb}%` }}
          />
          <div
            className="h-full bg-gray-700"
            style={{ width: `${drawProb}%` }}
          />
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${awayWinProb}%` }}
          />
        </div>
      </div>

      {/* Hover Glow Effect */}
      <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-[#00f2ea]/5 blur-3xl transition-opacity group-hover:opacity-100" />
    </div>
  );
}
