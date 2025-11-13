export const DEFAULT_SCOPE_LABELS = {
  total: "Totalt",
  home: "Hemmalaget",
  away: "Bortalaget",
};

export function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function splitMatchLabel(matchLabel) {
  if (!matchLabel) {
    return { home: null, away: null };
  }

  const parts = matchLabel.split(" vs ");
  const [home = "", away = ""] = parts.map((part) => part.trim());
  return {
    home: home || null,
    away: away || null,
  };
}

export function deriveScopeLabel(scope, matchLabel, customLabel) {
  if (customLabel) {
    return customLabel;
  }

  const { home, away } = splitMatchLabel(matchLabel);
  if (scope === "home") {
    return home ? `Hemmalaget – ${home}` : DEFAULT_SCOPE_LABELS.home;
  }
  if (scope === "away") {
    return away ? `Bortalaget – ${away}` : DEFAULT_SCOPE_LABELS.away;
  }
  return DEFAULT_SCOPE_LABELS.total;
}
