import { pickBestTeamstatsSnapshot } from "./teamstatsSnapshots.js";

const MATCH_ID_PATHS = [
  ["matchId"],
  ["id"],
  ["eventId"],
  ["event", "id"],
  ["event", "matchId"],
  ["event", "eventId"],
  ["raw", "id"],
  ["raw", "matchId"],
  ["raw", "eventId"],
  ["raw", "event", "id"],
  ["raw", "event", "matchId"],
  ["raw", "event", "eventId"],
];

function getByPath(root, path) {
  return path.reduce((acc, key) => (acc == null ? acc : acc[key]), root);
}

function uniqueByTypeAndValue(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (value == null) continue;
    const key = `${typeof value}:${String(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function normalizeMatchId(value) {
  if (value == null) return null;
  const str = String(value).trim();
  return str ? str : null;
}

export function buildMatchIdCandidates(matchId) {
  const normalized = normalizeMatchId(matchId);
  if (!normalized) return [];

  const candidates = [normalized];
  if (/^\d+$/.test(normalized)) {
    const numeric = Number(normalized);
    if (Number.isSafeInteger(numeric)) candidates.push(numeric);
  }

  return uniqueByTypeAndValue(candidates);
}

function matchesAnyCandidate(value, candidates) {
  if (value == null) return false;
  const valueString = String(value).trim();
  if (!valueString) return false;

  return candidates.some((candidate) => {
    if (value === candidate) return true;
    if (String(candidate) === valueString) return true;
    const valueNumber = Number(value);
    const candidateNumber = Number(candidate);
    return Number.isFinite(valueNumber) && Number.isFinite(candidateNumber) && valueNumber === candidateNumber;
  });
}

function getMatchIdentityValues(match) {
  return uniqueByTypeAndValue(MATCH_ID_PATHS.map((path) => getByPath(match, path)));
}

function matchHasId(match, candidates) {
  return getMatchIdentityValues(match).some((value) => matchesAnyCandidate(value, candidates));
}

function asFullArray(doc) {
  if (Array.isArray(doc?.full)) return doc.full;
  return doc?.full && typeof doc.full === "object" ? [doc.full] : [];
}

export function buildTeamstatsMatchFilter(matchIds) {
  const candidates = uniqueByTypeAndValue((matchIds || []).flatMap((matchId) => buildMatchIdCandidates(matchId)));
  if (!candidates.length) return null;

  return {
    $or: [
      { _id: { $in: candidates } },
      { "full.matchId": { $in: candidates } },
      { "full.id": { $in: candidates } },
      { "full.eventId": { $in: candidates } },
      { "full.event.id": { $in: candidates } },
      { "full.event.matchId": { $in: candidates } },
      { "full.event.eventId": { $in: candidates } },
      { "full.raw.matchId": { $in: candidates } },
      { "full.raw.id": { $in: candidates } },
      { "full.raw.eventId": { $in: candidates } },
      { "full.raw.event.id": { $in: candidates } },
      { "full.raw.event.matchId": { $in: candidates } },
      { "full.raw.event.eventId": { $in: candidates } },
    ],
  };
}

export function extractTeamstatsMatchSelections(docs, matchIds) {
  const requestedIds = [...new Set((matchIds || []).map(normalizeMatchId).filter(Boolean))];
  const buckets = new Map(requestedIds.map((matchId) => [matchId, { matches: [], sourceDocIds: new Set() }]));
  const candidatesById = new Map(requestedIds.map((matchId) => [matchId, buildMatchIdCandidates(matchId)]));

  for (const doc of Array.isArray(docs) ? docs : []) {
    const full = asFullArray(doc);
    if (!full.length) continue;

    for (const matchId of requestedIds) {
      const candidates = candidatesById.get(matchId) || [];
      const directMatches = full.filter((match) => matchHasId(match, candidates));
      const legacyMatches = directMatches.length || !matchesAnyCandidate(doc?._id, candidates) ? [] : full;
      const matches = directMatches.length ? directMatches : legacyMatches;
      if (!matches.length) continue;

      const bucket = buckets.get(matchId);
      bucket.sourceDocIds.add(String(doc?._id ?? "unknown"));
      bucket.matches.push(...matches);
    }
  }

  const selections = new Map();
  for (const matchId of requestedIds) {
    const bucket = buckets.get(matchId);
    if (!bucket?.matches.length) continue;
    const selection = pickBestTeamstatsSnapshot({ full: bucket.matches });
    selections.set(matchId, {
      ...selection,
      meta: {
        ...selection.meta,
        sourceDocCount: bucket.sourceDocIds.size,
        sourceDocIds: [...bucket.sourceDocIds],
      },
    });
  }

  return selections;
}

export async function findTeamstatsMatchSelections(db, matchIds, options = {}) {
  const collectionName = options.collectionName || "teamstats";
  const requestedIds = [...new Set((matchIds || []).map(normalizeMatchId).filter(Boolean))];
  const filter = buildTeamstatsMatchFilter(requestedIds);
  if (!filter) return new Map();

  const docs = await db
    .collection(collectionName)
    .find(filter, { projection: { _id: 1, full: 1, _importMeta: 1 } })
    .toArray();

  return extractTeamstatsMatchSelections(docs, requestedIds);
}

export async function findTeamstatsMatchSelection(db, matchId, options = {}) {
  const normalized = normalizeMatchId(matchId);
  if (!normalized) return null;
  const selections = await findTeamstatsMatchSelections(db, [normalized], options);
  return selections.get(normalized) || null;
}
