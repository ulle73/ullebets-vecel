const MIN_TOTAL_SCOPE_LINES = {
  totalShots: 10,
  shotsOnGoal: 4,
};

export function isLikelyPlayerMarketLeak(bet = {}) {
  const statKey = String(bet?.statKey || "");
  const scope = String(bet?.scope || "total");
  const period = String(bet?.period || "ALL");
  const line = Number(bet?.line);

  if (!Number.isFinite(line)) return false;
  if (scope !== "total" || period !== "ALL") return false;

  const minLine = MIN_TOTAL_SCOPE_LINES[statKey];
  if (!Number.isFinite(minLine)) return false;

  return line < minLine;
}

export function isValidTrackedBet(bet = {}) {
  if (!bet || typeof bet !== "object") return false;
  if (!bet?.statKey) return false;
  if (!Number.isFinite(Number(bet?.line))) return false;
  return !isLikelyPlayerMarketLeak(bet);
}
