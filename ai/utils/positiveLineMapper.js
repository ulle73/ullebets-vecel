"use strict";

export function mapBacktestResultToLine(match, result, unibetUrl = null) {
  if (!match || !result) {
    return null;
  }

  const bet = result.bet;
  if (!bet) {
    return null;
  }

  const matchId = match.matchId ?? match.id ?? null;
  const home = match.homeTeamName ?? "";
  const away = match.awayTeamName ?? "";
  const homeTeamId = match.homeTeam?.id ?? match.homeTeamId ?? null;
  const awayTeamId = match.awayTeam?.id ?? match.awayTeamId ?? null;
  const label = [home, away].filter(Boolean).join(" vs ");
  const oddsValue = Number(bet.odds);
  const lineValue = Number(bet.line);

  return {
    betKey: `${bet.key}`,
    matchId: matchId ? String(matchId) : null,
    matchLabel: label || "Match",
    leagueName: match.leagueName ?? match.raw?.league?.name ?? null,
    scope: bet.scope ?? "total",
    period: bet.period ?? "ALL",
    direction: bet.direction ?? "over",
    statKey: bet.statKey ?? null,
    odds: Number.isFinite(oddsValue) ? oddsValue : null,
    line: Number.isFinite(lineValue) ? lineValue : null,
    primaryEv: typeof result.primaryEv === "number" ? result.primaryEv : null,
    primaryLabel: result.primaryLabel ?? null,
    teams: {
      home,
      away,
      homeId: homeTeamId,
      awayId: awayTeamId,
    },
    unibetUrl: unibetUrl ?? match.unibetUrl ?? match.raw?.unibetUrl ?? null,
  };
}
