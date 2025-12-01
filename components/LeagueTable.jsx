"use client";

import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./LeagueTable.module.css";
import { normalizeMatch, toPositiveInt } from "@/lib/core/matchups";
import { slugify } from "@/lib/core/normalization";

const LEAGUE_ORDER = [17, 8, 35, 23, 325, 34];
const DEBUG_TAG = "[LeagueTable]";
const debug = (...args) => console.log(DEBUG_TAG, ...args);


function teamLogoCandidates(id) {
  const numeric = toPositiveInt(id);
  if (!numeric) return ["/images/teams/placeholder.png"];
  const base = String(numeric);
  return [
    `/images/teams/${base}.png`,
    `/images/teams/${base}.webp`,
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

export default function LeagueTable({
  items,
  formatTime,
  onSelectMatch,
  onPrefetchMatch,
  selectedMatchId,
}) {
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

  const prefetchedMatchIds = useRef(new Set());

  useEffect(() => {
    prefetchedMatchIds.current.clear();
  }, [items]);

  const handlePrefetchMatch = useCallback(
    (match) => {
      if (!match || typeof onPrefetchMatch !== "function") return;
      const matchKey = match.id ?? match.matchId ?? null;
      if (!matchKey) return;
      if (prefetchedMatchIds.current.has(matchKey)) return;
      prefetchedMatchIds.current.add(matchKey);
      onPrefetchMatch(match);
    },
    [onPrefetchMatch]
  );

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
                    onPointerEnter={() => handlePrefetchMatch(match)}
                    onFocus={() => handlePrefetchMatch(match)}
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

