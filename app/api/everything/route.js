import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import { getMatchesForDate } from "@/lib/repos/fixtures";
import { getUnibetOddsForMatch } from "@/lib/engines/unibet-engine";
import {
  fetchTeamMatches,
  fetchTeamProfilesBundle,
  fetchLeaguesAndTeams,
} from "@/lib/backtest/data";
import { calculateEVFromData } from "@/lib/backtest/engine";

export const runtime = "nodejs";
export const maxDuration = 300; // allow long aggregation

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_CONTROL = "public, s-maxage=900, stale-while-revalidate=900";
const MIN_SCORE = 70;

const PROFILE_STATS = [
  "expectedGoals",
  "totalShotsOnGoal",
  "shotsOnGoal",
  "totalShotsInsideBox",
  "totalShotsOutsideBox",
  "touchesInOppBox",
  "passes",
  "accuratePasses",
  "ballPossession",
  "bigChanceCreated",
  "goalkeeperSaves",
  "cornerKicks",
  "fouls",
  "yellowCards",
  "redCards",
];

const PROFILE_PERIODS = ["ALL", "1ST", "2ND"];

const STATKEY_CANONICAL = new Map([
  ["totalShots", "totalShotsOnGoal"],
]);

function normalizeStatKey(value) {
  if (!value) return value;
  return STATKEY_CANONICAL.get(value) || value;
}

function toBacktestStat(value) {
  if (value === "totalShotsOnGoal") return "totalShots";
  return value;
}

function extractMatchId(match) {
  const candidates = [
    match?.matchId,
    match?.id,
    match?.event?.id,
    match?.event?.matchId,
  ];
  for (const value of candidates) {
    if (value === undefined || value === null) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return null;
}

function pickTeamName(match, side) {
  if (side === "home") {
    return (
      match?.homeTeamName ||
      match?.homeTeam?.name ||
      match?.event?.homeName ||
      match?.event?.homeTeam?.name ||
      null
    );
  }
  return (
    match?.awayTeamName ||
    match?.awayTeam?.name ||
    match?.event?.awayName ||
    match?.event?.awayTeam?.name ||
    null
  );
}

function pickTeamId(match, side) {
  if (side === "home") {
    return (
      match?.homeTeamId ||
      match?.homeTeam?.id ||
      match?.event?.homeTeamId ||
      match?.event?.homeTeam?.id ||
      null
    );
  }
  return (
    match?.awayTeamId ||
    match?.awayTeam?.id ||
    match?.event?.awayTeamId ||
    match?.event?.awayTeam?.id ||
    null
  );
}

function pickLeagueName(match) {
  return (
    match?.leagueName ||
    match?.league?.name ||
    match?.tournament?.name ||
    match?.event?.tournament?.name ||
    null
  );
}

function pickKickoff(match) {
  return (
    match?.startTimestamp ||
    match?.timestamp ||
    match?.matchDate ||
    match?.event?.startTimestamp ||
    match?.event?.start ||
    null
  );
}

function sortMatchesStable(matches) {
  return matches.slice().sort((a, b) => {
    const aTs = Number(a.kickoff ?? 0);
    const bTs = Number(b.kickoff ?? 0);
    if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) {
      return aTs - bTs;
    }
    return String(a.matchId).localeCompare(String(b.matchId));
  });
}

function buildBetKey({ matchId, statKey, scope, period, line, direction }) {
  return [
    String(matchId),
    statKey,
    scope,
    period,
    String(line),
    direction,
  ].join("|");
}

function extractNodeValue(node) {
  if (node == null) return null;
  if (typeof node === "object") {
    const value = Number(node.value ?? node.avg ?? node.mean);
    const rank = Number(node.rank ?? node.Rank);
    return {
      value: Number.isFinite(value) ? value : null,
      rank: Number.isFinite(rank) ? rank : null,
    };
  }
  const value = Number(node);
  return {
    value: Number.isFinite(value) ? value : null,
    rank: null,
  };
}

function averageList(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const numeric = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (!numeric.length) return null;
  const sum = numeric.reduce((acc, v) => acc + v, 0);
  return sum / numeric.length;
}

function summarizeConceded(conceded) {
  if (Array.isArray(conceded)) {
    return {
      avg: averageList(conceded),
      samples: conceded.length,
    };
  }
  if (conceded && typeof conceded === "object") {
    const home = summarizeConceded(conceded.homeConceded ?? conceded.home);
    const away = summarizeConceded(conceded.awayConceded ?? conceded.away);
    return { home, away };
  }
  return null;
}

function extractProfileStats(profile, statKeys, periods) {
  if (!profile || typeof profile !== "object") return null;
  const stats = {};

  for (const statKey of PROFILE_STATS) {
    if (statKeys?.size && !statKeys.has(statKey)) continue;
    const perPeriod = {};
    for (const period of PROFILE_PERIODS) {
      if (periods?.size && !periods.has(period)) continue;
      const forNode =
        profile?.statistics?.for?.[statKey]?.[period] ??
        profile?.statistics?.for?.[statKey]?.ALL ??
        null;
      const againstNode =
        profile?.statistics?.against?.[statKey]?.[period] ??
        profile?.statistics?.against?.[statKey]?.ALL ??
        null;
      const leagueForNode =
        profile?.statistics?.leagueAverage?.for?.[statKey]?.[period] ??
        profile?.statistics?.leagueAverage?.for?.[statKey]?.ALL ??
        null;
      const leagueAgainstNode =
        profile?.statistics?.leagueAverage?.against?.[statKey]?.[period] ??
        profile?.statistics?.leagueAverage?.against?.[statKey]?.ALL ??
        null;

      perPeriod[period] = {
        for: extractNodeValue(forNode),
        against: extractNodeValue(againstNode),
        leagueAverage: {
          for: extractNodeValue(leagueForNode),
          against: extractNodeValue(leagueAgainstNode),
        },
      };
    }
    if (Object.keys(perPeriod).length > 0) {
      stats[statKey] = perPeriod;
    }
  }

  return stats;
}

function parseHits(hits) {
  if (typeof hits !== "string") return null;
  const match = hits.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  const hitsNum = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(hitsNum) || !Number.isFinite(total) || total === 0) {
    return null;
  }
  return {
    hits: `${hitsNum}/${total}`,
    hitRate: hitsNum / total,
  };
}

function isPositiveEv(result) {
  if (!result || typeof result !== "object") return false;
  const candidates = [
    result.evPct,
    result.evPctMultifactor,
    result.evPctLeagueAvg,
    result.evPctWithMultiplier,
    result.evPctUniversalOptimized,
    result.legacyEvPct,
  ];
  return candidates.some((value) => Number.isFinite(value) && value > 0);
}

async function loadMatchupsSnapshot(date) {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const doc = await db.collection("matchups-score").findOne({ _id: date });
  return doc?.data ?? null;
}

async function runBatchBacktest(bets) {
  if (!Array.isArray(bets) || bets.length === 0) return [];

  const uniqueTeams = new Set();
  for (const bet of bets) {
    if (bet.homeTeam) uniqueTeams.add(bet.homeTeam);
    if (bet.awayTeam) uniqueTeams.add(bet.awayTeam);
  }

  const teamDataPromises = {};
  uniqueTeams.forEach((teamName) => {
    teamDataPromises[teamName] = {
      profiles: fetchTeamProfilesBundle(teamName),
      homeMatches: fetchTeamMatches(teamName, "home"),
      awayMatches: fetchTeamMatches(teamName, "away"),
    };
  });

  const teamData = {};
  for (const teamName of uniqueTeams) {
    const { profiles, homeMatches, awayMatches } = teamDataPromises[teamName];
    teamData[teamName] = {
      profiles: await profiles,
      homeMatches: await homeMatches,
      awayMatches: await awayMatches,
    };
  }

  const leaguesData = await fetchLeaguesAndTeams().catch(() => null);

  const results = [];
  for (const bet of bets) {
    try {
      const homeData = teamData[bet.homeTeam];
      const awayData = teamData[bet.awayTeam];

      if (!homeData || !awayData) {
        throw new Error(`Missing team data for ${bet.homeTeam} or ${bet.awayTeam}`);
      }

      const fetchedData = {
        homeBundle: homeData.profiles,
        awayBundle: awayData.profiles,
        homeMatchesRaw: bet.neutralGround ? homeData.awayMatches : homeData.homeMatches,
        awayMatchesRaw: awayData.awayMatches,
        leaguesData,
      };

      const result = await calculateEVFromData(bet.params, fetchedData);
      results.push({ key: bet.key, result });
    } catch (error) {
      results.push({
        key: bet.key,
        error: error?.message || "backtest failed",
      });
    }
  }

  return results;
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    const matchIdFilter = url.searchParams.get("matchId");

    if (!date || !DATE_REGEX.test(date)) {
      return NextResponse.json(
        { message: "Missing or invalid date (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const snapshot = await loadMatchupsSnapshot(date);
    if (!snapshot) {
      return NextResponse.json(
        { message: "Matchups data not found" },
        { status: 404 }
      );
    }

    const overRows = Array.isArray(snapshot?.top50?.over)
      ? snapshot.top50.over
      : [];
    const underRows = Array.isArray(snapshot?.top50?.under)
      ? snapshot.top50.under
      : [];
    const allRows = [...overRows, ...underRows];

    const selectedRows = allRows.filter(
      (row) => Number(row?.score ?? row?.normalizedScore ?? 0) > MIN_SCORE
    );

    const selectedMatchIds = new Set(
      selectedRows
        .map((row) => (row?.matchId != null ? String(row.matchId) : null))
        .filter(Boolean)
    );

    if (matchIdFilter) {
      const normalized = String(matchIdFilter).trim();
      if (normalized) {
        const only = new Set();
        if (selectedMatchIds.has(normalized)) {
          only.add(normalized);
        }
        for (const id of selectedMatchIds) {
          if (String(id) === normalized) {
            only.add(id);
            break;
          }
        }
        if (only.size > 0) {
          selectedMatchIds.clear();
          for (const id of only) selectedMatchIds.add(id);
        } else {
          return NextResponse.json(
            {
              message: "matchId not found in matchup scores above threshold",
            },
            { status: 404 }
          );
        }
      }
    }

    const matchupByMatchId = new Map();
    for (const row of selectedRows) {
      const matchId = row?.matchId != null ? String(row.matchId) : null;
      if (!matchId || !selectedMatchIds.has(matchId)) continue;
      if (!matchupByMatchId.has(matchId)) {
        matchupByMatchId.set(matchId, []);
      }
      matchupByMatchId.get(matchId).push(row);
    }

    if (selectedMatchIds.size === 0) {
      return NextResponse.json(
        {
          date,
          minScore: MIN_SCORE,
          generatedAt: new Date().toISOString(),
          matches: [],
          errors: [],
        },
        {
          headers: {
            "cache-control": CACHE_CONTROL,
          },
        }
      );
    }

    const fixtures = await getMatchesForDate(date);
    const fixtureMap = new Map();
    for (const match of fixtures) {
      const matchId = extractMatchId(match);
      if (matchId) fixtureMap.set(String(matchId), match);
    }

    const errors = [];
    const matchEntries = [];

    for (const matchId of selectedMatchIds) {
      const fixture = fixtureMap.get(matchId);
      const homeTeam = fixture ? pickTeamName(fixture, "home") : null;
      const awayTeam = fixture ? pickTeamName(fixture, "away") : null;
      const entry = {
        matchId,
        eventId: null,
        leagueName: fixture ? pickLeagueName(fixture) : null,
        homeTeam,
        awayTeam,
        homeTeamId: fixture ? pickTeamId(fixture, "home") : null,
        awayTeamId: fixture ? pickTeamId(fixture, "away") : null,
        kickoff: fixture ? pickKickoff(fixture) : null,
        matchupScores: matchupByMatchId.get(matchId) ?? [],
        teamProfiles: {
          home: null,
          away: null,
        },
        tuples: [],
        evLines: [],
      };

      if (!fixture) {
        errors.push({
          matchId,
          reason: "fixture_not_found",
          details: "No fixture for matchId on date",
        });
        matchEntries.push(entry);
        continue;
      }

      if (!homeTeam || !awayTeam) {
        errors.push({
          matchId,
          reason: "missing_team_name",
          details: "homeTeam or awayTeam missing",
        });
        matchEntries.push(entry);
        continue;
      }

      matchEntries.push(entry);
    }

    const sortedEntries = sortMatchesStable(matchEntries);

    for (const entry of sortedEntries) {
      if (!entry.homeTeam || !entry.awayTeam) continue;

      try {
        const oddsResult = await getUnibetOddsForMatch({
          homeTeam: entry.homeTeam,
          awayTeam: entry.awayTeam,
          leagueName: entry.leagueName,
          timestamp: entry.kickoff,
        });

        entry.eventId = oddsResult?.eventId ?? null;
        const rawTuples = Array.isArray(oddsResult?.tuples)
          ? oddsResult.tuples
          : [];

        entry.tuples = rawTuples
          .map((tuple) => ({
            ...tuple,
            statKey: normalizeStatKey(tuple.statKey),
          }))
          .sort((a, b) => {
            const stat = String(a.statKey).localeCompare(String(b.statKey));
            if (stat !== 0) return stat;
            const scope = String(a.scope).localeCompare(String(b.scope));
            if (scope !== 0) return scope;
            const period = String(a.period).localeCompare(String(b.period));
            if (period !== 0) return period;
            return Number(a.line) - Number(b.line);
          });
      } catch (error) {
        errors.push({
          matchId: entry.matchId,
          reason: "unibet_fetch_failed",
          details: error?.message || "odds fetch failed",
        });
      }
    }

    for (const entry of sortedEntries) {
      if (!entry.homeTeam || !entry.awayTeam) continue;

      try {
        const [homeProfile, awayProfile] = await Promise.all([
          fetchTeamProfilesBundle(entry.homeTeam),
          fetchTeamProfilesBundle(entry.awayTeam),
        ]);

        entry.teamProfiles = {
          home: {
            teamId: entry.homeTeamId ?? null,
            teamName: entry.homeTeam ?? null,
            leagueId: homeProfile?.home?.meta?.ligaId ?? null,
            leagueName: homeProfile?.home?.meta?.leagueName ?? null,
            stats: extractProfileStats(homeProfile?.home),
          },
          away: {
            teamId: entry.awayTeamId ?? null,
            teamName: entry.awayTeam ?? null,
            leagueId: awayProfile?.away?.meta?.ligaId ?? null,
            leagueName: awayProfile?.away?.meta?.leagueName ?? null,
            stats: extractProfileStats(awayProfile?.away),
          },
        };
        entry._teamProfilesRaw = {
          home: homeProfile?.home ?? null,
          away: awayProfile?.away ?? null,
        };
      } catch (error) {
        errors.push({
          matchId: entry.matchId,
          reason: "teamprofiles_failed",
          details: error?.message || "teamprofiles fetch failed",
        });
      }
    }

    const bets = [];
    for (const entry of sortedEntries) {
      for (const tuple of entry.tuples || []) {
        const odds = tuple?.odds || {};
        const directions = [
          { direction: "over", odds: odds.over ?? null },
          { direction: "under", odds: odds.under ?? null },
        ];

        for (const dir of directions) {
          if (!Number.isFinite(dir.odds)) continue;
          const key = buildBetKey({
            matchId: entry.matchId,
            statKey: tuple.statKey,
            scope: tuple.scope,
            period: tuple.period,
            line: tuple.line,
            direction: dir.direction,
          });
          bets.push({
            key,
            matchId: entry.matchId,
            statKey: tuple.statKey,
            scope: tuple.scope,
            period: tuple.period,
            line: tuple.line,
            direction: dir.direction,
            odds: dir.odds,
            homeTeam: entry.homeTeam,
            awayTeam: entry.awayTeam,
            params: {
              homeTeam: entry.homeTeam,
              awayTeam: entry.awayTeam,
              stat: toBacktestStat(tuple.statKey),
              scope: tuple.scope,
              period: tuple.period,
              line: tuple.line,
              over: dir.direction === "over",
              odds: dir.odds,
              form: "all",
              neutralGround: false,
              home_importance: 5,
              away_importance: 5,
            },
          });
        }
      }
    }

    const backtestResults = await runBatchBacktest(bets);
    const backtestByKey = new Map();
    for (const item of backtestResults) {
      backtestByKey.set(item.key, item);
    }

    for (const entry of sortedEntries) {
      const evLines = [];
      for (const tuple of entry.tuples || []) {
        for (const direction of ["over", "under"]) {
          const key = buildBetKey({
            matchId: entry.matchId,
            statKey: tuple.statKey,
            scope: tuple.scope,
            period: tuple.period,
            line: tuple.line,
            direction,
          });
          const result = backtestByKey.get(key);
          if (!result) continue;

          if (result.error) {
            errors.push({
              matchId: entry.matchId,
              reason: "backtest_failed",
              details: result.error,
              statKey: tuple.statKey,
              scope: tuple.scope,
              period: tuple.period,
              line: tuple.line,
              direction,
            });
            continue;
          }

          const payload = result.result || {};
          if (!isPositiveEv(payload)) {
            continue;
          }

          const evCandidates = {
            evPct: payload.evPct ?? null,
            evPctMultifactor: payload.evPctMultifactor ?? null,
            evPctLeagueAvg: payload.evPctLeagueAvg ?? null,
            evPctWithMultiplier: payload.evPctWithMultiplier ?? null,
            evPctUniversalOptimized: payload.evPctUniversalOptimized ?? null,
            legacyEvPct: payload.legacyEvPct ?? null,
          };
          const evValues = Object.values(evCandidates).filter(
            (value) => Number.isFinite(value)
          );
          const evBest = evValues.length ? Math.max(...evValues) : null;

          const hitsInfo =
            direction === "over"
              ? parseHits(payload.hitsOver)
              : parseHits(payload.hitsUnder);

          const opponentConceded =
            tuple.scope === "home"
              ? payload.awayConceded ?? null
              : tuple.scope === "away"
              ? payload.homeConceded ?? null
              : {
                  homeConceded: payload.homeConceded ?? null,
                  awayConceded: payload.awayConceded ?? null,
                };

          evLines.push({
            statKey: tuple.statKey,
            scope: tuple.scope,
            period: tuple.period,
            line: tuple.line,
            direction,
            odds: tuple?.odds?.[direction] ?? null,
            evBest,
            evSources: evCandidates,
            modelProb: payload.modelProb ?? null,
            matches: payload.matches ?? null,
            hitRate: hitsInfo?.hitRate ?? null,
            hits: hitsInfo?.hits ?? null,
            meanFor: payload.meanFor ?? null,
            meanAgainst: payload.meanAgainst ?? null,
            lambda: payload.lambda ?? null,
            opponentConceded: summarizeConceded(opponentConceded),
          });
        }
      }
      entry.evLines = evLines;
    }

    const statKeysNeeded = new Set();
    const periodsNeeded = new Set();
    for (const entry of sortedEntries) {
      for (const row of entry.matchupScores || []) {
        const statKey = normalizeStatKey(row.statKey);
        if (statKey) statKeysNeeded.add(statKey);
        if (row.period) periodsNeeded.add(row.period);
      }
      for (const line of entry.evLines || []) {
        if (line.statKey) statKeysNeeded.add(line.statKey);
        if (line.period) periodsNeeded.add(line.period);
      }
    }

    for (const entry of sortedEntries) {
      if (entry.teamProfiles?.home && entry._teamProfilesRaw?.home) {
        entry.teamProfiles.home.stats = extractProfileStats(
          entry._teamProfilesRaw.home,
          statKeysNeeded,
          periodsNeeded
        );
      }
      if (entry.teamProfiles?.away && entry._teamProfilesRaw?.away) {
        entry.teamProfiles.away.stats = extractProfileStats(
          entry._teamProfilesRaw.away,
          statKeysNeeded,
          periodsNeeded
        );
      }
      delete entry._teamProfilesRaw;
      delete entry.tuples;
    }

    return NextResponse.json(
      {
        date,
        minScore: MIN_SCORE,
        generatedAt: new Date().toISOString(),
        matches: sortedEntries,
        errors,
      },
      {
        headers: {
          "cache-control": CACHE_CONTROL,
        },
      }
    );
  } catch (error) {
    console.error("[api/everything] GET error", error);
    return NextResponse.json(
      { message: "Server error" },
      { status: 500 }
    );
  }
}
