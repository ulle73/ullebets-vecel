/**
 * Extract Training Data from MongoDB
 * 
 * This script pulls data from MongoDB collections and builds training datasets
 * for ML models (both Tier 1 and Tier 2).
 * 
 * Output: JSONL files in machinelearning/data/datasets/
 * Format: One line per training sample
 * {
 *   raw_features: [...],
 *   formula_predictions: {...},
 *   consensus_features: {...},
 *   historical_win_rates: {...},
 *   target: <actual_value>,
 *   metadata: { matchId, date, statKey, scope, period }
 * }
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { calculateWMA } from './utils.js';
import { calculateHistoricalWinRates } from './calculateWinRates.js';
import fs from 'fs/promises';
import path from 'path';
import { toDateStr, toDate } from '../../../lib/core/date.js';
import { loadExternalUnibetTests } from '../loadExternalUnibetTests.js';
import { retryTransientMongoOperation } from '../../../lib/mongo-resilience.js';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// Configuration
const STAT_KEYS = [
  'totalShotsOnGoal',
  'shotsOnGoal', 
  'cornerKicks',
  'throwIns',
  'fouls',
  'offsides',
  'goalKicks',
  'yellowCards'
];

// Statkeys that do not have Unibet odds (handled via teamstats supervised samples)
const NO_ODDS_STAT_KEYS = ['throwIns', 'goalKicks'];

const SCOPES = ['home', 'away', 'total'];
const PERIODS = ['ALL', '1ST', '2ND'];
const EXTRA_FEATURE_KEYS = [
  'ballPossession',
  'passes',
  'accuratePasses',
  'finalThirdEntries',
  'touchesInOppBox',
  'expectedGoals',
  'bigChanceCreated',
  'bigChanceMissed',
  'bigChanceScored',
  'shotsOffGoal',
  'totalShotsInsideBox',
  'totalShotsOutsideBox',
  'accurateCross',
  'accurateLongBalls',
  'ballRecovery',
  'interceptionWon',
  'dispossessed',
  'blockedScoringAttempt',
  'duelWonPercent',
  'groundDuelsPercentage',
  'aerialDuelsPercentage',
  'cleanSheets',
  'goalsConceded',
  'tackles',
  'clearances',
  'dribbles',
  'dribblesCompleted',
  'touches',
  'duels',
  'groundDuels',
  'aerialDuels'
];

function isOddsSupported(statKey, scope, period) {
  const anyScope = scope === 'home' || scope === 'away' || scope === 'total';
  if (!anyScope) return false;

  if (statKey === 'totalShotsOnGoal' || statKey === 'shotsOnGoal') {
    return period === 'ALL';
  }
  if (statKey === 'cornerKicks') {
    return period === 'ALL' || period === '1ST' || period === '2ND';
  }
  if (statKey === 'offsides' || statKey === 'yellowCards' || statKey === 'fouls') {
    return period === 'ALL';
  }
  return false;
}

// Date split for train/val/test
// Tidsbaserad split – tidigarelagd för större val/test-fönster
const TRAIN_END_DATE = new Date('2025-10-15');
const VAL_END_DATE = new Date('2025-11-05');
// Allt efter = test

/**
 * Main extraction function
 */
export async function extractTrainingData() {
  console.log('🚀 Starting training data extraction...\n');
  
  // Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI not found in environment');
  }
  
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(process.env.MONGODB_DB || 'app');
    
    // Collections
    const backtestCol = db.collection('unibet-backtest');
    const leaguesCol = db.collection('leages-and-teams');
    const teamprofilesCol = db.collection('teamprofiles');
    const teamstatsCol = db.collection('teamstats');
    
    // Load leagues-and-teams (for Opta data)
    console.log('📊 Loading leagues and teams data...');
    const leaguesDocs = await retryTransientMongoOperation(
      'load leagues-and-teams',
      () => leaguesCol.find({}).toArray(),
      { logger: console }
    );
    
    const leaguesData = {};
    for (const doc of leaguesDocs) {
      // Skip _id and merge all league objects
      const { _id, ...leagues } = doc;
      Object.assign(leaguesData, leagues);
    }
    
    const leagueCount = Object.keys(leaguesData).length;
    const teamCount = Object.values(leaguesData).reduce((sum, league) => 
      sum + (league.teams?.length || 0), 0
    );
    
    console.log(`  Found ${leagueCount} leagues with ${teamCount} total teams\n`);
    
    // Cache teamprofiles and teamstats once to avoid repetitive DB lookups
    console.log('🗂️ Caching teamprofiles and teamstats...');
    const teamProfileCache = await loadTeamProfileCache(teamprofilesCol);
    const teamStatsCache = await loadTeamStatsCache(teamstatsCol);
    console.log(`  Cached ${teamProfileCache.size} teamprofiles and ${teamStatsCache.size} teamstats\n`);
    
    // Get all completed matches from unibet-backtest
    console.log('📝 Fetching completed backtest matches...');
    const matches = await retryTransientMongoOperation(
      'load completed backtest matches',
      () =>
        backtestCol.find({
          'lines.0': { $exists: true } // Has at least one line
        }).toArray(),
      { logger: console }
    );
    
    console.log(`Found ${matches.length} matches with backtest data\n`);

    // Optionally load external Unibet backtests from disk (can comment out if not needed)
    const EXTERNAL_BASE = "C:\\Users\\ryd\\OneDrive\\Skrivbord\\FRONTEND\\bet365\\UNIBET\\unibet-backtests";
    const externalMatches = await loadExternalUnibetTests(EXTERNAL_BASE);
    if (externalMatches.length) {
      console.log(`Loaded ${externalMatches.length} external backtest matches from disk\n`);
      matches.push(...externalMatches);
    } else {
      console.log(`No external backtest matches loaded (path: ${EXTERNAL_BASE})\n`);
    }
    
    // Group samples by statKey/scope/period
    const datasets = {};
    
    for (const match of matches) {
    const matchDateStr = toDateStr(match.matchDate || match.timestamp);
    const matchDate = toDate(matchDateStr);
    if (!matchDate) {
      console.log(`Processing: ${match.homeTeam} vs ${match.awayTeam} (invalid matchDate: ${match.matchDate ?? match.timestamp ?? ''}) - skipped`);
      continue;
    }
    const homeTeam = match.homeTeam;
    const awayTeam = match.awayTeam;
    
    // Determine split (train/val/test)
    let split = 'test';
    if (matchDate < TRAIN_END_DATE) split = 'train';
    else if (matchDate < VAL_END_DATE) split = 'val';
    
    console.log(`Processing: ${homeTeam} vs ${awayTeam} (${matchDateStr}) - ${split}`);
    
    // Get Opta data for both teams
    const homeOptaData = findTeamInLeagues(leaguesData, homeTeam);
    const awayOptaData = findTeamInLeagues(leaguesData, awayTeam);
    
    if (!homeOptaData || !awayOptaData) {
      console.log(`  ⚠️  Skipping: Missing Opta data`);
      continue;
    }
    
    // Get team profiles
    const homeProfile = getCachedTeamProfile(teamProfileCache, homeTeam, 'home') 
      || await findTeamProfile(teamprofilesCol, homeTeam, 'home');
    const awayProfile = getCachedTeamProfile(teamProfileCache, awayTeam, 'away') 
      || await findTeamProfile(teamprofilesCol, awayTeam, 'away');
    
    if (!homeProfile || !awayProfile) {
      console.log(`  ⚠️  Skipping: Missing team profiles`);
      continue;
    }
    
    // Get historical matches for WMA calculation
    const homeStats = getCachedTeamStats(teamStatsCache, homeTeam, 'home')
      || await findTeamStats(teamstatsCol, homeTeam, 'home');
    const awayStats = getCachedTeamStats(teamStatsCache, awayTeam, 'away')
      || await findTeamStats(teamstatsCol, awayTeam, 'away');
    
    // Process each line in the match
    for (const line of match.lines) {
      if (!line.actual || line.actual === null) continue; // Skip incomplete
      
      // Sanity check: Skip lines with unreasonable values (data quality issue)
      if (line.line > 100) {
        console.log(`  ⚠️  Skipping line with unreasonable value: ${line.statKey} line=${line.line}`);
        continue;
      }
      
      const { statKey, scope, period } = line;
      const datasetKey = `${statKey}_${scope}_${period}`;
      
      if (!datasets[datasetKey]) {
        datasets[datasetKey] = { train: [], val: [], test: [] };
      }
      
      try {
        // Build feature vector
        const sample = await buildSample({
          line,
          match,
          homeTeam,
          awayTeam,
          homeOptaData,
          awayOptaData,
          homeProfile,
          awayProfile,
          homeStats,
          awayStats,
          matchDate
        });
        
        datasets[datasetKey][split].push(sample);
        
      } catch (err) {
        console.log(`  ⚠️  Error building sample for ${datasetKey}: ${err.message}`);
      }
    }
    }
    
    // === SUPERVISED LEARNING FÖR KOMBI UTAN UNIBET-ODDS ===
    // Vi tar in alla STAT_KEYS men hoppar över de scope/period som har odds (via isOddsSupported)
    console.log('\n📊 Extracting supervised samples from teamstats...');
    const supervisedStats = STAT_KEYS;
    
    await extractSupervisedSamples({
      datasets,
      teamstatsCol,
      leaguesData,
      teamprofilesCol,
      teamProfileCache,
      supervisedStats,
      TRAIN_END_DATE,
      VAL_END_DATE
    });
    
    // Save datasets to JSONL files
    console.log('\n💾 Saving datasets...\n');
    const outputDir = path.join(process.cwd(), 'machinelearning', 'data', 'datasets');
    await fs.mkdir(outputDir, { recursive: true });
    
    let savedCount = 0;
    let skippedCount = 0;
    let totalTrainSamples = 0;
    let totalValSamples = 0;
    let totalTestSamples = 0;
    
    for (const [key, splits] of Object.entries(datasets)) {
      const totalSamples = splits.train.length + splits.val.length + splits.test.length;
      
      console.log(`${key}:`);
      console.log(`  Train: ${splits.train.length}, Val: ${splits.val.length}, Test: ${splits.test.length}`);
      console.log(`  Total: ${totalSamples}`);
      totalTrainSamples += splits.train.length;
      totalValSamples += splits.val.length;
      totalTestSamples += splits.test.length;
      
      // Lower threshold for testing - require at least 10 samples total
      if (totalSamples < 10) {
        console.log(`  ⚠️  Too few samples (need at least 10), skipping\n`);
        skippedCount++;
        continue;
      }
      
      // Save each split
      for (const [splitName, samples] of Object.entries(splits)) {
        if (samples.length === 0) continue;
        
        const filename = path.join(outputDir, `${key}_${splitName}.jsonl`);
        const content = samples.map(s => JSON.stringify(s)).join('\n');
        await fs.writeFile(filename, content);
        console.log(`  ✅ Saved ${samples.length} samples to ${splitName}.jsonl`);
        savedCount++;
      }
      console.log('');
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`  Total dataset keys processed: ${Object.keys(datasets).length}`);
    console.log(`  Files saved: ${savedCount}`);
    console.log(`  Skipped (too few samples): ${skippedCount}`);
    console.log(`  Totals -> Train: ${totalTrainSamples}, Val: ${totalValSamples}, Test: ${totalTestSamples}`);
    
    console.log('\n✅ Data extraction complete!');
  } finally {
    await client.close().catch(() => {});
    console.log('✅ MongoDB connection closed');
  }
}

/**
 * Extract supervised learning samples from teamstats for stats without Unibet lines
 * These samples have actual values but no betting odds/lines
 */
async function extractSupervisedSamples({
  datasets,
  teamstatsCol,
  leaguesData,
  teamprofilesCol,
  teamProfileCache,
  supervisedStats,
  TRAIN_END_DATE,
  VAL_END_DATE
}) {
  // Get all teamstats documents
  const allTeamStats = await retryTransientMongoOperation(
    'load teamstats documents for supervised samples',
    () => teamstatsCol.find({}).toArray(),
    { logger: console }
  );
  console.log(`  Found ${allTeamStats.length} teamstats documents`);
  
  let samplesCreated = 0;
  
  for (const teamDoc of allTeamStats) {
    const teamName = teamDoc._importMeta?.teamName;
    const teamRole = teamDoc._importMeta?.teamRole; // 'home' or 'away'
    
    if (!teamName || !teamRole || !teamDoc.full) continue;
    
    const matches = teamDoc.full;
    
    for (const match of matches) {
      if (!match.matchDetails?.statistics) continue;
      const rawStats = match.matchDetails.statistics;
      const stats = Array.isArray(rawStats) ? rawStats : Object.values(rawStats || {});
      if (!stats || !stats.length) continue;
      
      const matchDate = new Date(match.date || match.timestamp);
      if (isNaN(matchDate.getTime())) continue;
      
      // Determine split
      let split = 'test';
      if (matchDate < TRAIN_END_DATE) split = 'train';
      else if (matchDate < VAL_END_DATE) split = 'val';
      
      // Get opponent
      const isHome = teamRole === 'home';
      const homeTeam = isHome ? teamName : (match.awayTeamName || match.homeTeamName);
      const awayTeam = isHome ? (match.awayTeamName || match.homeTeamName) : teamName;
      
      // Skip if we can't identify teams
      if (!homeTeam || !awayTeam) continue;
      
      // Get Opta data
      const homeOptaData = findTeamInLeagues(leaguesData, homeTeam);
      const awayOptaData = findTeamInLeagues(leaguesData, awayTeam);
      if (!homeOptaData || !awayOptaData) continue;
      
      // Get profiles
      const cachedHomeProfile = getCachedTeamProfile(teamProfileCache, homeTeam, 'home');
      const cachedAwayProfile = getCachedTeamProfile(teamProfileCache, awayTeam, 'away');
      const homeProfile = cachedHomeProfile || await findTeamProfile(teamprofilesCol, homeTeam, 'home');
      const awayProfile = cachedAwayProfile || await findTeamProfile(teamprofilesCol, awayTeam, 'away');
      if (!homeProfile || !awayProfile) continue;
      
      // Process each supervised stat
      for (const statKey of supervisedStats) {
        // Extract from match statistics for each period
        for (const periodSection of stats) {
          const period = periodSection.period; // 'ALL', '1ST', '2ND'
          if (!['ALL', '1ST', '2ND'].includes(period)) continue;
          
          // Find the stat value
          let actualValue = null;
          for (const group of periodSection.groups || []) {
            const item = group.statisticsItems?.find(i => i.key === statKey);
            if (item) {
              // Extract based on scope
              for (const scope of ['home', 'away', 'total']) {
                // Skip combos that already have odds support
                if (isOddsSupported(statKey, scope, period)) {
                  continue;
                }
                if (scope === 'home') {
                  actualValue = parseFloat(item.homeValue) || 0;
                } else if (scope === 'away') {
                  actualValue = parseFloat(item.awayValue) || 0;
                } else { // total
                  actualValue = (parseFloat(item.homeValue) || 0) + (parseFloat(item.awayValue) || 0);
                }
                
                if (actualValue === null || actualValue === undefined) continue;
                
                const datasetKey = `${statKey}_${scope}_${period}`;
                
                if (!datasets[datasetKey]) {
                  datasets[datasetKey] = { train: [], val: [], test: [] };
                }
                
                try {
                  // Build sample with synthetic line (use profile average as proxy)
                  const syntheticLine = {
                    statKey,
                    scope, 
                    period,
                    actual: actualValue,
                    line: 0, // No betting line
                    odds: 0,
                    underOdds: 0,
                    evDetails: {} // No formula predictions
                  };
                  
                  const sample = await buildSupervisedSample({
                    line: syntheticLine,
                    match,
                    homeTeam,
                    awayTeam,
                    homeOptaData,
                    awayOptaData,
                    homeProfile,
                    awayProfile,
                    homeStats: teamDoc,
                    awayStats: null, // We only have one team's stats
                    matchDate
                  });
                  
                  datasets[datasetKey][split].push(sample);
                  samplesCreated++;
                  
                } catch (err) {
                  // Silent fail for supervised samples
                }
              }
              break; // Found the stat, move on
            }
          }
        }
      }
    }
  }
  
  console.log(`  Created ${samplesCreated} supervised samples for ${supervisedStats.join(', ')}`);
}

/**
 * Build supervised sample (similar to buildSample but for stats without lines)
 */
async function buildSupervisedSample({
  line,
  match,
  homeTeam,
  awayTeam,
  homeOptaData,
  awayOptaData,
  homeProfile,
  awayProfile,
  homeStats,
  awayStats,
  matchDate
}) {
  const { statKey, scope, period, actual } = line;
  
  const raw_features = [];
  
  // Market features: zeros for supervised samples (no betting data)
  raw_features.push(0, 0, 0, 0, 0, 0); // line, overOdds, impliedOver, underOdds, impliedUnder, margin
  
  // Team Quality Features
  raw_features.push(homeOptaData.optaRank || 100);
  raw_features.push(homeOptaData.optaRating || 80);
  raw_features.push(awayOptaData.optaRank || 100);
  raw_features.push(awayOptaData.optaRating || 80);
  raw_features.push((homeOptaData.optaRank || 100) - (awayOptaData.optaRank || 100));
  raw_features.push((homeOptaData.optaRating || 80) - (awayOptaData.optaRating || 80));
  raw_features.push(Math.pow((homeOptaData.optaRating || 80) - (awayOptaData.optaRating || 80), 2));
  raw_features.push(Math.pow((homeOptaData.optaRating || 80) - (awayOptaData.optaRating || 80), 2));
  
  // Team Profile Features
  const homeStat = homeProfile.statistics?.[statKey]?.[period];
  const awayStat = awayProfile.statistics?.[statKey]?.[period];
  
  raw_features.push(homeStat?.value || 0);
  raw_features.push(homeStat?.rank || 50);
  raw_features.push(awayStat?.value || 0);
  raw_features.push(awayStat?.rank || 50);
  
  // Rank For/Against
  raw_features.push(homeProfile.rankFor || 50);
  raw_features.push(homeProfile.rankAgainst || 50);
  raw_features.push(awayProfile.rankFor || 50);
  raw_features.push(awayProfile.rankAgainst || 50);
  
  // Matchup score
  raw_features.push((homeProfile.rankFor || 50) / (awayProfile.rankAgainst || 50));
  
  // WMA - calculate for home team if available
  if (homeStats) {
    const homeWMA_recent = calculateWMA(homeStats.full, statKey, 5, matchDate, 'for', period);
    const homeWMA_medium = calculateWMA(homeStats.full, statKey, 15, matchDate, 'for', period);
    const homeWMA_long = calculateWMA(homeStats.full, statKey, 30, matchDate, 'for', period);
    const homeWMA_recent_against = calculateWMA(homeStats.full, statKey, 5, matchDate, 'against', period);
    const homeWMA_medium_against = calculateWMA(homeStats.full, statKey, 15, matchDate, 'against', period);
    const homeWMA_long_against = calculateWMA(homeStats.full, statKey, 30, matchDate, 'against', period);
    raw_features.push(homeWMA_recent, homeWMA_medium, homeWMA_long, 0, 0, 0); // away zeros
    raw_features.push(homeWMA_recent_against, homeWMA_medium_against, homeWMA_long_against, 0, 0, 0);
  } else {
    raw_features.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  
  // Period features (16 features - padded to fixed size)
  const relevantPeriods = period === '1ST' ? ['1ST'] 
    : period === '2ND' ? ['1ST', '2ND']
    : ['ALL'];
  
  for (const p of relevantPeriods) {
    const home_for_value = homeProfile.statistics?.[statKey]?.[p]?.value || 0;
    const home_for_rank = homeProfile.statistics?.[statKey]?.[p]?.rank || 50;
    const home_against_value = homeProfile.against?.[statKey]?.[p]?.value || 0;
    const home_against_rank = homeProfile.against?.[statKey]?.[p]?.rank || 50;
    const away_for_value = awayProfile.statistics?.[statKey]?.[p]?.value || 0;
    const away_for_rank = awayProfile.statistics?.[statKey]?.[p]?.rank || 50;
    const away_against_value = awayProfile.against?.[statKey]?.[p]?.value || 0;
    const away_against_rank = awayProfile.against?.[statKey]?.[p]?.rank || 50;
    
    raw_features.push(
      home_for_value, home_for_rank,
      home_against_value, home_against_rank,
      away_for_value, away_for_rank,
      away_against_value, away_against_rank
    );
  }
  
  if (relevantPeriods.length === 1) {
    raw_features.push(0, 0, 0, 0, 0, 0, 0, 0);
  }
  
  // Situational features
  raw_features.push(homeProfile.firstGoal?.scoreFirstPercentage || 50);
  raw_features.push(awayProfile.firstGoal?.scoreFirstPercentage || 50);
  raw_features.push((homeProfile.firstGoal?.scoreFirstPercentage || 50) - (awayProfile.firstGoal?.scoreFirstPercentage || 50));
  
  raw_features.push(
    homeProfile.shotsPerMinute?.leading || 0,
    homeProfile.shotsPerMinute?.trailing || 0,
    homeProfile.shotsPerMinute?.tied || 0,
    awayProfile.shotsPerMinute?.leading || 0,
    awayProfile.shotsPerMinute?.trailing || 0,
    awayProfile.shotsPerMinute?.tied || 0
  );
  
  raw_features.push(homeProfile.shotsPerTenMinutes?.avg || 0);
  raw_features.push(awayProfile.shotsPerTenMinutes?.avg || 0);
  
  // Extra features
  const excludeShotFeatures = statKey === 'totalShots';
  for (const key of EXTRA_FEATURE_KEYS) {
    const isShotLeak = excludeShotFeatures && key.toLowerCase().includes('shot');
    const home_for = isShotLeak ? 0 : (homeProfile?.statistics?.for?.[key]?.ALL?.value ?? 0);
    const away_for = isShotLeak ? 0 : (awayProfile?.statistics?.for?.[key]?.ALL?.value ?? 0);
    const home_against = isShotLeak ? 0 : (homeProfile?.statistics?.against?.[key]?.ALL?.value ?? 0);
    const away_against = isShotLeak ? 0 : (awayProfile?.statistics?.against?.[key]?.ALL?.value ?? 0);
    raw_features.push(home_for, away_for, home_against, away_against);
  }
  
  // Flags + home advantage + league
  raw_features.push(1); // no_odds flag
  raw_features.push(1, 0); // home_advantage, league_id
  
  return {
    raw_features,
    formula_predictions: {},
    consensus_features: {},
    historical_win_rates: {},
    target: actual,
    metadata: {
      matchId: match.matchId,
      date: matchDate.toISOString(),
      homeTeam,
      awayTeam,
      statKey,
      scope,
      period,
      line: 0,
      odds: 0,
      supervised: true // Mark as supervised sample
    }
  };
}

/**
 * Build a training sample from match data
 */
async function buildSample({
  line,
  match,
  homeTeam,
  awayTeam,
  homeOptaData,
  awayOptaData,
  homeProfile,
  awayProfile,
  homeStats,
  awayStats,
  matchDate
}) {
  const { statKey, scope, period, actual, evDetails } = line;
  
  // === RAW FEATURES ===
  const raw_features = [];
  
  // Market features: line, odds, implied probabilities, margin
  const lineValue = Number.isFinite(line.line) ? Number(line.line) : 0;
  const overOdds = Number.isFinite(line.odds) ? Number(line.odds) : 0;
  const underOdds = Number.isFinite(line.underOdds) ? Number(line.underOdds) : 0;

  const impliedOver = overOdds > 0 ? 1 / overOdds : 0;
  const impliedUnder = underOdds > 0 ? 1 / underOdds : 0;
  const margin =
    impliedOver > 0 && impliedUnder > 0 ? impliedOver + impliedUnder - 1 : 0;

  raw_features.push(lineValue, overOdds, impliedOver, underOdds, impliedUnder, margin);
  
  // Team Quality Features
  raw_features.push(homeOptaData.optaRank || 100);
  raw_features.push(homeOptaData.optaRating || 80);
  raw_features.push(awayOptaData.optaRank || 100);
  raw_features.push(awayOptaData.optaRating || 80);
  raw_features.push((homeOptaData.optaRank || 100) - (awayOptaData.optaRank || 100));
  raw_features.push((homeOptaData.optaRating || 80) - (awayOptaData.optaRating || 80));
  
  // Team Profile Features (for this statKey)
  const homeStat = homeProfile.statistics?.[statKey]?.[period];
  const awayStat = awayProfile.statistics?.[statKey]?.[period];
  
  raw_features.push(homeStat?.value || 0);
  raw_features.push(homeStat?.rank || 50);
  raw_features.push(awayStat?.value || 0);
  raw_features.push(awayStat?.rank || 50);
  
  // Rank For/Against
  raw_features.push(homeProfile.rankFor || 50);
  raw_features.push(homeProfile.rankAgainst || 50);
  raw_features.push(awayProfile.rankFor || 50);
  raw_features.push(awayProfile.rankAgainst || 50);
  
  // Matchup score
  const matchupScore = (homeProfile.rankFor || 50) / (awayProfile.rankAgainst || 50);
  raw_features.push(matchupScore);
  
  // Historical WMA - OFFENSIVE (own stats) - period-specific
  if (homeStats && awayStats) {
    const homeWMA_recent = calculateWMA(homeStats.full, statKey, 5, matchDate, 'for', period);
    const homeWMA_medium = calculateWMA(homeStats.full, statKey, 15, matchDate, 'for', period);
    const homeWMA_long = calculateWMA(homeStats.full, statKey, 30, matchDate, 'for', period);
    
    const awayWMA_recent = calculateWMA(awayStats.full, statKey, 5, matchDate, 'for', period);
    const awayWMA_medium = calculateWMA(awayStats.full, statKey, 15, matchDate, 'for', period);
    const awayWMA_long = calculateWMA(awayStats.full, statKey, 30, matchDate, 'for', period);
    
    raw_features.push(homeWMA_recent, homeWMA_medium, homeWMA_long);
    raw_features.push(awayWMA_recent, awayWMA_medium, awayWMA_long);
    
    // Historical WMA - DEFENSIVE (opponent stats against them)
    const homeWMA_recent_against = calculateWMA(homeStats.full, statKey, 5, matchDate, 'against', period);
    const homeWMA_medium_against = calculateWMA(homeStats.full, statKey, 15, matchDate, 'against', period);
    const homeWMA_long_against = calculateWMA(homeStats.full, statKey, 30, matchDate, 'against', period);
    
    const awayWMA_recent_against = calculateWMA(awayStats.full, statKey, 5, matchDate, 'against', period);
    const awayWMA_medium_against = calculateWMA(awayStats.full, statKey, 15, matchDate, 'against', period);
    const awayWMA_long_against = calculateWMA(awayStats.full, statKey, 30, matchDate, 'against', period);
    
    raw_features.push(homeWMA_recent_against, homeWMA_medium_against, homeWMA_long_against);
    raw_features.push(awayWMA_recent_against, awayWMA_medium_against, awayWMA_long_against);
  } else {
    // Fill with zeros if no historical data (6 offensive + 6 defensive = 12)
    raw_features.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  
  // Period-specific features with FOR/AGAINST separation
  // Only include periods that are "known" at prediction time to avoid data leakage
  // 1ST period: only use 1ST data (can't see 2ND yet)
  // 2ND period: can use 1ST + 2ND data
  // ALL period: use ALL data only
  const relevantPeriods = period === '1ST' ? ['1ST'] 
    : period === '2ND' ? ['1ST', '2ND']
    : ['ALL'];
  
  for (const p of relevantPeriods) {
    // HOME OFFENSIVE (for) - home team's own stats
    const home_for_value = homeProfile.statistics?.[statKey]?.[p]?.value || 0;
    const home_for_rank = homeProfile.statistics?.[statKey]?.[p]?.rank || 50;
    
    // HOME DEFENSIVE (against) - what opponents do against home team
    const home_against_value = homeProfile.against?.[statKey]?.[p]?.value || 0;
    const home_against_rank = homeProfile.against?.[statKey]?.[p]?.rank || 50;
    
    // AWAY OFFENSIVE (for) - away team's own stats
    const away_for_value = awayProfile.statistics?.[statKey]?.[p]?.value || 0;
    const away_for_rank = awayProfile.statistics?.[statKey]?.[p]?.rank || 50;
    
    // AWAY DEFENSIVE (against) - what opponents do against away team
    const away_against_value = awayProfile.against?.[statKey]?.[p]?.value || 0;
    const away_against_rank = awayProfile.against?.[statKey]?.[p]?.rank || 50;
    
    raw_features.push(
      home_for_value, home_for_rank,
      home_against_value, home_against_rank,
      away_for_value, away_for_rank,
      away_against_value, away_against_rank
    );
  }
  // Pad to fixed size: max 2 periods × 8 features = 16 features
  // If only 1 period, add 8 zeros for padding
  if (relevantPeriods.length === 1) {
    raw_features.push(0, 0, 0, 0, 0, 0, 0, 0);
  }
  // Total period features: 2 periods × 8 features = 16 features (fixed size)

  // === SITUATIONAL FEATURES ===
  
  // First Goal Impact
  const home_scoreFirst_pct = homeProfile.firstGoal?.scoreFirstPercentage || 50;
  const away_scoreFirst_pct = awayProfile.firstGoal?.scoreFirstPercentage || 50;
  const scoreFirst_diff = home_scoreFirst_pct - away_scoreFirst_pct;
  raw_features.push(home_scoreFirst_pct, away_scoreFirst_pct, scoreFirst_diff);
  
  // Shots per minute by game state (leading/trailing/tied)
  const home_shotsPerMin_leading = homeProfile.shotsPerMinute?.leading || 0;
  const home_shotsPerMin_trailing = homeProfile.shotsPerMinute?.trailing || 0;
  const home_shotsPerMin_tied = homeProfile.shotsPerMinute?.tied || 0;
  
  const away_shotsPerMin_leading = awayProfile.shotsPerMinute?.leading || 0;
  const away_shotsPerMin_trailing = awayProfile.shotsPerMinute?.trailing || 0;
  const away_shotsPerMin_tied = awayProfile.shotsPerMinute?.tied || 0;
  
  raw_features.push(
    home_shotsPerMin_leading, home_shotsPerMin_trailing, home_shotsPerMin_tied,
    away_shotsPerMin_leading, away_shotsPerMin_trailing, away_shotsPerMin_tied
  );
  
  // Shots per 10 minutes average
  const home_shotsPer10Min = homeProfile.shotsPerTenMinutes?.avg || 0;
  const away_shotsPer10Min = awayProfile.shotsPerTenMinutes?.avg || 0;
  raw_features.push(home_shotsPer10Min, away_shotsPer10Min);

  // No-odds flag (odds>0 => 0, otherwise 1)
  const noOdds = line.odds > 0 ? 0 : 1;

  // === EXTRA TEAM PROFILE FEATURES (ALL period only) ===
  const excludeShotFeatures = statKey === 'totalShots';
  const getStatVal = (profile, polarity, key) =>
    profile?.statistics?.[polarity]?.[key]?.ALL?.value ?? 0;

  for (const key of EXTRA_FEATURE_KEYS) {
    const isShotLeak = excludeShotFeatures && key.toLowerCase().includes('shot');
    const home_for = isShotLeak ? 0 : getStatVal(homeProfile, 'for', key);
    const away_for = isShotLeak ? 0 : getStatVal(awayProfile, 'for', key);
    const home_against = isShotLeak ? 0 : getStatVal(homeProfile, 'against', key);
    const away_against = isShotLeak ? 0 : getStatVal(awayProfile, 'against', key);
    raw_features.push(home_for, away_for, home_against, away_against);
  }

  // Situational features total: 3 + 6 + 2 = 11 features
  
  // No-odds flag
  raw_features.push(noOdds);

  // Home advantage
  raw_features.push(1); // Always 1 (binary indicator)
  
  // League ID (encode as number)
  // Neutralize league id to avoid league-specific overfitting
  const leagueId = 0;
  raw_features.push(leagueId);

  // === FORMULA PREDICTIONS (for Tier 2) ===
  const formula_predictions = {};
  if (evDetails) {
    for (const [formulaName, value] of Object.entries(evDetails)) {
      if (typeof value === 'number' && !formulaName.startsWith('raw')) {
        formula_predictions[formulaName] = value;
      }
    }
  }

  // Formula features (include key formulas as additional features for ML to combine)
  raw_features.push(formula_predictions.evPctMultifactor || 0);
  raw_features.push(formula_predictions.evPctUniversalOptimized || 0);
  raw_features.push(formula_predictions.evPctOptaCombined || 0);
  raw_features.push(formula_predictions.evPctLeagueAvg || 0);
  raw_features.push(formula_predictions.evPctOptaRating || 0);

  // === CONSENSUS FEATURES ===
  const predictions = Object.values(formula_predictions);
  const consensus_features = {};
  
  if (predictions.length > 0) {
    const mean = predictions.reduce((a, b) => a + b, 0) / predictions.length;
    const variance = predictions.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / predictions.length;
    const stdDev = Math.sqrt(variance);
    
    consensus_features.formula_consensus_std = stdDev;
    consensus_features.formula_range = Math.max(...predictions) - Math.min(...predictions);
    consensus_features.optimistic_formula = Math.max(...predictions);
    consensus_features.pessimistic_formula = Math.min(...predictions);
    consensus_features.median_formula_pred = predictions.sort((a, b) => a - b)[Math.floor(predictions.length / 2)];
  }
  
  // === HISTORICAL WIN RATES ===
  // TODO: Calculate from past unibet-backtest documents
  const historical_win_rates = {};
  
  // === TARGET ===
  const target = actual;
  
  // === METADATA ===
  const metadata = {
    matchId: match._id,
    date: matchDate.toISOString(),
    homeTeam,
    awayTeam,
    statKey,
    scope,
    period,
    line: line.line,
    odds: line.odds
  };
  
  return {
    raw_features,
    formula_predictions,
    consensus_features,
    historical_win_rates,
    target,
    metadata
  };
}

/**
 * Find team in leagues-and-teams data
 */
function findTeamInLeagues(leaguesData, teamName) {
  const normalizedSearch = normalizeTeamName(teamName);
  
  for (const [leagueName, league] of Object.entries(leaguesData)) {
    if (!league.teams || leagueName === '_id') continue;
    
    const team = league.teams.find(t => {
      const normalizedTeamName = normalizeTeamName(t.name);
      return normalizedTeamName === normalizedSearch;
    });
    
    if (team) {
      return { ...team, leagueId: league.leagueId };
    }
  }
  
  return null;
}

/**
 * Normalize team name for matching
 */
function normalizeTeamName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accentsç
    .replace(/&/g, 'and')  // & -> and
    .replace(/\./g, '')    // Remove dots
    .replace(/'/g, '')     // Remove apostrophes
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .trim();
}

/**
 * Cache helpers for teamprofiles and teamstats
 */
async function loadTeamProfileCache(col) {
  const docs = await retryTransientMongoOperation(
    'load teamprofiles cache',
    () => col.find({}).toArray(),
    { logger: console }
  );
  const cache = new Map();
  for (const doc of docs) {
    const name = normalizeTeamName(doc?.meta?.lagnamn);
    const matchType = doc?.meta?.matchType;
    if (name && matchType) {
      cache.set(`${name}|${matchType}`, doc);
    }
  }
  return cache;
}

function getCachedTeamProfile(cache, teamName, matchType) {
  if (!cache) return null;
  const key = `${normalizeTeamName(teamName)}|${matchType}`;
  return cache.get(key) || null;
}

async function loadTeamStatsCache(col) {
  const docs = await retryTransientMongoOperation(
    'load teamstats cache',
    () => col.find({}).toArray(),
    { logger: console }
  );
  const cache = new Map();
  for (const doc of docs) {
    const name = normalizeTeamName(doc?._importMeta?.teamName);
    const role = doc?._importMeta?.teamRole;
    if (name && role) {
      cache.set(`${name}|${role}`, doc);
    }
  }
  return cache;
}

function getCachedTeamStats(cache, teamName, teamRole) {
  if (!cache) return null;
  const key = `${normalizeTeamName(teamName)}|${teamRole}`;
  return cache.get(key) || null;
}

/**
 * Find team profile in teamprofiles collection
 */
async function findTeamProfile(col, teamName, matchType) {
  return retryTransientMongoOperation(
    `find teamprofile ${teamName} (${matchType})`,
    () =>
      col.findOne({
        'meta.lagnamn': { $regex: new RegExp(`^${teamName}$`, 'i') },
        'meta.matchType': matchType
      }),
    { logger: console }
  );
}

/**
 * Find team stats in teamstats collection
 */
async function findTeamStats(col, teamName, teamRole) {
  return retryTransientMongoOperation(
    `find teamstats ${teamName} (${teamRole})`,
    () =>
      col.findOne({
        '_importMeta.teamName': { $regex: new RegExp(`^${teamName}$`, 'i') },
        '_importMeta.teamRole': teamRole
      }),
    { logger: console }
  );
}

// Run if called directly
console.log('Script loaded, checking if running directly...');

extractTrainingData()
  .then(() => {
    console.log('✅ Extraction completed successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error during extraction:');
    console.error(err);
    process.exit(1);
  });

