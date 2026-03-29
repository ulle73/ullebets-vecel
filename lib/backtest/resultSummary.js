const CORE_RESULT_FIELDS = [
  { key: "multiplier", valueKey: "evPctWithMultiplier", label: "Multiplier" },
  { key: "multifactor", valueKey: "evPctMultifactor", label: "Multifaktor" },
  { key: "leagueAvg", valueKey: "evPctLeagueAvg", label: "Liga" },
  { key: "base", valueKey: "evPct", label: "Modell" },
  { key: "legacy", valueKey: "legacyEvPct", label: "Legacy" },
];

const STAT_LABELS = {
  totalShots: "Skott",
  shotsOnGoal: "Skott på mål",
  cornerKicks: "Hörnor",
  yellowCards: "Gula kort",
  throwIns: "Inkast",
  freeKicks: "Frisparkar",
  fouls: "Fouls",
  totalTackle: "Tacklingar",
  offsides: "Offside",
};

function clamp(min, value, max) {
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function humanizeStat(statKey) {
  return STAT_LABELS[statKey] || statKey || "Stat";
}

function humanizeDirection(direction) {
  return direction === "under" ? "Under" : "Över";
}

function humanizeScope(scope, result) {
  if (scope === "home") {
    return result?.bet?.homeTeam || "Hemmalag";
  }
  if (scope === "away") {
    return result?.bet?.awayTeam || "Bortalag";
  }
  return "Totalt";
}

export function getCoreFormulaEntries(result) {
  if (!result || typeof result !== "object") {
    return [];
  }

  return CORE_RESULT_FIELDS
    .map((field) => {
      const value = toFiniteNumber(result[field.valueKey]);
      if (value == null) return null;
      return {
        key: field.key,
        label: field.label,
        value,
      };
    })
    .filter(Boolean);
}

export function buildConfidenceMetrics(result) {
  const entries = getCoreFormulaEntries(result);
  const available = entries.length;
  const positive = entries.filter((entry) => entry.value > 0).length;
  const agreementRatio = available ? positive / available : 0;
  const sampleSize = clamp(0, Number(result?.matches) || 0, 25);
  const sampleRatio = sampleSize / 25;
  const primaryEv = Math.max(0, Number(result?.primaryEv) || 0);
  const edgeRatio = clamp(0, primaryEv / 15, 1);

  const confidenceScore = Math.round(
    agreementRatio * 55 + sampleRatio * 25 + edgeRatio * 20
  );

  const agreementLabel =
    agreementRatio >= 0.8
      ? "Stark konsensus"
      : agreementRatio >= 0.6
        ? "Bra konsensus"
        : agreementRatio > 0
          ? "Splittrad"
          : "Ingen konsensus";

  const confidenceLabel =
    confidenceScore >= 75
      ? "Hög"
      : confidenceScore >= 55
        ? "Medium"
        : "Låg";

  return {
    entries,
    available,
    positive,
    agreementRatio,
    agreementPct: Math.round(agreementRatio * 100),
    agreementLabel,
    confidenceScore,
    confidenceLabel,
    sampleSize: Number(result?.matches) || 0,
    autoScore: Math.round(primaryEv * 3 + confidenceScore),
  };
}

export function buildBetHeadline(result) {
  const bet = result?.bet ?? {};
  const direction = humanizeDirection(bet.direction);
  const line = bet.line != null ? bet.line : "–";
  const stat = humanizeStat(bet.statKey);
  return `${direction} ${line} ${stat}`;
}

export function buildPositiveResultsSummary(results = [], unibetUrl = null) {
  const enriched = (Array.isArray(results) ? results : [])
    .map((result) => {
      const metrics = buildConfidenceMetrics(result);
      return {
        ...result,
        ...metrics,
        headline: buildBetHeadline(result),
        scopeLabel: humanizeScope(result?.bet?.scope, result),
      };
    })
    .sort((a, b) => {
      if (b.autoScore !== a.autoScore) return b.autoScore - a.autoScore;
      return (b.primaryEv || 0) - (a.primaryEv || 0);
    });

  return {
    count: enriched.length,
    items: enriched,
    bestBet: enriched[0] || null,
    unibetUrl: unibetUrl || null,
  };
}
