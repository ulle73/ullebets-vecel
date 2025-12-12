"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import TeamOddsHistory, { TeamOddsSingle } from "@/components/TeamOddsHistory";
import { buildLineupsKey } from "@/lib/utils/apiKeys";
import { fetchJson } from "@/lib/utils/fetchers";

const ONE_DAY_MS = 168 * 60 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

const GOALKEEPER_TOKENS = ["gk", "goalkeeper", "keeper", "målvakt", "portero"];
const DEFENDER_TOKENS = ["cb", "rb", "lb", "def", "back", "df", "försvar", "defender"];
const MIDFIELDER_TOKENS = ["mid", "mf", "cm", "dm", "am", "mitt", "midfielder"];
const FORWARD_TOKENS = ["fw", "st", "att", "striker", "wing", "forward", "anf", "angripare"];

function normalizePositionValue(position) {
  if (!position) return "";
  if (typeof position === "string") return position;
  if (typeof position === "number") return String(position);
  if (typeof position === "object") {
    if (typeof position.name === "string") return position.name;
    if (typeof position.shortName === "string") return position.shortName;
    if (typeof position.code === "string") return position.code;
    if (typeof position.label === "string") return position.label;
  }
  return String(position);
}

function detectRole(position) {
  const normalized = normalizePositionValue(position).toLowerCase();
  if (!normalized) return null;
  if (GOALKEEPER_TOKENS.some((token) => normalized.includes(token))) {
    return "goalkeeper";
  }
  if (DEFENDER_TOKENS.some((token) => normalized.includes(token))) {
    return "defender";
  }
  if (MIDFIELDER_TOKENS.some((token) => normalized.includes(token))) {
    return "midfielder";
  }
  if (FORWARD_TOKENS.some((token) => normalized.includes(token))) {
    return "forward";
  }
  if (normalized === "g") return "goalkeeper";
  if (normalized === "d") return "defender";
  if (normalized === "m") return "midfielder";
  if (normalized === "f") return "forward";
  return null;
}

function parseFormation(formation) {
  if (typeof formation !== "string") return [];
  const numbers = formation
    .split(/[^0-9]+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part) && part > 0);
  const total = numbers.reduce((sum, value) => sum + value, 0);
  if (!numbers.length || total < 3 || total > 10) {
    return [];
  }
  return numbers;
}

function partitionPlayers(starters = []) {
  const cleanStarters = Array.isArray(starters) ? starters.filter(Boolean) : [];
  let goalkeeper = cleanStarters.find((player) => detectRole(player.position) === "goalkeeper");
  if (!goalkeeper && cleanStarters.length) {
    goalkeeper = cleanStarters[0];
  }
  const fieldPlayers = cleanStarters.filter((player) => player !== goalkeeper);
  return { goalkeeper: goalkeeper ?? null, fieldPlayers };
}

function groupPlayersByFormation(starters = [], formation) {
  const { goalkeeper, fieldPlayers } = partitionPlayers(starters);
  const layout = [];
  const formationNumbers = parseFormation(formation);

  if (formationNumbers.length) {
    let cursor = 0;
    for (const count of formationNumbers) {
      const slice = fieldPlayers.slice(cursor, cursor + count);
      layout.push(slice);
      cursor += slice.length;
    }
    if (cursor < fieldPlayers.length && layout.length) {
      layout[layout.length - 1] = layout[layout.length - 1].concat(
        fieldPlayers.slice(cursor)
      );
    }
    if (!layout.length && fieldPlayers.length) {
      layout.push(fieldPlayers);
    }
    return { goalkeeper, lines: layout };
  }

  const defenders = [];
  const midfielders = [];
  const forwards = [];
  const others = [];

  for (const player of fieldPlayers) {
    const role = detectRole(player.position);
    if (role === "defender") {
      defenders.push(player);
    } else if (role === "midfielder") {
      midfielders.push(player);
    } else if (role === "forward") {
      forwards.push(player);
    } else {
      others.push(player);
    }
  }

  if (defenders.length) layout.push(defenders);
  if (midfielders.length) layout.push(midfielders);
  if (forwards.length) layout.push(forwards);
  if (others.length) layout.push(others);
  if (!layout.length && fieldPlayers.length) {
    layout.push(fieldPlayers);
  }
  return { goalkeeper, lines: layout };
}

function computeLineY(totalRows, rowIndex, orientation) {
  if (totalRows <= 1) {
    return orientation === "bottom" ? 72 : 28;
  }

  const isBottom = orientation === "bottom";
  const start = isBottom ? 95 : 5;
  const end = isBottom ? 56 : 44;
  const fraction = rowIndex / (totalRows - 1);
  return start + (end - start) * fraction;
}

// Ny: flexibel spridning med padding och minsta avstånd
function computeLineXs(
  count,
  {
    mode = "between",        // "between" | "around"
    minX = 14,               // ursprungsband
    maxX = 88,
    sidePadding = 2,         // extra padding från kanter (procentenheter)
    minGap = 0,              // minsta gap mellan spelare (procentenheter)
  } = {}
) {
  if (count <= 0) return [];
  if (count === 1) return [50];

  // 1) Effektivt band med extra padding
  const left = minX + sidePadding;
  const right = maxX - sidePadding;
  const width = Math.max(0, right - left);

  // 2) Bas-gap utifrån mode
  let baseGap;
  if (mode === "around") {
    // lika gap överallt + halvt gap mot kanterna
    baseGap = width / count;
    // start ligger ett halvt gap in
    let start = left + baseGap / 2;

    // 3) Respektera minGap: om baseGap < minGap, centrera med minGap
    if (minGap > 0 && baseGap < minGap) {
      const need = minGap * (count - 1);
      const inner = Math.min(width, need);
      start = left + (width - inner) / 2;
      baseGap = count > 1 ? (inner / (count - 1)) : 0; // för säkerhets skull
    }

    return Array.from({ length: count }, (_, i) => start + i * baseGap);
  }

  // mode = "between" (default): första vid vänsterkant, sista vid högerkant
  baseGap = count > 1 ? width / (count - 1) : width;
  let start = left;

  // 3) Respektera minGap även här
  if (minGap > 0 && baseGap < minGap) {
    const need = minGap * (count - 1);
    const inner = Math.min(width, need);
    start = left + (width - inner) / 2;
    baseGap = count > 1 ? (inner / (count - 1)) : 0;
  }

  return Array.from({ length: count }, (_, i) => start + i * baseGap);
}


function buildPitchPlayers(starters, formation, orientation) {
  const grouping = groupPlayersByFormation(starters, formation);
  const totalRows = grouping.lines.length + (grouping.goalkeeper ? 1 : 0);
  if (totalRows === 0) return [];

  const result = [];
  let rowIndex = 0;

  if (grouping.goalkeeper) {
    const y = computeLineY(totalRows, rowIndex, orientation);
    result.push({ ...grouping.goalkeeper, x: 50, y, isGoalkeeper: true });
    rowIndex += 1;
  }

  for (const line of grouping.lines) {
    const players = Array.isArray(line) ? line.filter(Boolean) : [];
    const y = computeLineY(totalRows, rowIndex, orientation);
    // const xs = computeLineXs(players.length || 1);
    const xs = computeLineXs(players.length || 1, {
      mode: "around",      // eller "between"
      sidePadding: 0,      // t.ex. 8% extra marginal från kanter
      minGap: 4,           // t.ex. minst 6% mellan spelare
      minX: 14,
      maxX: 88,
    });
    players.forEach((player, index) => {
      result.push({ ...player, x: xs[index] ?? 50, y, isGoalkeeper: false });
    });
    rowIndex += 1;
  }

  return result;
}

function parseMatchStartTimestamp(match) {
  if (!match || typeof match !== "object") return null;

  const candidates = [
    match.startTimestamp,
    match.event?.startTimestamp,
    match.timestamp,
    match.kickoffTime,
    match.startTime,
  ];

  for (const value of candidates) {
    if (value == null) continue;

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) continue;

    // Heuristic: treat values below unix ms threshold as seconds.
    const milliseconds =
      numericValue > 1e12 ? numericValue : Math.round(numericValue * 1000);
    if (Number.isFinite(milliseconds)) {
      return milliseconds;
    }
  }

  if (typeof match.date === "string") {
    const parsed = Date.parse(match.date);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function isWithinOneDay(matchStartMs, referenceTimeMs) {
  if (!matchStartMs || !Number.isFinite(matchStartMs)) return true;
  const diff = Math.abs(matchStartMs - referenceTimeMs);
  return diff <= ONE_DAY_MS;
}

function toComparable(value) {
  if (value == null) return null;
  return String(value).trim().toLowerCase();
}

function findLineup(lineups, teamId, teamName, side) {
  if (!Array.isArray(lineups)) return null;
  const targetId = teamId != null ? String(teamId) : null;
  const targetName = teamName ? toComparable(teamName) : null;

  let match = null;

  if (targetId) {
    match = lineups.find((lineup) => {
      const candidateId = lineup?.teamId != null ? String(lineup.teamId) : null;
      return candidateId === targetId;
    });
  }

  if (!match && targetName) {
    match = lineups.find((lineup) => toComparable(lineup?.teamName) === targetName);
  }

  if (!match && lineups.length === 2) {
    return side === "away" ? lineups[1] : lineups[0];
  }

  return match ?? null;
}

function formatPlayerName(player) {
  return player?.shortName || player?.name || "Okänd";
}

function formatJerseyNumber(player) {
  if (!player) return "";
  if (player.jerseyNumber == null) return "";
  const value = String(player.jerseyNumber).trim();
  return value;
}

function formatPosition(player) {
  const value = normalizePositionValue(player?.position);
  return value ? value.toUpperCase() : null;
}

function PlayerMarker({ player, badgeClass }) {
  const badge = formatJerseyNumber(player) || (player.name ? player.name[0] : "?");
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      style={{ left: `${player.x}%`, top: `${player.y}%` }}
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white shadow-lg ${badgeClass}`}
      >
        {badge}
      </div>
      <div className="mt-1 whitespace-nowrap px-2 text-center text-xs font-medium text-white drop-shadow">
        {formatPlayerName(player)}
        {player.captain ? <span className="ml-1 text-[7.5px]">©</span> : null}
      </div>
      {player.rating != null ? (
        <div className="text-[8.25px] font-semibold text-emerald-100">
          {player.rating}
        </div>
      ) : null}
    </div>
  );
}

function CombinedPitch({ homeLineup, awayLineup, className = "" }) {
  const homePlayers = useMemo(
    () => buildPitchPlayers(homeLineup?.starters ?? [], homeLineup?.formation, "top"),
    [homeLineup]
  );
  const awayPlayers = useMemo(
    () => buildPitchPlayers(awayLineup?.starters ?? [], awayLineup?.formation, "bottom"),
    [awayLineup]
  );

  if (!homePlayers.length && !awayPlayers.length) {
    return null;
  }

  const homeBadge = resolveBadgeClass("home");
  const awayBadge = resolveBadgeClass("away");

  const containerClass = [
    "relative isolate w-full overflow-hidden rounded-2xl",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClass}>
      <div className="relative w-full pb-[160%]">
        <div className="absolute inset-0 bg-[url('/images/pitch4.png')] bg-cover bg-center" />
        {[homePlayers, awayPlayers].map((group, index) =>
          group.map((player) => (
            <PlayerMarker
              key={player.id ?? `${player.name}-${player.x}-${player.y}`}
              player={player}
              badgeClass={index === 0 ? homeBadge : awayBadge}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SubstitutesList({ players }) {
  if (!Array.isArray(players) || players.length === 0) return null;

  return (
    <div className="mt-4">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2 border-b border-white/5 pb-1">
        Avbytare
      </h4>
      <div className="flex flex-col divide-y divide-white/5">
        {players.map((player) => {
          const jersey = formatJerseyNumber(player);
          return (
            <div key={player.id ?? `${player.name}-${jersey}`}
              className="flex items-center justify-between py-2 text-xs text-slate-300 hover:bg-white/[0.02] -mx-2 px-2 rounded-sm transition-colors">
              <div className="flex items-center gap-3">
                <span className="font-mono text-slate-500 text-[10px] w-4 text-center">{jersey || "-"}</span>
                <span className="truncate max-w-[120px]">{formatPlayerName(player)}</span>
              </div>
              {player.rating && (
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  {player.rating}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamLineup({ lineup, teamLabel }) {
  if (!lineup) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 p-4 text-center text-xs text-slate-600">
        Ingen info för {teamLabel.toLowerCase()}
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-lg border border-white/5 bg-white/[0.02] p-4"> {/* Added border */}
      <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500/80 block mb-0.5">
            {teamLabel}
          </span>
          <h3 className="text-sm font-bold text-white leading-tight">
            {lineup.teamName || "Okänt lag"}
          </h3>
        </div>
        {lineup.formation && (
          <span className="text-[10px] font-mono font-bold bg-white/5 px-2 py-1 rounded text-slate-300">
            {lineup.formation}
          </span>
        )}
      </div>

      {lineup.coach && (
        <div className="flex items-center gap-2 mb-3 text-xs text-slate-400">
          <span className="text-slate-600 uppercase text-[10px] font-bold tracking-wide">Coach</span>
          <span>{lineup.coach}</span>
        </div>
      )}

      <SubstitutesList players={lineup.substitutes ?? []} />
    </div>
  );
}

function resolveBadgeClass(side) {
  return side === "home"
    ? "bg-sky-600/90 backdrop-blur"
    : "bg-rose-600/90 backdrop-blur";
}

export default function Lineups({ match, isLoading, className = "" }) {
  const matchId = useMemo(() => {
    const cand =
      match?.matchId ??
      match?.id ??
      match?.eventId ??
      match?.event?.id ??
      match?.raw?.matchId ??
      match?.raw?.id ??
      null;
    return cand != null ? String(cand).trim() : null;
  }, [match]);

  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const matchStartTimestamp = useMemo(
    () => parseMatchStartTimestamp(match),
    [match]
  );

  useEffect(() => {
    if (!matchStartTimestamp) return undefined;

    setCurrentTime(Date.now());
    const intervalId = setInterval(
      () => setCurrentTime(Date.now()),
      THIRTY_MINUTES_MS
    );
    return () => clearInterval(intervalId);
  }, [matchStartTimestamp]);

  const withinFetchWindow = isWithinOneDay(matchStartTimestamp, currentTime);
  const shouldFetchLineups = Boolean(matchId && withinFetchWindow);

  const swrOptions = useMemo(
    () => ({
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      dedupingInterval: 5 * 60 * 1000,
      refreshInterval: (latestData) => {
        if (!shouldFetchLineups || !matchStartTimestamp) return 0;

        const current = Date.now();
        if (!isWithinOneDay(matchStartTimestamp, current)) return 0;
        if (matchStartTimestamp <= current) return 0;
        if (latestData?.confirmed) return 0;

        return THIRTY_MINUTES_MS;
      },
    }),
    [matchStartTimestamp, shouldFetchLineups]
  );

  const kickoffParam = useMemo(() => {
    if (!Number.isFinite(matchStartTimestamp)) return null;
    return Math.trunc(matchStartTimestamp);
  }, [matchStartTimestamp]);

  const lineupsKey = useMemo(() => {
    if (!shouldFetchLineups) return null;
    const params = {};
    if (kickoffParam) {
      params.kickoff = kickoffParam;
    }
    return buildLineupsKey(matchId, params);
  }, [shouldFetchLineups, matchId, kickoffParam]);

  const {
    data,
    error,
    isLoading: isLineupsLoading,
    mutate,
  } = useSWR(lineupsKey, fetchJson, swrOptions);

  const handleManualRefresh = () => {
    if (shouldFetchLineups) {
      void mutate();
    }
  };

  const isOutsideFetchWindow = Boolean(match && matchId && !withinFetchWindow);
  const isFutureMatch = matchStartTimestamp
    ? matchStartTimestamp > currentTime
    : null;

  const loading = isLoading || isLineupsLoading;

  const lineups = data?.lineups ?? [];
  const homeLineup = useMemo(
    () =>
      findLineup(
        lineups,
        match?.homeTeamId ?? match?.homeTeam?.id,
        match?.homeTeamName,
        "home"
      ),
    [lineups, match?.homeTeamId, match?.homeTeam?.id, match?.homeTeamName]
  );
  const awayLineup = useMemo(
    () =>
      findLineup(
        lineups,
        match?.awayTeamId ?? match?.awayTeam?.id,
        match?.awayTeamName,
        "away"
      ),
    [lineups, match?.awayTeamId, match?.awayTeam?.id, match?.awayTeamName]
  );

  const confirmed = data?.confirmed;

  const containerClass = [
    "flex flex-col rounded-lg",
    "lg:h-full lg:min-h-0", // Make sure it takes height if needed
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // Handle various states
  if (!match) {
    return (
      <div className={containerClass}>
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">
          Välj en match för att se laguppställning.
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      {/* Refactored Header: Centered Status & Formations - No Border */}
      <div className="px-4 py-3 flex justify-center items-center relative">
        <div className="flex gap-8 items-center">
          {/* Home Formation */}
          {homeLineup?.formation && (
            <span className="text-sm font-mono font-bold text-white bg-white/10 px-2.5 py-1 rounded">
              {homeLineup.formation}
            </span>
          )}

          {/* Status Center */}
          <div className="flex flex-col items-center">
            {(confirmed !== undefined) && (
              <p className={`text-xs font-bold uppercase tracking-widest ${confirmed ? "text-emerald-400" : "text-amber-400"}`}>
                {confirmed ? "Bekräftad" : "Preliminär"}
              </p>
            )}
          </div>

          {/* Away Formation */}
          {awayLineup?.formation && (
            <span className="text-sm font-mono font-bold text-white bg-white/10 px-2.5 py-1 rounded">
              {awayLineup.formation}
            </span>
          )}
        </div>

        {/* Refresh button absolute right */}
        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={!shouldFetchLineups}
          className="absolute right-4 text-[10px] font-semibold text-slate-500 hover:text-white disabled:opacity-30 uppercase tracking-wider"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-col lg:flex-1 lg:min-h-0">

        {/* Mobile View: Stacked */}
        <div className="lg:hidden flex flex-col gap-6 p-4">
          {/* Mobile Pitch */}
          <div className="flex-none">
            <CombinedPitch homeLineup={homeLineup} awayLineup={awayLineup} />
          </div>

          {/* Mobile Lists */}
          <div className="grid gap-6">
            {homeLineup && <TeamLineup lineup={homeLineup} teamLabel="Hemma" />}
            {awayLineup && <TeamLineup lineup={awayLineup} teamLabel="Borta" />}
          </div>

          {/* Mobile Odds */}
          <TeamOddsHistory match={match} />
        </div>

        {/* Desktop View: 3-column Grid (3fr-4fr-3fr) */}
        <div className="hidden lg:grid lg:grid-cols-[3fr_4fr_3fr] gap-4 p-4 h-full items-start overflow-y-auto">

          {/* Left Column: Home Odds - FIXED WIDTH */}
          <div className="flex flex-col gap-4">
            <TeamOddsSingle teamName={match?.homeTeamName} className="w-full" />
          </div>

          {/* Center Column: Pitch + Lineups */}
          <div className="flex flex-col gap-4">
            {/* Pitch */}
            <div className="flex-none">
              {loading ? (
                <div className="h-[300px] flex items-center justify-center text-slate-500">Hämtar pitch...</div>
              ) : (
                <CombinedPitch homeLineup={homeLineup} awayLineup={awayLineup} />
              )}
            </div>

            {/* Lineup Cards */}
            <div className="grid gap-4 md:grid-cols-2">
              {homeLineup ? (
                <TeamLineup lineup={homeLineup} teamLabel="Hemma" />
              ) : (
                <div className="p-4 text-center border border-dashed border-white/10 rounded-lg text-slate-500 text-xs text-slate-500">
                  {loading ? "Laddar..." : "Ingen info hemma"}
                </div>
              )}
              {awayLineup ? (
                <TeamLineup lineup={awayLineup} teamLabel="Borta" />
              ) : (
                <div className="p-4 text-center border border-dashed border-white/10 rounded-lg text-slate-500 text-xs text-slate-500">
                  {loading ? "Laddar..." : "Ingen info borta"}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Away Odds - FIXED WIDTH */}
          <div className="flex flex-col gap-4">
            <TeamOddsSingle teamName={match?.awayTeamName} className="w-full" />
          </div>

        </div>

      </div>
    </div>
  );
}
