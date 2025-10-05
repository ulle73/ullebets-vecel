import { useMemo } from "react";
import { logClientBacktestStep } from "@/lib/backtest/logger";

function parseRank(rank) {
  const numeric = Number.parseInt(rank, 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function rankColor(rank, { inverse = false } = {}) {
  const numeric = parseRank(rank);
  if (numeric == null) return "text-gray-300";
  if (!inverse) {
    if (numeric >= 1 && numeric <= 6) return "text-emerald-400";
    if (numeric >= 14) return "text-red-400";
    return "text-amber-300";
  }
  if (numeric >= 1 && numeric <= 6) return "text-red-400";
  if (numeric >= 14) return "text-emerald-400";
  return "text-amber-300";
}

function formatValue(value, percent) {
  if (value == null) return "";
  if (percent) return ` (${Math.round(value)}%)`;
  return ` (${value.toFixed(2)})`;
}

function computePercent(value, total) {
  if (typeof value !== "number" || typeof total !== "number" || total === 0) {
    return null;
  }
  return (value / total) * 100;
}

function extractStat(profile, direction, statKey, periodKey) {
  return profile?.statistics?.[direction]?.[statKey]?.[periodKey] ?? null;
}

function resolveMatchType(scope, teamRole) {
  if (scope === "home") {
    return teamRole === "homeTeam" ? "home" : "away";
  }
  if (scope === "away") {
    return teamRole === "homeTeam" ? "away" : "home";
  }
  return teamRole === "homeTeam" ? "home" : "away";
}

function buildShotPercentages({
  homeProfile,
  awayProfile,
  periodKey,
  statKey,
  values,
  formEntry,
}) {
  if (statKey !== "shotsOnGoal") return values;
  const homeTotal = homeProfile?.statistics?.for?.totalShotsOnGoal;
  const awayTotal = awayProfile?.statistics?.for?.totalShotsOnGoal;
  const homeTotalAgainst = homeProfile?.statistics?.against?.totalShotsOnGoal;
  const awayTotalAgainst = awayProfile?.statistics?.against?.totalShotsOnGoal;
  const homeForTotal = homeTotal?.[periodKey] ?? {};
  const homeAgainstTotal = homeTotalAgainst?.[periodKey] ?? {};
  const awayForTotal = awayTotal?.[periodKey] ?? {};
  const awayAgainstTotal = awayTotalAgainst?.[periodKey] ?? {};
  return {
    ...values,
    homeForPercent: computePercent(
      values.homeForValue,
      homeForTotal?.value ?? homeForTotal?.rawValue
    ),
    homeAgainstPercent: computePercent(
      values.homeAgainstValue,
      homeAgainstTotal?.value ?? homeAgainstTotal?.rawValue
    ),
    awayForPercent: computePercent(
      values.awayForValue,
      awayForTotal?.value ?? awayForTotal?.rawValue
    ),
    awayAgainstPercent: computePercent(
      values.awayAgainstValue,
      awayAgainstTotal?.value ?? awayAgainstTotal?.rawValue
    ),
  };
}

function buildValues({ statKey, periodKey, formEntry, teamProfiles }) {
  if (!formEntry?.homeTeam || !formEntry?.awayTeam) {
    return null;
  }

  const scope = formEntry.scope ?? "total";
  const homeMatchType = resolveMatchType(scope, "homeTeam");
  const awayMatchType = resolveMatchType(scope, "awayTeam");

  const homeProfile = teamProfiles?.homeTeam?.[homeMatchType];
  const awayProfile = teamProfiles?.awayTeam?.[awayMatchType];

  if (!homeProfile && !awayProfile) {
    logClientBacktestStep("Ranking-översikten saknar lagprofiler.", {
      statKey,
      periodKey,
      scope,
      homeProfile: Boolean(homeProfile),
      awayProfile: Boolean(awayProfile),
    });
    return null;
  }

  const homeFor = extractStat(homeProfile, "for", statKey, periodKey);
  const homeAgainst = extractStat(homeProfile, "against", statKey, periodKey);
  const awayFor = extractStat(awayProfile, "for", statKey, periodKey);
  const awayAgainst = extractStat(awayProfile, "against", statKey, periodKey);

  const values = {
    homeForRank: homeFor?.rank ?? "-",
    homeAgainstRank: homeAgainst?.rank ?? "-",
    awayForRank: awayFor?.rank ?? "-",
    awayAgainstRank: awayAgainst?.rank ?? "-",
    homeForValue: homeFor?.value ?? null,
    homeAgainstValue: homeAgainst?.value ?? null,
    awayForValue: awayFor?.value ?? null,
    awayAgainstValue: awayAgainst?.value ?? null,
    homeForRaw: homeFor?.rawValue ?? null,
    homeAgainstRaw: homeAgainst?.rawValue ?? null,
    awayForRaw: awayFor?.rawValue ?? null,
    awayAgainstRaw: awayAgainst?.rawValue ?? null,
    homeProfileMatchType: homeMatchType,
    awayProfileMatchType: awayMatchType,
  };

  logClientBacktestStep("Ranking-översikten beräknar värden.", {
    statKey,
    periodKey,
    scope,
    values,
  });

  return buildShotPercentages({
    homeProfile,
    awayProfile,
    periodKey,
    statKey,
    values,
    formEntry,
  });
}

export default function RankingSummary({
  statKey,
  formEntry,
  teamProfiles,
  homeLeagueName,
  awayLeagueName,
}) {
  const payload = useMemo(() => {
    if (!formEntry?.homeTeam || !formEntry?.awayTeam) {
      logClientBacktestStep("Ranking-översikten saknar lag och hoppas över.", {
        formEntry,
      });
      return null;
    }
    const periodKey = formEntry?.period ?? "ALL";
    const values = buildValues({
      statKey,
      periodKey,
      formEntry,
      teamProfiles,
    });
    logClientBacktestStep("Ranking-översikten får in data för rendering.", {
      statKey,
      periodKey,
      homeTeam: formEntry.homeTeam,
      awayTeam: formEntry.awayTeam,
      homeLeagueName,
      awayLeagueName,
      hasTeamProfiles: Boolean(teamProfiles),
      values,
    });
    return { values, periodKey };
  }, [formEntry, statKey, teamProfiles, homeLeagueName, awayLeagueName]);

  if (!payload?.values) {
    return null;
  }

  const {
    homeForRank,
    homeAgainstRank,
    awayForRank,
    awayAgainstRank,
    homeForValue,
    homeAgainstValue,
    awayForValue,
    awayAgainstValue,
    homeForPercent,
    homeAgainstPercent,
    awayForPercent,
    awayAgainstPercent,
    homeForRaw,
    homeAgainstRaw,
    awayForRaw,
    awayAgainstRaw,
  } = payload.values;

  return (
    <div className="mb-4 text-center text-sm italic text-gray-300">
      <div className="mb-2">
        <span>
          {formEntry.homeTeam} attack-rank:{" "}
          <span
            className={rankColor(homeForRank)}
            title={homeForRaw != null ? `raw: ${homeForRaw.toFixed(2)}` : undefined}
          >
            {homeForRank}
            {homeForPercent != null
              ? formatValue(homeForPercent, true)
              : homeForValue != null
              ? formatValue(homeForValue)
              : ""}
          </span>
        </span>
        <span className="ml-3">
          {formEntry.homeTeam} concede-rank:{" "}
          <span
            className={rankColor(homeAgainstRank, { inverse: true })}
            title={homeAgainstRaw != null ? `raw: ${homeAgainstRaw.toFixed(2)}` : undefined}
          >
            {homeAgainstRank}
            {homeAgainstPercent != null
              ? formatValue(homeAgainstPercent, true)
              : homeAgainstValue != null
              ? formatValue(homeAgainstValue)
              : ""}
          </span>
        </span>
      </div>
      <div>
        <span>
          {formEntry.awayTeam} attack-rank:{" "}
          <span
            className={rankColor(awayForRank)}
            title={awayForRaw != null ? `raw: ${awayForRaw.toFixed(2)}` : undefined}
          >
            {awayForRank}
            {awayForPercent != null
              ? formatValue(awayForPercent, true)
              : awayForValue != null
              ? formatValue(awayForValue)
              : ""}
          </span>
        </span>
        <span className="ml-3">
          {formEntry.awayTeam} concede-rank:{" "}
          <span
            className={rankColor(awayAgainstRank, { inverse: true })}
            title={awayAgainstRaw != null ? `raw: ${awayAgainstRaw.toFixed(2)}` : undefined}
          >
            {awayAgainstRank}
            {awayAgainstPercent != null
              ? formatValue(awayAgainstPercent, true)
              : awayAgainstValue != null
              ? formatValue(awayAgainstValue)
              : ""}
          </span>
        </span>
      </div>
    </div>
  );
}
