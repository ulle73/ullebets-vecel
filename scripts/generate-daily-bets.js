import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { MongoClient } from "mongodb";
import { DateTime } from "luxon";

// Configuration  
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "app";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const RESULTS_COLLECTION = "ai-generated-bets";

// Helper to get today's date
function getTodayDateString() {
  return DateTime.now().setZone("Europe/Stockholm").toFormat("yyyy-MM-dd");
}

// Combo builder logic (copied from comboBuilder.js to avoid import issues)
function buildCombos(lines = [], options = {}) {
  const {
    legs = 2,
    minOdds = 1.8,
    maxOdds = 2.2,
    maxLines = 32,
    maxCombos = 14,
  } = options;

  const sanitizedLegs = Math.max(1, Math.min(legs, 4));
  const sanitizedMinOdds = Math.max(1, minOdds);
  const sanitizedMaxOdds = Math.max(sanitizedMinOdds, maxOdds);

  const validLines = [...lines]
    .filter((line) => line && line.odds && line.odds > 1)
    .map((line) => ({
      ...line,
      primaryEv: line.primaryEv || 0,
      odds: line.odds || 1,
    }))
    .sort((a, b) => {
      if ((b.primaryEv ?? 0) !== (a.primaryEv ?? 0)) {
        return (b.primaryEv ?? 0) - (a.primaryEv ?? 0);
      }
      return (b.odds ?? 0) - (a.odds ?? 0);
    })
    .slice(0, Math.max(1, maxLines));

  if (!validLines.length) {
    return [];
  }

  const combos = [];
  const seen = new Set();

  const legsTarget = sanitizedLegs === 1 ? 1 : Math.min(sanitizedLegs, validLines.length);

  function recordCombo(candidateLines, totalOdds, totalEv) {
    const key = candidateLines.map((line) => line.betKey).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    combos.push({
      id: key,
      lines: [...candidateLines],
      odds: Number(totalOdds.toFixed(2)),
      totalEv: Number(totalEv.toFixed(2)),
    });
  }

  function canAddLineToCombo(currentLines, candidate) {
    // Same match rule
    for (const existing of currentLines) {
      if (existing.matchId === candidate.matchId) return false;
    }
    return true;
  }

  function walk(start, currentLines, currentOdds, currentEv) {
    if (currentLines.length === legsTarget) {
      if (currentOdds >= sanitizedMinOdds && currentOdds <= sanitizedMaxOdds) {
        recordCombo(currentLines, currentOdds, currentEv);
      }
      return;
    }

    for (let i = start; i < validLines.length; i += 1) {
      if (combos.length >= maxCombos) {
        break;
      }
      const candidate = validLines[i];
      const nextOdds = currentOdds * (candidate.odds || 1);
      if (nextOdds > sanitizedMaxOdds * 1.25) {
        continue;
      }
      if (!canAddLineToCombo(currentLines, candidate)) {
        continue;
      }
      currentLines.push(candidate);
      walk(i + 1, currentLines, nextOdds, currentEv + (candidate.primaryEv || 0));
      currentLines.pop();
    }
  }

  if (legsTarget === 1) {
    validLines.forEach((line) => {
      if (!canAddLineToCombo([], line)) {
        return;
      }
      const totalOdds = line.odds;
      if (totalOdds >= sanitizedMinOdds && totalOdds <= sanitizedMaxOdds) {
        recordCombo([line], totalOdds, line.primaryEv || 0);
      }
    });
  } else {
    walk(0, [], 1, 0);
  }

  combos.sort((a, b) => b.totalEv - a.totalEv);
  return combos.slice(0, maxCombos);
}

async function run() {
  const dateArg = process.argv[2];
  const dateStr = dateArg?.replace("--date=", "") || getTodayDateString();
  
  console.log(`[AI Daily] Starting generation for ${dateStr}`);
  console.log(`[AI Daily] Using API base URL: ${BASE_URL}`);

  try {
    // 1. Fetch matchups-score via API
    console.log("[AI Daily] Fetching matchups...");
    const matchupsRes = await fetch(`${BASE_URL}/api/matchups-score?date=${dateStr}`);
    
    if (!matchupsRes.ok) {
      console.error(`Failed to fetch matchups: ${matchupsRes.status}`);
      process.exit(1);
    }

    const matchupsData = await matchupsRes.json();
    const topOverRows = matchupsData.topOverRows || matchupsData.top50?.over || [];
    const topUnderRows = matchupsData.topUnderRows || matchupsData.top50?.under || [];
    
    // Deduplicate matches
    const uniqueMatches = new Map();
    [...topOverRows, ...topUnderRows].forEach(row => {
      if (row.matchId && !uniqueMatches.has(row.matchId)) {
        uniqueMatches.set(row.matchId, row);
      }
    });

    console.log(`[AI Daily] Found ${uniqueMatches.size} unique matches to process`);

    if (uniqueMatches.size === 0) {
      console.log("[AI Daily] No matches found - exiting");
      return;
    }

    const allBets = [];

    // 2. For each match, get Unibet odds via API
    for (const [matchId, match] of uniqueMatches) {
      const [homeTeamName, awayTeamName] = match.match?.split(" vs ") || [];
      const leagueName = match.league || match.leagueName;
      
      if (!homeTeamName || !awayTeamName) {
        console.warn(`  -> Skipping match ${matchId}: invalid format`);
        continue;
      }
      
      console.log(`[AI Daily] Processing: ${homeTeamName} vs ${awayTeamName}`);
      
      try {
        const oddsRes = await fetch(`${BASE_URL}/api/backtest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'auto-unibet-odds',
            matchId,
            homeTeam: homeTeamName,
            awayTeam: awayTeamName,
            leagueName: leagueName,
            timestamp: match.matchDate,
            startTime: match.matchDate,
          }),
        });

        if (!oddsRes.ok) {
          const errorText = await oddsRes.text();
          console.warn(`  -> Failed to get odds (${oddsRes.status}): ${errorText}`);
          continue;
        }

        const oddsData = await oddsRes.json();
        const tuples = oddsData.odds ? 
          (await import("../components/backtest/unibetOddsMapper.js")).default(oddsData.odds, homeTeamName, awayTeamName) 
          : [];
        
        console.log(`  -> Found ${tuples.length} bet options`);
        
        tuples.forEach(tuple => {
          const { statKey, scope, period, line, odds } = tuple;
          
          if (odds.over && odds.over > 1) {
            allBets.push({
              homeTeam: homeTeamName,
              awayTeam: awayTeamName,
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
              leagueName: leagueName,
            });
          }

          if (odds.under && odds.under > 1) {
            allBets.push({
              homeTeam: homeTeamName,
              awayTeam: awayTeamName,
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
              leagueName: leagueName,
            });
          }
        });

      } catch (err) {
        console.error(`  -> Error: ${err.message}`);
      }
    }

    if (allBets.length === 0) {
      console.log("[AI Daily] No bets to process - exiting");
      return;
    }

    console.log(`[AI Daily] Running batch backtest for ${allBets.length} bets...`);

    // 3. Batch process all bets via API
    const backtestRes = await fetch(`${BASE_URL}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'batch-expected-value',
        bets: allBets,
      }),
    });

    if (!backtestRes.ok) {
      console.error(`Batch backtest failed: ${backtestRes.status}`);
      const errorText = await backtestRes.text();
      console.error(`Error details: ${errorText}`);
      process.exit(1);
    }

    const backtestData = await backtestRes.json();
    const results = Array.isArray(backtestData) ? backtestData : (backtestData.results || []);
    
    // 4. Map +EV results to line format for combo builder
    const allLines = results
      .filter(r => {
        return (r.evPct && r.evPct > 0) || 
               (r.evPctMultifactor && r.evPctMultifactor > 0) || 
               (r.evPctUniversalOptimized && r.evPctUniversalOptimized > 0);
      })
      .map(r => ({
        matchId: r.params.matchId || r.matchId,
        matchLabel: `${r.params.home} vs ${r.params.away}`,
        homeTeamName: r.params.home,
        awayTeamName: r.params.away,
        leagueName: r.leagueName,
        scope: r.params.scope,
        period: r.params.period,
        direction: r.params.over ? 'over' : 'under',
        statKey: r.params.stat,
        odds: r.params.odds,
        line: r.params.line,
        primaryEv: r.evPctUniversalOptimized || r.evPctMultifactor || r.evPct || 0,
        betKey: `${r.params.matchId}_${r.params.stat}_${r.params.line}_${r.params.over ? 'over' : 'under'}`,
        fullResult: r, // Keep full result for saving
      }));
    
    console.log(`[AI Daily] Mapped ${allLines.length} +EV lines`);
    
    // 5. Build combos
    const singles = buildCombos(allLines, {
      legs: 1,
      minOdds: 1.01,
      maxOdds: 10,
      maxLines: 100,
      maxCombos: 50,
    });
    
    const doubles = buildCombos(allLines, {
      legs: 2,
      minOdds: 1.8,
      maxOdds: 3.0,
      maxLines: 100,
      maxCombos: 50,
    });
    
    const triples = buildCombos(allLines, {
      legs: 3,
      minOdds: 2.5,
      maxOdds: 5.0,
      maxLines: 100,
      maxCombos: 50,
    });
    
    const allCombos = [...singles, ...doubles, ...triples];
    
    console.log(`[AI Daily] Built ${singles.length} singles, ${doubles.length} doubles, ${triples.length} triples`);
    console.log(`[AI Daily] Total: ${allCombos.length} combos`);

    // 6. Save to MongoDB
    if (allCombos.length > 0) {
      if (!MONGODB_URI) {
        console.log("[AI Daily] ⚠️  No MONGODB_URI - skipping database save (local test mode)");
        console.log("[AI Daily] Preview of first 3 combos:");
        allCombos.slice(0, 3).forEach((combo, i) => {
          const legsSummary = combo.lines.map(l => `${l.homeTeamName} vs ${l.awayTeamName}`).join(", ");
          console.log(`  ${i+1}. ${combo.lines.length}-leg @ ${combo.odds}: ${legsSummary} (EV: ${combo.totalEv}%)`);
        });
      } else {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        
        try {
          const db = client.db(DB_NAME);
          
          const enrichedCombos = allCombos.map(combo => ({
            ...combo,
            date: dateStr,
            generatedAt: new Date(),
          }));

          await db.collection(RESULTS_COLLECTION).insertMany(enrichedCombos);
          
          console.log(`[AI Daily] ✅ Saved ${enrichedCombos.length} combos to database`);
        } finally {
          await client.close();
        }
      }
    } else {
      console.log("[AI Daily] No combos to save");
    }

    console.log("[AI Daily] Complete!");

  } catch (error) {
    console.error("[AI Daily] Fatal error:", error);
    process.exit(1);
  }
}

run();
