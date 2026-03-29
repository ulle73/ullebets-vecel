import { evPct } from "./evPct.js";
import { evPctWithMultiplier } from "./evPctWithMultiplier.js";
import { evPctLeagueAvg } from "./evPctLeagueAvg.js";
import { evPctMultifactor } from "./evPctMultifactor.js";
import { evPctOptaRank } from "./evPctOptaRank.js";
import { evPctOptaRating } from "./evPctOptaRating.js";
import { evPctOptaCombined } from "./evPctOptaCombined.js";
import { evPctOptaPlusBase } from "./evPctOptaPlusBase.js";
import { evPctOptaPlusLeagueAvg } from "./evPctOptaPlusLeagueAvg.js";
import { evPctShotsAdvanced } from "./evPctShotsAdvanced.js";
import { evPctSoTAdvanced } from "./evPctSoTAdvanced.js";
import { evPctFoulsAdvanced } from "./evPctFoulsAdvanced.js";
import { evPctGoalKicksAdvanced } from "./evPctGoalKicksAdvanced.js";
import { evPctThrowInsAdvanced } from "./evPctThrowInsAdvanced.js";
import { evPctUniversalOptimized } from "./evPctUniversalOptimized.js";
import { ML_FORMULAS, isMlTier2Enabled } from "./mlTier2Factory.js";

const STATIC_FORMULAS = [
  evPct,
  evPctWithMultiplier,
  evPctLeagueAvg,
  evPctMultifactor,
  evPctOptaRank,
  evPctOptaRating,
  evPctOptaCombined,
  evPctOptaPlusBase,
  evPctOptaPlusLeagueAvg,
  evPctShotsAdvanced,
  evPctSoTAdvanced,
  evPctFoulsAdvanced,
  evPctGoalKicksAdvanced,
  evPctThrowInsAdvanced,
  evPctUniversalOptimized,
];

export const FORMULA_RUNNERS = isMlTier2Enabled()
  ? [...STATIC_FORMULAS, ...ML_FORMULAS]
  : STATIC_FORMULAS;

export function runFormulas(context) {
  return FORMULA_RUNNERS.reduce((acc, fn) => {
    const partial = fn(context) || {};
    return { ...acc, ...partial };
  }, {});
}
