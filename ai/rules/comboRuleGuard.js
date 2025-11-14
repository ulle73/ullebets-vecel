"use strict";

import ruleSet from "./comboRules.json";

const rules = Array.isArray(ruleSet?.rules) ? ruleSet.rules : [];

const normalizeMatchIdentifier = (line) => {
  if (!line) return null;
  if (line.matchId) return String(line.matchId);
  if (line.matchLabel) return String(line.matchLabel);
  return null;
};

const buildSignature = (line) => {
  if (!line) return null;
  const parts = [
    normalizeMatchIdentifier(line),
    line.statKey ?? line.statLabel ?? "",
    line.scope ?? "total",
    line.period ?? "ALL",
  ];
  return parts.filter(Boolean).join("|");
};

const normalizeDirection = (direction) => {
  if (!direction) return null;
  const normalized = String(direction).toLowerCase();
  if (normalized === "over" || normalized === "under") {
    return normalized;
  }
  return null;
};

export function getComboRules() {
  return rules;
}

export function canAddLineToCombo(currentLines = [], candidate) {
  if (!candidate) {
    return false;
  }
  const candidateSignature = buildSignature(candidate);
  const candidateMatch = normalizeMatchIdentifier(candidate);
  const candidateDirection = normalizeDirection(candidate.direction);

  for (const existing of currentLines || []) {
    const existingSignature = buildSignature(existing);
    if (!existingSignature || !candidateSignature) {
      continue;
    }
    if (existingSignature === candidateSignature) {
      return false;
    }

    const existingMatch = normalizeMatchIdentifier(existing);
    const existingDirection = normalizeDirection(existing.direction);

    const sameMatchAndStat =
      candidateMatch &&
      existingMatch &&
      candidateMatch === existingMatch &&
      (existing.statKey ?? existing.statLabel) === (candidate.statKey ?? candidate.statLabel) &&
      (existing.scope ?? "total") === (candidate.scope ?? "total") &&
      (existing.period ?? "ALL") === (candidate.period ?? "ALL");

    if (
      sameMatchAndStat &&
      existingDirection &&
      candidateDirection &&
      existingDirection !== candidateDirection
    ) {
      return false;
    }
  }

  return true;
}
