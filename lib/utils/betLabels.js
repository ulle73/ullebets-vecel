function normalizePeriod(period) {
  return String(period || "ALL").toUpperCase();
}

function normalizeScope(scope) {
  return String(scope || "total").toLowerCase();
}

export function formatBetPeriodLabel(period) {
  const periodKey = normalizePeriod(period);
  if (periodKey === "1ST") return "Första halvlek";
  if (periodKey === "2ND") return "Andra halvlek";
  return "Hela matchen";
}

export function formatBetScopeLabel(scope, homeTeamName = null, awayTeamName = null) {
  const scopeKey = normalizeScope(scope);
  if (scopeKey === "home") {
    return homeTeamName ? `Hemmalaget – ${homeTeamName}` : "Hemmalaget";
  }
  if (scopeKey === "away") {
    return awayTeamName ? `Bortalaget – ${awayTeamName}` : "Bortalaget";
  }
  return "Totalt i matchen";
}

export function formatBetContextLabels(bet = {}, homeTeamName = null, awayTeamName = null) {
  return {
    scopeLabel: formatBetScopeLabel(bet?.scope, homeTeamName, awayTeamName),
    periodLabel: formatBetPeriodLabel(bet?.period),
  };
}
