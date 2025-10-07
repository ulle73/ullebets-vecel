"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { buildLineupsKey } from "@/lib/utils/apiKeys";
import { fetchJson } from "@/lib/utils/fetchers";

const MARKET_DEFAULT = "1x2";
const MAX_CLOSING_ODDS_ENTRIES = 5;
const closingOddsRequests = new Map();

function safeGetCache(cache, key) {
  if (!cache || !key) return undefined;
  try {
    return cache.get(key);
  } catch (error) {
    console.warn("[closing-odds] cache read failed", error);
    return undefined;
  }
}

function toDecimalOdds(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(2));
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, ".");
    if (!normalized) return null;
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
  }
  return null;
}

function normalizeClosingOddsEntries(payload) {
  if (payload === undefined) {
    return undefined;
  }
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.entries)
    ? payload.entries
    : null;
  if (!entries) {
    return null;
  }

  const normalized = entries
    .map((entry) => {
      if (!entry) return null;
      const market = (entry.market || MARKET_DEFAULT).toLowerCase();
      if (market !== MARKET_DEFAULT) return null;

      const oddsSource = entry.odds || entry.values || entry.closing || entry.closingOdds;
      if (!oddsSource || typeof oddsSource !== "object") {
        return null;
      }

      const home = toDecimalOdds(
        oddsSource.home ?? oddsSource.Home ?? oddsSource["1"] ?? oddsSource.one ?? oddsSource.homeWin
      );
      const draw = toDecimalOdds(
        oddsSource.draw ?? oddsSource.Draw ?? oddsSource["X"] ?? oddsSource["x"] ?? oddsSource.tie
      );
      const away = toDecimalOdds(
        oddsSource.away ?? oddsSource.Away ?? oddsSource["2"] ?? oddsSource.two ?? oddsSource.awayWin
      );

      if ([home, draw, away].filter((value) => typeof value === "number").length < 2) {
        return null;
      }

      const rawTimestamp = entry.timestamp ?? entry.kickoff ?? entry.date ?? null;
      const timestampMs = rawTimestamp ? new Date(rawTimestamp).getTime() : null;

      return {
        matchId: entry.matchId != null ? String(entry.matchId) : null,
        timestamp: rawTimestamp && Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null,
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
        market: MARKET_DEFAULT,
        side: entry.side === "away" ? "away" : "home",
        opponent: {
          teamId:
            entry.opponent?.teamId != null
              ? Number.parseInt(entry.opponent.teamId, 10) || entry.opponent.teamId
              : null,
          name: entry.opponent?.name ?? null,
        },
        odds: { home, draw, away },
        winner: entry.winner ?? entry.result ?? null,
      };
    })
    .filter(Boolean);

  normalized.sort((a, b) => {
    const ta = a.timestampMs ?? 0;
    const tb = b.timestampMs ?? 0;
    return tb - ta;
  });

  return normalized.slice(0, MAX_CLOSING_ODDS_ENTRIES);
}

function useTeamClosingOddsHistory({ matchId, teamId, market = MARKET_DEFAULT }) {
  const { cache } = useSWRConfig();
  const [state, setState] = useState(() => ({
    status: teamId ? "loading" : "idle",
    entries: [],
    error: null,
    source: null,
  }));

  const cacheKey = useMemo(
    () => (teamId ? `team:${teamId}:odds:closing:${market}` : null),
    [teamId, market]
  );
  const requestKey = useMemo(
    () => (teamId ? `${matchId ?? "no-match"}:${teamId}:${market}` : null),
    [matchId, teamId, market]
  );
  const abortedRef = useRef(false);

  useEffect(() => {
    abortedRef.current = false;
    if (!teamId || !cacheKey || !requestKey) {
      setState({ status: "idle", entries: [], error: null, source: null });
      return () => {
        abortedRef.current = true;
      };
    }

    const cachedRaw = safeGetCache(cache, cacheKey);
    const normalizedCache = normalizeClosingOddsEntries(cachedRaw);

    if (Array.isArray(normalizedCache)) {
      setState({
        status: normalizedCache.length ? "success" : "empty",
        entries: normalizedCache,
        error: null,
        source: "cache",
      });
      return () => {
        abortedRef.current = true;
      };
    }

    setState({ status: "loading", entries: [], error: null, source: null });

    let active = true;

    const run = async () => {
      try {
        let requestPromise = closingOddsRequests.get(requestKey);
        if (!requestPromise) {
          const url = `/api/team-odds/closing?teamId=${encodeURIComponent(
            teamId
          )}&market=${encodeURIComponent(market)}&limit=${MAX_CLOSING_ODDS_ENTRIES}`;
          const fetchPromise = fetch(url).then((res) => {
            if (!res.ok) {
              const error = new Error(`Failed to fetch closing odds: ${res.status}`);
              error.status = res.status;
              throw error;
            }
            return res.json();
          });
          requestPromise = fetchPromise
            .then((result) => {
              closingOddsRequests.delete(requestKey);
              return result;
            })
            .catch((error) => {
              closingOddsRequests.delete(requestKey);
              throw error;
            });
          closingOddsRequests.set(requestKey, requestPromise);
        }

        const data = await requestPromise;
        if (!active || abortedRef.current) {
          return;
        }

        const normalized = normalizeClosingOddsEntries(data);
        const entries = Array.isArray(normalized) ? normalized : [];
        const status = entries.length ? "success" : "empty";

        setState({ status, entries, error: null, source: "network" });

        if (cache && cacheKey) {
          cache.set(cacheKey, {
            entries,
            fetchedAt: Date.now(),
            teamId,
            market,
          });
        }
      } catch (error) {
        if (!active || abortedRef.current) {
          return;
        }
        console.error("[closing-odds] fetch error", error);
        setState({ status: "error", entries: [], error, source: "network" });
      }
    };

    run();

    return () => {
      active = false;
      abortedRef.current = true;
    };
  }, [cache, cacheKey, market, matchId, requestKey, teamId]);

  return state;
}

function formatOddsValue(value) {
  if (typeof value === "number") {
    return value.toFixed(2);
  }
  return "–";
}

function resolveResultBadge(entry) {
  if (!entry?.winner) {
    return null;
  }
  if (entry.winner === "draw") {
    return { label: "D", tone: "text-amber-700", title: "Oavgjort" };
  }
  if (entry.winner === entry.side) {
    return { label: "W", tone: "text-emerald-700", title: "Vinst" };
  }
  return { label: "L", tone: "text-rose-600", title: "Förlust" };
}

function TeamOddsList({ title, teamName, state }) {
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("sv-SE", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    []
  );

  let body = null;

  if (state.status === "loading") {
    body = (
      <p className="text-xs text-gray-500">
        Hämtar closing odds…
      </p>
    );
  } else if (state.status === "error" || state.status === "idle" || state.status === "empty") {
    body = (
      <p className="text-xs font-medium text-gray-500">
        saknas
      </p>
    );
  } else if (state.entries.length === 0) {
    body = (
      <p className="text-xs font-medium text-gray-500">
        saknas
      </p>
    );
  } else {
    body = (
      <ul className="mt-3 space-y-3">
        {state.entries.map((entry) => {
          const opponentLabel = entry.opponent?.name || "Okänt motstånd";
          const when = entry.timestamp
            ? dateFormatter.format(new Date(entry.timestamp))
            : "Okänt datum";
          const role = entry.side === "home" ? "Hemma" : "Borta";
          const teamOdds = entry.side === "home" ? entry.odds.home : entry.odds.away;
          const opponentOdds = entry.side === "home" ? entry.odds.away : entry.odds.home;
          const drawOdds = entry.odds.draw;
          const badge = resolveResultBadge(entry);
          return (
            <li
              key={entry.matchId ?? `${entry.timestamp ?? ""}-${entry.side}`}
              className="rounded-lg border border-emerald-100 bg-white/80 p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{opponentLabel}</p>
                  <p className="text-[11px] text-gray-500">{when} · {role}</p>
                </div>
                {badge ? (
                  <span
                    className={`text-xs font-semibold ${badge.tone}`}
                    title={badge.title}
                  >
                    {badge.label}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-medium text-gray-600">
                <div className="rounded border border-emerald-100 bg-emerald-50/60 px-2 py-1 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-emerald-700">Lag</p>
                  <p className="text-sm text-gray-900">{formatOddsValue(teamOdds)}</p>
                </div>
                <div className="rounded border border-emerald-100 bg-emerald-50/40 px-2 py-1 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-emerald-700">X</p>
                  <p className="text-sm text-gray-900">{formatOddsValue(drawOdds)}</p>
                </div>
                <div className="rounded border border-emerald-100 bg-emerald-50/60 px-2 py-1 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-emerald-700">Motst</p>
                  <p className="text-sm text-gray-900">{formatOddsValue(opponentOdds)}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-100/60 bg-white/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">{title}</p>
          <p className="text-sm font-semibold text-gray-900">{teamName || "Okänt lag"}</p>
        </div>
        {state.status === "loading" ? (
          <span className="text-[11px] text-gray-500">…</span>
        ) : null}
      </div>
      <div className="mt-2">{body}</div>
    </div>
  );
}

function ClosingOddsSection({ match }) {
  const matchId = match?.matchId ?? match?.id ?? null;
  const homeTeamId = match?.homeTeamId ?? match?.homeTeam?.id ?? null;
  const awayTeamId = match?.awayTeamId ?? match?.awayTeam?.id ?? null;
  const homeTeamName = match?.homeTeamName ?? match?.homeTeam?.name ?? match?.homeTeam?.shortName ?? null;
  const awayTeamName = match?.awayTeamName ?? match?.awayTeam?.name ?? match?.awayTeam?.shortName ?? null;

  const homeState = useTeamClosingOddsHistory({ matchId, teamId: homeTeamId, market: MARKET_DEFAULT });
  const awayState = useTeamClosingOddsHistory({ matchId, teamId: awayTeamId, market: MARKET_DEFAULT });

  if (!homeTeamId && !awayTeamId) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
          Closing odds (1X2)
        </h3>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <TeamOddsList title="Hemma" teamName={homeTeamName} state={homeState} />
        <TeamOddsList title="Borta" teamName={awayTeamName} state={awayState} />
      </div>
    </div>
  );
}

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

// function computeLineXs(count) {
//   if (count <= 0) return [];
//   if (count === 1) return [50];
//   const minX = 18;
//   const maxX = 82;
//   const step = (maxX - minX) / (count - 1);
//   return Array.from({ length: count }, (_, index) => minX + step * index);
// }

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
        {player.captain ? <span className="ml-1 text-[10px]">©</span> : null}
      </div>
      {player.rating != null ? (
        <div className="text-[11px] font-semibold text-emerald-100">
          {player.rating}
        </div>
      ) : null}
    </div>
  );
}

function CombinedPitch({ homeLineup, awayLineup }) {
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

  return (
    <div className="relative isolate w-full overflow-hidden rounded-2xl border border-emerald-700 shadow-lg">
      <div className="relative w-full pb-[150%]">
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
  if (!Array.isArray(players) || players.length === 0) {
    return null;
  }
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Avbytare
      </h4>
      <ul className="mt-2 space-y-1 text-xs text-gray-600">
        {players.map((player) => {
          const jersey = formatJerseyNumber(player);
          const position = formatPosition(player);
          return (
            <li key={player.id ?? `${player.name}-${jersey}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
            >
              <span className="font-medium text-gray-700">{formatPlayerName(player)}</span>
              {jersey ? <span className="text-gray-400">#{jersey}</span> : null}
              {position ? <span className="text-gray-400">{position}</span> : null}
              {player.rating != null ? (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                  {player.rating}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TeamLineup({ lineup, teamLabel }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {teamLabel}
          </p>
          <h3 className="text-base font-semibold text-gray-900">
            {lineup?.teamName || "Okänt lag"}
          </h3>
          {lineup?.coach ? (
            <p className="text-xs text-gray-500">Tränare: {lineup.coach}</p>
          ) : null}
        </div>
        {lineup?.formation ? (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
            {lineup.formation}
          </span>
        ) : null}
      </div>
      <SubstitutesList players={lineup?.substitutes ?? []} />
    </div>
  );
}

function resolveBadgeClass(side) {
  return side === "home"
    ? "bg-sky-600/90 backdrop-blur"
    : "bg-rose-600/90 backdrop-blur";
}

export default function Lineups({ match, isLoading, className = "" }) {
  const matchId = match?.matchId ?? match?.id ?? null;

  const {
    data,
    error,
    isLoading: isLineupsLoading,
    mutate,
  } = useSWR(matchId ? buildLineupsKey(matchId) : null, fetchJson, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });

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

  let content = null;

  if (!match) {
    content = (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-400">
        Välj en match för att se laguppställning.
      </div>
    );
  } else if (loading) {
    content = (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-500">
        Hämtar laguppställningar…
      </div>
    );
  } else if (error) {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-gray-500">
        <p>Kunde inte hämta laguppställningar.</p>
        <button
          type="button"
          onClick={() => mutate()}
          className="rounded bg-gray-900 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-gray-700"
        >
          Försök igen
        </button>
      </div>
    );
  } else if (!homeLineup && !awayLineup) {
    content = (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-500">
        Ingen laguppställning hittades ännu. Förhandsinfo kan saknas.
      </div>
    );
  } else {
    content = (
      <div className="flex flex-1 flex-col gap-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
            <p className="text-sm font-semibold text-gray-900">
              {confirmed === true
                ? "Bekräftad uppställning"
                : confirmed === false
                ? "Inte bekräftad"
                : "Okänd status"}
            </p>
            {data?.provider ? (
              <p className="text-xs text-gray-400">Källa: {data.provider}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => mutate()}
            className="rounded-full border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:border-gray-300 hover:text-gray-800"
          >
            Uppdatera
          </button>
        </div>
        <ClosingOddsSection match={match} />
        <CombinedPitch homeLineup={homeLineup} awayLineup={awayLineup} />
        <div className="grid gap-6 lg:grid-cols-2">
          {homeLineup ? (
            <TeamLineup
              lineup={homeLineup}
              teamLabel="Hemma"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
              <p>Ingen laguppställning hittades för hemmalaget ännu.</p>
            </div>
          )}
          {awayLineup ? (
            <TeamLineup
              lineup={awayLineup}
              teamLabel="Borta"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
              <p>Ingen laguppställning hittades för bortalaget ännu.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const containerClass = [
    "flex h-full flex-col rounded-lg border border-gray-200 bg-white shadow-sm",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClass}>
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
          Lineups
        </h2>
      </div>
      {content}
    </div>
  );
}
