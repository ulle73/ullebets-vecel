import { deriveFormula } from "./derive_formula.js";

// All stats to optimize
const STATS = [
  "totalShotsOnGoal",  // Skott
  "shotsOnGoal",        // Skott på mål
  "cornerKicks",        // Hörnor
  "throwIns",           // Inkast
  "fouls",              // Fouls
  "offsides",           // Offside
  "goalKicks",          // Insparkar
  "yellowCards",        // Gula kort
];

async function main() {
  console.log("Starting Multi-Stat Universal Formula Derivation...");
  console.log("This will derive optimal formulas for all stats using ALL teams.");
  console.log("--------------------------------------------------\n");

  const results = {};

  for (const stat of STATS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`DERIVING FORMULA FOR: ${stat.toUpperCase()}`);
    console.log(`${"=".repeat(60)}\n`);

    try {
      // Derive formula for Home games
      const homeFormula = await deriveFormula("home", stat);
      
      // Derive formula for Away games
      const awayFormula = await deriveFormula("away", stat);

      results[stat] = {
        home: homeFormula,
        away: awayFormula
      };

      console.log(`\n✓ ${stat} formulas derived successfully.\n`);
    } catch (err) {
      console.error(`✗ Error deriving formula for ${stat}:`, err.message);
      results[stat] = { error: err.message };
    }
  }

  // Output summary
  console.log("\n" + "=".repeat(60));
  console.log("FINAL RESULTS - UNIVERSAL FORMULAS");
  console.log("=".repeat(60) + "\n");

  for (const [stat, formulas] of Object.entries(results)) {
    console.log(`\n${stat.toUpperCase()}:`);
    if (formulas.error) {
      console.log(`  Error: ${formulas.error}`);
    } else {
      console.log(`  HOME: W:[${formulas.home.weights.recent},${formulas.home.weights.medium},${formulas.home.weights.old}], M:${formulas.home.multiplier}, B:${formulas.home.bias}`);
      console.log(`  AWAY: W:[${formulas.away.weights.recent},${formulas.away.weights.medium},${formulas.away.weights.old}], M:${formulas.away.multiplier}, B:${formulas.away.bias}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Optimization Complete!");
  console.log("=".repeat(60));
}

main();
