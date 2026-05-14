import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import { getMatchesForDate } from "@/lib/repos/fixtures";
import { getMatch as getTeamstatsMatch } from "@/lib/repos/teamstats";
import { resolveMatchupActualValue } from "@/lib/matchupsOutcome";

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
      .find({ matchDate: date })
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

      // Enrich startTime if missing from betDoc (for legacy data)
      if (!betDoc.startTime && match) {
        const startTimestamp = match.startTimestamp || match.timestamp || match.matchDate;
        if (startTimestamp) {
          betDoc.startTime = String(startTimestamp).length === 10 ? startTimestamp * 1000 : startTimestamp;
        }
      }

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
        // Use saved values from database instead of recalculating
        let actual = line.actual ?? null;
        let outcome = "pending";

        // If we have saved win/loss info, use it
        if (line.win === true) {
          outcome = "win";
        } else if (line.win === false) {
          outcome = "loss";
        } else if (line.outcome) {
          outcome = line.outcome;
        } else {
          // Fallback: try to calculate if no saved data
          const { statKey, scope, period, line: targetLine, direction } = line;

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

          const resolved = resolveMatchupActualValue(fullMatch, {
            statKey,
            period,
            scope,
          });

          if (typeof resolved?.actualValue === "number") {
              actual = resolved.actualValue;

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

        // Normalize teams object to match frontend expectations
        // Frontend expects: teams: { home, away, homeId, awayId }
        const home =
          line?.teams?.home ||
          betDoc.homeTeam ||
          match?.homeTeamName ||
          match?.homeTeam?.name ||
          line.homeTeam;
        const away =
          line?.teams?.away ||
          betDoc.awayTeam ||
          match?.awayTeamName ||
          match?.awayTeam?.name ||
          line.awayTeam;
        const homeId =
          line?.teams?.homeId ||
          line.homeTeamId ||
          betDoc.homeTeamId ||
          match?.homeTeamId ||
          match?.homeTeam?.id ||
          null;
        const awayId =
          line?.teams?.awayId ||
          line.awayTeamId ||
          betDoc.awayTeamId ||
          match?.awayTeamId ||
          match?.awayTeam?.id ||
          null;

        const normalizedLine = {
          ...line,
          actual,
          outcome,
          homeTeamId: homeId,
          awayTeamId: awayId,
          teams: {
            home,
            away,
            homeId,
            awayId,
          },
          startTime: betDoc.startTime,
          snapshots: betDoc.snapshots || [],
        };

        gradedLines.push(normalizedLine);
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
