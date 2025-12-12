"use client";

import { useMemo } from "react";
import useSWR from "swr";
import Image from "next/image";
import { extractClosingOdds } from "@/lib/utils/closingOdds";

const TEAM_STATS_ENDPOINT = "/api/backtest";
const TEAM_MATCH_LIMIT = 10;

async function requestTeamMatches(teamName, matchType) {
  console.log(`[requestTeamMatches] Fetching for team: '${teamName}', type: '${matchType}'`);
  const res = await fetch(TEAM_STATS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "team-stats", teamName, matchType }),
  });

  console.log(`[requestTeamMatches] API response status for '${teamName}': ${res.status}`);
  const payload = await res.json().catch(() => ({}));
  console.log(`[requestTeamMatches] API payload for '${teamName}':`, payload);

  if (!res.ok) {
    const message = payload?.message || `Failed to fetch matches for ${teamName}`;
    console.error(`[requestTeamMatches] Error for '${teamName}':`, message);
    throw new Error(message);
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

function resolveOpponent(match, perspective) {
  if (perspective === "home") {
    return (
      match?.awayTeamName ||
      match?.awayTeam?.name ||
      match?.awayTeam?.teamName ||
      match?.awayTeam ||
      null
    );
  }
  return (
    match?.homeTeamName ||
    match?.homeTeam?.name ||
    match?.homeTeam?.teamName ||
    match?.homeTeam ||
    null
  );
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

function useTeamOdds(teamName) {
  return useSWR(teamName ? ["team-odds-history", teamName] : null, ([, team]) => requestTeamMatches(team, "all"), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60 * 1000,
    onError: (error) => {
      console.error(`[useTeamOdds] API error for '${teamName}':`, error);
    }
  });
}

function getResult(venue, winner) {
  if (!winner) return null;
  if (winner === "draw") return "D";
  if (venue === "home" && winner === "home") return "W";
  if (venue === "away" && winner === "away") return "W";
  return "L";
}

function MatchResultBadge({ result }) {
  const styles = {
    W: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    D: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    L: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  };
  const style = styles[result] || "bg-slate-800 text-slate-600 border-transparent";

  return (
    <div className={`flex items-center justify-center w-5 h-5 rounded border text-[10px] font-bold ${style}`}>
      {result || "-"}
    </div>
  );
}

function TeamOddsList({ teamName, data, loading, error }) {
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-2 pb-2 border-b border-white/5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{teamName}</span>
        <span className="text-[10px] text-slate-600">SENASTE 10</span>
      </div>
      <div className="flex flex-col gap-1">
        {items.map((item) => {
          const result = getResult(item.venue, item.closingWinner);

          return (
            <div key={item.id} className="group flex items-center justify-between p-2 rounded hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">

              {/* Left: Date + Matchup */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Date */}
                <div className="flex flex-col w-[40px] shrink-0">
                  <span className="text-[9px] text-slate-500 font-mono tracking-tight">{item.date}</span>
                </div>

                {/* Matchup Center */}
                <div className="flex items-center gap-1.5 text-xs min-w-0 flex-1">
                  {/* Home Team */}
                  <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
                    <span className={`truncate text-right text-[10px] ${item.homeTeam.name === teamName ? 'text-white font-semibold' : 'text-slate-400'}`}>
                      {item.homeTeam.name}
                    </span>
                    <div className="relative w-4 h-4 shrink-0">
                      <Image src={getLogo(item.homeTeam.id)} alt={item.homeTeam.name || ''} fill className="object-contain" unoptimized />
                    </div>
                  </div>

                  <span className="text-slate-700 font-mono text-[9px] shrink-0">-</span>

                  {/* Away Team */}
                  <div className="flex items-center gap-1.5 flex-1 justify-start min-w-0">
                    <div className="relative w-4 h-4 shrink-0">
                      <Image src={getLogo(item.awayTeam.id)} alt={item.awayTeam.name || ''} fill className="object-contain" unoptimized />
                    </div>
                    <span className={`truncate text-left text-[10px] ${item.awayTeam.name === teamName ? 'text-white font-semibold' : 'text-slate-400'}`}>
                      {item.awayTeam.name}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Result + Odds */}
              <div className="flex items-center gap-2 pl-2 border-l border-white/5 shrink-0 ml-1">
                <MatchResultBadge result={result} />

                <div className="flex gap-1 text-[9px] font-mono justify-end">
                  {/* 1 */}
                  <span className={`min-w-[24px] text-center py-0.5 rounded ${item.closingWinner === 'home' ? 'bg-emerald-500/20 text-emerald-400 font-bold' : 'text-slate-600'}`}>
                    {formatOddsValue(item.closingOdds?.home)}
                  </span>
                  {/* X */}
                  <span className={`min-w-[24px] text-center py-0.5 rounded ${item.closingWinner === 'draw' ? 'bg-emerald-500/20 text-emerald-400 font-bold' : 'text-slate-600'}`}>
                    {formatOddsValue(item.closingOdds?.draw)}
                  </span>
                  {/* 2 */}
                  <span className={`min-w-[24px] text-center py-0.5 rounded ${item.closingWinner === 'away' ? 'bg-emerald-500/20 text-emerald-400 font-bold' : 'text-slate-600'}`}>
                    {formatOddsValue(item.closingOdds?.away)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
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
    <div className={`flex flex-col bg-[#050505] rounded-xl border border-white/5 overflow-hidden ${className}`}>
      {showHeader && (
        <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
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
