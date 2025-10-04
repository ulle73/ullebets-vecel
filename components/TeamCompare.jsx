"use client";

import { useEffect, useMemo } from "react";
import useSWR from "swr";
import styles from "./TeamCompare.module.css";

const DEBUG_TAG = "[TeamCompare]";
const debug = (...args) => console.log(DEBUG_TAG, ...args);
const debugError = (...args) => console.error(DEBUG_TAG, ...args);

const fetcher = async (url) => {
  debug("fetch:start", { url });
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.message || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    debugError("fetch:error", { url, status: response.status, message });
    throw error;
  }
  const json = await response.json();
  debug("fetch:success", {
    url,
    hasProfile: Boolean(json?.profile),
  });
  return json;
};

const PROFILE_STATS = [
  { key: "expectedGoals", label: "Expected Goals" },
  { key: "totalShotsOnGoal", label: "Total Shots" },
  { key: "shotsOnGoal", label: "Shots on Target" },
  { key: "totalShotsInsideBox", label: "Shots Inside Box" },
  { key: "totalShotsOutsideBox", label: "Shots Outside Box" },
  { key: "touchesInOppBox", label: "Touches in Opp Box" },
  { key: "passes", label: "Passes" },
  { key: "accuratePasses", label: "Accurate Passes" },
  { key: "ballPossession", label: "Possession %" },
  { key: "bigChanceCreated", label: "Big Chances" },
  { key: "goalkeeperSaves", label: "Saves" },
  { key: "cornerKicks", label: "Corner Kicks" },
  { key: "fouls", label: "Fouls" },
  { key: "yellowCards", label: "Yellow Cards" },
  { key: "redCards", label: "Red Cards" },
];

const SCORE_STATES = ["leading", "tied", "trailing"];

const NUMBER_FORMATTERS = {
  integer: new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }),
  oneDecimal: new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }),
  twoDecimals: new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  percent: new Intl.NumberFormat("sv-SE", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }),
};

function formatValue(value, { isPercentage = false } = {}) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  if (isPercentage) {
    return NUMBER_FORMATTERS.percent.format(value / 100);
  }
  const abs = Math.abs(value);
  if (abs >= 100) return NUMBER_FORMATTERS.integer.format(value);
  if (abs >= 10) return NUMBER_FORMATTERS.oneDecimal.format(value);
  return NUMBER_FORMATTERS.twoDecimals.format(value);
}

const FIRST_GOAL_METRICS = [
  {
    key: "scoreFirstPercentage",
    label: "Score first",
    format: (value) => (value == null ? "—" : formatValue(value * 100, { isPercentage: true })),
  },
  {
    key: "concedeFirstPercentage",
    label: "Concede first",
    format: (value) => (value == null ? "—" : formatValue(value * 100, { isPercentage: true })),
  },
  {
    key: "averageTimeScoredFirst",
    label: "Avg minute scoring first",
    format: (value) => (value == null ? "—" : formatValue(value)),
  },
  {
    key: "averageTimeConcededFirst",
    label: "Avg minute conceding first",
    format: (value) => (value == null ? "—" : formatValue(value)),
  },
];

function normalizeId(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function buildProfileUrl(match, side) {
  const matchType = side === "home" ? "home" : "away";
  const params = new URLSearchParams();

  const leagueId = normalizeId(match?.leagueId ?? match?.raw?.leagueId);
  const leagueName = match?.leagueName ?? match?.raw?.leagueName ?? null;
  const teamId = normalizeId(
    side === "home"
      ? match?.homeTeamId ?? match?.raw?.homeTeamId
      : match?.awayTeamId ?? match?.raw?.awayTeamId
  );
  const teamName =
    side === "home"
      ? match?.homeTeamName ?? match?.raw?.homeTeamName
      : match?.awayTeamName ?? match?.raw?.awayTeamName;
  const matchId = match?.matchId ?? match?.id ?? match?.raw?.matchId ?? null;

  if (leagueId != null) params.set("leagueId", String(leagueId));
  if (leagueName) params.set("league", leagueName);
  if (teamId != null) params.set("teamId", String(teamId));
  if (teamName) params.set("team", teamName);
  params.set("matchType", matchType);
  if (matchId) params.set("matchId", String(matchId));

  const url = `/api/teamprofiles?${params.toString()}`;
  debug("buildProfileUrl", {
    side,
    url,
    matchId,
    leagueId,
    teamId,
  });
  return url;
}

function extractStatValue(profile, statKey, type = "for") {
  if (!profile?.statistics) return null;
  return profile.statistics?.[type]?.[statKey]?.ALL ?? null;
}

function extractLeagueAverage(profile, statKey, type = "for") {
  if (!profile?.statistics?.leagueAverage) return null;
  return profile.statistics.leagueAverage?.[type]?.[statKey]?.ALL ?? null;
}

function renderRankBadge(node) {
  const rank = node?.rank;
  if (!rank) return null;
  return <span className={styles.rankBadge}>#{rank}</span>;
}

function useTeamProfiles(match) {
  const key = useMemo(() => {
    if (!match) {
      debug("useTeamProfiles: no match provided");
      return null;
    }

    const matchId = match.matchId ?? match.id;
    const leagueIdentity =
      normalizeId(match.leagueId ?? match.raw?.leagueId) ??
      match.leagueName ??
      match.raw?.leagueName ??
      null;
    const homeIdentity =
      normalizeId(match.homeTeamId ?? match.raw?.homeTeamId) ??
      match.homeTeamName ??
      match.raw?.homeTeamName ??
      null;
    const awayIdentity =
      normalizeId(match.awayTeamId ?? match.raw?.awayTeamId) ??
      match.awayTeamName ??
      match.raw?.awayTeamName ??
      null;

    if (!matchId || !leagueIdentity || !homeIdentity || !awayIdentity) {
      debug("useTeamProfiles: missing identity", {
        matchId,
        leagueIdentity,
        homeIdentity,
        awayIdentity,
      });
      return null;
    }

    return [
      "teamprofiles",
      String(matchId),
      String(leagueIdentity),
      String(homeIdentity),
      String(awayIdentity),
    ];
  }, [
    match?.matchId,
    match?.id,
    match?.leagueId,
    match?.raw?.leagueId,
    match?.leagueName,
    match?.raw?.leagueName,
    match?.homeTeamId,
    match?.raw?.homeTeamId,
    match?.homeTeamName,
    match?.raw?.homeTeamName,
    match?.awayTeamId,
    match?.raw?.awayTeamId,
    match?.awayTeamName,
    match?.raw?.awayTeamName,
  ]);

  const swr = useSWR(
    key,
    async () => {
      debug("useTeamProfiles: fetching", {
        matchId: match?.matchId ?? match?.id,
        leagueId: match?.leagueId ?? match?.raw?.leagueId,
        homeTeamId: match?.homeTeamId ?? match?.raw?.homeTeamId,
        awayTeamId: match?.awayTeamId ?? match?.raw?.awayTeamId,
      });
      const homeUrl = buildProfileUrl(match, "home");
      const awayUrl = buildProfileUrl(match, "away");

      const [home, away] = await Promise.all([
        fetcher(homeUrl),
        fetcher(awayUrl),
      ]);

      debug("useTeamProfiles: fetched", {
        matchId: match?.matchId ?? match?.id,
        homeProfile: Boolean(home?.profile),
        awayProfile: Boolean(away?.profile),
      });

      return { home: home?.profile ?? null, away: away?.profile ?? null };
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  if (!key) {
    return { homeProfile: null, awayProfile: null, isLoading: false, error: null };
  }

  return {
    homeProfile: swr.data?.home ?? null,
    awayProfile: swr.data?.away ?? null,
    isLoading: swr.isLoading,
    error: swr.error,
  };
}

export default function TeamCompare({ match, isLoading, error, className = "" }) {
  useEffect(() => {
    if (!match) {
      debug("render", { state: "no-match" });
      return;
    }
    debug("render", {
      state: "with-match",
      matchId: match.matchId ?? match.id,
      leagueId: match.leagueId,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
    });
  }, [match?.matchId, match?.id, match?.leagueId, match?.homeTeamId, match?.awayTeamId]);

  const {
    homeProfile,
    awayProfile,
    isLoading: isProfileLoading,
    error: profileError,
  } = useTeamProfiles(match);

  const loading = isLoading || isProfileLoading;
  const combinedError = error ?? profileError ?? null;

  useEffect(() => {
    if (combinedError) {
      debugError("combinedError", combinedError);
    }
  }, [combinedError]);

  const containerClass = [
    "flex h-full flex-col rounded-lg border border-gray-200 bg-white shadow-sm",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const renderStatistics = () => {
    if (!homeProfile || !awayProfile) return null;

    return (
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionSubtitle}>Key metrics (per match)</span>
          <h3 className={styles.sectionTitle}>All periods</h3>
        </div>
        <div className={styles.table}>
          <div className={styles.mainHeader}>
            <span className={styles.mainHeaderMetric}>Metric</span>
            <span
              className={`${styles.mainHeaderTeam} ${styles.mainHeaderTeamHome}`}
            >
              {match?.homeTeamName ?? "Home"}
            </span>
            <span
              className={`${styles.mainHeaderTeam} ${styles.mainHeaderTeamAway}`}
            >
              {match?.awayTeamName ?? "Away"}
            </span>
            <span
              className={`${styles.mainHeaderLabel} ${styles.mainHeaderLabelHomeFor}`}
            >
              For
            </span>
            <span
              className={`${styles.mainHeaderLabel} ${styles.mainHeaderLabelHomeAgainst}`}
            >
              Against
            </span>
            <span
              className={`${styles.mainHeaderLabel} ${styles.mainHeaderLabelAwayFor}`}
            >
              For
            </span>
            <span
              className={`${styles.mainHeaderLabel} ${styles.mainHeaderLabelAwayAgainst}`}
            >
              Against
            </span>
          </div>
          <div className={styles.rows}>
            {PROFILE_STATS.map(({ key, label }) => {
              const homeForNode = extractStatValue(homeProfile, key, "for");
              const homeAgainstNode = extractStatValue(homeProfile, key, "against");
              const awayForNode = extractStatValue(awayProfile, key, "for");
              const awayAgainstNode = extractStatValue(awayProfile, key, "against");
              const leagueAvgForNode = extractLeagueAverage(homeProfile, key, "for");
              const leagueAvgAgainstNode = extractLeagueAverage(
                homeProfile,
                key,
                "against"
              );
              const isPercentage = key === "ballPossession";
              const homeForValue = formatValue(homeForNode?.value, {
                isPercentage,
              });
              const homeAgainstValue = formatValue(homeAgainstNode?.value, {
                isPercentage,
              });
              const awayForValue = formatValue(awayForNode?.value, {
                isPercentage,
              });
              const awayAgainstValue = formatValue(awayAgainstNode?.value, {
                isPercentage: key === "ballPossession",
              });
              const leagueAvgForValue =
                leagueAvgForNode?.value != null
                  ? formatValue(leagueAvgForNode.value, { isPercentage })
                  : null;
              const leagueAvgAgainstValue =
                leagueAvgAgainstNode?.value != null
                  ? formatValue(leagueAvgAgainstNode.value, { isPercentage })
                  : null;
              const leagueAvgHint = (() => {
                if (leagueAvgForValue && leagueAvgAgainstValue) {
                  return `League avg (for/against): ${leagueAvgForValue} / ${leagueAvgAgainstValue}`;
                }
                if (leagueAvgForValue) {
                  return `League avg (for): ${leagueAvgForValue}`;
                }
                if (leagueAvgAgainstValue) {
                  return `League avg (against): ${leagueAvgAgainstValue}`;
                }
                return null;
              })();

              return (
                <div className={`${styles.row} ${styles.mainRow}`} key={key}>
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>{label}</span>
                    {leagueAvgHint ? (
                      <span className={styles.metricHint}>{leagueAvgHint}</span>
                    ) : null}
                  </div>
                  <div className={`${styles.valueCell} ${styles.valueCellFor}`}>
                    <span>{homeForValue}</span>
                    {renderRankBadge(homeForNode)}
                  </div>
                  <div className={`${styles.valueCell} ${styles.valueCellAgainst}`}>
                    <span>{homeAgainstValue}</span>
                    {renderRankBadge(homeAgainstNode)}
                  </div>
                  <div className={`${styles.valueCell} ${styles.valueCellFor}`}>
                    <span>{awayForValue}</span>
                    {renderRankBadge(awayForNode)}
                  </div>
                  <div className={`${styles.valueCell} ${styles.valueCellAgainst}`}>
                    <span>{awayAgainstValue}</span>
                    {renderRankBadge(awayAgainstNode)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderSpecials = () => {
    if (!homeProfile || !awayProfile) return null;

    const homeSpecials = homeProfile.specials ?? {};
    const awaySpecials = awayProfile.specials ?? {};
    const leagueSpecials = homeSpecials.leagueAverage ?? awaySpecials.leagueAverage ?? {};

    const shotsPerMinuteRows = SCORE_STATES.map((state) => {
      const homeValue = homeSpecials?.shotsPerMinute?.for?.[state] ?? null;
      const awayValue = awaySpecials?.shotsPerMinute?.for?.[state] ?? null;
      const leagueValue = leagueSpecials?.shotsPerMinute?.for?.[state] ?? null;
      const label =
        state === "leading" ? "When leading" : state === "trailing" ? "When trailing" : "When tied";

      return {
        key: state,
        label,
        homeValue,
        awayValue,
        leagueValue,
      };
    });

    const allWindowLabels = new Set([
      ...Object.keys(homeSpecials?.shotsPerTenMinutes?.for ?? {}),
      ...Object.keys(awaySpecials?.shotsPerTenMinutes?.for ?? {}),
      ...Object.keys(leagueSpecials?.shotsPerTenMinutes?.for ?? {}),
    ]);

    const windowRows = Array.from(allWindowLabels)
      .sort((a, b) => {
        const getStart = (label) => {
          const match = label.match(/\d+/);
          return match ? parseInt(match[0], 10) : 0;
        };
        return getStart(a) - getStart(b);
      })
      .map((label) => ({
        key: label,
        label: `${label} min`,
        homeValue: homeSpecials?.shotsPerTenMinutes?.for?.[label] ?? null,
        awayValue: awaySpecials?.shotsPerTenMinutes?.for?.[label] ?? null,
        leagueValue: leagueSpecials?.shotsPerTenMinutes?.for?.[label] ?? null,
      }));

    const firstGoalRows = FIRST_GOAL_METRICS.map((metric) => {
      const homeValue = homeSpecials?.firstGoal?.[metric.key] ?? null;
      const awayValue = awaySpecials?.firstGoal?.[metric.key] ?? null;
      const leagueValue = leagueSpecials?.firstGoal?.[metric.key] ?? null;
      return {
        key: metric.key,
        label: metric.label,
        homeValue: metric.format(homeValue),
        awayValue: metric.format(awayValue),
        leagueValue: leagueValue == null ? null : metric.format(leagueValue),
      };
    });

    const renderGenericTable = (
      key,
      title,
      subtitle,
      rows,
      formatter = (value) => formatValue(value)
    ) => (
      <div className={styles.section} key={key}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionSubtitle}>{subtitle}</span>
          <h3 className={styles.sectionTitle}>{title}</h3>
        </div>
        <div className={styles.table}>
          <div className={styles.headerRow}>
            <span>Metric</span>
            <span>{match?.homeTeamName ?? "Home"}</span>
            <span>{match?.awayTeamName ?? "Away"}</span>
          </div>
          <div className={styles.rows}>
            {rows.map(({ key: rowKey, label, homeValue, awayValue, leagueValue }) => {
              const homeDisplay = formatter(homeValue);
              const awayDisplay = formatter(awayValue);
              const leagueDisplay = leagueValue == null ? null : formatter(leagueValue);

              return (
                <div className={styles.row} key={rowKey}>
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>{label}</span>
                    {leagueDisplay ? (
                      <span className={styles.metricHint}>League avg: {leagueDisplay}</span>
                    ) : null}
                  </div>
                  <div className={styles.valueCell}>
                    <span>{homeDisplay}</span>
                  </div>
                  <div className={styles.valueCell}>
                    <span>{awayDisplay}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );

    const specials = [];

    if (shotsPerMinuteRows.length) {
      specials.push(
        renderGenericTable("shots-per-minute", "Shots per minute", "Game state", shotsPerMinuteRows)
      );
    }

    if (windowRows.length) {
      specials.push(
        renderGenericTable("shots-per-ten-minutes", "Shots per ten minutes", "Timing", windowRows)
      );
    }

    if (firstGoalRows.length) {
      specials.push(
        <div className={styles.section} key="first-goal">
          <div className={styles.sectionHeader}>
            <span className={styles.sectionSubtitle}>Game flow</span>
            <h3 className={styles.sectionTitle}>First goal tendencies</h3>
          </div>
          <div className={styles.table}>
            <div className={styles.headerRow}>
              <span>Metric</span>
              <span>{match?.homeTeamName ?? "Home"}</span>
              <span>{match?.awayTeamName ?? "Away"}</span>
            </div>
            <div className={styles.rows}>
              {firstGoalRows.map(({ key: rowKey, label, homeValue, awayValue, leagueValue }) => (
                <div className={styles.row} key={rowKey}>
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>{label}</span>
                    {leagueValue ? (
                      <span className={styles.metricHint}>League avg: {leagueValue}</span>
                    ) : null}
                  </div>
                  <div className={styles.valueCell}>
                    <span>{homeValue}</span>
                  </div>
                  <div className={styles.valueCell}>
                    <span>{awayValue}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return specials;
  };

  const renderBody = () => {
    if (!match) {
      return <div className={styles.emptyState}>Välj en match för att se lagprofiler.</div>;
    }

    if (loading) {
      return <div className={styles.emptyState}>Hämtar lagprofiler...</div>;
    }

    if (combinedError) {
      const message = combinedError?.message ? ` (${combinedError.message})` : "";
      return (
        <div className={styles.emptyState}>
          Kunde inte ladda lagprofiler{message}.
        </div>
      );
    }

    if (!homeProfile || !awayProfile) {
      return <div className={styles.emptyState}>Inga lagprofiler hittades.</div>;
    }

    return (
      <>
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Lagprofiler</h2>
          <p className="text-xs text-gray-500">
            {match.homeTeamName} vs {match.awayTeamName}
          </p>
        </div>
        {renderStatistics()}
        {renderSpecials()}
      </>
    );
  };

  return (
    <div className={containerClass}>
      <div className="flex-1 overflow-auto p-4">{renderBody()}</div>
    </div>
  );
}