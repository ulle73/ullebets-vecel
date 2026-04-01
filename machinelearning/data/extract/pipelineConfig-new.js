export const ALL_STATS_NEW = [
  "cornerKicks",
  "fouls",
  "freeKicks",
  "goalKicks",
  "offsides",
  "shotsOnGoal",
  "throwIns",
  "totalShots",
  "totalShotsOnGoal",
  "yellowCards",
];

export const ALL_SCOPES_NEW = ["home", "away", "total"];
export const ALL_PERIODS_NEW = ["ALL", "1ST", "2ND"];
export const FEATURE_MODES_NEW = ["strict", "extended"];
export const DATASET_SPLITS_NEW = ["train", "val", "test"];

export const DATASETS_DIR_NEW = "machinelearning/data/datasets-new";
export const TIER1_OUTPUT_DIR_NEW = "machinelearning/models/trained/tier1-new";
export const TIER2_OUTPUT_DIR_NEW = "machinelearning/models/trained/tier2-new";

export function buildSupportedCombosNew() {
  const combos = [];
  for (const statKey of ALL_STATS_NEW) {
    for (const scope of ALL_SCOPES_NEW) {
      for (const period of ALL_PERIODS_NEW) {
        combos.push({ statKey, scope, period });
      }
    }
  }
  return combos;
}

export function buildDatasetKeyNew(statKey, scope, period) {
  return `${statKey}_${scope}_${period}`;
}

export function buildDatasetFileNameNew({
  statKey,
  scope,
  period,
  featureMode,
  split,
}) {
  return `${buildDatasetKeyNew(statKey, scope, period)}_${featureMode}_${split}.jsonl`;
}

export function parseDatasetFileNameNew(fileName) {
  const match = String(fileName).match(
    /^(?<statKey>.+)_(?<scope>home|away|total)_(?<period>ALL|1ST|2ND)_(?<featureMode>strict|extended)_(?<split>train|val|test)\.jsonl$/,
  );
  if (!match?.groups) {
    throw new Error(`Invalid dataset filename: ${fileName}`);
  }
  return { ...match.groups };
}

const MARKET_FEATURES_NEW = [
  "market_line",
  "market_over_odds",
  "market_implied_over",
  "market_under_odds",
  "market_implied_under",
  "market_margin",
];

const QUALITY_FEATURES_NEW = [
  "quality_home_opta_rank",
  "quality_home_opta_rating",
  "quality_away_opta_rank",
  "quality_away_opta_rating",
  "quality_opta_rank_diff",
  "quality_opta_rating_diff",
];

const WMA_FEATURES_NEW = [
  "wma_home_for_recent",
  "wma_home_for_medium",
  "wma_home_for_long",
  "wma_away_for_recent",
  "wma_away_for_medium",
  "wma_away_for_long",
  "wma_home_against_recent",
  "wma_home_against_medium",
  "wma_home_against_long",
  "wma_away_against_recent",
  "wma_away_against_medium",
  "wma_away_against_long",
];

export const FORMULA_FEATURE_KEYS_NEW = [
  "evPctMultifactor",
  "evPctUniversalOptimized",
  "evPctOptaCombined",
  "evPctLeagueAvg",
  "evPctOptaRating",
  "evPctBase",
  "evPctPoisson",
];

const FORMULA_FEATURES_NEW = FORMULA_FEATURE_KEYS_NEW.map(
  (key) => `formula_${key}`,
);

const CONSENSUS_FEATURES_NEW = [
  "consensus_count",
  "consensus_mean",
  "consensus_std",
  "consensus_range",
  "consensus_max",
  "consensus_min",
  "consensus_median",
];

const FLAG_FEATURES_NEW = [
  "flag_no_odds",
  "flag_supervised",
  "flag_has_formulas",
  "flag_scope_home",
  "flag_scope_away",
  "flag_scope_total",
  "flag_period_all",
  "flag_period_1st",
  "flag_period_2nd",
];

const PROFILE_FEATURES_NEW = [
  "profile_home_value",
  "profile_home_rank",
  "profile_away_value",
  "profile_away_rank",
  "profile_home_rank_for",
  "profile_home_rank_against",
  "profile_away_rank_for",
  "profile_away_rank_against",
  "profile_matchup_score",
  "profile_home_score_first_pct",
  "profile_away_score_first_pct",
  "profile_score_first_diff",
  "profile_home_shots_per_min_leading",
  "profile_home_shots_per_min_trailing",
  "profile_home_shots_per_min_tied",
  "profile_away_shots_per_min_leading",
  "profile_away_shots_per_min_trailing",
  "profile_away_shots_per_min_tied",
  "profile_home_shots_per_ten",
  "profile_away_shots_per_ten",
];

export const EXTRA_PROFILE_KEYS_NEW = [
  "ballPossession",
  "passes",
  "accuratePasses",
  "finalThirdEntries",
  "touchesInOppBox",
  "expectedGoals",
  "bigChanceCreated",
  "bigChanceMissed",
  "bigChanceScored",
  "shotsOffGoal",
  "totalShotsInsideBox",
  "totalShotsOutsideBox",
  "accurateCross",
  "accurateLongBalls",
  "ballRecovery",
  "interceptionWon",
  "dispossessed",
  "blockedScoringAttempt",
  "duelWonPercent",
  "groundDuelsPercentage",
  "aerialDuelsPercentage",
  "cleanSheets",
  "goalsConceded",
  "tackles",
  "clearances",
  "dribbles",
  "dribblesCompleted",
  "touches",
  "duels",
  "groundDuels",
  "aerialDuels",
];

const EXTRA_PROFILE_FEATURES_NEW = EXTRA_PROFILE_KEYS_NEW.flatMap((key) => [
  `profile_extra_home_for_${key}`,
  `profile_extra_away_for_${key}`,
  `profile_extra_home_against_${key}`,
  `profile_extra_away_against_${key}`,
]);

export function buildFeatureNamesNew(featureMode) {
  const names = [
    ...MARKET_FEATURES_NEW,
    ...QUALITY_FEATURES_NEW,
    ...WMA_FEATURES_NEW,
    ...FORMULA_FEATURES_NEW,
    ...CONSENSUS_FEATURES_NEW,
    ...FLAG_FEATURES_NEW,
  ];

  if (featureMode === "extended") {
    names.push(...PROFILE_FEATURES_NEW, ...EXTRA_PROFILE_FEATURES_NEW);
  }

  return names;
}
