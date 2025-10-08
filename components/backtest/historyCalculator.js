const DEFAULT_HISTORY = () => ({
  over: { hits: 0, total: 0 },
  under: { hits: 0, total: 0 },
  opponent: { hits: 0, total: 0 },
});

const PERIODS = new Set(["ALL", "1ST", "2ND"]);

function normalizeTeamName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toTimestamp(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return value;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 1e12) return numeric;
    if (numeric > 1e9) return numeric * 1000;
  }
  const date = new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function extractTeamName(match, side) {
  const candidates = [
    match?.[`${side}TeamName`],
    match?.[`${side}Team`]?.name,
    match?.[`${side}Team`]?.teamName,
    match?.matchDetails?.[`${side}TeamName`],
    match?.matchDetails?.[`${side}Team`]?.name,
    match?.matchDetails?.[`${side}Team`]?.teamName,
    match?.match?.[`${side}Team`]?.name,
    match?.team?.[side]?.name,
  ];
  for (const candidate of candidates) {
    if (candidate) return String(candidate);
  }
  return "";
}

function toFeatureSlug(value) {
  if (!value) return "";
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extractAllFeaturesFromBlock(block) {
  if (!block?.groups) return null;
  const features = {};
  for (const group of block.groups) {
    for (const row of group.statisticsItems || []) {
      const slug = toFeatureSlug(row.key || row.name);
      if (!slug) continue;
      const homeValue = Number(row.homeValue);
      const awayValue = Number(row.awayValue);
      if (!Number.isFinite(homeValue) || !Number.isFinite(awayValue)) continue;
      const entry = { home: homeValue, away: awayValue, total: homeValue + awayValue };
      features[slug] = entry;
      const alias = slug.replace(/_/g, "");
      if (alias && alias !== slug && !features[alias]) {
        features[alias] = entry;
      }
    }
  }
  return features;
}

function extractTuple(detail, statPatterns, periodKey) {
  if (!detail?.statistics) return null;
  const statsBlock = Array.isArray(detail.statistics)
    ? detail.statistics.find((block) => (block.period ?? "").toUpperCase() === periodKey) || detail.statistics[0]
    : detail.statistics;
  if (!statsBlock?.groups) return null;

  const patterns = Object.entries(statPatterns).map(([stat, cfg]) => ({
    stat,
    keys: (cfg.keys || []).map((k) => k.toLowerCase()),
    names: (cfg.names || []).map((n) => n.toLowerCase()),
  }));

  const stats = {};

  for (const group of statsBlock.groups) {
    for (const row of group.statisticsItems || []) {
      const key = row.key?.toLowerCase();
      const name = row.name?.toLowerCase().trim();
      const match = patterns.find(
        (pattern) => (key && pattern.keys.includes(key)) || (name && pattern.names.includes(name))
      );
      if (!match) continue;
      const homeValue = Number(row.homeValue);
      const awayValue = Number(row.awayValue);
      if (!Number.isFinite(homeValue) || !Number.isFinite(awayValue)) continue;
      stats[match.stat] = {
        home: homeValue,
        away: awayValue,
        total: homeValue + awayValue,
      };
    }
  }

  const featureMap = extractAllFeaturesFromBlock(statsBlock);
  if (featureMap && Object.keys(featureMap).length) {
    stats.__features = featureMap;
  }

  return stats;
}

function safeNumber(value) {
  const numeric = toNumber(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sanitizeStatEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const home = toNumber(entry.home);
  const away = toNumber(entry.away);
  let total = toNumber(entry.total);
  if (!Number.isFinite(total) && Number.isFinite(home) && Number.isFinite(away)) {
    total = home + away;
  }
  if (!Number.isFinite(home) && !Number.isFinite(away) && !Number.isFinite(total)) {
    return null;
  }
  return {
    home: Number.isFinite(home) ? home : null,
    away: Number.isFinite(away) ? away : null,
    total: Number.isFinite(total) ? total : null,
  };
}

function resolveMatchStat(match, statPatterns, statKey, periodKey) {
  const containers = [match?.stat, match?.stats, match?.statistics, match?.extraStats, match?.additionalStats];
  for (const container of containers) {
    const direct = container?.[statKey];
    const sanitized = sanitizeStatEntry(direct);
    if (sanitized) return sanitized;
  }

  const detailCandidates = [];
  if (match?.matchDetails) {
    detailCandidates.push(match.matchDetails);
  }
  if (!match?.matchDetails && match?.statistics) {
    detailCandidates.push({ statistics: match.statistics });
  }
  if (!match?.matchDetails && match?.stats) {
    detailCandidates.push({ statistics: match.stats });
  }

  for (const detail of detailCandidates) {
    const tuple = extractTuple(detail, statPatterns, periodKey);
    if (!tuple) continue;
    if (tuple.freeKicks) {
      const homeBase = safeNumber(tuple.freeKicks.home);
      const awayBase = safeNumber(tuple.freeKicks.away);
      const offsides = tuple.offsides || {};
      const homeOpponentOffsides = safeNumber(offsides.away);
      const awayOpponentOffsides = safeNumber(offsides.home);
      const homeAdjusted = homeBase + homeOpponentOffsides;
      const awayAdjusted = awayBase + awayOpponentOffsides;
      tuple.freeKicks = {
        home: homeAdjusted,
        away: awayAdjusted,
        total: homeAdjusted + awayAdjusted,
      };
    }
    const stat = sanitizeStatEntry(tuple[statKey]);
    if (stat) return stat;
  }

  return null;
}

function buildNormalizedMatches(matches, statPatterns, statKey, periodKey, teamName, assumedVenue) {
  if (!Array.isArray(matches) || !matches.length) return [];
  const normalizedTeam = normalizeTeamName(teamName);
  return matches
    .map((match) => {
      const stat = resolveMatchStat(match, statPatterns, statKey, periodKey);
      if (!stat) return null;
      const homeTeam = extractTeamName(match, "home");
      const awayTeam = extractTeamName(match, "away");
      let teamIsHome = null;
      if (normalizedTeam) {
        const isHome = normalizeTeamName(homeTeam) === normalizedTeam;
        const isAway = normalizeTeamName(awayTeam) === normalizedTeam;
        if (isHome) teamIsHome = true;
        else if (isAway) teamIsHome = false;
      }
      if (teamIsHome == null) {
        if (assumedVenue === "home") teamIsHome = true;
        else if (assumedVenue === "away") teamIsHome = false;
      }
      const timestamp =
        toTimestamp(match?.timestamp) ??
        toTimestamp(match?.matchTimestamp) ??
        toTimestamp(match?.startTimestamp) ??
        toTimestamp(match?.date) ??
        toTimestamp(match?.eventDate) ??
        toTimestamp(match?.matchDetails?.event?.startTimestamp);
      return {
        stat,
        homeTeam,
        awayTeam,
        timestamp: Number.isFinite(timestamp) ? timestamp : 0,
        teamIsHome,
      };
    })
    .filter(Boolean);
}

function parseFormLimit(value) {
  if (value == null) return Infinity;
  const str = String(value).trim();
  if (!str || str.toLowerCase() === "all") return Infinity;
  const parsed = Number.parseInt(str, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
}

function limitMatches(matches, limit) {
  const sorted = [...matches].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  if (!Number.isFinite(limit) || limit === Infinity) {
    return sorted;
  }
  return sorted.slice(0, limit);
}

function countGreater(values, threshold) {
  return values.filter((value) => Number.isFinite(value) && value > threshold).length;
}

function countLess(values, threshold) {
  return values.filter((value) => Number.isFinite(value) && value < threshold).length;
}

export function computeHistoryStats({
  homeMatches = [],
  awayMatches = [],
  statPatterns = {},
  statKey,
  scope = "total",
  period = "ALL",
  line,
  formMatches,
  neutralGround = false,
  homeTeam = "",
  awayTeam = "",
} = {}) {
  const history = DEFAULT_HISTORY();
  const numericLine = toNumber(line);
  if (!Number.isFinite(numericLine)) {
    return history;
  }

  const periodKey = PERIODS.has(String(period).toUpperCase())
    ? String(period).toUpperCase()
    : "ALL";

  const homeNormalized = buildNormalizedMatches(
    homeMatches,
    statPatterns,
    statKey,
    periodKey,
    homeTeam,
    "home"
  );
  const awayNormalized = buildNormalizedMatches(
    awayMatches,
    statPatterns,
    statKey,
    periodKey,
    awayTeam,
    "away"
  );

  const limit = parseFormLimit(formMatches);

  if (scope === "total") {
    const combined = limitMatches([...homeNormalized, ...awayNormalized], limit);
    const values = combined
      .map((match) => toNumber(match?.stat?.total))
      .filter((value) => Number.isFinite(value));
    const hitsOver = countGreater(values, numericLine);
    const hitsUnder = countLess(values, numericLine);
    history.over = { hits: hitsOver, total: values.length };
    history.under = { hits: hitsUnder, total: values.length };
    history.opponent = { ...history.under };
    return history;
  }

  const teamBaseMatches =
    scope === "home"
      ? neutralGround && awayNormalized.length
        ? awayNormalized
        : homeNormalized
      : neutralGround && homeNormalized.length
      ? homeNormalized
      : awayNormalized;

  const opponentBaseMatches = scope === "home" ? awayNormalized : homeNormalized;

  const teamMatches = limitMatches(teamBaseMatches, limit);
  const opponentMatches = limitMatches(opponentBaseMatches, limit);

  const teamValues = teamMatches
    .map((match) => {
      const teamIsHome =
        match.teamIsHome != null ? match.teamIsHome : scope === "home";
      const value = teamIsHome ? match.stat?.home : match.stat?.away;
      return toNumber(value);
    })
    .filter((value) => Number.isFinite(value));

  const opponentValues = opponentMatches
    .map((match) => {
      const teamIsHome =
        match.teamIsHome != null ? match.teamIsHome : scope !== "home";
      const value = teamIsHome ? match.stat?.away : match.stat?.home;
      return toNumber(value);
    })
    .filter((value) => Number.isFinite(value));

  history.over = {
    hits: countGreater(teamValues, numericLine),
    total: teamValues.length,
  };
  history.under = {
    hits: countLess(teamValues, numericLine),
    total: teamValues.length,
  };
  history.opponent = {
    hits: countGreater(opponentValues, numericLine),
    total: opponentValues.length,
  };

  return history;
}
