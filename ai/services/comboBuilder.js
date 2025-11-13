"use client";

const COMBO_SIZES = {
  singel: 1,
  dubblar: 2,
  tripplar: 3,
};

function clampRange(min, max) {
  const fixedMin = Number.isFinite(min) ? Math.max(1, min) : 1;
  const fixedMax = Number.isFinite(max) ? Math.max(fixedMin, max) : fixedMin + 0.5;
  return { min: fixedMin, max: fixedMax };
}

function buildSingleCombos(bets, range) {
  return bets
    .filter((bet) => bet.odds >= range.min && bet.odds <= range.max)
    .map((bet) => ({
      bets: [bet],
      totalOdds: bet.odds,
      totalEv: bet.primaryEv,
      score: bet.primaryEv,
    }));
}

function computePriority(totalOdds, totalEv, range) {
  const midpoint = (range.min + range.max) / 2;
  const width = Math.max(range.max - range.min, 0.5);
  const closeness = Math.max(0, 1 - Math.min(Math.abs(totalOdds - midpoint) / width, 1));
  return totalEv + closeness;
}

function buildMultiCombos(bets, size, range, maxResults = 12) {
  const combos = [];
  const candidates = bets.slice(0, 20);

  function helper(start, current, odds, ev) {
    if (current.length === size) {
      if (odds >= range.min && odds <= range.max) {
        combos.push({
          bets: [...current],
          totalOdds: odds,
          totalEv: ev,
          score: computePriority(odds, ev, range),
        });
      }
      return;
    }
    if (start >= candidates.length) {
      return;
    }
    for (let i = start; i < candidates.length; i += 1) {
      const bet = candidates[i];
      if (current.some((entry) => entry.matchId === bet.matchId)) continue;
      const nextOdds = odds * bet.odds;
      const nextEv = ev + bet.primaryEv;
      current.push(bet);
      helper(i + 1, current, nextOdds, nextEv);
      current.pop();
      if (combos.length >= maxResults * 3) break;
    }
  }

  helper(0, [], 1, 0);

  return combos;
}

export function buildCombos(bets = [], type = "singel", min = 1, max = 2.5) {
  if (!bets.length) return [];
  const range = clampRange(min, max);
  const size = COMBO_SIZES[type] || COMBO_SIZES.singel;
  let combos = [];
  if (size === 1) {
    combos = buildSingleCombos(bets, range);
  } else {
    combos = buildMultiCombos(bets, size, range);
  }
  return combos
    .sort((a, b) => b.score - a.score || b.totalEv - a.totalEv)
    .slice(0, 12);
}
