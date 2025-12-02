import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import { getMatchesForDate } from "@/lib/repos/fixtures";
import { getMatch as getTeamstatsMatch } from "@/lib/repos/teamstats";
import { calcTuple } from "@/lib/backtest/tuples";

export async function POST(request) {
  try {
    const { date } = await request.json();
    if (!date) {
      return NextResponse.json({ error: "Date is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB || "app");

    // 1. Fetch saved bets for the date
    const bets = await db
      .collection("ai-generated-bets")
      .find({ date: date })
      .toArray();

    if (!bets.length) {
      return NextResponse.json({ bets: [] });
    }

    // 2. Extract unique match IDs
    const matchIds = [...new Set(bets.map((b) => String(b.matchId)))];

    // 3. Fetch match data (fixtures)
    // We try to get them from match-for-date first
    const fixtures = await getMatchesForDate(date);
    const fixtureMap = new Map(fixtures.map((m) => [String(m.matchId || m.id), m]));

    // 4. Grade each bet
    const gradedBets = [];

    for (const betDoc of bets) {
      // Each doc might have multiple lines, but usually we save 1 line per doc now?
      // The generate-user route saves: lines: [line] (array of 1)
      // But let's handle if there are multiple lines just in case.
      
      const lines = betDoc.lines || [];
      const matchId = String(betDoc.matchId);
      
      // Get match data
      let match = fixtureMap.get(matchId);

      // If fixture doesn't have stats, try fetching from teamstats
      // We check if we can calculate the tuple. If not, we might need more data.
      // But for now, let's assume fixtures might have it OR we fetch individually if needed.
      // Optimization: Fetch all needed teamstats in parallel if fixtures are missing stats?
      // For now, let's just fetch individually if missing to be safe, or just rely on what we have.
      // Actually, getMatchesForDate might not return full stats.
      // Let's check if we can get the stat.
      
      // We'll try to grade.
      const gradedLines = [];
      
      // We might need to fetch full match data if it's missing from fixture
      // Let's do a lazy fetch if we can't find stats
      let fullMatch = match;
      let fetchedFull = false;

      for (const line of lines) {
        const { statKey, scope, period, line: targetLine, direction } = line;
        
        // Try to calculate actual
        let actual = null;
        let outcome = "pending";

        // We need the match object to have statistics
        // If fullMatch doesn't have statistics, try fetching from teamstats
        if (!fullMatch?.matchDetails?.statistics && !fullMatch?.statistics && !fetchedFull) {
             try {
                const tm = await getTeamstatsMatch(matchId);
                if (tm) {
                    fullMatch = { ...fullMatch, ...tm }; // Merge
                }
                fetchedFull = true;
             } catch (e) {
                 console.error(`Failed to fetch teamstats for ${matchId}`, e);
             }
        }

        const tuple = calcTuple(fullMatch, statKey, period);
        
        if (tuple && tuple[statKey]) {
            // Extract value based on scope
            // scope is usually 'total', 'home', 'away'
            // tuple[statKey] is { home: X, away: Y, total: Z }
            const val = tuple[statKey][scope];
            
            if (typeof val === 'number') {
                actual = val;
                
                // Determine outcome
                if (direction === 'over') {
                    if (actual > targetLine) outcome = "win";
                    else if (actual < targetLine) outcome = "loss";
                    else outcome = "push";
                } else { // under
                    if (actual < targetLine) outcome = "win";
                    else if (actual > targetLine) outcome = "loss";
                    else outcome = "push";
                }
            }
        }

        gradedLines.push({
            ...line,
            actual,
            outcome
        });
      }

      gradedBets.push({
          ...betDoc,
          lines: gradedLines
      });
    }

    return NextResponse.json({ bets: gradedBets });

  } catch (error) {
    console.error("Error in history API:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
