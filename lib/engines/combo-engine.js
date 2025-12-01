/**
 * @fileoverview Combo Engine - Bet combination and filtering orchestration.
 * 
 * CRITICAL: comboId generation MUST use buildComboId from lib/core/keys.js
 * to ensure frontend and backend generate IDENTICAL combo IDs.
 * 
 * @module lib/engines/combo-engine
 */

import { buildBetKey, buildComboId } from '../core/keys.js';

/**
 * Filter lines based on criteria (priority, minOdds, minEv).
 * 
 * @param {Array} lines - Array of bet lines
 * @param {Object} criteria - Filter criteria
 * @param {number} [criteria.minPriority=1] - Minimum priority
 * @param {number} [criteria.minOdds=1.0] - Minimum odds
 * @param {number} [criteria.minEv=0] - Minimum EV percentage
 * @returns {Array} Filtered lines
 */
export function filterLines(lines, criteria = {}) {
  const {
    minPriority = 1,
    minOdds = 1.0,
    minEv = 0,
  } = criteria;
  
  if (!Array.isArray(lines)) return [];
  
  return lines.filter(line => {
    // Priority check
    const priority = line.priority ?? 10;
    if (priority > minPriority) return false;
    
    // Odds check
    const odds = line.odds ?? 0;
    if (odds < minOdds) return false;
    
    // EV check
    const ev = line.value ?? line.ev ?? 0;
    if (ev < minEv) return false;
    
    return true;
  });
}

/**
 * Build all possible combinations of bets.
 * 
 * @param {Array} lines - Array of bet lines (must have betKey)
 * @param {Object} options - Options
 * @param {number} [options.minCombos=2] - Minimum bets per combo
 * @param {number} [options.maxCombos=5] - Maximum bets per combo
 * @param {number} [options.maxTotal=100] - Maximum total combos to generate
 * @returns {Array} Array of combo objects
 * 
 * @example
 * const combos = buildCombinations(filteredLines, {
 *   minCombos: 2,
 *   maxCombos: 4,
 *   maxTotal: 50
 * });
 * // Returns: [{ comboId, betKeys, lines, totalOdds, avgEv, ... }, ...]
 */
export function buildCombinations(lines, options = {}) {
  const {
    minCombos = 2,
    maxCombos = 5,
    maxTotal = 100,
  } = options;
  
  if (!Array.isArray(lines) || lines.length < minCombos) {
    return [];
  }
  
  const results = [];
  
  // Generate combinations of different sizes
  for (let size = minCombos; size <= Math.min(maxCombos, lines.length); size++) {
    const combos = generateCombinationsOfSize(lines, size);
    results.push(...combos);
    
    // Stop if we've hit the limit
    if (results.length >= maxTotal) {
      return results.slice(0, maxTotal);
    }
  }
  
  return results;
}

/**
 * Generate all combinations of a specific size.
 * 
 * @param {Array} lines - Array of lines
 * @param {number} size - Combo size
 * @returns {Array} Array of combos
 */
function generateCombinationsOfSize(lines, size) {
  const combos = [];
  
  function backtrack(start, current) {
    if (current.length === size) {
      const betKeys = current.map(line => line.betKey).filter(Boolean);
      
      if (betKeys.length === size) {
        combos.push(buildComboFromLines(current, betKeys));
      }
      return;
    }
    
    for (let i = start; i < lines.length; i++) {
      current.push(lines[i]);
      backtrack(i + 1, current);
      current.pop();
    }
  }
  
  backtrack(0, []);
  return combos;
}

/**
 * Build a combo object from selected lines.
 * 
 * @param {Array} lines - Selected lines
 * @param {Array} betKeys - Bet keys
 * @returns {Object} Combo object
 */
function buildComboFromLines(lines, betKeys) {
  // CRITICAL: Use buildComboId from lib/core/keys.js
  const comboId = buildComboId(betKeys);
  
  // Calculate total odds (multiply all)
  const totalOdds = lines.reduce((acc, line) => acc * (line.odds || 1), 1);
  
  // Calculate average EV
  const evValues = lines.map(line => line.value ?? line.ev ?? 0);
  const avgEv = evValues.reduce((a, b) => a + b, 0) / evValues.length;
  
  // Calculate min EV
  const minEv = Math.min(...evValues);
  
  // Extract unique matches
  const matches = new Set(lines.map(line => line.matchSlug || line.slug).filter(Boolean));
  
  return {
    comboId,
    comboNumber: null, // Will be assigned later during sorting
    betKeys,
    lines,
    totalOdds: Number(totalOdds.toFixed(2)),
    avgEv: Number(avgEv.toFixed(2)),
    minEv: Number(minEv.toFixed(2)),
    size: lines.length,
    matchCount: matches.size,
  };
}

/**
 * Assign combo numbers based on sorting criteria.
 * 
 * @param {Array} combos - Array of combos
 * @param {string} [sortBy='avgEv'] - Sort key ('avgEv'|'minEv'|'totalOdds')
 * @param {string} [order='desc'] - Sort order ('asc'|'desc')
 * @returns {Array} Sorted combos with comboNumber assigned
 */
export function assignComboNumbers(combos, sortBy = 'avgEv', order = 'desc') {
  if (!Array.isArray(combos) || combos.length === 0) {
    return [];
  }
  
  // Sort combos
  const sorted = [...combos].sort((a, b) => {
    const aVal = a[sortBy] ?? 0;
    const bVal = b[sortBy] ?? 0;
    return order === 'desc' ? bVal - aVal : aVal - bVal;
  });
  
  // Assign combo numbers (1-indexed)
  sorted.forEach((combo, index) => {
    combo.comboNumber = index + 1;
  });
  
  return sorted;
}

/**
 * Full combo generation pipeline.
 * 
 * @param {Array} allLines - All bet lines from matches
 * @param {Object} filterCriteria - Filter criteria
 * @param {Object} comboOptions - Combo build options
 * @param {string} [sortBy='avgEv'] - Sort key
 * @returns {Object} { filtered, combos, stats }
 * 
 * @example
 * const result = generateCombos(allLines, {
 *   minPriority: 1,
 *   minOdds: 1.5,
 *   minEv: 5
 * }, {
 *   minCombos: 2,
 *   maxCombos: 4,
 *   maxTotal: 50
 * });
 */
export function generateCombos(allLines, filterCriteria = {}, comboOptions = {}, sortBy = 'avgEv') {
  // Step 1: Filter lines
  const filteredLines = filterLines(allLines, filterCriteria);
  
  // Step 2: Build combinations
  const rawCombos = buildCombinations(filteredLines, comboOptions);
  
  // Step 3: Assign combo numbers
  const combos = assignComboNumbers(rawCombos, sortBy);
  
  // Step 4: Compute stats
  const stats = {
    totalLines: allLines.length,
    filteredLines: filteredLines.length,
    totalCombos: combos.length,
    avgComboOdds: combos.length > 0
      ? combos.reduce((sum, c) => sum + c.totalOdds, 0) / combos.length
      : 0,
    avgComboEv: combos.length > 0
      ? combos.reduce((sum, c) => sum + c.avgEv, 0) / combos.length
      : 0,
  };
  
  return {
    filtered: filteredLines,
    combos,
    stats,
  };
}
