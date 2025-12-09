/**
 * Odds Skew Analysis Script
 * 
 * Analyzes systematic pricing errors in bookmaker 50/50 prop bet lines.
 * Identifies which teams are consistently mispriced (over/underestimated).
 * 
 * Output:
 * - Console: Top 20 results by relative bias
 * - JSON: Full results for all team/prop/period combinations
 */

import fs from 'fs/promises';
import path from 'path';
import clientPromise from '../lib/mongo.js';

// ==================== CONFIG ====================
const BACKTESTS_DIR = "C:\\Users\\ryd\\OneDrive\\Skrivbord\\FRONTEND\\bet365\\UNIBET\\unibet-backtests";
const MIN_SAMPLE_SIZE = 5;
const ODDS_MIN = 1.5;  // 50/50 odds range
const ODDS_MAX = 3.0;

const PROPS = ['totalShots', 'shotsOnGoal', 'cornerKicks', 'offsides', 'fouls', 'yellowCards'];
const PERIODS = ['ALL', '1ST', '2ND'];
const SCOPES = ['home', 'away']; // Exclude 'total' initially

// Stat key mapping for league averages
const STAT_KEY_MAP = {
  totalShots: 'totalShotsOnGoal',
  shotsOnGoal: 'shotsOnGoal',
  cornerKicks: 'cornerKicks',
  yellowCards: 'yellowCards',
  throwIns: 'throwIns',
  freeKicks: 'freeKicks',
  fouls: 'fouls',
  offsides: 'offsides',
  goalKicks: 'goalKicks'
};

// ==================== DISK FILE LOADING ====================

function parseTimestampFromFile(file) {
  const name = path.basename(file, ".json");
  const match = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d+)Z$/);
  if (!match) return null;
  const [, date, hh, mm, ss, ms] = match;
  const iso = `${date}T${hh}:${mm}:${ss}.${ms}Z`;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

async function collectFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await collectFiles(full)));
      } else if (entry.name.endsWith(".json")) {
        files.push(full);
      }
    }
    return files;
  } catch (err) {
    console.warn(`⚠️  Could not read disk directory: ${err.message}`);
    return [];
  }
}

async function loadBacktestsFromDisk() {
  console.log(`\n📂 Loading backtests from disk: ${BACKTESTS_DIR}`);
  const files = await collectFiles(BACKTESTS_DIR);
  console.log(`   Found ${files.length} JSON files`);
  
  const backtests = [];
  for (const file of files) {
    const txt = await fs.readFile(file, "utf-8");
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (err) {
      continue;
    }
    
    // Extract lines and metadata
    const lines = Array.isArray(parsed) ? parsed : parsed.lines || [];
    const timestamp = parseTimestampFromFile(file);
    const homeTeam = parsed.homeTeam || parsed.metadata?.homeTeam || 'Unknown';
    const awayTeam = parsed.awayTeam || parsed.metadata?.awayTeam || 'Unknown';
    
    backtests.push({ 
      lines, 
      timestamp, 
      homeTeam,
      awayTeam,
      source: 'disk'
    });
  }
  
  console.log(`   ✅ Loaded ${backtests.length} backtests from disk\n`);
  return backtests;
}

// ==================== DATA PROCESSING ====================

function buildTeamDataStructure(teamprofiles, props, periods) {
  const teamData = {};
  const nameToData = {};
  
  for (const profile of teamprofiles) {
    const teamId = profile.meta.lagId;
    const matchType = profile.meta.matchType; // 'home' or 'away'
    const teamName = profile.meta.lagnamn;
    
    if (!nameToData[teamName]) {
      nameToData[teamName] = { id: teamId, name: teamName, leagueAvgs: {} };
    }
    nameToData[teamName].leagueAvgs[matchType] = profile.statistics.leagueAverage.for;
    
    if (!teamData[teamId]) {
      teamData[teamId] = { name: teamName, types: {} };
    }
    
    if (!teamData[teamId].types[matchType]) {
      teamData[teamId].types[matchType] = { 
        props: {},
        profile: profile // Store reference to teamprofile for history access
      };
      for (const prop of props) {
        teamData[teamId].types[matchType].props[prop] = { periods: {} };
        for (const period of periods) {
          teamData[teamId].types[matchType].props[prop].periods[period] = {
            deviations: [],
            actuals: [],
            wins: 0,
            losses: 0,
            lines: []
          };
        }
      }
    }
  }
  
  return { teamData, nameToData };
}

function processBacktests(backtests, teamData, nameToData) {
  console.log(`\n📊 Processing backtests for 50/50 odds analysis...`);
  
  let totalBets = 0;
  let filteredBets = 0;
  let processedBets = 0;
  let matchesProcessed = 0;
  
  for (const backtest of backtests) {
    if (!backtest.lines || !Array.isArray(backtest.lines)) continue;
    
    let hasValidBets = false;
    
    for (const line of backtest.lines) {
      totalBets++;
      
      // Must have actual value (completed match)
      if (line.actual == null) continue;
      
      // Filter for 50/50 odds
      if (line.odds < ODDS_MIN || line.odds > ODDS_MAX) continue;
      
      // Filter for target props
      if (!PROPS.includes(line.statKey)) continue;
      
      // Filter for target scopes
      if (!SCOPES.includes(line.scope)) continue;
      
      filteredBets++;
      
      const deviation = line.actual - line.line;
      const period = line.period || 'ALL';
      
      let teamName = null;
      let matchType = null;
      
      if (line.scope === 'home') {
        teamName = line.homeTeam || backtest.homeTeam;
        matchType = 'home';
      } else if (line.scope === 'away') {
        teamName = line.awayTeam || backtest.awayTeam;
        matchType = 'away';
      }
      
      if (!teamName || !matchType) continue;
      
      const teamInfo = nameToData[teamName];
      if (!teamInfo) continue;
      
      const periodData = teamData[teamInfo.id]?.types[matchType]?.props[line.statKey]?.periods[period];
      if (!periodData) continue;
      
      // Store data
      periodData.deviations.push(deviation);
      periodData.actuals.push(line.actual);
      periodData.lines.push(line.line);
      
      const isOver = line.condition === 'över' || line.condition === 'over';
      const won = isOver ? deviation > 0 : deviation < 0;
      
      if (won) {
        periodData.wins++;
      } else if (deviation !== 0) {
        periodData.losses++;
      }
      
      processedBets++;
      hasValidBets = true;
    }
    
    if (hasValidBets) {
      matchesProcessed++;
    }
  }
  
  console.log(`   Total bets examined: ${totalBets}`);
  console.log(`   Filtered to 50/50 odds (${ODDS_MIN}-${ODDS_MAX}): ${filteredBets}`);
  console.log(`   Processed with complete data: ${processedBets}`);
  console.log(`   Matches with valid data: ${matchesProcessed}\n`);
  
  return { processedBets, matchesProcessed };
}

// ==================== STATISTICAL ANALYSIS ====================

function calculateStatistics(teamData, nameToData) {
  console.log(`📈 Calculating statistical biases...\n`);
  
  const results = [];
  let calculationCount = 0;
  
  for (const teamId in teamData) {
    const team = teamData[teamId];
    
    for (const type in team.types) {
      for (const prop of PROPS) {
        for (const period of PERIODS) {
          const periodData = team.types[type].props[prop].periods[period];
          const deviations = periodData.deviations;
          
          if (deviations.length < MIN_SAMPLE_SIZE) continue;
          
          const n = deviations.length;
          const wins = periodData.wins;
          const losses = periodData.losses;
          const winPct = (wins / n) * 100;
          
          // Calculate bias (mean deviation)
          const mean = deviations.reduce((a, b) => a + b, 0) / n;
          
          // Calculate standard deviation
          const variance = deviations.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n;
          const std = Math.sqrt(variance);
          
          // Calculate skewness
          const skewness = std > 0 
            ? deviations.reduce((sum, x) => sum + Math.pow((x - mean) / std, 3), 0) / n 
            : 0;
          
          // Get league average for this prop
          const statKey = STAT_KEY_MAP[prop] || prop;
          const leagueAvgData = nameToData[team.name]?.leagueAvgs?.[type]?.[statKey]?.[period];
          const leagueAvg = leagueAvgData?.value || leagueAvgData?.ALL?.value || 1;
          
          // Relative bias as percentage of league average
          const relBias = (mean / leagueAvg) * 100;
          
          // Value edge direction
          const valueEdge = mean > 0 ? 'Over' : 'Under';
          
          // HITS: From teamprofile history - last 10 matches
          const profile = teamData[teamId].types[type].profile;
          const historyRaw = profile?.statistics?.for?.[statKey]?.[period]?.history || [];
          
          // Extract values from history objects (use 'val' property)
          const history = historyRaw.map(item => {
            return typeof item === 'object' ? (item.val ?? 0) : item;
          });
          
          // Take last 10 matches from history
          const last10 = history.slice(-10);
          
          // Count hits based on value edge direction
          let hits = 0;
          let hitsTotal = last10.length;
          
          if (valueEdge === 'Over') {
            // Count how many times actual > league avg
            hits = last10.filter(val => val > leagueAvg).length;
          } else {
            // Count how many times actual < league avg  
            hits = last10.filter(val => val < leagueAvg).length;
          }
          
          // Calculate confidence and quality score
          const confidence = hitsTotal > 0 ? (hits / hitsTotal) * 100 : 0;
          const qualityScore = Math.abs(relBias) * (hits / Math.max(hitsTotal, 1));
          
          // Average line
          const avgLine = periodData.lines.reduce((a, b) => a + b, 0) / n;
          
          results.push({
            team: team.name,
            type,
            prop,
            period,
            count: n,
            bias: mean,
            relBias,
            std,
            skewness,
            winPct,
            wins,
            losses,
            hits,
            hitsTotal,
            confidence,
            qualityScore,
            leagueAvg,
            avgLine,
            valueEdge
          });
          
          calculationCount++;
        }
      }
    }
  }
  
  console.log(`   ✅ Calculated statistics for ${calculationCount} team/prop/period combinations\n`);
  
  return results;
}

// ==================== OUTPUT ====================

function displayTop20Results(results) {
  // Sort by quality score (best edges = high bias + high confidence)
  const sorted = [...results].sort((a, b) => b.qualityScore - a.qualityScore);
  
  console.log(`\n${'='.repeat(182)}`);
  console.log(`🎯 TOP 20 BEST QUALITY EDGES (sorted by Quality Score = |Bias%| × Confidence)`);
  console.log(`${'='.repeat(182)}\n`);
  
  // Header
  const header = [
    'Team'.padEnd(25),
    'Type'.padEnd(6),
    'Prop'.padEnd(15),
    'Per'.padEnd(4),
    'N'.padStart(4),
    'Bias'.padStart(7),
    'Rel%'.padStart(7),
    'Conf%'.padStart(6),
    'Q-Score'.padStart(8),
    'Win%'.padStart(5),
    'Hits (Lg Avg)'.padStart(14),
    'Edge'
  ].join(' | ');
  
  console.log(header);
  console.log('-'.repeat(182));
  
  // Top 20 rows
  for (let i = 0; i < Math.min(20, sorted.length); i++) {
    const r = sorted[i];
    
    // Format hits with league average: X/Total (Lg Avg)
    const hitsStr = r.hitsTotal > 0 
      ? `${r.hits}/${r.hitsTotal} (${r.leagueAvg.toFixed(1)})` 
      : 'N/A';
    
    const row = [
      r.team.substring(0, 25).padEnd(25),
      r.type.padEnd(6),
      r.prop.padEnd(15),
      r.period.padEnd(4),
      String(r.count).padStart(4),
      r.bias.toFixed(2).padStart(7),
      r.relBias.toFixed(1).padStart(7),
      r.confidence.toFixed(0).padStart(6),
      r.qualityScore.toFixed(1).padStart(8),
      r.winPct.toFixed(1).padStart(5),
      hitsStr.padStart(14),
      r.valueEdge
    ].join(' | ');
    
    console.log(row);
  }
  
  console.log(`\n${'='.repeat(182)}\n`);
  console.log(`📊 Column Explanations:`);
  console.log(`   Conf% = Confidence (hits/10 as %). Higher = recent trend supports the edge`);
  console.log(`   Q-Score = Quality Score (|Rel%| × Conf%). Higher = stronger + more consistent edge`);
  console.log(`   Hits (Lg Avg) = Last 10 matches beating trend / Total (League Average for comparison)`);
  console.log(`\n💡 Focus on high Q-Score for best opportunities!\n`);
}

function displayExampleCalculations(results, teamData, nameToData) {
  console.log(`\n📝 TOP 10 BEST QUALITY EDGES BY DIRECTION:\n`);
  
  // Split by edge direction
  const overEdges = results.filter(r => r.valueEdge === 'Over').sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 10);
  const underEdges = results.filter(r => r.valueEdge === 'Under').sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 10);
  
  // Display Over edges
  console.log('🔼 TOP 10 OVER EDGES:\n');
  console.log('Rank | Team (Type)               | Prop         | Period | Q-Score | Conf% |   Rel% ');
  console.log('-'.repeat(90));
  
  overEdges.forEach((r, i) => {
    const team = `${r.team} (${r.type})`.substring(0, 25).padEnd(25);
    const rank = String(i + 1).padStart(4);
    console.log(`${rank} | ${team} | ${r.prop.padEnd(12)} | ${r.period.padEnd(6)} | ${r.qualityScore.toFixed(1).padStart(7)} | ${r.confidence.toFixed(0).padStart(5)} | ${r.relBias.toFixed(1).padStart(6)}`);
  });
  
  // Display Under edges
  console.log('\n🔽 TOP 10 UNDER EDGES:\n');
  console.log('Rank | Team (Type)               | Prop         | Period | Q-Score | Conf% |   Rel% ');
  console.log('-'.repeat(90));
  
  underEdges.forEach((r, i) => {
    const team = `${r.team} (${r.type})`.substring(0, 25).padEnd(25);
    const rank = String(i + 1).padStart(4);
    console.log(`${rank} | ${team} | ${r.prop.padEnd(12)} | ${r.period.padEnd(6)} | ${r.qualityScore.toFixed(1).padStart(7)} | ${r.confidence.toFixed(0).padStart(5)} | ${r.relBias.toFixed(1).padStart(6)}`);
  });
  
  console.log();
}

async function saveResults(results) {
  const outputPath = 'scripts/scew-results.json';
  await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Full results saved to: ${outputPath}`);
  console.log(`   Total entries: ${results.length}\n`);
}

// ==================== MONGODB UPDATES ====================

async function saveEdgesToProfiles(db, results, teamData, nameToData) {
  console.log(`\n💾 Saving edges to teamprofiles in MongoDB...`);
  
  const updates = [];
  const edgesByTeam = {};
  
  // Group results by team/type
  for (const result of results) {
    const teamInfo = nameToData[result.team];
    if (!teamInfo) continue;
    
    const key = `${teamInfo.id}_${result.type}`;
    if (!edgesByTeam[key]) {
      edgesByTeam[key] = {
        teamId: teamInfo.id,
        matchType: result.type,
        teamName: result.team,
        edges: {}
      };
    }
    
    // Create edges structure for this stat/period
    const statKey = STAT_KEY_MAP[result.prop] || result.prop;
    if (!edgesByTeam[key].edges[statKey]) {
      edgesByTeam[key].edges[statKey] = {};
    }
    
    edgesByTeam[key].edges[statKey][result.period] = {
      relBias: parseFloat(result.relBias.toFixed(2)),
      confidence: parseFloat(result.confidence.toFixed(1)),
      qualityScore: parseFloat(result.qualityScore.toFixed(2)),
      sampleSize: result.count,
      winRate: parseFloat(result.winPct.toFixed(1)),
      direction: result.valueEdge,
      lastUpdated: new Date().toISOString(),
      details: {
        bias: parseFloat(result.bias.toFixed(2)),
        avgLine: parseFloat(result.avgLine.toFixed(2)),
        leagueAvg: parseFloat(result.leagueAvg.toFixed(2)),
        wins: result.wins,
        losses: result.losses,
        hits: result.hits,
        hitsTotal: result.hitsTotal
      }
    };
  }
  
  // Create MongoDB bulk update operations
  for (const key in edgesByTeam) {
    const { teamId, matchType, teamName, edges } = edgesByTeam[key];
    
    // Build $set operations for each stat/period
    const setOps = {};
    for (const statKey in edges) {
      for (const period in edges[statKey]) {
        setOps[`statistics.for.${statKey}.${period}.edges`] = edges[statKey][period];
      }
    }
    
    updates.push({
      updateOne: {
        filter: {
          'meta.lagnamn': teamName,
          'meta.matchType': matchType
        },
        update: { $set: setOps }
      }
    });
  }
  
  console.log(`   Preparing ${updates.length} teamprofile updates...`);
  
  if (updates.length > 0) {
    const result = await db.collection('teamprofiles').bulkWrite(updates);
    console.log(`   ✅ Updated ${result.modifiedCount} teamprofiles`);
    console.log(`   📊 Total edges saved: ${results.length}`);
  } else {
    console.log(`   ⚠️  No updates to perform`);
  }
  
  console.log();
}

// ==================== MAIN ====================

async function main() {
  // Check for command-line flags
  const args = process.argv.slice(2);
  const shouldUpdateProfiles = args.includes('--update-profiles') || args.includes('-u');
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 ODDS SKEW ANALYSIS - Systematic Bookmaker Pricing Errors`);
  if (shouldUpdateProfiles) {
    console.log(`📝 Mode: UPDATE TEAMPROFILES`);
  }
  console.log(`${'='.repeat(80)}\n`);
  
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  
  // 1. Fetch teamprofiles
  console.log(`📥 Fetching teamprofiles from MongoDB...`);
  const teamprofiles = await db.collection('teamprofiles').find({}).toArray();
  console.log(`   ✅ Loaded ${teamprofiles.length} teamprofiles\n`);
  
  if (teamprofiles.length === 0) {
    console.error(`❌ No teamprofiles found! Cannot proceed.`);
    process.exit(1);
  }
  
  // 2. Fetch backtests from MongoDB
  console.log(`📥 Fetching backtests from MongoDB...`);
  const dbBacktests = await db.collection('unibet-backtest').find({
    'lines.actual': { $ne: null }
  }).toArray();
  console.log(`   ✅ Loaded ${dbBacktests.length} completed backtests from MongoDB\n`);
  
  // 3. Fetch backtests from disk
  const diskBacktests = await loadBacktestsFromDisk();
  
  // 4. Combine all backtests
  const allBacktests = [...dbBacktests, ...diskBacktests];
  console.log(`📊 Total backtests to analyze: ${allBacktests.length}\n`);
  
  if (allBacktests.length === 0) {
    console.error(`❌ No backtests found! Cannot proceed.`);
    process.exit(1);
  }
  
  // 5. Build team data structure
  console.log(`🏗️  Building team data structure...`);
  const { teamData, nameToData } = buildTeamDataStructure(teamprofiles, PROPS, PERIODS);
  console.log(`   ✅ Structure ready for ${Object.keys(teamData).length} teams\n`);
  
  // 6. Process backtests
  const { processedBets } = processBacktests(allBacktests, teamData, nameToData);
  
  if (processedBets === 0) {
    console.error(`❌ No valid bets processed! Check your data.`);
    process.exit(1);
  }
  
  // 7. Calculate statistics
  const results = calculateStatistics(teamData, nameToData);
  
  if (results.length === 0) {
    console.error(`❌ No results generated! Check minimum sample size (${MIN_SAMPLE_SIZE}).`);
    process.exit(1);
  }
  
  // 8. Display results
  displayTop20Results(results);
  displayExampleCalculations(results, teamData, nameToData);
  
  // 9. Save full results
  await saveResults(results);
  
  // 10. Update teamprofiles if flag is set
  if (shouldUpdateProfiles) {
    await saveEdgesToProfiles(db, results, teamData, nameToData);
  }
  
  console.log(`${'='.repeat(80)}`);
  console.log(`✅ Analysis complete!`);
  console.log(`${'='.repeat(80)}\n`);
  
  await client.close();
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});