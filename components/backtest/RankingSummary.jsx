import { useMemo } from "react";

function pickLeague(leagueRankings, leagueName) {
  if (!Array.isArray(leagueRankings) || !leagueName) return null;
  return leagueRankings.find((entry) => entry?.league === leagueName) ?? null;
}

function getLists(leagueObj, rankKey, periodKey) {
  const ranking = leagueObj?.ranking?.[rankKey];
  if (!ranking) return { homeFor: [], homeAgainst: [], awayFor: [], awayAgainst: [] };
  return {
    homeFor: ranking.for?.[periodKey] ?? [],
    homeAgainst: ranking.against?.[periodKey] ?? [],
    awayFor: ranking.for?.[periodKey] ?? [],
    awayAgainst: ranking.against?.[periodKey] ?? [],
  };
}

function findEntry(list, team, propertyPrefix) {
  if (!Array.isArray(list) || !team) return {};
  const entry = list.find((item) => item.team === team) ?? {};
  if (!propertyPrefix) return entry;
  return entry;
}

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

function buildShotPercentages({
  homeLeagueObj,
  awayLeagueObj,
  periodKey,
  statKey,
  values,
  formEntry,
}) {
  if (statKey !== "shotsOnGoal") return values;
  const homeTotal = homeLeagueObj?.ranking?.totalShotsOnGoal;
  const awayTotal = awayLeagueObj?.ranking?.totalShotsOnGoal;
  const homeTotalFor = homeTotal?.for?.[periodKey] ?? [];
  const homeTotalAgainst = homeTotal?.against?.[periodKey] ?? [];
  const awayTotalFor = awayTotal?.for?.[periodKey] ?? [];
  const awayTotalAgainst = awayTotal?.against?.[periodKey] ?? [];
  const homeForTotal = findEntry(homeTotalFor, formEntry.homeTeam);
  const homeAgainstTotal = findEntry(homeTotalAgainst, formEntry.homeTeam);
  const awayForTotal = findEntry(awayTotalFor, formEntry.awayTeam);
  const awayAgainstTotal = findEntry(awayTotalAgainst, formEntry.awayTeam);
  return {
    ...values,
    homeForPercent: computePercent(values.homeForValue, homeForTotal?.home_adjustedValue ?? homeForTotal?.home_rawValue),
    homeAgainstPercent: computePercent(values.homeAgainstValue, homeAgainstTotal?.home_adjustedValue ?? homeAgainstTotal?.home_rawValue),
    awayForPercent: computePercent(values.awayForValue, awayForTotal?.away_adjustedValue ?? awayForTotal?.away_rawValue),
    awayAgainstPercent: computePercent(values.awayAgainstValue, awayAgainstTotal?.away_adjustedValue ?? awayAgainstTotal?.away_rawValue),
  };
}

function buildValues({
  homeLeagueObj,
  awayLeagueObj,
  rankKey,
  periodKey,
  statKey,
  formEntry,
}) {
  if (!homeLeagueObj || !awayLeagueObj) {
    return null;
  }

  const homeLists = getLists(homeLeagueObj, rankKey, periodKey);
  const awayLists = getLists(awayLeagueObj, rankKey, periodKey);

  const homeForEntry = findEntry(homeLists.homeFor, formEntry.homeTeam);
  const homeAgainstEntry = findEntry(homeLists.homeAgainst, formEntry.homeTeam);
  const awayForEntry = findEntry(awayLists.awayFor, formEntry.awayTeam);
  const awayAgainstEntry = findEntry(awayLists.awayAgainst, formEntry.awayTeam);

  const values = {
    homeForRank: homeForEntry?.home_rank ?? "-",
    homeAgainstRank: homeAgainstEntry?.home_rank ?? "-",
    awayForRank: awayForEntry?.away_rank ?? "-",
    awayAgainstRank: awayAgainstEntry?.away_rank ?? "-",
    homeForValue: homeForEntry?.home_adjustedValue ?? homeForEntry?.home_rawValue ?? null,
    homeAgainstValue: homeAgainstEntry?.home_adjustedValue ?? homeAgainstEntry?.home_rawValue ?? null,
    awayForValue: awayForEntry?.away_adjustedValue ?? awayForEntry?.away_rawValue ?? null,
    awayAgainstValue: awayAgainstEntry?.away_adjustedValue ?? awayAgainstEntry?.away_rawValue ?? null,
    homeForRaw: homeForEntry?.home_rawValue ?? null,
    homeAgainstRaw: homeAgainstEntry?.home_rawValue ?? null,
    awayForRaw: awayForEntry?.away_rawValue ?? null,
    awayAgainstRaw: awayAgainstEntry?.away_rawValue ?? null,
  };

  return buildShotPercentages({
    homeLeagueObj,
    awayLeagueObj,
    periodKey,
    statKey,
    values,
    formEntry,
  });
}

export default function RankingSummary({
  statKey,
  statPatterns,
  formEntry,
  leagueRankings,
  homeLeagueName,
  awayLeagueName,
}) {
  const payload = useMemo(() => {
    if (!formEntry?.homeTeam || !formEntry?.awayTeam) return null;
    const rankKey = statPatterns?.[statKey]?.rankKey ?? statKey;
    const periodKey = formEntry?.period ?? "ALL";
    const homeLeagueObj = pickLeague(leagueRankings, homeLeagueName);
    const awayLeagueObj = pickLeague(leagueRankings, awayLeagueName);
    const values = buildValues({
      homeLeagueObj,
      awayLeagueObj,
      rankKey,
      periodKey,
      statKey,
      formEntry,
    });
    return { values, periodKey };
  }, [formEntry, statKey, statPatterns, leagueRankings, homeLeagueName, awayLeagueName]);

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
