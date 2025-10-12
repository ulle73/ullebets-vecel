"use client";

import { useMemo, useCallback, useState } from "react";
import Image from "next/image";
import styles from "./LeagueTable.module.css";

const LEAGUE_ORDER = [17, 8, 35, 23, 325, 34];
const DEBUG_TAG = "[LeagueTable]";
const debug = (...args) => console.log(DEBUG_TAG, ...args);

function pick(v, paths, fallback = null) {
  for (const p of paths) {
    const val = p
      .split(".")
      .reduce((acc, key) => (acc == null ? acc : acc[key]), v);
    if (val != null) return val;
  }
  return fallback;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toPositiveInt(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function toScoreValue(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = toScoreValue(item);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  if (typeof value === "object") {
    const keys = [
      "current",
      "display",
      "total",
      "normaltime",
      "normalTime",
      "regular",
      "fullTime",
      "ft",
      "value",
      "main",
      "score",
    ];
    for (const key of keys) {
      if (!(key in value)) continue;
      const resolved = toScoreValue(value[key]);
      if (resolved !== null) return resolved;
    }
  }
  return null;
}

function normalizeMatch(item) {
  const id = String(
    pick(
      item,
      ["id", "matchId", "event.id", "event.matchId"],
      crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
    )
  );

  const leagueId = toPositiveInt(
    pick(
      item,
      [
        "tournament.uniqueTournament.id",
        "uniqueTournament.id",
        "tournament.id",
        "event.tournament.uniqueTournament.id",
        "event.tournament.id",
      ],
      null
    )
  );

  const leagueName = pick(
    item,
    ["tournament.name", "event.tournament.name", "league.name"],
    "Unknown"
  );

  const homeTeamId = toPositiveInt(
    pick(
      item,
      ["homeTeam.id", "event.homeTeam.id", "home.id", "teams.home.id"],
      null
    )
  );
  const awayTeamId = toPositiveInt(
    pick(
      item,
      ["awayTeam.id", "event.awayTeam.id", "away.id", "teams.away.id"],
      null
    )
  );

  const homeTeamName = pick(
    item,
    ["homeTeam.name", "event.homeTeam.name", "home.name", "teams.home.name"],
    "—"
  );
  const awayTeamName = pick(
    item,
    ["awayTeam.name", "event.awayTeam.name", "away.name", "teams.away.name"],
    "—"
  );

  const homeScore = toScoreValue(
    pick(
      item,
      [
        "homeScore",
        "homeScore.current",
        "homeScore.display",
        "homeScore.total",
        "event.homeScore",
        "event.homeScore.current",
        "event.homeScore.display",
        "event.homeScore.total",
        "score.home",
        "scores.home",
        "event.score.home",
        "event.scores.home",
        "result.home",
        "event.result.home",
      ],
      null
    )
  );

  const awayScore = toScoreValue(
    pick(
      item,
      [
        "awayScore",
        "awayScore.current",
        "awayScore.display",
        "awayScore.total",
        "event.awayScore",
        "event.awayScore.current",
        "event.awayScore.display",
        "event.awayScore.total",
        "score.away",
        "scores.away",
        "event.score.away",
        "event.scores.away",
        "result.away",
        "event.result.away",
      ],
      null
    )
  );

  const timestampRaw = pick(
    item,
    ["startTimestamp", "event.startTimestamp", "timestamp", "kickoffTime"],
    null
  );
  const timestamp = Number(timestampRaw);
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : null;

  return {
    id,
    matchId: id,
    leagueId,
    leagueName,
    homeTeamName,
    awayTeamName,
    homeTeamId,
    awayTeamId,
    timestamp: safeTimestamp,
    raw: item,
    homeScore,
    awayScore,
  };
}

function teamLogoCandidates(id) {
  const numeric = toPositiveInt(id);
  if (!numeric) return ["/images/teams/placeholder.png"];
  const base = String(numeric);
  return [
    `/images/teams/${base}.png`,
    `/images/teams/${base}.svg`,
    `/images/teams/${base}@2x.png`,
    "/images/teams/placeholder.png",
  ];
}

function leagueLogoCandidates(leagueId, leagueName) {
  const slug = slugify(leagueName);
  const candidates = [`/images/league/${slug}.png`, `/images/league/${slug}.svg`];
  const numeric = toPositiveInt(leagueId);
  if (numeric) {
    const base = String(numeric);
    candidates.push(`/images/league/${base}.png`);
    candidates.push(`/images/league/${base}.svg`);
  }
  candidates.push("/images/placeholder.png");
  return candidates;
}

function ImageWithFallback({ candidates, alt, size = 20, className }) {
  const sources = Array.isArray(candidates) && candidates.length > 0 ? candidates : ["/images/placeholder.png"];
  const [index, setIndex] = useState(0);
  const src = sources[Math.min(index, sources.length - 1)];
  const resolvedClassName = [styles.badge, className].filter(Boolean).join(" ");

  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={resolvedClassName}
      loading="lazy"
      onError={() => {
        setIndex((prev) => (prev < sources.length - 1 ? prev + 1 : prev));
      }}
      unoptimized 
    />
  );
}

export default function LeagueTable({ items, formatTime, onSelectMatch, selectedMatchId }) {
  const matches = useMemo(() => {
    if (!Array.isArray(items)) return [];
    const normalized = items.map(normalizeMatch);
    debug("normalize", {
      count: normalized.length,
      sample: normalized.slice(0, 3).map((match) => ({
        matchId: match.matchId,
        leagueId: match.leagueId,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
      })),
    });
    return normalized;
  }, [items]);

  const nowSeconds = Math.floor(Date.now() / 1000);

  const groups = useMemo(() => {
    const map = new Map();
    for (const match of matches) {
      const key = `${match.leagueId ?? "unknown"}:${match.leagueName}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(match);
    }
    return map;
  }, [matches]);

  const orderedGroups = useMemo(() => {
    const entries = [...groups.entries()];
    const indexOf = (id) => {
      const num = Number(id);
      const idx = Number.isFinite(num) ? LEAGUE_ORDER.indexOf(num) : -1;
      return idx === -1 ? Number.POSITIVE_INFINITY : idx;
    };
    entries.sort((a, b) => {
      const [akey] = a;
      const [bkey] = b;
      const [aid, aname] = akey.split(":");
      const [bid, bname] = bkey.split(":");
      const ai = indexOf(aid);
      const bi = indexOf(bid);
      if (ai !== bi) return ai - bi;
      return aname.localeCompare(bname, "sv");
    });
    return entries;
  }, [groups]);

  const handleRowClick = useCallback(
    (match) => {
      if (!match) {
        debug("rowClick", { state: "missing-match-object" });
        return;
      }
      debug("rowClick", {
        matchId: match.matchId,
        leagueId: match.leagueId,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
      });
      if (typeof onSelectMatch === "function") {
        onSelectMatch(match);
      }
    },
    [onSelectMatch]
  );

  if (!matches.length) {
    return <div className={styles.emptyState}>Inga matcher för valt datum.</div>;
  }

  return (
    <div className={styles.wrapper}>
      {orderedGroups.map(([key, list]) => {
        const [leagueIdRaw, leagueName] = key.split(":");
        const leagueId = leagueIdRaw === "unknown" ? null : Number(leagueIdRaw);
        const sortedList = [...list].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

        return (
          <section key={key} className={styles.leagueSection}>
            <div className={styles.leagueHeader}>
              <ImageWithFallback
                candidates={leagueLogoCandidates(leagueId, leagueName)}
                alt={leagueName}
                size={22}
                className={styles.leagueBadge}
              />
              <h2 className={styles.leagueTitle}>{leagueName}</h2>
            </div>
            <div className={styles.table}>
              <div className={styles.tableHeader}>
                <div className={styles.tableHeaderRow}>
                  <span>Tid</span>
                  <span>Hemmalag</span>
                  <span>Resultat</span>
                  <span>Bortalag</span>
                </div>
              </div>
              <div className={styles.rows}>
                {sortedList.map((match) => {
                  const isSelected = selectedMatchId === match.id;
                  const isPastMatch =
                    Number.isFinite(match.timestamp) && match.timestamp < nowSeconds;
                  const timeLabel = match.timestamp ? formatTime(match.timestamp) : "—";
                  const rowClassName = [
                    styles.rowButton,
                    isSelected ? styles.rowSelected : null,
                    isPastMatch ? styles.rowPast : null,
                  ]
                    .filter(Boolean)
                    .join(" ");

                  const homeScoreReady =
                    typeof match.homeScore === "number" &&
                    Number.isFinite(match.homeScore);
                  const awayScoreReady =
                    typeof match.awayScore === "number" &&
                    Number.isFinite(match.awayScore);
                  const hasScore = homeScoreReady && awayScoreReady;
                  const scoreLabel = hasScore
                    ? `${match.homeScore} - ${match.awayScore}`
                    : "vs";
                  const scoreClassName = [
                    styles.scoreCell,
                    hasScore ? null : styles.scoreCellPlaceholder,
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <button
                      key={match.id}
                      type="button"
                      onClick={() => handleRowClick(match)}
                      className={rowClassName}
                      data-match-id={match.matchId}
                      data-league-id={match.leagueId ?? undefined}
                      data-home-team-id={match.homeTeamId ?? undefined}
                      data-away-team-id={match.awayTeamId ?? undefined}
                    >
                      <span className={styles.timeCell}>{timeLabel}</span>
                      <span className={styles.teamCell}>
                        <ImageWithFallback
                          candidates={teamLogoCandidates(match.homeTeamId)}
                          alt={match.homeTeamName}
                          size={20}
                        />
                        <span className={styles.teamName}>{match.homeTeamName}</span>
                      </span>
                      <span className={scoreClassName}>{scoreLabel}</span>
                      <span className={styles.teamCell}>
                        <ImageWithFallback
                          candidates={teamLogoCandidates(match.awayTeamId)}
                          alt={match.awayTeamName}
                          size={20}
                        />
                        <span className={styles.teamName}>{match.awayTeamName}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export { normalizeMatch };