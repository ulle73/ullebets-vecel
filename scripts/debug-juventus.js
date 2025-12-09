/**
 * Debug script to show Juventus away cornerKicks 1ST data
 */
import clientPromise from '../lib/mongo.js';

async function main() {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  
  console.log('🔍 Looking for Juventus away cornerKicks 1ST half data...\n');
  
  // Fetch backtests with Juventus away
  const backtests = await db.collection('unibet-backtest').find({
    awayTeam: { $regex: /juventus/i }
  }).toArray();
  
  console.log(`Found ${backtests.length} Juventus away matches\n`);
  
  const juveData = [];
  
  for (const bt of backtests) {
    if (!bt.lines) continue;
    
    for (const line of bt.lines) {
      if (line.scope === 'away' && 
          line.statKey === 'cornerKicks' && 
          line.period === '1ST' &&
          line.actual != null &&
          line.odds >= 1.5 && line.odds <= 3.0) {
        
        juveData.push({
          homeTeam: bt.homeTeam,
          awayTeam: bt.awayTeam,
          matchDate: bt.matchDate,
          line: line.line,
          actual: line.actual,
          odds: line.odds,
          condition: line.condition,
          deviation: line.actual - line.line
        });
      }
    }
  }
  
  console.log(`Found ${juveData.length} valid 50/50 bets for Juventus away cornerKicks 1ST:\n`);
  
  // Get league average
  const teamprofile = await db.collection('teamprofiles').findOne({
    'meta.lagnamn': { $regex: /^juventus$/i },
    'meta.matchType': 'away'
  });
  
  const leagueAvg = teamprofile?.statistics?.leagueAverage?.for?.cornerKicks?.['1ST']?.value || 
                    teamprofile?.statistics?.leagueAverage?.for?.cornerKicks?.ALL?.value || 0;
  
  console.log(`League average for Juventus away cornerKicks 1ST: ${leagueAvg.toFixed(2)}\n`);
  
  // Calculate stats
  const actuals = juveData.map(d => d.actual);
  const deviations = juveData.map(d => d.deviation);
  const mean = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  
  console.log(`Bias (mean deviation): ${mean.toFixed(2)}`);
  console.log(`Sample size: ${juveData.length}\n`);
  
  // Show each match
  console.log('Match Details:');
  console.log('Date       | Home Team          | Line | Actual | Dev  | < Lg Avg?');
  console.log('-'.repeat(75));
  
  let hitsCount = 0;
  for (const d of juveData) {
    const belowAvg = d.actual < leagueAvg;
    if (belowAvg) hitsCount++;
    
    console.log(
      `${(d.matchDate || 'N/A').substring(0, 10).padEnd(10)} | ` +
      `${d.homeTeam.substring(0, 18).padEnd(18)} | ` +
      `${d.line.toFixed(1).padStart(4)} | ` +
      `${d.actual.toFixed(1).padStart(6)} | ` +
      `${d.deviation >= 0 ? '+' : ''}${d.deviation.toFixed(1).padStart(4)} | ` +
      `${belowAvg ? 'YES ✓' : 'NO  ✗'}`
    );
  }
  
  console.log('-'.repeat(75));
  console.log(`\nHits (actual < league avg): ${hitsCount}/${juveData.length}`);
  console.log(`Expected in output: ${hitsCount}/${juveData.length}\n`);
  
  // Show why this matters
  console.log('INTERPRETATION:');
  console.log(`- Bias is NEGATIVE (${mean.toFixed(2)}), meaning bookies OVERESTIMATE`);
  console.log(`- Juventus averages FEWER corners than bookies expect`);
  console.log(`- Value Edge: BET UNDER on Juventus away 1ST half corners`);
  console.log(`- ${hitsCount}/${juveData.length} matches were below league avg (${leagueAvg.toFixed(2)})`);
}

main().catch(console.error);
