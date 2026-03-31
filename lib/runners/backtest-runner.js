import { getMatchesForDateFiltered } from "../engines/fixtures-engine.js";
import { getUnibetOddsForMatch } from "../engines/unibet-engine.js";
import { calculateEvForBet, clearTeamDataCache } from "../engines/ev-engine.js";
import { writeSnapshot } from "../repos/snapshots.js";
import { formatDateInZone, coerceDate } from "../utils/date.js";
import { slugify } from "../core/normalization.js";
import { buildBetKey } from "../core/keys.js";
import { pickPrimaryEvSelection } from "../backtest/primaryEvSelection.js";

const TIME_ZONE = "Europe/Stockholm";
const DEFAULT_FORM = "all";
const DEFAULT_IMPORTANCE = 5;
const DEFAULT_NEUTRAL = false;

// ===== HELPERS =====
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCliArgs(argv) {
  const args = { date: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--date=")) {
      args.date = arg.split("=")[1];
    }
  }
  return args;
}

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
    if (
      key.startsWith("evPct") ||
      key === "legacyEvPct" ||
      key.includes("Ev") ||
      key.startsWith("ml_")
    ) {
      const numericValue = toNumber(value);
      if (numericValue !== null) {
        evDetails[key] = numericValue;
      }
    }
  }
  return evDetails;
}

function resolvePrimaryEvValue(evDetails, context = {}) {
  if (!evDetails) return null;

  const selection = pickPrimaryEvSelection({
    evDetails,
    statKey: context?.statKey ?? "unknown",
    scope: context?.scope ?? "total",
    period: context?.period ?? "ALL",
  });
  return selection.evPct;
}

// ===== CORE LOGIC =====

async function processMatch(match) {
  console.log(`⚽️ Processing ${match.homeTeam} vs ${match.awayTeam}`);
  
  try {
    // Get Unibet odds (engine handles discovery + fetching)
    const oddsResult = await getUnibetOddsForMatch({
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      leagueName: match.leagueName,
      timestamp: match.timestamp || match.matchDate || match.start,
      eventId: match.eventId || match.matchId,
    });
    
    const { tuples, eventId, matched } = oddsResult;
    
    if (!tuples || tuples.length === 0) {
      console.warn("   ⚠️ No odds tuples found - skipping match");
      return null;
    }
    
    // Use canonical names from Unibet matching
    const canonicalHome = matched?.home || match.homeTeam;
    const canonicalAway = matched?.away || match.awayTeam;
    const matchId = match.matchId || match.id || eventId;
    
    console.log(`   ✓ Found ${tuples.length} tuples for event ${eventId}`);
    
    // Process each tuple (both over/under)
    const lines = [];
    for (const tuple of tuples) {
      const { statKey, scope, period, line, odds } = tuple;
      
      for (const direction of ["over", "under"]) {
        const oddValue = odds?.[direction];
        if (!oddValue || !Number.isFinite(oddValue)) continue;
        
        const condition = direction === "over" ? "över" : "under";
        // console.log(`   → ${statKey} ${scope}/${period} ${condition} ${line} @ ${oddValue}`);
        
        try {
          // Calculate EV (engine handles team data caching)
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
          const value = resolvePrimaryEvValue(evDetails, tuple);
          
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
          // console.error(`   ❌ EV calc failed for ${statKey} ${condition} ${line}: ${error.message}`);
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

/**
 * Run the backtest process.
 * 
 * @param {Object} options
 * @param {string} options.type - Snapshot type ("backtest", "closing", "forward")
 * @param {Array<string>} [options.leagues] - Optional league filter
 * @param {number} [options.snapshotLimit] - Number of snapshots to keep
 * @param {string} [options.collection] - MongoDB collection name
 */
export async function runBacktest(options) {
  const {
    type,
    leagues = null,
    snapshotLimit = 20,
    collection = "unibet-backtest"
  } = options;

  if (!type) throw new Error("runBacktest: 'type' is required");

  try {
    const args = parseCliArgs(process.argv);
    const targetDate = args.date || formatDateInZone(new Date(), TIME_ZONE);
    
    console.log(`\n🎯 UNIBET RUNNER: ${type.toUpperCase()}`);
    console.log(`📅 Date: ${targetDate}`);
    if (leagues) {
      console.log(`🏆 Leagues: ${leagues.join(", ")}\n`);
    } else {
      console.log(`🏆 Leagues: ALL\n`);
    }
    
    // Fetch matches
    console.log("📥 Fetching matches...");
    const allMatches = await getMatchesForDateFiltered(targetDate, {
      leagues: leagues,
    });
    
    console.log(`✓ Found ${allMatches.length} matches for ${targetDate}\n`);
    
    if (allMatches.length === 0) {
      console.log("ℹ️ No matches to process. Exiting.");
      process.exit(0);
    }
    
    // Extract necessary fields
    const matchesToProcess = allMatches.map(m => ({
      matchId: m.matchId || m.id || m.event?.id,
      homeTeam: m.homeTeamName || m.homeTeam?.name || m.event?.homeName,
      awayTeam: m.awayTeamName || m.awayTeam?.name || m.event?.awayName,
      leagueName: m.leagueName || m.league?.name || m.tournament?.name,
      matchDate: m.matchDate || m.timestamp || m.start || m.startTimestamp,
      url: m.url, // Pass through URL if available
    }));
    
    // Process matches
    const results = [];
    for (let i = 0; i < matchesToProcess.length; i++) {
      const match = matchesToProcess[i];
      console.log(`\n[${i + 1}/${matchesToProcess.length}]`);

      // For closing odds, skip matches that have already started
      if (type === "closing") {
        const matchTime = coerceDate(match.matchDate || match.timestamp || match.start || match.startTimestamp);
        if (matchTime) {
          const now = new Date();
          if (matchTime <= now) {
            console.log(`⏰ Skipping ${match.homeTeam} vs ${match.awayTeam} - match has already started or is starting now`);
            continue;
          }
        }
      }

      const result = await processMatch(match);
      if (result) {
        results.push(result);
      }

      if (i < matchesToProcess.length - 1) {
        await sleep(500);
      }
    }
    
    console.log(`\n✓ Processed ${results.length}/${matchesToProcess.length} matches successfully\n`);
    
    // Save snapshots
    console.log("💾 Saving snapshots to MongoDB...");
    
    for (const { match, lines } of results) {
      const matchDate = formatDateInZone(match.matchDate || match.start, TIME_ZONE);
      const slug = `${slugify(match.canonicalHome)}-${slugify(match.canonicalAway)}-${matchDate}`;
      
      try {
        await writeSnapshot({
          collection,
          id: slug,
          type,
          date: targetDate,
          lines,
          metadata: {
            slug,
            eventId: match.eventId,
            matchId: match.matchId,
            matchDate,
            url: match.url || `https://www.unibet.se/betting/sports/event/${match.eventId}`,
            league: match.leagueName,
            homeTeam: match.canonicalHome,
            awayTeam: match.canonicalAway,
          },
          snapshotLimit,
        });
        
        console.log(`   ✓ Saved ${slug} (${lines.length} lines)`);
      } catch (error) {
        console.error(`   ❌ Failed to save ${slug}: ${error.message}`);
      }
    }
    
    clearTeamDataCache();
    
    console.log("\n✅ Run complete!\n");
    process.exit(0);
    
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
}
