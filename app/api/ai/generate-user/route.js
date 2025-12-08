import { NextResponse } from "next/server";

// Reuse existing engines and backtest logic
import { getMatchesForDateFiltered } from "@/lib/engines/fixtures-engine";
import { getUnibetOddsForMatch } from "@/lib/engines/unibet-engine";
import { calculateEvForBet, clearTeamDataCache } from "@/lib/engines/ev-engine";
import { buildBetKey } from "@/lib/core/keys";

// Database
import clientPromise from "@/lib/mongo";
import { writeSnapshot } from "@/lib/repos/snapshots";

// Constants from backtest-runner
const TIME_ZONE = "Europe/Stockholm";
const DEFAULT_FORM = "all";
const DEFAULT_IMPORTANCE = 5;
const DEFAULT_NEUTRAL = false;

// Helper functions from backtest-runner
function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function collectEvDetails(result) {
  if (!result || typeof result !== "object") return {};

  const evDetails = {};
  for (const [key, value] of Object.entries(result)) {
    // Collect traditional EV formulas + ML formulas (only if they have values)
    if (key.startsWith("evPct") || key === "legacyEvPct" || key.startsWith("ml_")) {
      const numericValue = toNumber(value);
      if (numericValue !== null) {
        evDetails[key] = numericValue;
      }
    }
  }
  return evDetails;
}

function resolvePrimaryEvValue(evDetails) {
  if (!evDetails) return null;

  const preferredOrder = [
    "evPctUniversalOptimized",
    "evPctWithMultiplier",
    "evPctMultifactor",
    "evPctOptaCombined",
    "evPctOptaPlusBase",
    "evPctLeagueAvg",
    "evPct",
    "legacyEvPct",
  ];

  for (const key of preferredOrder) {
    const value = evDetails[key];
    if (typeof value === "number") return value;
  }

  for (const [, value] of Object.entries(evDetails)) {
    if (typeof value === "number") return value;
  }

  return null;
}

function normalizeDirection(value) {
  const raw = String(value ?? "").toLowerCase();
  return raw.startsWith("u") ? "under" : "over";
}

// Process match function (adapted from backtest-runner)
async function processMatchForAI(match, tuples, eventId) {
  console.log(`⚽️ Processing ${match.homeTeam} vs ${match.awayTeam}`);

  try {
    if (!tuples || tuples.length === 0) {
      console.warn("   ⚠️ No odds tuples found - skipping match");
      return null;
    }

    // Use canonical names (same as backtest-runner)
    const canonicalHome = match.homeTeam; // Already extracted
    const canonicalAway = match.awayTeam;
    const matchId = match.matchId || match.id || eventId;

    console.log(`   ✓ Processing ${tuples.length} tuples for event ${eventId}`);

    // Process each tuple (both over/under) - EXACTLY like backtest-runner
    const lines = [];
    for (const tuple of tuples) {
      const { statKey, scope, period, line, odds } = tuple;

      for (const direction of ["over", "under"]) {
        const oddValue = odds?.[direction];
        if (!oddValue || !Number.isFinite(oddValue)) continue;

        const condition = direction === "over" ? "över" : "under";

        try {
          // Calculate EV (engine handles team data caching) - SAME AS BACKTEST-RUNNER
          const result = await calculateEvForBet({
            homeTeam: canonicalHome,
            awayTeam: canonicalAway,
            stat: statKey,
            scope,
            period,
            line,
            over: direction === "over",
            odds: Number(oddValue),
            form: DEFAULT_FORM,
            neutralGround: DEFAULT_NEUTRAL,
            home_importance: DEFAULT_IMPORTANCE,
            away_importance: DEFAULT_IMPORTANCE,
          });

          const evDetails = collectEvDetails(result);
          const value = resolvePrimaryEvValue(evDetails);

          lines.push({
            betKey: buildBetKey({
              matchId,
              homeTeam: canonicalHome,
              awayTeam: canonicalAway,
              stat: statKey,
              scope,
              period,
              line,
              over: direction === "over",
              form: DEFAULT_FORM,
              neutralGround: DEFAULT_NEUTRAL,
            }),
            statKey,
            line,
            condition,
            period,
            scope,
            odds: Number(oddValue),
            value,
            evDetails,
            homeTeam: canonicalHome,
            awayTeam: canonicalAway,
            actual: null,
            win: null,
          });
        } catch (error) {
          // Silent fail like backtest-runner
        }
      }
    }

    if (lines.length === 0) {
      console.warn("   ⚠️ No valid bet lines generated");
      return null;
    }

    console.log(`   ✓ Generated ${lines.length} bet lines`);

    return {
      match: {
        ...match,
        eventId,
        canonicalHome,
        canonicalAway,
      },
      lines,
    };

  } catch (error) {
    console.error(`❌ Failed to process match: ${error.message}`);
    return null;
  }
}

// Step 2: Fetch and filter AI matchups
export async function POST(request) {
  try {
    // Ensure MongoDB connection is ready
    await clientPromise;

    console.log("[AI Generate User] API called - step 2: fetch matchups");

    const { date } = await request.json().catch(() => ({}));
    const dateStr = date || new Date().toISOString().split('T')[0];
    console.log(`[AI Generate User] Processing date: ${dateStr}`);

    // Step 1: Fetch AI matchups
    console.log("[AI Generate User] Fetching AI matchups...");
    const origin = new URL(request.url).origin;
    const matchupsRes = await fetch(`${origin}/api/matchups-score?date=${dateStr}`, {
      cache: 'no-store',
    });

    if (!matchupsRes.ok) {
      throw new Error(`Failed to fetch matchups: ${matchupsRes.status}`);
    }

    const matchupsData = await matchupsRes.json();
    const { top50 } = matchupsData;
    const topOverRows = top50?.over?.slice(0, 50) ?? [];
    const topUnderRows = top50?.under?.slice(0, 50) ?? [];

    console.log(`[AI Generate User] Found ${topOverRows.length} over insights, ${topUnderRows.length} under insights`);

    // Step 2: Filter insights with score > 40
    const allInsights = [...topOverRows, ...topUnderRows];
    const filteredInsights = allInsights.filter(row => Number(row.score ?? row.normalizedScore ?? 0) > 40);

    console.log(`[AI Generate User] Filtered to ${filteredInsights.length} insights with score > 70:`);

    // Log each filtered insight
    filteredInsights.forEach((insight, index) => {
      const direction = normalizeDirection(insight.condition || insight.direction || (insight.over ? 'over' : 'under'));
      console.log(`  ${index + 1}. ${insight.matchId} - ${insight.statKey} ${insight.scope}/${insight.period} ${direction} ${insight.line} (score: ${insight.score})`);
    });

    // Step 3: Get unique matchIds from filtered insights
    const uniqueMatchIds = [...new Set(filteredInsights.map(i => String(i.matchId)))];
    console.log(`[AI Generate User] Found ${uniqueMatchIds.length} unique matches to process`);

    // Step 4: Fetch all matches for the date
    console.log("[AI Generate User] Fetching match data...");
    const allMatches = await getMatchesForDateFiltered(dateStr);
    const matchLookup = new Map(allMatches.map(m => [String(m.matchId || m.id), m]));

    console.log(`[AI Generate User] Found ${allMatches.length} total matches, ${matchLookup.size} in lookup`);

    // Step 5: For each unique matchId, get Unibet odds
    console.log("[AI Generate User] Fetching Unibet odds for matches...");
    const oddsResults = [];

    for (let i = 0; i < uniqueMatchIds.length; i++) {
      const matchId = uniqueMatchIds[i];
      const match = matchLookup.get(matchId);

      if (!match) {
        console.log(`[AI Generate User] Skipping match ${matchId} - not found in fixtures`);
        continue;
      }

      // Extract team and league names (reuse existing logic)
      const homeTeam = match.homeTeamName || match.homeTeam?.name || match.event?.homeName || match.event?.homeTeam?.name;
      const awayTeam = match.awayTeamName || match.awayTeam?.name || match.event?.awayName || match.event?.awayTeam?.name;
      const leagueName = match.leagueName || match.league?.name || match.tournament?.name;
      const homeTeamId = match.homeTeamId || match.homeTeam?.id || match.event?.homeTeamId || match.event?.homeTeam?.id;
      const awayTeamId = match.awayTeamId || match.awayTeam?.id || match.event?.awayTeamId || match.event?.awayTeam?.id;

      console.log(`[AI Generate User] Processing match [${i + 1}/${uniqueMatchIds.length}]: ${homeTeam} vs ${awayTeam} (${leagueName})`);

      try {
        // Reuse existing engine to get Unibet odds
        const oddsResult = await getUnibetOddsForMatch({
          homeTeam,
          awayTeam,
          leagueName,
          timestamp: match.matchDate,
          eventId: match.matchId,
        });

        const { tuples, eventId } = oddsResult;
        console.log(`[AI Generate User] ✓ Found ${tuples.length} odds tuples for event ${eventId}`);

        oddsResults.push({
          matchId,
          homeTeam,
          awayTeam,
          homeTeamId,
          awayTeamId,
          leagueName,
          eventId,
          tuplesCount: tuples.length,
          tuples: tuples // All tuples needed for matching
        });

      } catch (error) {
        console.error(`[AI Generate User] ❌ Failed to get odds for ${homeTeam} vs ${awayTeam}:`, error.message);
        oddsResults.push({
          matchId,
          homeTeam,
          awayTeam,
          error: error.message
        });
      }
    }

    console.log(`[AI Generate User] Completed odds fetching for ${oddsResults.length} matches`);

    // Step 6: Filter odds tuples to only those matching AI insights, then run EV calculation
    console.log(`[AI Generate User] Filtering odds tuples to match AI insights...`);

    // Create a map of insight requirements: matchId -> Set of "statKey-scope-period-direction" keys
    const insightRequirements = new Map();
    filteredInsights.forEach(insight => {
      const matchId = String(insight.matchId);
      const direction = normalizeDirection(insight.condition || insight.direction || (insight.over ? 'over' : 'under'));
      const key = `${insight.statKey}-${insight.scope}-${insight.period}-${direction}`;

      if (!insightRequirements.has(matchId)) {
        insightRequirements.set(matchId, new Set());
      }
      insightRequirements.get(matchId).add(key);
    });

    console.log(`[AI Generate User] Created insight requirements for ${insightRequirements.size} matches`);

    const evResults = [];

    for (let i = 0; i < oddsResults.length; i++) {
      const oddsResult = oddsResults[i];

      if (!oddsResult.tuples) {
        console.log(`[AI Generate User] Skipping match ${oddsResult.matchId} - no tuples`);
        continue;
      }

      const matchRequirements = insightRequirements.get(String(oddsResult.matchId));
      if (!matchRequirements) {
        console.log(`[AI Generate User] Skipping match ${oddsResult.matchId} - no AI insights`);
        continue;
      }

      console.log(`[AI Generate User] Processing match [${i + 1}/${oddsResults.length}]: ${oddsResult.homeTeam} vs ${oddsResult.awayTeam} (${matchRequirements.size} required insights)`);

      // Filter tuples to only those matching AI insights
      const relevantTuples = [];
      for (const tuple of oddsResult.tuples) {
        for (const dir of ["over", "under"]) {
          const oddsValue = tuple?.odds?.[dir];
          if (!Number.isFinite(oddsValue)) continue;
          const key = `${tuple.statKey}-${tuple.scope}-${tuple.period}-${dir}`;
          const hasMatch = matchRequirements.has(key);

          if (tuple.statKey === 'throwIns' && tuple.scope === 'total' && tuple.period === '1ST') {
            console.log(`[AI Generate User] Debug throwIns: key=${key}, hasMatch=${hasMatch}, requirements=${Array.from(matchRequirements).join(', ')}`);
          }

          if (hasMatch) {
            relevantTuples.push({ ...tuple, direction: dir, oddsValue });
          }
        }
      }

      console.log(`[AI Generate User] Found ${relevantTuples.length} relevant tuples out of ${oddsResult.tuples.length}`);

      if (relevantTuples.length === 0) {
        console.log(`[AI Generate User] No relevant tuples for match ${oddsResult.matchId}`);
        continue;
      }

      // Process each relevant tuple individually
      for (const tuple of relevantTuples) {
        const direction = tuple.direction;
        const oddsValue = tuple.oddsValue;

        if (!oddsValue || oddsValue <= 1) continue;

        const betParam = {
          homeTeam: oddsResult.homeTeam,
          awayTeam: oddsResult.awayTeam,
          over: direction === 'over',
          line: tuple.line,
          scope: tuple.scope,
          stat: tuple.statKey,
          period: tuple.period,
          form: "all",
          odds: oddsValue,
          neutralGround: false,
          home_importance: 5,
          away_importance: 5,
          matchId: oddsResult.matchId,
          leagueName: oddsResult.leagueName,
        };

        try {
          const evResult = await calculateEvForBet(betParam);
          const evDetails = collectEvDetails(evResult);

          // Find the corresponding insight for matchupScore
          const insight = filteredInsights.find(i => {
            const insightDirection = normalizeDirection(i.condition || i.direction || (i.over ? 'over' : 'under'));
            return (
              String(i.matchId) === String(oddsResult.matchId) &&
              i.statKey === tuple.statKey &&
              i.scope === tuple.scope &&
              i.period === tuple.period &&
              insightDirection === direction
            );
          });

          const matchupScore = insight ? Number(insight.score ?? insight.normalizedScore ?? 0) : 0;

          // Save ALL results (both +EV and -EV) for database storage
          evResults.push({
            bet: betParam,
            result: evResult,
            evDetails: evDetails,
          match: {
            matchId: oddsResult.matchId,
            eventId: oddsResult.eventId,
            homeTeam: oddsResult.homeTeam,
            awayTeam: oddsResult.awayTeam,
            homeTeamId: oddsResult.homeTeamId,
            awayTeamId: oddsResult.awayTeamId,
            leagueName: oddsResult.leagueName,
          },
            insight,
            matchupScore,
          });

          const evValue = evResult?.value ?? 0;
          const evSign = evValue >= 0 ? '+' : '';
          console.log(`[AI Generate User] ${evValue >= 0 ? '✓' : '✗'} EV ${evSign}${evValue.toFixed(3)} for ${tuple.statKey} ${tuple.scope}/${tuple.period} ${direction} ${tuple.line} @ ${oddsValue} (score: ${matchupScore})`);

        } catch (error) {
          console.error(`[AI Generate User] EV calculation failed for ${tuple.statKey}:`, error.message);
        }
      }

      // Clear cache every 5 matches
      if ((i + 1) % 5 === 0) {
        clearTeamDataCache();
        console.log(`[AI Generate User] Cleared team data cache (${i + 1}/${oddsResults.length})`);
      }
    }

    // Cleanup
    clearTeamDataCache();

    console.log(`[AI Generate User] EV calculation complete: ${evResults.length} results (${evResults.filter(r => r.result?.value > 0).length} +EV, ${evResults.filter(r => r.result?.value <= 0).length} -EV)`);

    // Step 8: Calculate combo scores and rankings
    console.log(`[AI Generate User] Calculating combo scores and rankings...`);

    // Calculate comboScore for each result: (matchupScore × 0.7) + (EV × 0.3)
    const resultsWithRanking = evResults.map(result => {
      const evValue = result.result?.value ?? 0;
      const comboScore = (result.matchupScore * 0.7) + (evValue * 0.3);
      return {
        ...result,
        comboScore,
      };
    });

    // Sort by comboScore (highest first)
    resultsWithRanking.sort((a, b) => b.comboScore - a.comboScore);

    // Assign comboRank (1 = best, 2 = next best, etc.)
    resultsWithRanking.forEach((result, index) => {
      result.comboRank = index + 1;
    });

    console.log(`[AI Generate User] Assigned rankings: #1 score ${resultsWithRanking[0]?.comboScore?.toFixed(3)}, #${resultsWithRanking.length} score ${resultsWithRanking[resultsWithRanking.length - 1]?.comboScore?.toFixed(3)}`);

    // Keep all ranked lines (not just best per match) so UI can show alla bra spel
    const selectedResults = resultsWithRanking;

    // Step 9: Save EACH line as its own snapshot document (one line per doc)
    let snapshotsSaved = 0;
    const betDocuments = []; // for response payload

    for (const result of selectedResults) {
      const { bet, result: evResult, evDetails, match, comboRank, comboScore, matchupScore } = result;
      const betKey = buildBetKey({
        matchId: match.matchId,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        stat: bet.stat,
        scope: bet.scope,
        period: bet.period,
        line: bet.line,
        over: bet.over,
        form: "all",
        neutralGround: false,
      });

      const line = {
        betKey,
        matchId: match.matchId,
        statKey: bet.stat,
        scope: bet.scope,
        period: bet.period,
        direction: bet.over ? "over" : "under",
        line: bet.line,
        odds: bet.odds,
        primaryEv: evResult?.value ?? 0,
        // Include all EV formula results dynamically
        ...evDetails,
        matchupScore,
        comboScore,
        comboRank,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        actual: null,
        win: null,
      };

      betDocuments.push({
        matchId: match.matchId,
        eventId: match.eventId,
        league: match.leagueName,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        betKey,
        lines: [line],
        totalEv: evResult?.value ?? 0,
        matchupScore,
        comboRank,
        comboScore,
        date: dateStr,
        generatedAt: new Date(),
        source: "ai-user",
        type: "ai-user",
      });

      // Snapshot per line, stable id for tracking odds changes
      const snapshotId = betKey.toLowerCase().replace(/[^a-z0-9]+/g, "-");

      // Calculate horizonDays (days until match)
      let horizonDays = 0;
      try {
        const matchDate = new Date(dateStr);
        const now = new Date();
        const diffTime = matchDate.getTime() - now.getTime();
        horizonDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      } catch (error) {
        console.warn(`[AI Generate User] Could not calculate horizonDays for ${match.matchId}`);
      }

      try {
        await writeSnapshot({
          collection: "ai-generated-bets",
          id: snapshotId,
          type: "ai-user",
          date: dateStr,
          lines: [line],
          metadata: {
            eventId: match.eventId,
            matchId: match.matchId,
            matchDate: dateStr, // run date as match date placeholder
            league: match.leagueName,
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            homeTeamId: match.homeTeamId,
            awayTeamId: match.awayTeamId,
            totalBets: 1,
            aiInsightsUsed: 1,
            horizonDays,
            source: "ai-user",
            type: "ai-user",
          },
          snapshotLimit: 20,
        });
        snapshotsSaved += 1;
      } catch (error) {
        console.error(`[AI Generate User] ❌ Failed to save snapshot for ${betKey}:`, error.message);
      }
    }

    // Detailed logging of top results
    if (resultsWithRanking.length > 0) {
      console.log(`\n🏆 Top 10 AI Generated Bets:`);
      resultsWithRanking.slice(0, 10).forEach((result, index) => {
        const { bet, result: evResult, match, matchupScore, comboScore, comboRank } = result;
        console.log(`  #${comboRank}. ${match.homeTeam} vs ${match.awayTeam} - ${bet.stat} ${bet.scope}/${bet.period} ${bet.over ? 'over' : 'under'} ${bet.line} @ ${bet.odds} → EV: ${(evResult?.value ?? 0).toFixed(3)}, Score: ${matchupScore}, Combo: ${comboScore.toFixed(3)}`);
      });
      console.log(``);
    }

    // Prepare lightweight payload for frontend consumption (alla linor)
    const betsPayload = selectedResults.map(result => {
      const { bet, match, result: evResult, comboRank, comboScore, matchupScore } = result;
      const teamHistory = bet.scope === "away" ? evResult?.awayHistory : evResult?.homeHistory;
      const opponentHistory = bet.scope === "away" ? evResult?.homeHistory : evResult?.awayHistory;
      const backtestPayload = {
        ...evResult,
        teamStats: {
          avg: evResult?.meanFor,
          history: Array.isArray(teamHistory) ? teamHistory : [],
        },
        opponentStats: {
          avgConceded: evResult?.meanAgainst,
          history: Array.isArray(opponentHistory) ? opponentHistory : [],
        },
      };
      const line = {
        matchId: match.matchId,
        statKey: bet.stat,
        scope: bet.scope,
        period: bet.period,
        direction: bet.over ? "over" : "under",
        line: bet.line,
        odds: bet.odds,
        primaryEv: evResult?.value ?? 0,
        evPct: evResult?.evPct ?? null,
        evPctMultifactor: evResult?.evPctMultifactor ?? null,
        evPctLeagueAvg: evResult?.evPctLeagueAvg ?? null,
        evPctWithMultiplier: evResult?.evPctWithMultiplier ?? null,
        evPctUniversalOptimized: evResult?.evPctUniversalOptimized ?? null,
        legacyEvPct: evResult?.legacyEvPct ?? null,
        matchupScore,
        comboScore,
        comboRank,
        matchLabel: `${match.homeTeam} vs ${match.awayTeam}`,
        teams: { home: match.homeTeam, away: match.awayTeam, homeId: match.homeTeamId, awayId: match.awayTeamId },
        backtest: backtestPayload,
        betKey: buildBetKey({
          matchId: match.matchId,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          stat: bet.stat,
          scope: bet.scope,
          period: bet.period,
          line: bet.line,
          over: bet.over,
          form: "all",
          neutralGround: false,
        }),
        leagueName: match.leagueName,
      };

      return {
        matchId: match.matchId,
        lines: [line],
        eventId: match.eventId,
        league: match.leagueName,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
      };
    });

    // Step 11: Return results
    return NextResponse.json({
      success: true,
      message: `Processed ${filteredInsights.length} insights from ${oddsResults.length} matches, saved ${selectedResults.length} bet lines to database`,
      date: dateStr,
      insightsCount: filteredInsights.length,
      matchesCount: oddsResults.length,
      totalBetsSaved: selectedResults.length,
      topComboScore: resultsWithRanking[0]?.comboScore ?? 0,
      snapshotsSaved,
      matchIdsProcessed: uniqueMatchIds,
      bets: betsPayload,
      topBets: resultsWithRanking.slice(0, 5).map(result => ({
        rank: result.comboRank,
        comboScore: result.comboScore,
        matchupScore: result.matchupScore,
        ev: result.result?.value ?? 0,
        bet: `${result.match.homeTeam} vs ${result.match.awayTeam} - ${result.bet.stat} ${result.bet.scope}/${result.bet.period} ${result.bet.over ? 'over' : 'under'} ${result.bet.line} @ ${result.bet.odds}`
      }))
    });

  } catch (error) {
    console.error("[AI Generate User] Error:", error);
    return NextResponse.json({
      error: error.message
    }, { status: 500 });
  }
}
