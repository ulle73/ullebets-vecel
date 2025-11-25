import "dotenv/config";
import { MongoClient } from "mongodb";
import { DateTime } from "luxon";
import { computeExpectedValue } from "../lib/backtest/engine.js";
import { findUnibetEventForMatch, UNIBET_EVENT_BASE_URL } from "../lib/backtest/unibetAuto.js";
import mapUnibetOdds from "../components/backtest/unibetOddsMapper.js";
import { getStatPatterns } from "../components/backtest/statPatterns.js";
import { computeHistoryStats } from "../components/backtest/historyCalculator.js";

// Configuration
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "app";
const MATCHUPS_COLLECTION = "matchups-score";
const RESULTS_COLLECTION = "ai-generated-bets";

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI environment variable");
  process.exit(1);
}

// Helper to get today's date in YYYY-MM-DD (Stockholm time)
function getTodayDateString() {
  return DateTime.now().setZone("Europe/Stockholm").toFormat("yyyy-MM-dd");
}

// Helper to fetch Unibet odds (replicated from route.js to avoid Next.js deps)
async function fetchUnibetOdds(eventId) {
  const UNIBET_BASE_URL = "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event";
  const url = `${UNIBET_BASE_URL}/${eventId}.json?lang=sv_SE&market=SE&client_id=2&channel_id=1&includeParticipants=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Unibet request failed with status ${res.status}`);
  }
  return res.json();
}

async function run() {
  let dateStr = process.argv[2];
  if (dateStr && dateStr.startsWith("--date=")) {
    dateStr = dateStr.split("=")[1];
  }
  dateStr = dateStr || getTodayDateString();
  console.log(`Starting AI generation for date: ${dateStr}`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    // 1. Fetch Matchups Candidates
    console.log("Fetching matchups candidates...");
    const matchupsDoc = await db.collection(MATCHUPS_COLLECTION).findOne({ _id: dateStr });

    if (!matchupsDoc || !matchupsDoc.data) {
      console.error(`No matchups data found for ${dateStr}. Ensure matchups-score generation runs first.`);
      process.exit(0);
    }

    const { top50 } = matchupsDoc.data;
    const candidates = [...(top50.over || []), ...(top50.under || [])];
    console.log(`Found ${candidates.length} candidate rows.`);

    // 1b. Fetch Full Match Details (for timestamp and exact names)
    console.log("Fetching full match details...");
    const matchesDoc = await db.collection("match-for-date").findOne({ _id: dateStr });
    const fullMatchesMap = new Map();
    
    if (matchesDoc && matchesDoc.full && matchesDoc.full[0] && matchesDoc.full[0].matches) {
      matchesDoc.full[0].matches.forEach(m => {
        // Map by string ID to ensure matching
        if (m.matchId) fullMatchesMap.set(String(m.matchId), m);
        if (m.id) fullMatchesMap.set(String(m.id), m);
      });
    }
    console.log(`Loaded ${fullMatchesMap.size} full matches for lookup.`);

    // Deduplicate matches
    const uniqueMatches = new Map();
    candidates.forEach(row => {
      if (row.matchId) {
        uniqueMatches.set(row.matchId, row);
      }
    });

    console.log(`Processing ${uniqueMatches.size} unique matches...`);

    const results = [];
    const statPatterns = getStatPatterns((key) => key); // Mock translation function

    for (const [matchId, row] of uniqueMatches) {
      let homeTeamName, awayTeamName, leagueName, matchDate;

      // Try to find full match details
      const fullMatch = fullMatchesMap.get(String(matchId));
      if (fullMatch) {
        homeTeamName = fullMatch.homeTeamName || fullMatch.homeTeam;
        awayTeamName = fullMatch.awayTeamName || fullMatch.awayTeam;
        leagueName = fullMatch.leagueName || fullMatch.league;
        matchDate = fullMatch.timestamp || fullMatch.kickoff || fullMatch.start;
      } else {
        // Fallback to parsing row
        console.warn(`  -> Warning: Full match details not found for ID ${matchId}. Using fallback parsing.`);
        const parts = row.match.split(" vs ");
        homeTeamName = parts[0];
        awayTeamName = parts[1];
        leagueName = row.league;
        // matchDate remains undefined, unibetAuto will skip time check
      }

      console.log(`Processing: ${homeTeamName} vs ${awayTeamName}`);

      try {
        // 2. Find Unibet Event
        const matchInfo = {
          homeTeam: homeTeamName,
          awayTeam: awayTeamName,
          leagueName: leagueName,
          timestamp: new Date(matchDate).getTime(),
        };

        const unibetMatch = await findUnibetEventForMatch(matchInfo);
        if (!unibetMatch) {
          console.warn(`  -> No Unibet event found for ${homeTeamName} vs ${awayTeamName}`);
          continue;
        }

        // 3. Fetch Odds
        const oddsData = await fetchUnibetOdds(unibetMatch.eventId);
        const tuples = mapUnibetOdds(oddsData.betOffers, homeTeamName, awayTeamName);

        if (!tuples.length) {
          console.warn(`  -> No relevant odds found for ${homeTeamName} vs ${awayTeamName}`);
          continue;
        }

        // 4. Run Backtests for each available line
        for (const tuple of tuples) {
          const { statKey, scope, period, line, odds } = tuple;
          
          // Check both over and under if odds exist
          const directions = [];
          if (odds.over) directions.push({ direction: 'over', odds: odds.over });
          if (odds.under) directions.push({ direction: 'under', odds: odds.under });

          for (const { direction, odds: oddsValue } of directions) {
            // Basic filtering: only check lines that match our candidates or high priority stats?
            // For now, let's check everything that has odds, or filter by candidate stats if performance is an issue.
            // To match "AI User" flow, we might want to check everything to find hidden gems.
            
            if (oddsValue <= 1) continue;

            const params = {
              homeTeam: homeTeamName,
              awayTeam: awayTeamName,
              over: direction === 'over',
              line,
              scope,
              stat: statKey,
              period,
              form: "all", // Default form
              odds: oddsValue,
              neutralGround: false, // Default
              home_importance: 5,
              away_importance: 5,
            };

            const evResult = await computeExpectedValue(params);

            if (evResult.evPct > 0 || evResult.evPctMultifactor > 0) {
               // Calculate history for context
               const history = computeHistoryStats({
                homeMatches: evResult.homeMatches,
                awayMatches: evResult.awayMatches,
                statPatterns,
                statKey,
                scope,
                period,
                line,
                formMatches: "all",
                neutralGround: false,
                homeTeam: homeTeamName,
                awayTeam: awayTeamName,
              });

              results.push({
                ...evResult,
                history, // Include history summary
                matchId: matchId,
                unibetEventId: unibetMatch.eventId,
                unibetUrl: `${UNIBET_EVENT_BASE_URL}/${unibetMatch.eventId}`,
                generatedAt: new Date(),
                date: dateStr
              });
            }
          }
        }

      } catch (err) {
        console.error(`  -> Error processing match ${matchId}:`, err.message);
      }
    }

    // 5. Save Results
    if (results.length > 0) {
      console.log(`Saving ${results.length} +EV bets to ${RESULTS_COLLECTION}...`);
      
      // Optional: Clear existing bets for this date to avoid duplicates?
      // await db.collection(RESULTS_COLLECTION).deleteMany({ date: dateStr });

      await db.collection(RESULTS_COLLECTION).insertMany(results);
      console.log("Done!");
    } else {
      console.log("No +EV bets found today.");
    }

  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

run();
