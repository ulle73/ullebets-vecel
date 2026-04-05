const FINAL_STATUSES = new Set(["closed", "ended", "finished", "afterextra", "afterpenalties"]);

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function getMatchTimestampMs(match) {
  const raw = toNumber(match?.timestamp ?? match?.startTimestamp ?? match?.matchDetails?.timestamp ?? null);
  if (!raw) return 0;
  return raw > 1e12 ? raw : raw * 1000;
}

export function getStatusKey(match) {
  return String(
    match?.status?.type ||
      match?.status?.description ||
      match?.matchDetails?.status?.type ||
      match?.matchDetails?.status?.description ||
      ""
  ).toLowerCase();
}

export function hasFullTimeScores(match) {
  const homeScore = toNumber(match?.homeScore ?? match?.matchDetails?.homeScore);
  const awayScore = toNumber(match?.awayScore ?? match?.matchDetails?.awayScore);
  return homeScore != null && awayScore != null;
}

export function getStatisticsCount(match) {
  const stats = match?.matchDetails?.statistics;
  return Array.isArray(stats) ? stats.length : 0;
}

export function getIncidentsCount(match) {
  return Array.isArray(match?.incidents) ? match.incidents.length : 0;
}

export function getSnapshotRichness(match) {
  return getStatisticsCount(match) * 10 + getIncidentsCount(match);
}

export function isFinishedMatchSnapshot(match) {
  const status = getStatusKey(match);
  if (FINAL_STATUSES.has(status)) return true;
  if (hasFullTimeScores(match)) return true;

  const tsMs = getMatchTimestampMs(match);
  if (tsMs > 0) {
    return Date.now() - tsMs > 3 * 60 * 60 * 1000;
  }

  return false;
}

function buildCandidateKey(match) {
  return [
    getMatchTimestampMs(match),
    getStatusKey(match),
    toNumber(match?.homeScore ?? match?.matchDetails?.homeScore) ?? "na",
    toNumber(match?.awayScore ?? match?.matchDetails?.awayScore) ?? "na",
    getStatisticsCount(match),
    getIncidentsCount(match),
  ].join("|");
}

export function getTeamstatsCandidates(doc) {
  const sources = [];
  if (Array.isArray(doc?.head)) sources.push(...doc.head);
  if (Array.isArray(doc?.tail)) sources.push(...doc.tail);
  if (!sources.length && Array.isArray(doc?.full)) sources.push(...doc.full);

  const seen = new Set();
  const candidates = [];
  for (const item of sources) {
    if (!item || typeof item !== "object") continue;
    const key = buildCandidateKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(item);
  }
  return candidates;
}

export function pickBestTeamstatsSnapshot(doc) {
  const candidates = getTeamstatsCandidates(doc);
  if (!candidates.length) {
    return {
      match: null,
      meta: {
        candidateCount: 0,
        finishedCandidateCount: 0,
        latestTimestampMs: 0,
      },
    };
  }

  const sorted = [...candidates].sort((a, b) => {
    const finishedDiff = Number(isFinishedMatchSnapshot(b)) - Number(isFinishedMatchSnapshot(a));
    if (finishedDiff) return finishedDiff;

    const scoreDiff = Number(hasFullTimeScores(b)) - Number(hasFullTimeScores(a));
    if (scoreDiff) return scoreDiff;

    const statsDiff = getStatisticsCount(b) - getStatisticsCount(a);
    if (statsDiff) return statsDiff;

    const richnessDiff = getSnapshotRichness(b) - getSnapshotRichness(a);
    if (richnessDiff) return richnessDiff;

    return getMatchTimestampMs(b) - getMatchTimestampMs(a);
  });

  const latestTimestampMs = Math.max(...candidates.map((item) => getMatchTimestampMs(item)), 0);
  return {
    match: sorted[0] || null,
    meta: {
      candidateCount: candidates.length,
      finishedCandidateCount: candidates.filter((item) => isFinishedMatchSnapshot(item)).length,
      latestTimestampMs,
      selectedTimestampMs: getMatchTimestampMs(sorted[0]),
      selectedStatus: getStatusKey(sorted[0]),
      selectedStatsCount: getStatisticsCount(sorted[0]),
    },
  };
}
