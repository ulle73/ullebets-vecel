"use strict";

import { canAddLineToCombo } from "@/ai/rules/comboRuleGuard";
import { buildLineKey } from "@/ai/utils/matchupUtils";

const DEFAULTS = {
  legs: 2,
  minOdds: 1.8,
  maxOdds: 2.2,
  maxLines: 32,
  maxCombos: 14,
};

function settleNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function makeLineId(line) {
  if (!line) return null;
  if (line.betKey) return line.betKey;
  const parts = [line.matchId, line.statKey, line.direction, line.line];
  return parts.filter(Boolean).join(":");
}

export function buildCombos(lines = [], options = {}) {
  const {
    legs = DEFAULTS.legs,
    minOdds = DEFAULTS.minOdds,
    maxOdds = DEFAULTS.maxOdds,
    maxLines = DEFAULTS.maxLines,
    maxCombos = DEFAULTS.maxCombos,
    priorityMap = {},
  } = options;

  const sanitizedLegs = Math.max(1, Math.min(ledsValue(legs), 4));
  const sanitizedMinOdds = Math.max(1, settleNumber(minOdds, DEFAULTS.minOdds));
  const sanitizedMaxOdds = Math.max(sanitizedMinOdds, settleNumber(maxOdds, sanitizedMinOdds));

  const validLines = [...lines]
    .filter((line) => line && line.odds && line.odds > 1)
    .map((line) => ({
      ...line,
      primaryEv: settleNumber(line.primaryEv, 0),
      odds: settleNumber(line.odds, 1),
      priority: priorityMap[buildLineKey(line)] ?? 0,
    }))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if ((b.primaryEv ?? 0) !== (a.primaryEv ?? 0)) {
        return (b.primaryEv ?? 0) - (a.primaryEv ?? 0);
      }
      return (b.odds ?? 0) - (a.odds ?? 0);
    })
    .slice(0, Math.max(1, maxLines));

  if (!validLines.length) {
    return [];
  }

  const combos = [];
  const seen = new Set();

  const legsTarget =
    sanitizedLegs === 1 ? 1 : Math.min(sanitizedLegs, validLines.length);

  function recordCombo(candidateLines, totalOdds, totalEv) {
    const key = candidateLines.map((line) => makeLineId(line)).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    combos.push({
      id: key,
      lines: [...candidateLines],
      odds: Number(totalOdds.toFixed(2)),
      totalEv: Number(totalEv.toFixed(2)),
    });
  }

  function walk(start, currentLines, currentOdds, currentEv) {
    if (currentLines.length === legsTarget) {
      if (currentOdds >= sanitizedMinOdds && currentOdds <= sanitizedMaxOdds) {
        recordCombo(currentLines, currentOdds, currentEv);
      }
      return;
    }

    for (let i = start; i < validLines.length; i += 1) {
      if (combos.length >= maxCombos) {
        break;
      }
      const candidate = validLines[i];
      const nextOdds = currentOdds * (candidate.odds || 1);
      if (nextOdds > sanitizedMaxOdds * 1.25) {
        continue;
      }
      if (!canAddLineToCombo(currentLines, candidate)) {
        continue;
      }
      currentLines.push(candidate);
      walk(i + 1, currentLines, nextOdds, currentEv + (candidate.primaryEv || 0));
      currentLines.pop();
    }
  }

  if (legsTarget === 1) {
    validLines.forEach((line) => {
      if (!canAddLineToCombo([], line)) {
        return;
      }
      const totalOdds = line.odds;
      if (totalOdds >= sanitizedMinOdds && totalOdds <= sanitizedMaxOdds) {
        recordCombo([line], totalOdds, line.primaryEv || 0);
      }
    });
  } else {
    walk(0, [], 1, 0);
  }

  combos.sort((a, b) => b.totalEv - a.totalEv);
  return combos.slice(0, maxCombos);
}

function ledsValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : DEFAULTS.legs;
}
