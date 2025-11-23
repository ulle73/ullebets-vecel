export function evPctShotsAdvanced({
  baseResult,
  oddsValue,
  implied,
  probabilityOf,
  homeBundle,
  awayBundle,
}) {
  const baseLambda = baseResult?.lambda;
  if (!Number.isFinite(baseLambda)) return { evPctShotsAdvanced: null };

  // Helper to safely extract a metric average from a bundle (simplified)
  const getMetric = (bundle, group, key) => {
    // Try to get from 'home' profile first, then 'away'
    const profile = bundle?.home || bundle?.away;
    const val = profile?.statistics?.[group]?.[key]?.ALL?.value;
    return val ? parseFloat(val) : null;
  };

  const homePossession = getMetric(homeBundle, "matchOverview", "ballPossession");
  const awayPossession = getMetric(awayBundle, "matchOverview", "ballPossession");
  
  const homeEntries = getMetric(homeBundle, "passes", "finalThirdEntries");
  const awayEntries = getMetric(awayBundle, "passes", "finalThirdEntries");

  let adjustment = 1;

  // Possession Logic: More possession -> slightly more shots expected
  if (homePossession && awayPossession) {
    const diff = homePossession - awayPossession; // e.g., 55 - 45 = 10
    adjustment += (diff * 0.005); // +5% for 10% possession diff
  }

  // Entries Logic: More entries -> more shots expected
  if (homeEntries && awayEntries) {
    const diff = homeEntries - awayEntries;
    adjustment += (diff * 0.002); 
  }

  const adjustedLambda = baseLambda * adjustment;
  const modelProb = probabilityOf(adjustedLambda);
  
  if (!modelProb) return { evPctShotsAdvanced: null };

  const evPct = (modelProb * oddsValue) - 1;

  return {
    evPctShotsAdvanced: Number(evPct.toFixed(4)),
    shotsAdvancedLambda: Number(adjustedLambda.toFixed(2)),
    shotsAdvancedProb: Number(modelProb.toFixed(4)),
  };
}
