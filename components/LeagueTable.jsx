"use client";

import { useMemo, useCallback, useState } from "react";
import Image from "next/image";
import styles from "./LeagueTable.module.css";

const LEAGUE_ORDER = [17, 8, 35, 23, 325, 34];

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

function normalizeMatch(item) {
  const id = String(
    pick(
      item,
      ["id", "matchId", "event.id", "event.matchId"],
      crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
    )
  );

  const leagueId =
    Number(
      pick(
        item,
        [
          "tournament.uniqueTournament.id",
          "uniqueTournament.id",
          "tournament.id",
          "event.tournament.uniqueTournament.id",
          "event.tournament.id",
        ],
        0
      )
    ) || 0;

  const leagueName = pick(
    item,
    ["tournament.name", "event.tournament.name", "league.name"],
    "Unknown"
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

  const homeTeamId =
    Number(
      pick(
        item,
        ["homeTeam.id", "event.homeTeam.id", "home.id", "teams.home.id"],
        0
      )
    ) || 0;
  const awayTeamId =
    Number(
      pick(
        item,
        ["awayTeam.id", "event.awayTeam.id", "away.id", "teams.away.id"],
        0
      )
    ) || 0;

  const timestamp =
    Number(
      pick(
        item,
        ["startTimestamp", "event.startTimestamp", "timestamp", "kickoffTime"],
        null
      )
    ) || null;

  return {
    id,
    leagueId,
    leagueName,
    homeTeamName,
    awayTeamName,
    homeTeamId,
    awayTeamId,
    timestamp,
    raw: item,
  };
}

function teamLogoCandidates(id) {
  if (!id) return ["/images/teams/placeholder.png"];
  return [
    `/images/teams/${id}.png`,
    `/images/teams/${id}.svg`,
    `/images/teams/${id}@2x.png`,
    "/images/teams/placeholder.png",
  ];
}

function leagueLogoCandidates(leagueId, leagueName) {
  const slug = slugify(leagueName);
  return [
    `/images/league/${slug}.png`,
    `/images/league/${slug}.svg`,
    `/images/league/${leagueId}.png`,
    `/images/league/${leagueId}.svg`,
    "/images/placeholder.png",
  ];
}

function ImageWithFallback({ candidates, alt, size = 20, className }) {
  const sources = Array.isArray(candidates) && candidates.length > 0
    ? candidates
    : ["/images/placeholder.png"];
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
    />
  );
}

export default function LeagueTable({ items, formatTime, onSelectMatch, selectedMatchId }) {
  const matches = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return items.map(normalizeMatch);
  }, [items]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const match of matches) {
      const key = `${match.leagueId}:${match.leagueName}`;
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
      const idx = LEAGUE_ORDER.indexOf(Number(id));
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
    (matchId) => {
      if (typeof onSelectMatch === "function") {
        onSelectMatch(matchId);
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
        const [leagueId, leagueName] = key.split(":");
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
                  <span>
                    <span className={styles.srOnly}>VS</span>
                  </span>
                  <span>Bortalag</span>
                </div>
              </div>
              <div className={styles.rows}>
                {sortedList.map((match) => {
                  const isSelected = selectedMatchId === match.id;
                  const timeLabel = match.timestamp ? formatTime(match.timestamp) : "—";
                  const rowClassName = [
                    styles.rowButton,
                    isSelected ? styles.rowSelected : null,
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <button
                      key={match.id}
                      type="button"
                      onClick={() => handleRowClick(match.id)}
                      className={rowClassName}
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
                      <span className={styles.vsCell}>vs</span>
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
