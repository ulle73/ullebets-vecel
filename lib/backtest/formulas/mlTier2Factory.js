import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calibrateEv } from '../math.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lista över tillgängliga Tier 2-modeller (baserat på tränade modeller)
const AVAILABLE_COMBOS = [
  // Total Shots
  ['totalShots', 'total', 'ALL'],
  ['totalShots', 'home', 'ALL'],
  ['totalShots', 'away', 'ALL'],
  ['totalShots', 'total', '1ST'],
  ['totalShots', 'total', '2ND'],

  // Shots on Goal
  ['shotsOnGoal', 'total', 'ALL'],
  ['shotsOnGoal', 'home', 'ALL'],
  ['shotsOnGoal', 'away', 'ALL'],
  ['shotsOnGoal', 'total', '1ST'],
  ['shotsOnGoal', 'total', '2ND'],

  // Corner Kicks
  ['cornerKicks', 'total', 'ALL'],
  ['cornerKicks', 'home', 'ALL'],
  ['cornerKicks', 'away', 'ALL'],
  ['cornerKicks', 'total', '1ST'],
  ['cornerKicks', 'total', '2ND'],

  // Fouls
  ['fouls', 'total', 'ALL'],
  ['fouls', 'home', 'ALL'],
  ['fouls', 'away', 'ALL'],

  // Free Kicks
  ['freeKicks', 'total', 'ALL'],
  ['freeKicks', 'home', 'ALL'],
  ['freeKicks', 'away', 'ALL'],

  // Throw Ins
  ['throwIns', 'total', 'ALL'],
  ['throwIns', 'home', 'ALL'],
  ['throwIns', 'away', 'ALL'],

  // Offsides
  ['offsides', 'total', 'ALL'],
  ['offsides', 'home', 'ALL'],
  ['offsides', 'away', 'ALL'],

  // Goal Kicks
  ['goalKicks', 'total', 'ALL'],
  ['goalKicks', 'home', 'ALL'],
  ['goalKicks', 'away', 'ALL'],

  // Yellow Cards
  ['yellowCards', 'total', 'ALL'],
  ['yellowCards', 'home', 'ALL'],
  ['yellowCards', 'away', 'ALL'],

  // Total Tackle
  ['totalTackle', 'total', 'ALL'],
  ['totalTackle', 'home', 'ALL'],
  ['totalTackle', 'away', 'ALL'],
];

// Cache för laddade modeller
const modelCache = new Map();

function getModelPath(statKey, scope, period) {
  return path.join(__dirname, '../../../machinelearning/models/trained/tier2', `${statKey}_${scope}_${period}_stacked.json`);
}

function loadXGBoostModel(modelPath) {
  if (modelCache.has(modelPath)) {
    return modelCache.get(modelPath);
  }

  try {
    if (!fs.existsSync(modelPath)) {
      console.warn(`ML Model not found: ${modelPath} - using placeholder`);
      // Return placeholder model that gives reasonable predictions
      const placeholderModel = {
        predict: (features) => {
          // Simple placeholder: return a value based on some features
          // This will be replaced with real XGBoost loading
          const baseProb = 0.5; // Placeholder probability
          return [baseProb + (Math.random() - 0.5) * 0.2]; // Add some noise
        }
      };
      modelCache.set(modelPath, placeholderModel);
      return placeholderModel;
    }

    // TODO: Implementera riktig XGBoost-laddning för Node.js
    // För närvarande använder vi placeholder
    console.log(`Loading ML model: ${modelPath}`);
    const model = {
      predict: (features) => {
        // Placeholder prediction - ersätt med riktig modell
        const baseProb = 0.5;
        return [baseProb + (Math.random() - 0.5) * 0.1];
      }
    };
    modelCache.set(modelPath, model);
    return model;
  } catch (error) {
    console.error(`Failed to load ML model ${modelPath}:`, error.message);
    return null;
  }
}

function buildTier2Features(context, tier1Model = null, selectedFeatures = null, formulaKeys = []) {
  const features = [];

  // Första versionen: Använd samma features som skickas till runFormulas
  // Detta är en förenklad version - i praktiken behöver du matcha exakt
  // vad Tier 2-modellen tränades på

  const { baseResult, oddsValue, implied, homeBundle, awayBundle } = context;

  // 1. Raw features från baseResult (om tillgängliga)
  if (baseResult?.rawFeatures) {
    features.push(...baseResult.rawFeatures);
  } else {
    // Placeholder: lägg till 197 nollor eller meningsfulla defaults
    features.push(...new Array(197).fill(0));
  }

  // 2. Formula predictions (placeholder för nu)
  // I verkligheten skulle du samla alla formula predictions här
  features.push(...new Array(10).fill(0)); // Placeholder för formula predictions

  // 3. Consensus features
  features.push(0, 0, 0, 0, 0); // std, range, max, min, median

  // 4. Tier 1 prediction (placeholder)
  features.push(0.5);

  return features;
}

function createMLFormula(statKey, scope, period) {
  const formulaName = `ml_${statKey}_${scope}_${period}`;
  const modelPath = getModelPath(statKey, scope, period);

  return function mlTier2Formula(context) {
    const { baseResult, oddsValue, implied, probabilityOf, homeBundle, awayBundle, params } = context;

    // Kontrollera att params matchar
    if (!params || params.statKey !== statKey || params.scope !== scope) {
      return { [formulaName]: null };
    }

    const model = loadXGBoostModel(modelPath);
    if (!model) {
      return { [formulaName]: null };
    }

    try {
      // Bygg features (detta behöver implementeras baserat på din data)
      const features = buildTier2Features(context.sample || {}, null, null, []);

      // Predicera med modellen
      const rawPrediction = model.predict([features])[0];

      // Konvertera till probability (antar att modellen predicerar expected value)
      const modelProb = Math.max(0, Math.min(1, rawPrediction));

      // Beräkna EV%
      const rawEvPct = modelProb != null && oddsValue != null
        ? modelProb * oddsValue * 100 - 100
        : null;

      const evPctValue = rawEvPct != null ? calibrateEv(rawEvPct) : null;

      return {
        [formulaName]: evPctValue,
        [`${formulaName}_prob`]: modelProb,
        [`${formulaName}_raw`]: rawEvPct,
      };
    } catch (error) {
      console.error(`ML Formula ${formulaName} prediction failed:`, error.message);
      return { [formulaName]: null };
    }
  };
}

// Generera alla ML-formler för tillgängliga kombinationer
export const ML_FORMULAS = AVAILABLE_COMBOS.map(([statKey, scope, period]) =>
  createMLFormula(statKey, scope, period)
);

// Export individuellt för enklare debugging
export const ml_totalShots_total_ALL = createMLFormula('totalShots', 'total', 'ALL');
export const ml_totalShots_home_ALL = createMLFormula('totalShots', 'home', 'ALL');
export const ml_totalShots_away_ALL = createMLFormula('totalShots', 'away', 'ALL');
// ... kan lägga till fler exports om needed

// Funktion för att kontrollera vilka modeller som finns
export function getAvailableMLFormulas() {
  return AVAILABLE_COMBOS.filter(([statKey, scope, period]) => {
    const modelPath = getModelPath(statKey, scope, period);
    return fs.existsSync(modelPath);
  });
}