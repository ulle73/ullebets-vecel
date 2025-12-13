"use client";

import { useMemo } from "react";
import useSWR from "swr";
import Image from "next/image";
import { extractClosingOdds } from "@/lib/utils/closingOdds";

const TEAM_STATS_ENDPOINT = "/api/backtest";
const TEAM_MATCH_LIMIT = 10;

// Exporting this to separate logic if needed, but keeping it simple
export async function requestTeamMatches(teamName, matchType) {
  const res = await fetch(TEAM_STATS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "team-stats", teamName, matchType }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.message || `Failed to fetch matches for ${teamName}`);
  }
  return Array.isArray(payload?.matches) ? payload.matches : [];
}

function toTimestamp(match) {
  const rawTimestamp = match?.timestamp;
  if (typeof rawTimestamp === "number") {
    return rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000;
  }
  if (typeof rawTimestamp === "string" && rawTimestamp) {
    const parsed = Number(rawTimestamp);
    if (Number.isFinite(parsed)) {
      return parsed > 1e12 ? parsed : parsed * 1000;
    }
  }
  const dateValue = match?.date || match?.matchDate || match?.savedAt;
  if (dateValue) {
    const parsed = Date.parse(dateValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function resolveMatchDate(match) {
  if (match?.date) {
    return match.date;
  }
  const timestamp = toTimestamp(match);
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toISOString().slice(0, 10);
}

function resolvePerspective(match, teamName) {
  const homeTeamCandidates = [match?.homeTeamName, match?.homeTeam?.name].filter(Boolean);
  const normalizedTeamName = (teamName || "").toLowerCase();

  const isHome = homeTeamCandidates.some(
    (candidate) => (candidate || "").toLowerCase() === normalizedTeamName
  );
  if (isHome) {
    return "home";
  }
  return "away";
}

function normalizeMatchEntry(match, perspective) {
  const timestamp = toTimestamp(match);
  const closingInfo = extractClosingOdds(match) || null;
  const closing = closingInfo?.values || null;
  const winner = closingInfo?.winner || null;

  return {
    id:
      match?.matchId ||
      match?.id ||
      match?.gameId ||
      match?.eventId ||
      `${match?.date || ""}-${match?.homeTeamName || ""}-${match?.awayTeamName || ""}`,
    timestamp: timestamp ?? 0,
    date: resolveMatchDate(match),
    venue: perspective,
    closingOdds: closing,
    closingWinner: winner,
    homeTeam: {
      id: match?.homeTeamId || match?.homeTeam?.id,
      name: match?.homeTeamName || match?.homeTeam?.name,
    },
    awayTeam: {
      id: match?.awayTeamId || match?.awayTeam?.id,
      name: match?.awayTeamName || match?.awayTeam?.name,
    }
  };
}

function formatOddsValue(value) {
  if (typeof value === "number") {
    return value.toFixed(2);
  }
  return value ? String(value) : "–";
}

export function useTeamOdds(teamName) {
  return useSWR(teamName ? ["team-odds-history", teamName] : null, ([, team]) => requestTeamMatches(team, "all"), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60 * 1000,
  });
}

function getResult(venue, winner) {
  if (!winner) return null;
  if (winner === "draw") return "D";
  if (venue === "home" && winner === "home") return "W";
  if (venue === "away" && winner === "away") return "W";
  return "L";
}

export function MatchResultBadge({ result, className = "" }) {
  const styles = {
    W: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", // Increased contrast: Lighter text, slightly stronger bg
    D: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    L: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  };
  const style = styles[result] || "bg-slate-800 text-slate-400 border-transparent";

  return (
    <div className={`flex items-center justify-center w-6 h-6 rounded border text-[11px] font-bold ${style} ${className}`}>
      {result || "-"}
    </div>
  );
}

// ------------------------------------------------------------------
// Odds Highlight Logic
// ------------------------------------------------------------------
function getOddsPillStyle(result) {
  if (result === 'W') return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
  if (result === 'D') return "bg-slate-500/20 text-slate-300 border-slate-500/30";
  if (result === 'L') return "bg-rose-500/20 text-rose-300 border-rose-500/30";
  return "text-slate-400 border-transparent";
}

export function TeamOddsList({ teamName, data, loading, error }) {
  const getLogo = (id) => id ? `/images/teams/${id}.png` : "/images/teams/placeholder.png";

  const items = useMemo(() => {
    if (!Array.isArray(data) || !data.length) return [];
    return data
      .map((match) => normalizeMatchEntry(match, resolvePerspective(match, teamName)))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, TEAM_MATCH_LIMIT);
  }, [data, teamName]);

  if (!teamName) return <div className="p-4 text-center text-xs text-slate-500">Välj en match...</div>;
  if (loading) return <div className="p-4 text-center text-xs text-slate-500">Hämtar historik...</div>;
  if (error) return <div className="p-4 text-center text-xs text-rose-500">Kunde inte hämta data</div>;
  if (!items.length) return <div className="p-4 text-center text-xs text-slate-500">Ingen historik hittades.</div>;

  return (
    <div className="flex flex-col gap-1.5 h-full">
      <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-1">
        {items.map((item) => {
          const result = getResult(item.venue, item.closingWinner);

          // Determine styling based on the result of the FOCUS TEAM
          // But apply it to the outcome that occurred.
          // IF Result is L (Loss), highlight the winner (which isn't us) in Red.
          // IF Result is W (Win), highlight the winner (us) in Green.
          // IF Result is D (Draw), highlight Draw in Gray.

          const highlightStyle = getOddsPillStyle(result);

          return (
            <div key={item.id} className="group flex flex-col gap-2 py-3 border-b border-white/10 last:border-0 transition-colors">

              {/* Row 1: Header - Date and Result Badge */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono tracking-tight">{item.date}</span>
                <MatchResultBadge result={result} />
              </div>

              {/* Row 2: Matchup - Names White, Wide */}
              <div className="flex items-center justify-center gap-3 py-1 w-full relative">
                {/* Home */}
                <div className="flex items-center justify-end gap-3 flex-1 min-w-0">
                  <span className="text-[11px] truncate w-full text-right text-white font-medium block">
                    {item.homeTeam.name}
                  </span>
                  <div className="relative w-[22px] h-[22px] shrink-0">
                    <Image src={getLogo(item.homeTeam.id)} alt="" fill className="object-contain" unoptimized />
                  </div>
                </div>

                <span className="text-slate-600 text-[10px] font-bold shrink-0 px-2">VS</span>

                {/* Away */}
                <div className="flex items-center justify-start gap-3 flex-1 min-w-0">
                  <div className="relative w-[22px] h-[22px] shrink-0">
                    <Image src={getLogo(item.awayTeam.id)} alt="" fill className="object-contain" unoptimized />
                  </div>
                  <span className="text-[11px] truncate w-full text-left text-white font-medium block">
                    {item.awayTeam.name}
                  </span>
                </div>
              </div>

              {/* Row 3: Odds -  Solid Divider 80% - Much Weaker */}
              <div className="flex items-center justify-center gap-1 border-t border-white/[0.03] w-[80%] mx-auto pt-2">
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono border ${item.closingWinner === 'home' ? highlightStyle : 'text-slate-600 border-transparent'}`}>
                  <span className="text-[9px] opacity-60">1</span>
                  <span className="font-bold">{formatOddsValue(item.closingOdds?.home)}</span>
                </div>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono border ${item.closingWinner === 'draw' ? highlightStyle : 'text-slate-600 border-transparent'}`}>
                  <span className="text-[9px] opacity-60">X</span>
                  <span className="font-bold">{formatOddsValue(item.closingOdds?.draw)}</span>
                </div>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono border ${item.closingWinner === 'away' ? highlightStyle : 'text-slate-600 border-transparent'}`}>
                  <span className="text-[9px] opacity-60">2</span>
                  <span className="font-bold">{formatOddsValue(item.closingOdds?.away)}</span>
                </div>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}

// Helper component for the header form
export function FormBadges({ teamName, limit = 5 }) {
  const { data } = useTeamOdds(teamName);

  // Process items same as list
  const items = useMemo(() => {
    if (!Array.isArray(data) || !data.length) return [];
    return data
      .map((match) => normalizeMatchEntry(match, resolvePerspective(match, teamName)))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limit);
  }, [data, teamName, limit]);

  if (!items.length) return null;

  return (
    <div className="flex items-center justify-center gap-1 mt-3 animate-in fade-in duration-500">
      {items.map(item => {
        const result = getResult(item.venue, item.closingWinner);
        return <MatchResultBadge key={item.id} result={result} className="w-5 h-5 text-[9px]" />;
      })}
    </div>
  );
}


export function TeamOddsSingle({ teamName, className = "" }) {
  const { data, isLoading, error } = useTeamOdds(teamName);

  return (
    <div className={`flex flex-col bg-[#09090b] rounded-xl border border-white/5 overflow-hidden h-full ${className}`}>
      <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02] shrink-0">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200">
          Form & Odds
        </h3>
      </div>
      <div className="p-4 flex-1 min-h-0 overflow-y-auto">
        <TeamOddsList
          teamName={teamName}
          data={data}
          loading={isLoading}
          error={error}
        />
      </div>
    </div>
  );
}

export default function TeamOddsHistory({
  match,
  className = "",
  showHeader = true,
  contentClassName = "",
}) {
  const homeTeamName = match?.homeTeamName || match?.homeTeam?.name || null;
  const awayTeamName = match?.awayTeamName || match?.awayTeam?.name || null;

  const homeOdds = useTeamOdds(homeTeamName);
  const awayOdds = useTeamOdds(awayTeamName);

  return (
    <div className={`flex flex-col bg-[#09090b] rounded-xl border border-white/5 overflow-hidden ${className}`}>
      {showHeader && (
        <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200">
            Form & Odds
          </h3>
        </div>
      )}
      <div className={`p-4 grid gap-6 md:grid-cols-2 ${contentClassName}`}>
        <TeamOddsList
          teamName={homeTeamName}
          data={homeOdds.data}
          loading={homeOdds.isLoading}
          error={homeOdds.error}
        />
        <TeamOddsList
          teamName={awayTeamName}
          data={awayOdds.data}
          loading={awayOdds.isLoading}
          error={awayOdds.error}
        />
      </div>
    </div>
  );
}
