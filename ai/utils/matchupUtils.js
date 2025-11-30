"use strict";

const MATCH_ID_ACCESSORS = [
  (match) => match.matchId,
  (match) => match.id,
  (match) => match.raw?.matchId,
  (match) => match.raw?.event?.id,
  (match) => match.raw?.event?.matchId,
];

const normalizeStringId = (value) => {
  if (value == null) return null;
  return String(value);
};

const normalizeMatchLabel = (label) => {
  if (!label) return "";
  return String(label).trim().toLowerCase();
};

export function buildMatchLookup(matches = []) {
  const map = new Map();
  matches.forEach((match) => {
    MATCH_ID_ACCESSORS.forEach((accessor) => {
      const candidate = normalizeStringId(accessor(match));
      if (candidate) {
        map.set(candidate, match);
      }
    });
  });
  return map;
}

export function buildMatchupKey(entry = {}) {
  const parts = [
    normalizeStringId(entry.matchId),
    entry.statKey ?? entry.statLabel ?? "",
    entry.period ?? "ALL",
    entry.scope ?? "total",
    entry.condition ?? "over",
  ];
  return parts.join("|");
}


export function buildMatchLabelSignature(line = {}) {
  const parts = [
    normalizeMatchLabel(line.matchLabel ?? line.match ?? ""),
    (line.statKey ?? line.statLabel ?? "").toLowerCase(),
    (line.period ?? "ALL").toString().toLowerCase(),
    (line.scope ?? "total").toLowerCase(),
    (line.direction ?? "over").toLowerCase(),
  ];
  return parts.join("|");
}
