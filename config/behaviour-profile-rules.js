/**
 * Over/Under Behaviour Profile Rules
 * 
 * This file contains configurable rules for classifying teams into
 * Over/Under behaviour profiles based on shooting volume, response
 * to game state, and goal timing.
 * 
 * All thresholds can be adjusted here without modifying the core logic.
 */

// Profile definitions with keys, scores, and labels
export const PROFILES = {
  VERY_STRONG_OVER: { key: "VERY_STRONG_OVER", score: 2, label: "Very Strong Over", emoji: "🔥" },
  STRONG_OVER: { key: "STRONG_OVER", score: 1, label: "Strong Over", emoji: "🔴" },
  NEUTRAL: { key: "NEUTRAL", score: 0, label: "Neutral", emoji: "⚪" },
  STRONG_UNDER: { key: "STRONG_UNDER", score: -1, label: "Strong Under", emoji: "🔵" },
  VERY_STRONG_UNDER: { key: "VERY_STRONG_UNDER", score: -2, label: "Very Strong Under", emoji: "🧊" },
};

// Priority order for profile evaluation (first match wins)
export const PROFILE_PRIORITY = [
  "VERY_STRONG_OVER",
  "STRONG_OVER",
  "VERY_STRONG_UNDER",
  "STRONG_UNDER",
  "NEUTRAL",
];

/**
 * Threshold multipliers and values for each profile.
 * All percentages are on a 0-100 scale.
 * 
 * Variables available in evaluation context:
 * - shots_trailing: team's shots/min when trailing
 * - shots_leading: team's shots/min when leading
 * - shots_tied: team's shots/min when tied
 * - league_avg_trailing: league avg shots/min when trailing
 * - league_avg_leading: league avg shots/min when leading
 * - league_avg_tied: league avg shots/min when tied
 * - delta_trail_lead: shots_trailing - shots_leading
 * - shots_avg_match: average total shots per match (FOR only)
 * - league_avg_match: league average total shots per match
 * - score_first_pct: % of matches where team scores first (0-100)
 * - concede_first_pct: % of matches where team concedes first (0-100)
 * - avg_min_score: average minute of first goal scored
 * - avg_min_concede: average minute of first goal conceded
 */

export const THRESHOLDS = {
  VERY_STRONG_OVER: {
    // ALL conditions must be met
    type: "ALL",
    conditions: [
      { field: "shots_trailing", op: ">=", multiplier: 1.25, base: "league_avg_trailing" },
      { field: "shots_leading", op: ">=", multiplier: 0.95, base: "league_avg_leading" },
      { field: "delta_trail_lead", op: ">=", multiplier: 0.06, base: "league_avg_match" },
      { field: "score_first_pct", op: ">=", value: 55 },
      { field: "avg_min_score", op: "<=", value: 20 },
      // OR condition: concede_first_pct >= 40 OR avg_min_concede <= 35
      { type: "OR", conditions: [
        { field: "concede_first_pct", op: ">=", value: 40 },
        { field: "avg_min_concede", op: "<=", value: 35 },
      ]},
    ],
  },

  STRONG_OVER: {
    // At least 4 of 6 conditions must be met
    type: "MIN",
    minCount: 4,
    conditions: [
      { field: "shots_trailing", op: ">=", multiplier: 1.15, base: "league_avg_trailing" },
      { field: "delta_trail_lead", op: ">=", multiplier: 0.04, base: "league_avg_match" },
      { field: "shots_avg_match", op: ">=", multiplier: 1.10, base: "league_avg_match" },
      { field: "score_first_pct", op: ">=", value: 52 },
      { field: "avg_min_score", op: "<=", value: 25 },
      { field: "avg_min_concede", op: "<=", value: 40 },
    ],
  },

  NEUTRAL: {
    // ALL conditions must be met
    type: "ALL",
    conditions: [
      // shots_trailing within ±10% of league_avg_trailing
      { field: "shots_trailing", op: "within", tolerance: 0.10, base: "league_avg_trailing" },
      // |delta_trail_lead| <= 0.03 * league_avg_match
      { field: "delta_trail_lead", op: "abs_lte", multiplier: 0.03, base: "league_avg_match" },
      // score_first_pct between 45 and 55
      { field: "score_first_pct", op: "between", min: 45, max: 55 },
      // avg_min_score between 20 and 30
      { field: "avg_min_score", op: "between", min: 20, max: 30 },
      // avg_min_concede between 30 and 45
      { field: "avg_min_concede", op: "between", min: 30, max: 45 },
    ],
  },

  STRONG_UNDER: {
    // At least 4 of 6 conditions must be met
    type: "MIN",
    minCount: 4,
    conditions: [
      { field: "shots_trailing", op: "<=", multiplier: 0.90, base: "league_avg_trailing" },
      { field: "shots_leading", op: "<=", multiplier: 0.85, base: "league_avg_leading" },
      { field: "delta_trail_lead", op: "<=", multiplier: 0.02, base: "league_avg_match" },
      { field: "shots_avg_match", op: "<=", multiplier: 0.95, base: "league_avg_match" },
      { field: "score_first_pct", op: "<=", value: 48 },
      { field: "avg_min_score", op: ">=", value: 28 },
    ],
  },

  VERY_STRONG_UNDER: {
    // ALL conditions must be met
    type: "ALL",
    conditions: [
      { field: "shots_trailing", op: "<=", multiplier: 0.80, base: "league_avg_trailing" },
      { field: "shots_leading", op: "<=", multiplier: 0.80, base: "league_avg_leading" },
      { field: "delta_trail_lead", op: "<=", multiplier: 0.01, base: "league_avg_match" },
      { field: "shots_avg_match", op: "<=", multiplier: 0.90, base: "league_avg_match" },
      { field: "score_first_pct", op: "<=", value: 45 },
      { field: "avg_min_score", op: ">=", value: 32 },
      { field: "avg_min_concede", op: ">=", value: 45 },
    ],
  },
};

/**
 * Evaluate a single condition against the context values
 */
function evaluateCondition(condition, context) {
  const { field, op, value, multiplier, base, tolerance, min, max, type, conditions } = condition;

  // Handle nested OR conditions
  if (type === "OR" && Array.isArray(conditions)) {
    return conditions.some(c => evaluateCondition(c, context));
  }

  const fieldValue = context[field];
  if (fieldValue === null || fieldValue === undefined || !Number.isFinite(fieldValue)) {
    return false; // Missing data fails the condition
  }

  let threshold;
  if (base) {
    const baseValue = context[base];
    if (!Number.isFinite(baseValue)) return false;
    threshold = baseValue * (multiplier ?? 1);
  } else {
    threshold = value;
  }

  switch (op) {
    case ">=":
      return fieldValue >= threshold;
    case "<=":
      return fieldValue <= threshold;
    case ">":
      return fieldValue > threshold;
    case "<":
      return fieldValue < threshold;
    case "within":
      // Value is within ±tolerance% of base
      const baseVal = context[base];
      if (!Number.isFinite(baseVal)) return false;
      const lower = baseVal * (1 - tolerance);
      const upper = baseVal * (1 + tolerance);
      return fieldValue >= lower && fieldValue <= upper;
    case "abs_lte":
      // |value| <= threshold
      return Math.abs(fieldValue) <= threshold;
    case "between":
      return fieldValue >= min && fieldValue <= max;
    default:
      console.warn(`Unknown operator: ${op}`);
      return false;
  }
}

/**
 * Evaluate a profile's threshold rules against the context
 */
function evaluateProfile(profileKey, context) {
  const rules = THRESHOLDS[profileKey];
  if (!rules) return false;

  const results = rules.conditions.map(c => evaluateCondition(c, context));

  switch (rules.type) {
    case "ALL":
      return results.every(r => r === true);
    case "MIN":
      const passCount = results.filter(r => r === true).length;
      return passCount >= rules.minCount;
    default:
      return false;
  }
}

/**
 * Main function to compute the behaviour profile for a team
 * 
 * @param {Object} specials - The team's specials object from teamprofile
 * @param {Object} leagueAverage - The league's average specials object
 * @param {string} side - "for" (offensive) or "against" (defensive), default "for"
 * @returns {Object} { key, score, label, emoji }
 */
export function computeBehaviourProfile(specials, leagueAverage, side = "for") {
  // Build context object with all required variables
  const shotsPerMin = specials?.shotsPerMinute || {};
  const firstGoal = specials?.firstGoal || {};
  const leagueShotsPerMin = leagueAverage?.shotsPerMinute || {};
  const leagueFirstGoal = leagueAverage?.firstGoal || {};

  // Use the 'side' parameter to read from .for or .against
  const shots_trailing = shotsPerMin[side]?.trailing ?? null;
  const shots_leading = shotsPerMin[side]?.leading ?? null;
  const shots_tied = shotsPerMin[side]?.tied ?? null;

  const league_avg_trailing = leagueShotsPerMin[side]?.trailing ?? null;
  const league_avg_leading = leagueShotsPerMin[side]?.leading ?? null;
  const league_avg_tied = leagueShotsPerMin[side]?.tied ?? null;

  // Calculate delta_trail_lead
  const delta_trail_lead = (shots_trailing !== null && shots_leading !== null)
    ? shots_trailing - shots_leading
    : null;

  // Calculate shots_avg_match (average of shots in all game states)
  // This is a simplification - multiply by approximate game state durations
  const shots_avg_match = (shots_trailing !== null && shots_leading !== null && shots_tied !== null)
    ? (shots_trailing + shots_leading + shots_tied) / 3 * 90 // Convert to per-match basis
    : null;

  const league_avg_match = (league_avg_trailing !== null && league_avg_leading !== null && league_avg_tied !== null)
    ? (league_avg_trailing + league_avg_leading + league_avg_tied) / 3 * 90
    : null;

  // First goal percentages (convert from 0-1 to 0-100)
  const score_first_pct = firstGoal.scoreFirstPercentage !== null
    ? firstGoal.scoreFirstPercentage * 100
    : null;
  
  const concede_first_pct = firstGoal.concedeFirstPercentage !== null
    ? firstGoal.concedeFirstPercentage * 100
    : null;

  // Average timing of first goals
  const avg_min_score = firstGoal.averageTimeScoredFirst ?? null;
  const avg_min_concede = firstGoal.averageTimeConcededFirst ?? null;

  const context = {
    shots_trailing,
    shots_leading,
    shots_tied,
    league_avg_trailing,
    league_avg_leading,
    league_avg_tied,
    delta_trail_lead,
    shots_avg_match,
    league_avg_match,
    score_first_pct,
    concede_first_pct,
    avg_min_score,
    avg_min_concede,
  };

  // Evaluate profiles in priority order
  for (const profileKey of PROFILE_PRIORITY) {
    if (evaluateProfile(profileKey, context)) {
      return { ...PROFILES[profileKey], context };
    }
  }

  // Default to NEUTRAL if no profile matches
  return { ...PROFILES.NEUTRAL, context };
}
