"use client";

import { useMemo } from "react";
import useSWR from "swr";

const fetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    const message = `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

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

function computeRowX(totalRows, rowIndex, orientation) {
  if (totalRows <= 1) return 50;
  const minX = 14;
  const maxX = 86;
  const fraction = totalRows === 1 ? 0.5 : rowIndex / (totalRows - 1);
  const x = minX + (maxX - minX) * fraction;
  return orientation === "right" ? 100 - x : x;
}

function computeRowY(count) {
  if (count <= 0) return [];
  if (count === 1) return [50];
  const top = 14;
  const bottom = 86;
  const step = (bottom - top) / (count - 1);
  return Array.from({ length: count }, (_, index) => top + step * index);
}

function buildPitchPlayers(starters, formation, orientation) {
  const grouping = groupPlayersByFormation(starters, formation);
  const totalRows = grouping.lines.length + (grouping.goalkeeper ? 1 : 0);
  if (totalRows === 0) return [];

  const result = [];
  let rowIndex = 0;

  if (grouping.goalkeeper) {
    const x = computeRowX(totalRows, rowIndex, orientation);
    result.push({ ...grouping.goalkeeper, x, y: 50, isGoalkeeper: true });
    rowIndex += 1;
  }

  for (const line of grouping.lines) {
    const players = Array.isArray(line) ? line.filter(Boolean) : [];
    const x = computeRowX(totalRows, rowIndex, orientation);
    const ys = computeRowY(players.length || 1);
    players.forEach((player, index) => {
      result.push({ ...player, x, y: ys[index] ?? 50, isGoalkeeper: false });
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

function Pitch({ players, badgeClass }) {
  return (
    <div className="relative isolate w-full overflow-hidden rounded-xl border border-emerald-700 bg-gradient-to-br from-emerald-900 via-emerald-800 to-emerald-900 pb-[140%] shadow-inner">
      <div className="absolute inset-[4%] rounded-xl border border-emerald-500/70"></div>
      <div className="absolute left-1/2 top-[4%] h-[92%] w-px -translate-x-1/2 bg-emerald-500/60"></div>
      <div className="absolute left-[4%] top-1/2 h-[40%] w-[14%] -translate-y-1/2 rounded-r-[45%] border border-emerald-500/60"></div>
      <div className="absolute right-[4%] top-1/2 h-[40%] w-[14%] -translate-y-1/2 rounded-l-[45%] border border-emerald-500/60"></div>
      <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-500/60"></div>
      <div className="absolute left-[4%] top-1/2 h-[24%] w-[6%] -translate-y-1/2 border border-emerald-500/60"></div>
      <div className="absolute right-[4%] top-1/2 h-[24%] w-[6%] -translate-y-1/2 border border-emerald-500/60"></div>
      {players.map((player) => {
        const badge = formatJerseyNumber(player) || (player.name ? player.name[0] : "?");
        return (
          <div
            key={player.id ?? `${player.name}-${player.x}-${player.y}`}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: `${player.x}%`, top: `${player.y}%` }}
          >
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white shadow-lg ${badgeClass}`}
            >
              {badge}
            </div>
            <div className="mt-1 whitespace-nowrap px-2 text-center text-xs font-medium text-emerald-50 drop-shadow">
              {formatPlayerName(player)}
              {player.captain ? <span className="ml-1 text-[10px]">©</span> : null}
            </div>
            {player.rating != null ? (
              <div className="text-[11px] font-semibold text-emerald-200">
                {player.rating}
              </div>
            ) : null}
          </div>
        );
      })}
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

function TeamLineup({ lineup, teamLabel, orientation, badgeClass }) {
  const playersOnPitch = useMemo(
    () => buildPitchPlayers(lineup?.starters ?? [], lineup?.formation, orientation),
    [lineup, orientation]
  );

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
      <Pitch players={playersOnPitch} badgeClass={badgeClass} />
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
  } = useSWR(matchId ? `/api/match/${matchId}/lineups` : null, fetcher, {
    revalidateOnFocus: false,
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
        <div className="grid gap-6 lg:grid-cols-2">
          {homeLineup ? (
            <TeamLineup
              lineup={homeLineup}
              orientation="left"
              teamLabel="Hemma"
              badgeClass={resolveBadgeClass("home")}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
              <p>Ingen laguppställning hittades för hemmalaget ännu.</p>
            </div>
          )}
          {awayLineup ? (
            <TeamLineup
              lineup={awayLineup}
              orientation="right"
              teamLabel="Borta"
              badgeClass={resolveBadgeClass("away")}
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
