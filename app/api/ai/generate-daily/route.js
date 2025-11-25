import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import { DateTime } from "luxon";

export const maxDuration = 300; // 5 minutes

/**
 * Daily AI Bet Generation Endpoint
 * 
 * This endpoint replicates the user flow from /ai/user:
 * 1. Fetches matchups-score for today
 * 2. Calls /api/backtest with auto-unibet-odds for each match
 * 3. Calls /api/backtest with batch-expected-value for all bets
 * 4. Saves +EV results to ai-generated-bets collection
 */
export async function POST(request) {
  try {
    const { date } = await request.json().catch(() => ({}));
    const dateStr = date || DateTime.now().setZone("Europe/Stockholm").toFormat("yyyy-MM-dd");
    
    console.log(`[AI Daily] Starting generation for ${dateStr}`);

    // Determine base URL from request
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const host = request.headers.get('host') || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;
    
    console.log(`[AI Daily] Using base URL: ${baseUrl}`);

    // 1. Fetch matchups-score
    const matchupsRes = await fetch(
      `${baseUrl}/api/matchups-score?date=${dateStr}`,
      { cache: 'no-store' }
    );
    
    if (!matchupsRes.ok) {
      return NextResponse.json({ 
        error: "Failed to fetch matchups", 
        date: dateStr 
      }, { status: 500 });
    }

    const matchupsData = await matchupsRes.json();
    const { topOverRows = [], topUnderRows = [] } = matchupsData;
    
    // Deduplicate matches
    const uniqueMatches = new Map();
    [...topOverRows, ...topUnderRows].forEach(row => {
      if (row.matchId && !uniqueMatches.has(row.matchId)) {
        uniqueMatches.set(row.matchId, row);
      }
    });

    console.log(`[AI Daily] Processing ${uniqueMatches.size} unique matches`);

    const allBets = [];

    // 2. For each match, get Unibet odds
    for (const [matchId, match] of uniqueMatches) {
      try {
        // Auto-fetch Unibet odds
        const oddsRes = await fetch(`${baseUrl}/api/backtest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'auto-unibet-odds',
            matchId,
            homeTeam: match.homeTeamName,
            awayTeam: match.awayTeamName,
            leagueName: match.leagueName,
            timestamp: match.matchDate,
            startTime: match.matchDate,
          }),
        });

        if (!oddsRes.ok) {
          console.warn(`[AI Daily] Failed to get odds for ${match.homeTeamName} vs ${match.awayTeamName}`);
          continue;
        }

        const { tuples = [] } = await oddsRes.json();
        
        // Prepare bets for batch processing
        tuples.forEach(tuple => {
          const { statKey, scope, period, line, odds } = tuple;
          
          if (odds.over && odds.over > 1) {
            allBets.push({
              homeTeam: match.homeTeamName,
              awayTeam: match.awayTeamName,
              over: true,
              line,
              scope,
              stat: statKey,
              period,
              form: "all",
              odds: odds.over,
              neutralGround: false,
              home_importance: 5,
              away_importance: 5,
              matchId,
              leagueName: match.leagueName,
            });
          }

          if (odds.under && odds.under > 1) {
            allBets.push({
              homeTeam: match.homeTeamName,
              awayTeam: match.awayTeamName,
              over: false,
              line,
              scope,
              stat: statKey,
              period,
              form: "all",
              odds: odds.under,
              neutralGround: false,
              home_importance: 5,
              away_importance: 5,
              matchId,
              leagueName: match.leagueName,
            });
          }
        });

      } catch (err) {
        console.error(`[AI Daily] Error processing match ${matchId}:`, err.message);
      }
    }

    console.log(`[AI Daily] Running batch backtest for ${allBets.length} bets`);

    // 3. Batch process all bets
    const backtestRes = await fetch(`${baseUrl}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'batch-expected-value',
        bets: allBets,
      }),
    });

    if (!backtestRes.ok) {
      return NextResponse.json({ 
        error: "Batch backtest failed" 
      }, { status: 500 });
    }

    const { results = [] } = await backtestRes.json();
    
    // 4. Filter for +EV bets
    const positiveResults = results.filter(r => 
      r.evPct > 0 || r.evPctMultifactor > 0 || r.evPctUniversalOptimized > 0
    );

    console.log(`[AI Daily] Found ${positiveResults.length} +EV bets`);

    // 5. Save to MongoDB
    if (positiveResults.length > 0) {
      const client = await clientPromise;
      const db = client.db(process.env.MONGODB_DB || "app");
      
      const enrichedResults = positiveResults.map(result => ({
        ...result,
        date: dateStr,
        generatedAt: new Date(),
      }));

      await db.collection("ai-generated-bets").insertMany(enrichedResults);
      
      console.log(`[AI Daily] Saved ${enrichedResults.length} bets to database`);
    }

    return NextResponse.json({
      success: true,
      date: dateStr,
      matchesProcessed: uniqueMatches.size,
      betsAnalyzed: allBets.length,
      positiveResults: positiveResults.length,
    });

  } catch (error) {
    console.error("[AI Daily] Fatal error:", error);
    return NextResponse.json({ 
      error: error.message 
    }, { status: 500 });
  }
}
