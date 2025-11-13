const STAT_KEY_LABELS = {
  totalShotsOnGoal: "Totala skott på mål",
  shotsOnGoal: "Skott på mål",
  cornerKicks: "Hörnor",
  freeKicks: "Frisparkar",
  fouls: "Fouls",
  throwIns: "Inkast",
  offsides: "Offside",
  yellowCards: "Gula kort",
  goalKicks: "Målvaktssparkar",
  totalTackle: "Tacklingar",
};

function toSentenceCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function getStatKeyLabel(statKey) {
  if (!statKey) return "Statistik";
  if (STAT_KEY_LABELS[statKey]) {
    return STAT_KEY_LABELS[statKey];
  }
  return toSentenceCase(statKey);
}

export { STAT_KEY_LABELS };
