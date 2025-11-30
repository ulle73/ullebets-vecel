import { NextResponse } from "next/server";

// Core utilities
import { buildBetKey } from "@/lib/core/keys";

// Date utilities
import { todaySE } from "@/lib/utils/date";

// Engines
import { getMatchesForDateFiltered } from "@/lib/engines/fixtures-engine";
import { getUnibetOddsForMatch } from "@/lib/engines/unibet-engine";
import { calculateEvForBets, clearTeamDataCache } from "@/lib/engines/ev-engine";

// Database
import clientPromise from "@/lib/mongo";

// Snapshots
import { writeSnapshot } from "@/lib/repos/snapshots";

// Date utilities
import { formatDateInZone } from "@/lib/utils/date";

// Normalization
import { slugify } from "@/lib/core/normalization";

const SOURCE = "ai-user";

export const maxDuration = 300; // 5 minutes

export async function POST(request) {
  try {
    console.log(`[AI Generate User] API called`);
    const { date } = await request.json().catch(() => ({}));
    const dateStr = date || todaySE();

    console.log(`[AI Generate User] Starting generation for ${dateStr}`);

    // 1. Fetch matches
    const allMatches = await getMatchesForDateFiltered(dateStr);
    console.log(`[AI Generate User] Found ${allMatches.length} matches for ${dateStr}`);

    if (allMatches.length === 0) {
      return NextResponse.json({ error: "No matches found for date" }, { status: 404 });
    }

    // 2. Fetch matchups-score (AI insights)
    const matchupsRes = await fetch(
      `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/matchups-score?date=${dateStr}`,
      { cache: 'no-store' }
    );

    if (!matchupsRes.ok) {
      return NextResponse.json({
        error: "Failed to fetch matchups",
        date: dateStr
      }, { status: 500 });
    }

    const matchupsData = await matchupsRes.json();
    const { top50 } = matchupsData;
    const topOverRows = top50?.over?.slice(0, 50) ?? [];
    const topUnderRows = top50?.under?.slice(0, 50) ?? [];

    console.log(`[AI Generate User] Insights: ${topOverRows.length} over, ${topUnderRows.length} under`);

    // Create match lookup
    const matchLookup = new Map(allMatches.map(m => [String(m.matchId || m.id), m]));

    // 3. Filter AI insights by score > 50 and process each line individually
    const allInsights = [...topOverRows, ...topUnderRows];
    const filteredInsights = allInsights.filter(row => Number(row.score ?? row.normalizedScore ?? 0) > 50);

    console.log(`[AI Generate User] Filtered ${filteredInsights.length} insights with score > 70`);

    // 4. Process each filtered insight line individually
    const allBets = [];

    for (let i = 0; i < filteredInsights.length; i++) {
      const insight = filteredInsights[i];
      const matchId = String(insight.matchId);
      const match = matchLookup.get(matchId);

      if (!match) {
        console.log(`[AI Generate User] Skipping insight ${i + 1}/${filteredInsights.length} - match ${matchId} not found`);
        continue;
      }

      // Extract team and league names
      const homeTeam = match.homeTeamName || match.homeTeam?.name || match.event?.homeName || match.event?.homeTeam?.name;
      const awayTeam = match.awayTeamName || match.awayTeam?.name || match.event?.awayName || match.event?.awayTeam?.name;
      const leagueName = match.leagueName || match.league?.name || match.tournament?.name;

      // Determine direction from insight
      const direction = insight.condition || insight.direction || (insight.over ? 'over' : 'under');
      const over = direction === 'over';

      console.log(`[AI Generate User] Processing [${i + 1}/${filteredInsights.length}] ${homeTeam} vs ${awayTeam} - ${insight.statKey} ${insight.scope}/${insight.period} ${direction} ${insight.line} (score: ${insight.score})`);

      try {
        // Get Unibet odds for this specific match
        const oddsResult = await getUnibetOddsForMatch({
          homeTeam,
          awayTeam,
          leagueName,
          timestamp: match.matchDate,
          eventId: match.matchId,
        });

        const { tuples } = oddsResult;

        // Debug: log insight vs available tuples
        if (tuples.length > 0) {
          console.log(`[AI Generate User] Available tuples (first 3):`, tuples.slice(0, 3).map(t => `${t.statKey} ${t.scope}/${t.period} ${t.line}`));
        }

        // Find the specific tuple that matches this insight
        const matchingTuple = tuples.find(tuple =>
          tuple.statKey === insight.statKey &&
          tuple.scope === insight.scope &&
          tuple.period === insight.period &&
          tuple.line === insight.line
        );

        if (!matchingTuple) {
          console.log(`[AI Generate User] No matching odds found for insight (looking for: ${insight.statKey} ${insight.scope}/${insight.period} ${insight.line})`);
          continue;
        }

        // Get the specific odds for this direction
        const oddsValue = over ? matchingTuple.odds.over : matchingTuple.odds.under;
        if (!oddsValue || oddsValue <= 1) {
          console.log(`[AI Generate User] No valid odds found for direction ${direction}`);
          continue;
        }

        // Calculate EV for this specific bet
        const betParam = {
          homeTeam,
          awayTeam,
          over,
          line: insight.line,
          scope: insight.scope,
          stat: insight.statKey,
          period: insight.period,
          form: "all",
          odds: oddsValue,
          neutralGround: false,
          home_importance: 5,
          away_importance: 5,
          matchId: match.matchId,
          leagueName,
        };

        const evResult = await calculateEvForBet(betParam);

        if (evResult && evResult.value > 0) {
          allBets.push({
            bet: betParam,
            result: evResult,
            match,
            homeTeam,
            awayTeam,
            leagueName,
            insight,
          });
          console.log(`[AI Generate User] ✓ +EV found: ${evResult.value} (${insight.score} score)`);
        } else {
          console.log(`[AI Generate User] ✗ Not +EV: ${evResult?.value || 'N/A'}`);
        }

      } catch (error) {
        console.error(`[AI Generate User] Failed to process insight ${i + 1}:`, error.message);
      }

      // Clear cache every 10 insights
      if ((i + 1) % 10 === 0) {
        clearTeamDataCache();
        console.log(`[AI Generate User] Cleared team data cache (${i + 1}/${filteredInsights.length})`);
      }
    }

    // Final cleanup
    clearTeamDataCache();

    console.log(`[AI Generate User] Found ${allBets.length} +EV bets`);

    if (allBets.length === 0) {
      console.log(`[AI Generate User] No +EV bets found, nothing to save`);
      return NextResponse.json({
        success: true,
        date: dateStr,
        bets: [],
        totalBets: 0,
      });
    }

    // 5. Calculate comboRank for each bet: (matchupScore * 0.7) + (EV * 0.3)
    const betsWithRanking = allBets.map(item => {
      const { insight, result } = item;
      const matchupScore = Number(insight.score ?? insight.normalizedScore ?? 0);
      const evValue = result.value;
      const comboScore = (matchupScore * 0.7) + (evValue * 0.3);

      return {
        ...item,
        matchupScore,
        comboScore,
      };
    });

    // Sort by comboScore descending and assign ranks
    betsWithRanking.sort((a, b) => b.comboScore - a.comboScore);
    betsWithRanking.forEach((item, index) => {
      item.comboRank = index + 1;
    });

    // 6. Save to database in the correct format
    const betDocuments = betsWithRanking.map((item) => {
      const { bet, result, match, homeTeam, awayTeam, leagueName, matchupScore, comboRank } = item;

      // Get the correct matchId
      const matchId = match.matchId || match.id;

      const betKey = buildBetKey({
        matchId,
        homeTeam: bet.homeTeam,
        awayTeam: bet.awayTeam,
        stat: bet.stat,
        scope: bet.scope,
        period: bet.period,
        line: bet.line,
        over: bet.over,
        form: bet.form,
        neutralGround: bet.neutralGround,
      });

      return {
        id: betKey,
        matchId,
        lines: [{
          betKey,
          matchId,
          homeTeamName: homeTeam,
          awayTeamName: awayTeam,
          leagueName,
          statKey: bet.stat,
          scope: bet.scope,
          direction: bet.over ? "over" : "under",
          period: bet.period,
          line: bet.line,
          odds: bet.odds,
          primaryEv: result.value,
          evPct: result.evPct,
          evPctMultifactor: result.evPctMultifactor,
          evPctLeagueAvg: result.evPctLeagueAvg,
          evPctWithMultiplier: result.evPctWithMultiplier,
          evPctUniversalOptimized: result.evPctUniversalOptimized,
          matchupScore,
          actual: null,
          win: null,
        }],
        odds: bet.odds, // Duplicate for frontend compatibility
        totalEv: result.value,
        matchupScore,
        comboRank,
        legs: 1,
        date: dateStr,
        generatedAt: new Date(),
        source: SOURCE,
      };
    });

    // Save to database
    console.log(`[AI Generate User] About to save ${betDocuments.length} bets to database`);
    if (betDocuments.length > 0) {
      try {
        const client = await clientPromise;
        const db = client.db(process.env.MONGODB_DB || "app");
        const collection = db.collection('ai-generated-bets');

        const result = await collection.insertMany(betDocuments);
        console.log(`[AI Generate User] Successfully saved ${result.insertedCount} bets to database`);
      } catch (dbError) {
        console.error(`[AI Generate User] Database save failed:`, dbError.message);
        console.error(`[AI Generate User] Full error:`, dbError);
        // Continue and return bets to frontend even if DB save fails
      }
    } else {
      console.log(`[AI Generate User] No bets to save (betDocuments.length = 0)`);
    }

    // Save snapshots for each match with +EV bets
    console.log(`[AI Generate User] Saving snapshots for ${allBets.length} +EV bets...`);

    // Group bets by match
    const betsByMatch = new Map();
    allBets.forEach(item => {
      const matchId = item.match.matchId || item.match.id;
      if (!betsByMatch.has(matchId)) {
        betsByMatch.set(matchId, {
          match: item.match,
          bets: [],
          homeTeam: item.homeTeam,
          awayTeam: item.awayTeam,
          leagueName: item.leagueName
        });
      }
      betsByMatch.get(matchId).bets.push(item);
    });

    console.log(`[AI Generate User] Grouped into ${betsByMatch.size} matches for snapshots`);

    // Save snapshot for each match
    for (const [matchId, matchData] of betsByMatch) {
      const { match, bets, homeTeam, awayTeam, leagueName } = matchData;

      // Convert bets to snapshot line format
      const lines = bets.map(item => {
        const { bet, result } = item;
        return {
          betKey: buildBetKey({
            matchId,
            homeTeam: bet.homeTeam,
            awayTeam: bet.awayTeam,
            stat: bet.stat,
            scope: bet.scope,
            period: bet.period,
            line: bet.line,
            over: bet.over,
            form: bet.form,
            neutralGround: bet.neutralGround,
          }),
          statKey: bet.stat,
          line: bet.line,
          condition: bet.over ? "över" : "under",
          period: bet.period,
          scope: bet.scope,
          odds: bet.odds,
          value: result.value,
          evDetails: {
            evPct: result.evPct,
            evPctMultifactor: result.evPctMultifactor,
            evPctLeagueAvg: result.evPctLeagueAvg,
            evPctWithMultiplier: result.evPctWithMultiplier,
            evPctUniversalOptimized: result.evPctUniversalOptimized,
          },
          homeTeam,
          awayTeam,
          actual: null,
          win: null,
        };
      });

      const matchDate = formatDateInZone(match.matchDate || match.timestamp || match.start, "Europe/Stockholm");
      const slug = `${slugify(homeTeam)}-${slugify(awayTeam)}-${matchDate}`;

      try {
        await writeSnapshot({
          collection: "ai-generated-bets",
          id: slug,
          type: "ai-user",
          date: dateStr,
          lines,
          metadata: {
            slug,
            eventId: match.eventId || matchId,
            matchId,
            matchDate,
            url: match.url || `https://www.unibet.se/betting/sports/event/${match.eventId || matchId}`,
            league: leagueName,
            homeTeam,
            awayTeam,
          },
          snapshotLimit: 20, // Keep last 20 snapshots
        });

        console.log(`[AI Generate User] ✓ Saved snapshot for ${homeTeam} vs ${awayTeam} (${lines.length} lines)`);
      } catch (error) {
        console.error(`[AI Generate User] ❌ Failed to save snapshot for ${homeTeam} vs ${awayTeam}:`, error.message);
      }
    }

    console.log(`[AI Generate User] Saved snapshots for ${betsByMatch.size} matches`);

    return NextResponse.json({
      success: true,
      date: dateStr,
      bets: betDocuments,
      totalBets: betDocuments.length,
    });

  } catch (error) {
    console.error("[AI Generate User] Fatal error:", error);
    return NextResponse.json({
      error: error.message
    }, { status: 500 });
  }
}
