"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
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

const SHOTS_PER_MINUTE_METRICS = [
  { key: "leading", label: "When leading" },
  { key: "tied", label: "When tied" },
  { key: "trailing", label: "When trailing" },
];

const SHOTS_PER_TEN_MINUTES_METRICS = [
  { key: "0-10", label: "0-10 min" },
  { key: "11-20", label: "11-20 min" },
  { key: "21-30", label: "21-30 min" },
  { key: "31-40", label: "31-40 min" },
  { key: "41-50", label: "41-50 min" },
  { key: "51-60", label: "51-60 min" },
  { key: "61-70", label: "61-70 min" },
  { key: "71-80", label: "71-80 min" },
  { key: "81-90", label: "81-90 min" },
];

const PERIOD_OPTIONS = [
  { value: "ALL", label: "Hela matchen" },
  { value: "1ST", label: "Första halvlek" },
  { value: "2ND", label: "Andra halvlek" },
];

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

function toNumberOrNull(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSpecialMetricNode(specials, category, type, key) {
  if (!specials || typeof specials !== "object") {
    return { value: null, rank: null };
  }

  const categoryNode = specials[category];
  if (!categoryNode || typeof categoryNode !== "object") {
    return { value: null, rank: null };
  }

  if (type) {
    const typeNode = categoryNode[type];
    if (typeNode && typeof typeNode === "object") {
      const rawValue = typeNode[key];
      const rawRank = typeNode[`rank-${key}`];
      return {
        value: toNumberOrNull(rawValue),
        rank: toNumberOrNull(rawRank),
      };
    }
  }

  const rawValue = categoryNode[key];
  const rawRank = categoryNode[`rank-${key}`];
  return {
    value: toNumberOrNull(rawValue),
    rank: toNumberOrNull(rawRank),
  };
}

function getSpecialLeagueValue(leagueSpecials, category, type, key) {
  if (!leagueSpecials || typeof leagueSpecials !== "object") {
    return null;
  }

  const categoryNode = leagueSpecials[category];
  if (!categoryNode || typeof categoryNode !== "object") {
    return null;
  }

  if (type) {
    const typeNode = categoryNode[type];
    if (typeNode && typeof typeNode === "object" && typeNode[key] != null) {
      return toNumberOrNull(typeNode[key]);
    }
  }

  if (categoryNode[key] != null) {
    return toNumberOrNull(categoryNode[key]);
  }

  return null;
}

function hasAnyFiniteValue(...values) {
  return values.some((value) => Number.isFinite(value));
}

function formatMetricValue(value, formatter) {
  if (value == null) {
    return "—";
  }

  return formatter(value);
}

function buildLeagueAverageHint(forValue, againstValue, formatter) {
  const hasFor = Number.isFinite(forValue);
  const hasAgainst = Number.isFinite(againstValue);

  if (hasFor && hasAgainst) {
    return `League avg (for/against): ${formatter(forValue)} / ${formatter(againstValue)}`;
  }

  if (hasFor) {
    return `League avg (for): ${formatter(forValue)}`;
  }

  if (hasAgainst) {
    return `League avg (against): ${formatter(againstValue)}`;
  }

  return null;
}

function buildSingleLeagueAverageHint(value, formatter) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return `League avg: ${formatter(value)}`;
}

function normalizeId(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function buildTeamLogoCandidates(teamId) {
  const numeric = normalizeId(teamId);
  if (!numeric) {
    return ["/images/teams/placeholder.png"];
  }

  const base = String(numeric);
  return [
    `/images/teams/${base}.png`,
    `/images/teams/${base}.svg`,
    `/images/teams/${base}@2x.png`,
    "/images/teams/placeholder.png",
  ];
}

function TeamLogo({ teamId, teamName, size = 48, className }) {
  const candidates = useMemo(() => buildTeamLogoCandidates(teamId), [teamId]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
  }, [candidates]);
  const src = candidates[Math.min(index, candidates.length - 1)];

  return (
    <Image
      src={src}
      alt={teamName ?? "Lag"}
      width={size}
      height={size}
      className={className}
      loading="lazy"
      onError={() => {
        setIndex((prev) => (prev < candidates.length - 1 ? prev + 1 : prev));
      }}
      unoptimized
    />
  );
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

function extractStatValue(profile, statKey, type = "for", period = "ALL") {
  if (!profile?.statistics?.[type]?.[statKey]) {
    return null;
  }

  const node = profile.statistics[type][statKey][period];
  if (node == null) {
    return null;
  }

  if (typeof node === "object") {
    return {
      value: toNumberOrNull(node.value),
      rank: toNumberOrNull(node.rank),
    };
  }

  return {
    value: toNumberOrNull(node),
    rank: null,
  };
}

function extractLeagueAverage(profile, statKey, type = "for", period = "ALL") {
  if (!profile?.statistics?.leagueAverage?.[type]?.[statKey]) {
    return null;
  }

  const baseNode = profile.statistics.leagueAverage[type][statKey];
  const periodNode = baseNode?.[period] ?? baseNode?.ALL ?? null;

  if (periodNode == null) {
    return null;
  }

  if (typeof periodNode === "object") {
    return {
      value: toNumberOrNull(periodNode.value),
      rank: toNumberOrNull(periodNode.rank),
    };
  }

  return {
    value: toNumberOrNull(periodNode),
    rank: null,
  };
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

  const [selectedPeriod, setSelectedPeriod] = useState(PERIOD_OPTIONS[0].value);
  const selectedPeriodOption =
    PERIOD_OPTIONS.find((option) => option.value === selectedPeriod) ?? PERIOD_OPTIONS[0];

  const homeTeamId =
    normalizeId(
      match?.homeTeamId ??
        match?.raw?.homeTeamId ??
        match?.homeTeam?.id ??
        match?.raw?.homeTeam?.id
    ) ?? null;
  const awayTeamId =
    normalizeId(
      match?.awayTeamId ??
        match?.raw?.awayTeamId ??
        match?.awayTeam?.id ??
        match?.raw?.awayTeam?.id
    ) ?? null;
  const homeTeamLabel =
    match?.homeTeamName ??
    match?.raw?.homeTeamName ??
    match?.homeTeam?.name ??
    match?.raw?.homeTeam?.name ??
    "Home";
  const awayTeamLabel =
    match?.awayTeamName ??
    match?.raw?.awayTeamName ??
    match?.awayTeam?.name ??
    match?.raw?.awayTeam?.name ??
    "Away";

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

  const renderComparisonTable = (key, title, subtitle, rows, options = {}) => {
    const { layout = "forAgainst" } = options;
    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    if (layout === "single") {
      return (
        <div className={styles.section} key={key}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionSubtitle}>{subtitle}</span>
            <h3 className={styles.sectionTitle}>{title}</h3>
          </div>
          <div className={styles.table}>
            <div className={styles.headerRow}>
              <span className={styles.simpleHeaderMetric}>Metric</span>
              <span className={`${styles.simpleHeaderTeam} ${styles.simpleHeaderTeamHome}`}>
                {homeTeamLabel}
              </span>
              <span className={`${styles.simpleHeaderTeam} ${styles.simpleHeaderTeamAway}`}>
                {awayTeamLabel}
              </span>
            </div>
            <div className={styles.rows}>
              {rows.map((row) => (
                <div className={styles.row} key={row.key}>
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>{row.label}</span>
                    {row.hint ? <span className={styles.metricHint}>{row.hint}</span> : null}
                  </div>
                  <div className={styles.valueCell}>
                    <span>{row.home.display}</span>
                    {renderRankBadge(row.home)}
                  </div>
                  <div className={styles.valueCell}>
                    <span>{row.away.display}</span>
                    {renderRankBadge(row.away)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.section} key={key}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionSubtitle}>{subtitle}</span>
          <h3 className={styles.sectionTitle}>{title}</h3>
        </div>
        <div className={styles.table}>
          <div className={styles.mainHeader}>
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
            <span className={styles.mainHeaderMetric}>Metric</span>
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
            {rows.map((row) => (
              <div className={`${styles.row} ${styles.mainRow}`} key={row.key}>
                <div
                  className={`${styles.valueCell} ${styles.valueCellHome} ${styles.valueCellFor}`}
                >
                  <span>{row.home.for.display}</span>
                  {renderRankBadge(row.home.for)}
                </div>
                <div
                  className={`${styles.valueCell} ${styles.valueCellHome} ${styles.valueCellAgainst}`}
                >
                  <span>{row.home.against.display}</span>
                  {renderRankBadge(row.home.against)}
                </div>
                <div className={`${styles.metric} ${styles.metricMain}`}>
                  <span className={styles.metricLabel}>{row.label}</span>
                  {row.hint ? (
                    <span className={styles.metricHint}>{row.hint}</span>
                  ) : null}
                </div>
                <div
                  className={`${styles.valueCell} ${styles.valueCellAway} ${styles.valueCellFor}`}
                >
                  <span>{row.away.for.display}</span>
                  {renderRankBadge(row.away.for)}
                </div>
                <div
                  className={`${styles.valueCell} ${styles.valueCellAway} ${styles.valueCellAgainst}`}
                >
                  <span>{row.away.against.display}</span>
                  {renderRankBadge(row.away.against)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderStatistics = () => {
    if (!homeProfile || !awayProfile) return null;

    const rows = PROFILE_STATS.map(({ key, label }) => {
      const homeForNode = extractStatValue(homeProfile, key, "for", selectedPeriod);
      const homeAgainstNode = extractStatValue(homeProfile, key, "against", selectedPeriod);
      const awayForNode = extractStatValue(awayProfile, key, "for", selectedPeriod);
      const awayAgainstNode = extractStatValue(awayProfile, key, "against", selectedPeriod);
      const leagueAvgForNode = extractLeagueAverage(
        homeProfile,
        key,
        "for",
        selectedPeriod
      );
      const leagueAvgAgainstNode = extractLeagueAverage(
        homeProfile,
        key,
        "against",
        selectedPeriod
      );
      const isPercentage = key === "ballPossession";
      const formatter = (value) =>
        formatValue(value, {
          isPercentage,
        });
      const leagueAvgHint = buildLeagueAverageHint(
        leagueAvgForNode?.value,
        leagueAvgAgainstNode?.value,
        formatter
      );

      return {
        key,
        label,
        hint: leagueAvgHint,
        home: {
          for: {
            display: formatMetricValue(homeForNode?.value, formatter),
            rank: homeForNode?.rank ?? null,
          },
          against: {
            display: formatMetricValue(homeAgainstNode?.value, formatter),
            rank: homeAgainstNode?.rank ?? null,
          },
        },
        away: {
          for: {
            display: formatMetricValue(awayForNode?.value, formatter),
            rank: awayForNode?.rank ?? null,
          },
          against: {
            display: formatMetricValue(awayAgainstNode?.value, formatter),
            rank: awayAgainstNode?.rank ?? null,
          },
        },
      };
    });

    return renderComparisonTable(
      "team-statistics",
      "Lagstatistik",
      selectedPeriodOption.label,
      rows
    );
  };

  const renderSpecials = () => {
    if (!homeProfile || !awayProfile) return null;

    const homeSpecials = homeProfile.specials ?? {};
    const awaySpecials = awayProfile.specials ?? {};
    const leagueSpecials = homeSpecials.leagueAverage ?? awaySpecials.leagueAverage ?? {};

    const formatRate = (value) => formatValue(value);

    const shotsPerMinuteRows = SHOTS_PER_MINUTE_METRICS.map(({ key, label }) => {
      const homeFor = getSpecialMetricNode(homeSpecials, "shotsPerMinute", "for", key);
      const homeAgainst = getSpecialMetricNode(homeSpecials, "shotsPerMinute", "against", key);
      const awayFor = getSpecialMetricNode(awaySpecials, "shotsPerMinute", "for", key);
      const awayAgainst = getSpecialMetricNode(awaySpecials, "shotsPerMinute", "against", key);
      const leagueFor = getSpecialLeagueValue(leagueSpecials, "shotsPerMinute", "for", key);
      const leagueAgainst = getSpecialLeagueValue(
        leagueSpecials,
        "shotsPerMinute",
        "against",
        key
      );
      const hasData = hasAnyFiniteValue(
        homeFor.value,
        homeAgainst.value,
        awayFor.value,
        awayAgainst.value,
        leagueFor,
        leagueAgainst
      );

      return {
        key,
        label,
        hint: buildLeagueAverageHint(leagueFor, leagueAgainst, formatRate),
        home: {
          for: {
            display: formatMetricValue(homeFor.value, formatRate),
            rank: homeFor.rank,
          },
          against: {
            display: formatMetricValue(homeAgainst.value, formatRate),
            rank: homeAgainst.rank,
          },
        },
        away: {
          for: {
            display: formatMetricValue(awayFor.value, formatRate),
            rank: awayFor.rank,
          },
          against: {
            display: formatMetricValue(awayAgainst.value, formatRate),
            rank: awayAgainst.rank,
          },
        },
        hasData,
      };
    }).filter((row) => row.hasData);

    const shotsPerTenRows = SHOTS_PER_TEN_MINUTES_METRICS.map(({ key, label }) => {
      const homeFor = getSpecialMetricNode(homeSpecials, "shotsPerTenMinutes", "for", key);
      const homeAgainst = getSpecialMetricNode(
        homeSpecials,
        "shotsPerTenMinutes",
        "against",
        key
      );
      const awayFor = getSpecialMetricNode(awaySpecials, "shotsPerTenMinutes", "for", key);
      const awayAgainst = getSpecialMetricNode(
        awaySpecials,
        "shotsPerTenMinutes",
        "against",
        key
      );
      const leagueFor = getSpecialLeagueValue(
        leagueSpecials,
        "shotsPerTenMinutes",
        "for",
        key
      );
      const leagueAgainst = getSpecialLeagueValue(
        leagueSpecials,
        "shotsPerTenMinutes",
        "against",
        key
      );
      const hasData = hasAnyFiniteValue(
        homeFor.value,
        homeAgainst.value,
        awayFor.value,
        awayAgainst.value,
        leagueFor,
        leagueAgainst
      );

      return {
        key,
        label,
        hint: buildLeagueAverageHint(leagueFor, leagueAgainst, formatRate),
        home: {
          for: {
            display: formatMetricValue(homeFor.value, formatRate),
            rank: homeFor.rank,
          },
          against: {
            display: formatMetricValue(homeAgainst.value, formatRate),
            rank: homeAgainst.rank,
          },
        },
        away: {
          for: {
            display: formatMetricValue(awayFor.value, formatRate),
            rank: awayFor.rank,
          },
          against: {
            display: formatMetricValue(awayAgainst.value, formatRate),
            rank: awayAgainst.rank,
          },
        },
        hasData,
      };
    }).filter((row) => row.hasData);

    const firstGoalRows = FIRST_GOAL_METRICS.map((metric) => {
      const homeMetric = getSpecialMetricNode(homeSpecials, "firstGoal", null, metric.key);
      const awayMetric = getSpecialMetricNode(awaySpecials, "firstGoal", null, metric.key);
      const leagueValue = getSpecialLeagueValue(leagueSpecials, "firstGoal", null, metric.key);
      const hasData = hasAnyFiniteValue(homeMetric.value, awayMetric.value, leagueValue);
      const formatter = metric.format;

      return {
        key: metric.key,
        label: metric.label,
        hint: buildSingleLeagueAverageHint(leagueValue, formatter),
        home: {
          display: formatMetricValue(homeMetric.value, formatter),
          rank: homeMetric.rank,
        },
        away: {
          display: formatMetricValue(awayMetric.value, formatter),
          rank: awayMetric.rank,
        },
        hasData,
      };
    }).filter((row) => row.hasData);

    const specials = [];

    if (shotsPerMinuteRows.length) {
      specials.push(
        renderComparisonTable(
          "shots-per-minute",
          "Shots per minute",
          "Game state",
          shotsPerMinuteRows
        )
      );
    }

    if (shotsPerTenRows.length) {
      specials.push(
        renderComparisonTable(
          "shots-per-ten-minutes",
          "Shots per ten minutes",
          "Timing",
          shotsPerTenRows
        )
      );
    }

    if (firstGoalRows.length) {
      specials.push(
        renderComparisonTable(
          "first-goal",
          "First goal tendencies",
          "Game flow",
          firstGoalRows,
          { layout: "single" }
        )
      );
    }

    return specials.length ? specials : null;
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
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <label
            className="text-xs font-semibold uppercase tracking-wide text-gray-600"
            htmlFor="team-compare-period"
          >
            Period
          </label>
          <select
            id="team-compare-period"
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={selectedPeriod}
            onChange={(event) => setSelectedPeriod(event.target.value)}
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.teamIdentities}>
          <div className={styles.teamIdentity}>
            <TeamLogo
              teamId={homeTeamId}
              teamName={homeTeamLabel}
              size={72}
              className={styles.teamIdentityLogo}
            />
            <span className={styles.teamIdentityName}>{homeTeamLabel}</span>
          </div>
          <span className={styles.teamIdentitiesDivider}>vs</span>
          <div className={styles.teamIdentity}>
            <TeamLogo
              teamId={awayTeamId}
              teamName={awayTeamLabel}
              size={72}
              className={styles.teamIdentityLogo}
            />
            <span className={styles.teamIdentityName}>{awayTeamLabel}</span>
          </div>
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