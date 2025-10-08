export function normalizeTeamName(name) {
  if (!name || typeof name !== "string") return "";
  return name.trim();
}

export function slugifyTeamName(name) {
  return normalizeTeamName(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export function makeTeamKey(homeTeam, awayTeam) {
  const homeSlug = slugifyTeamName(homeTeam);
  const awaySlug = slugifyTeamName(awayTeam);
  if (!homeSlug || !awaySlug) return "default";
  return `${homeSlug}__${awaySlug}`;
}

function stripTrailingSlash(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\/+$/, "");
}

export function getBackendBaseUrl() {
  const envBase =
    stripTrailingSlash(process.env.NEXT_PUBLIC_BACKEND_BASE_URL) ||
    stripTrailingSlash(process.env.BACKEND_BASE_URL);
  if (envBase) return envBase;
  return "";
}

export function buildBackendUrl(pathname) {
  if (!pathname) {
    return "/api";
  }
  if (pathname.startsWith("http")) return pathname;
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `/api${normalized}`;
}

export function buildBacktestApiUrl(pathname = "") {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `/api/backtest${normalized}`;
}

export function formatPercent(value, { decimals = 1 } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const multiplier = 10 ** decimals;
  const formatted = Math.round(value * multiplier) / multiplier;
  const sign = formatted > 0 ? "+" : "";
  return `${sign}${formatted.toFixed(decimals)}%`;
}

export function createInitialForm(statPatterns, homeTeam = "", awayTeam = "") {
  return Object.keys(statPatterns).reduce((acc, statKey) => {
    acc[statKey] = {
      homeTeam,
      awayTeam,
      scope: "total",
      statKey,
      period: "ALL",
      formMatches: "all",
      home_importance: 5,
      away_importance: 5,
    };
    return acc;
  }, {});
}

export function replaceTeamsInForm(form, homeTeam, awayTeam) {
  const next = {};
  for (const [statKey, entry] of Object.entries(form)) {
    next[statKey] = {
      ...entry,
      homeTeam: normalizeTeamName(homeTeam) || entry.homeTeam || "",
      awayTeam: normalizeTeamName(awayTeam) || entry.awayTeam || "",
    };
  }
  return next;
}
