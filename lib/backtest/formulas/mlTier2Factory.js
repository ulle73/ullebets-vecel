import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { calibrateEv } from "../math.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENABLE_ML_TIER2 = process.env.ENABLE_ML_TIER2 === "1";

const AVAILABLE_COMBOS = [
  ["totalShots", "total", "ALL"],
  ["totalShots", "home", "ALL"],
  ["totalShots", "away", "ALL"],
  ["totalShots", "total", "1ST"],
  ["totalShots", "total", "2ND"],
  ["shotsOnGoal", "total", "ALL"],
  ["shotsOnGoal", "home", "ALL"],
  ["shotsOnGoal", "away", "ALL"],
  ["shotsOnGoal", "total", "1ST"],
  ["shotsOnGoal", "total", "2ND"],
  ["cornerKicks", "total", "ALL"],
  ["cornerKicks", "home", "ALL"],
  ["cornerKicks", "away", "ALL"],
  ["cornerKicks", "total", "1ST"],
  ["cornerKicks", "total", "2ND"],
  ["fouls", "total", "ALL"],
  ["fouls", "home", "ALL"],
  ["fouls", "away", "ALL"],
  ["freeKicks", "total", "ALL"],
  ["freeKicks", "home", "ALL"],
  ["freeKicks", "away", "ALL"],
  ["throwIns", "total", "ALL"],
  ["throwIns", "home", "ALL"],
  ["throwIns", "away", "ALL"],
  ["offsides", "total", "ALL"],
  ["offsides", "home", "ALL"],
  ["offsides", "away", "ALL"],
  ["goalKicks", "total", "ALL"],
  ["goalKicks", "home", "ALL"],
  ["goalKicks", "away", "ALL"],
  ["yellowCards", "total", "ALL"],
  ["yellowCards", "home", "ALL"],
  ["yellowCards", "away", "ALL"],
  ["totalTackle", "total", "ALL"],
  ["totalTackle", "home", "ALL"],
  ["totalTackle", "away", "ALL"],
];

const modelCache = new Map();

function getModelPath(statKey, scope, period) {
  return path.join(
    __dirname,
    "../../../machinelearning/models/trained/tier2",
    `${statKey}_${scope}_${period}_stacked.json`
  );
}

function readModelDefinition(modelPath) {
  if (modelCache.has(modelPath)) {
    return modelCache.get(modelPath);
  }

  if (!fs.existsSync(modelPath)) {
    modelCache.set(modelPath, null);
    return null;
  }

  try {
    const raw = fs.readFileSync(modelPath, "utf-8");
    const parsed = JSON.parse(raw);
    modelCache.set(modelPath, parsed);
    return parsed;
  } catch (error) {
    console.error(`[mlTier2Factory] Failed to read model ${modelPath}:`, error.message);
    modelCache.set(modelPath, null);
    return null;
  }
}

function getFormulaName(statKey, scope, period) {
  return `ml_${statKey}_${scope}_${period}`;
}

function computeSafeModelResult(context, formulaName, modelPath) {
  const modelDefinition = readModelDefinition(modelPath);
  if (!modelDefinition) {
    return {};
  }

  // Tier 2-modelerna finns som filer men någon riktig runtime-loader för dem
  // är ännu inte inkopplad i Next-miljön. Vi returnerar därför inga ML-värden
  // förrän den delen är implementerad på riktigt.
  const modelProb = null;
  const oddsValue = Number(context?.oddsValue);
  const rawEvPct =
    modelProb != null && Number.isFinite(oddsValue) && oddsValue > 0
      ? modelProb * oddsValue * 100 - 100
      : null;
  const evPctValue = rawEvPct != null ? calibrateEv(rawEvPct) : null;

  return {
    [formulaName]: evPctValue,
    [`${formulaName}_prob`]: modelProb,
    [`${formulaName}_raw`]: rawEvPct,
  };
}

function createMLFormula(statKey, scope, period) {
  const formulaName = getFormulaName(statKey, scope, period);
  const modelPath = getModelPath(statKey, scope, period);

  return function mlTier2Formula(context) {
    const { params } = context || {};
    if (
      !params ||
      params.statKey !== statKey ||
      params.scope !== scope ||
      params.period !== period
    ) {
      return {};
    }

    if (!ENABLE_ML_TIER2) {
      return {};
    }

    return computeSafeModelResult(context, formulaName, modelPath);
  };
}

export function isMlTier2Enabled() {
  return ENABLE_ML_TIER2;
}

export function getAvailableMLFormulas() {
  return AVAILABLE_COMBOS.filter(([statKey, scope, period]) =>
    fs.existsSync(getModelPath(statKey, scope, period))
  );
}

export const ML_FORMULAS = AVAILABLE_COMBOS.map(([statKey, scope, period]) =>
  createMLFormula(statKey, scope, period)
);

export const ml_totalShots_total_ALL = createMLFormula("totalShots", "total", "ALL");
export const ml_totalShots_home_ALL = createMLFormula("totalShots", "home", "ALL");
export const ml_totalShots_away_ALL = createMLFormula("totalShots", "away", "ALL");
