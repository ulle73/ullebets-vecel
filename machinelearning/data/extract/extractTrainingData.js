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

const SCOPES = ['home', 'away', 'total'];
const PERIODS = ['ALL', '1ST', '2ND'];

// Date split for train/val/test
const TRAIN_END_DATE = new Date('2025-11-22');
const VAL_END_DATE = new Date('2025-11-23');
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
  const leaguesDocs = await leaguesCol.find({}).toArray();
  
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
  
  // Get all completed matches from unibet-backtest
  console.log('📝 Fetching completed backtest matches...');
  const matches = await backtestCol.find({
    'lines.0': { $exists: true } // Has at least one line
  }).toArray();
  
  console.log(`Found ${matches.length} matches with backtest data\n`);
  
  // Group samples by statKey/scope/period
  const datasets = {};
  
  for (const match of matches) {
    const matchDate = new Date(match.matchDate);
    const homeTeam = match.homeTeam;
    const awayTeam = match.awayTeam;
    
    // Determine split (train/val/test)
    let split = 'test';
    if (matchDate < TRAIN_END_DATE) split = 'train';
    else if (matchDate < VAL_END_DATE) split = 'val';
    
    console.log(`Processing: ${homeTeam} vs ${awayTeam} (${matchDate.toISOString().split('T')[0]}) - ${split}`);
    
    // Get Opta data for both teams
    const homeOptaData = findTeamInLeagues(leaguesData, homeTeam);
    const awayOptaData = findTeamInLeagues(leaguesData, awayTeam);
    
    if (!homeOptaData || !awayOptaData) {
      console.log(`  ⚠️  Skipping: Missing Opta data`);
      continue;
    }
    
    // Get team profiles
    const homeProfile = await findTeamProfile(teamprofilesCol, homeTeam, 'home');
    const awayProfile = await findTeamProfile(teamprofilesCol, awayTeam, 'away');
    
    if (!homeProfile || !awayProfile) {
      console.log(`  ⚠️  Skipping: Missing team profiles`);
      continue;
    }
    
    // Get historical matches for WMA calculation
    const homeStats = await findTeamStats(teamstatsCol, homeTeam, 'home');
    const awayStats = await findTeamStats(teamstatsCol, awayTeam, 'away');
    
    // Process each line in the match
    for (const line of match.lines) {
      if (!line.actual || line.actual === null) continue; // Skip incomplete
      
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
  
  // Save datasets to JSONL files
  console.log('\n💾 Saving datasets...\n');
  const outputDir = path.join(process.cwd(), 'machinelearning', 'data', 'datasets');
  await fs.mkdir(outputDir, { recursive: true });
  
  let savedCount = 0;
  let skippedCount = 0;
  
  for (const [key, splits] of Object.entries(datasets)) {
    const totalSamples = splits.train.length + splits.val.length + splits.test.length;
    
    console.log(`${key}:`);
    console.log(`  Train: ${splits.train.length}, Val: ${splits.val.length}, Test: ${splits.test.length}`);
    console.log(`  Total: ${totalSamples}`);
    
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
  
  console.log('\n✅ Data extraction complete!');
  await client.close();
  console.log('✅ MongoDB connection closed');
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
  
  // Historical WMA (if teamstats available)
  if (homeStats && awayStats) {
    const homeWMA_recent = calculateWMA(homeStats.full, statKey, 5, matchDate);
    const homeWMA_medium = calculateWMA(homeStats.full, statKey, 15, matchDate);
    const homeWMA_long = calculateWMA(homeStats.full, statKey, 30, matchDate);
    
    const awayWMA_recent = calculateWMA(awayStats.full, statKey, 5, matchDate);
    const awayWMA_medium = calculateWMA(awayStats.full, statKey, 15, matchDate);
    const awayWMA_long = calculateWMA(awayStats.full, statKey, 30, matchDate);
    
    raw_features.push(homeWMA_recent, homeWMA_medium, homeWMA_long);
    raw_features.push(awayWMA_recent, awayWMA_medium, awayWMA_long);
  } else {
    // Fill with zeros if no historical data
    raw_features.push(0, 0, 0, 0, 0, 0);
  }
  
  // Period-specific features (if not ALL)
  if (period !== 'ALL') {
    const home1H = homeProfile.statistics?.[statKey]?.['1ST']?.value || 0;
    const home2H = homeProfile.statistics?.[statKey]?.['2ND']?.value || 0;
    const away1H = awayProfile.statistics?.[statKey]?.['1ST']?.value || 0;
    const away2H = awayProfile.statistics?.[statKey]?.['2ND']?.value || 0;
    
    raw_features.push(home1H, home2H, away1H, away2H);
  }
  
  // Home advantage
  raw_features.push(1); // Always 1 (binary indicator)
  
  // League ID (encode as number)
  const leagueId = homeOptaData.leagueId || 0;
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
 * Find team profile in teamprofiles collection
 */
async function findTeamProfile(col, teamName, matchType) {
  const doc = await col.findOne({
    'meta.lagnamn': { $regex: new RegExp(`^${teamName}$`, 'i') },
    'meta.matchType': matchType
  });
  return doc;
}

/**
 * Find team stats in teamstats collection
 */
async function findTeamStats(col, teamName, teamRole) {
  const doc = await col.findOne({
    '_importMeta.teamName': { $regex: new RegExp(`^${teamName}$`, 'i') },
    '_importMeta.teamRole': teamRole
  });
  return doc;
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

