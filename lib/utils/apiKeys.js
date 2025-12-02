const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const MATCHES_TTL_MS = DAY_MS;
export const TEAM_PROFILE_TTL_MS = FIVE_MINUTES_MS;
export const LINEUPS_TTL_MS = HALF_HOUR_MS;
export const DEFAULT_TTL_MS = DAY_MS;

function toTrimmedString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

export function toNumericIdString(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return String(Math.trunc(num));
}

export function toNumericId(value) {
  const str = toNumericIdString(value);
  return str ? Number(str) : null;
}

export function buildMatchesByDateKey(date) {
  const trimmed = toTrimmedString(date);
  if (!trimmed) return null;
  return `/api/matches/by-date?date=${encodeURIComponent(trimmed)}`;
}

export function buildMatchDetailsKey(matchId) {
  const trimmed = toTrimmedString(matchId);
  if (!trimmed) return null;
  return `/api/match/${encodeURIComponent(trimmed)}`;
}

export function buildLineupsKey(matchId, params = {}) {
  const base = buildMatchDetailsKey(matchId);
  if (!base) return null;

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const normalized = toTrimmedString(value);
    if (!normalized) continue;
    searchParams.append(key, normalized);
  }

  const query = searchParams.toString();
  return query ? `${base}/lineups?${query}` : `${base}/lineups`;
}

export function buildTeamProfileKey({
  leagueId,
  league,
  leagueName,
  teamId,
  team,
  teamName,
  matchType,
  matchId,
}) {
  const rawMatchType = toTrimmedString(matchType);
  if (!rawMatchType) return null;

  const params = new URLSearchParams();
  const teamIdStr = toNumericIdString(teamId);
  const teamNameStr = toTrimmedString(
    typeof team === "string" || typeof team === "number" ? team : teamName
  );
  const leagueIdStr = toNumericIdString(leagueId);
  const leagueNameStr = toTrimmedString(
    typeof league === "string" || typeof league === "number" ? league : leagueName
  );
  const matchIdStr = toTrimmedString(matchId);

  params.append("matchType", rawMatchType);

  if (teamIdStr) {
    params.append("teamId", teamIdStr);
  } else if (teamNameStr) {
    params.append("team", teamNameStr);
  }

  if (leagueIdStr) {
    params.append("leagueId", leagueIdStr);
  } else if (leagueNameStr) {
    params.append("league", leagueNameStr);
  }

  if (matchIdStr) {
    params.append("matchId", matchIdStr);
  }

  if (params.get("teamId") == null && params.get("team") == null) {
    return null;
  }

  return `/api/teamprofiles?${params.toString()}`;
}

function readMatchField(match, field, fallbackField) {
  if (!match) return null;
  if (match[field] != null) return match[field];
  if (match.raw && match.raw[field] != null) return match.raw[field];
  if (fallbackField && match[field]?.[fallbackField] != null)
    return match[field][fallbackField];
  if (fallbackField && match.raw && match.raw[field]?.[fallbackField] != null)
    return match.raw[field][fallbackField];
  return null;
}

export function buildTeamProfileKeyForMatch(match, side) {
  if (!match) return null;
  const normalizedSide = side === "away" ? "away" : "home";
  const leagueId =
    readMatchField(match, "leagueId") ?? readMatchField(match, "league", "id");
  const leagueName =
    readMatchField(match, "leagueName") ?? readMatchField(match, "league", "name");
  const teamPrefix = normalizedSide === "home" ? "home" : "away";
  const teamId =
    readMatchField(match, `${teamPrefix}TeamId`) ??
    readMatchField(match, `${teamPrefix}Team`, "id");
  const teamName =
    readMatchField(match, `${teamPrefix}TeamName`) ??
    readMatchField(match, `${teamPrefix}Team`, "name");
  const matchId =
    match?.matchId ??
    match?.id ??
    match?.raw?.matchId ??
    match?.raw?.id ??
    null;

  return buildTeamProfileKey({
    leagueId,
    league: leagueName,
    teamId,
    team: teamName,
    matchType: normalizedSide,
    matchId,
  });
}
