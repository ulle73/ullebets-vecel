function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const STAT_KEY_ALIASES = new Map([
  ["totalshots", "totalshotsongoal"],
  ["totalshotsongoal", "totalshotsongoal"],
  ["totalshotsontarget", "totalshotsongoal"],
  ["shotsongoal", "shotsongoal"],
]);

export function normalizeTrackedStatKey(statKey) {
  const normalized = normalizeToken(statKey);
  return STAT_KEY_ALIASES.get(normalized) || normalized;
}

export function toTimestampMs(value) {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundOdds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number(numeric.toFixed(3));
}

function normalizeLine(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : null;
}

export function buildBetSignature(bet = {}) {
  return {
    statKey: normalizeTrackedStatKey(bet?.statKey),
    scope: String(bet?.scope || "total").toLowerCase(),
    period: String(bet?.period || "ALL").toUpperCase(),
    direction: String(bet?.direction === "under" ? "under" : "over"),
    line: normalizeLine(bet?.line),
  };
}

export function sameTrackedBet(left, right) {
  const a = buildBetSignature(left);
  const b = buildBetSignature(right);
  return (
    a.statKey &&
    a.statKey === b.statKey &&
    a.scope === b.scope &&
    a.period === b.period &&
    a.direction === b.direction &&
    a.line != null &&
    b.line != null &&
    Math.abs(a.line - b.line) < 0.051
  );
}

export function findMatchingClvDoc(clvDocs = [], trackedItem = {}) {
  if (!Array.isArray(clvDocs) || !clvDocs.length) return null;
  if (trackedItem?.trackingKey) {
    const exact = clvDocs.find((doc) => doc?.trackingKey === trackedItem.trackingKey);
    if (exact) return exact;
  }

  const matchId = trackedItem?.matchId != null ? String(trackedItem.matchId) : null;
  if (!matchId || !trackedItem?.bet) return null;
  return (
    clvDocs.find(
      (doc) =>
        String(doc?.matchId || "") === matchId &&
        sameTrackedBet(doc?.bet, trackedItem.bet)
    ) || null
  );
}

export function buildTrackingPriceSnapshot({
  odds,
  observedAt,
  source = "unknown",
} = {}) {
  const normalizedOdds = roundOdds(odds);
  const observedTimestampMs = toTimestampMs(observedAt);
  return {
    odds: normalizedOdds,
    observedAt: Number.isFinite(observedTimestampMs)
      ? new Date(observedTimestampMs).toISOString()
      : null,
    observedTimestampMs: Number.isFinite(observedTimestampMs)
      ? observedTimestampMs
      : null,
    source,
  };
}

export function mergeTrackingPriceHistory(history = [], snapshot = null) {
  const normalized = Array.isArray(history)
    ? history
        .map((item) => buildTrackingPriceSnapshot(item))
        .filter((item) => Number.isFinite(item.odds) && Number.isFinite(item.observedTimestampMs))
    : [];

  const next = snapshot ? buildTrackingPriceSnapshot(snapshot) : null;
  if (next && Number.isFinite(next.odds) && Number.isFinite(next.observedTimestampMs)) {
    const exists = normalized.some(
      (item) =>
        item.observedTimestampMs === next.observedTimestampMs &&
        Math.abs(item.odds - next.odds) < 0.0005
    );
    if (!exists) normalized.push(next);
  }

  normalized.sort((a, b) => a.observedTimestampMs - b.observedTimestampMs);
  return normalized;
}

export function buildTrackedObservationHistory(observations = []) {
  const sorted = Array.isArray(observations)
    ? [...observations].sort(
        (left, right) =>
          (toTimestampMs(left?.observedAt) || 0) - (toTimestampMs(right?.observedAt) || 0)
      )
    : [];

  let history = [];
  for (const observation of sorted) {
    history = mergeTrackingPriceHistory(history, observation);
  }
  return history;
}

function buildClvMetrics(savedOdds, closingOdds) {
  if (!Number.isFinite(savedOdds) || !Number.isFinite(closingOdds) || savedOdds <= 1 || closingOdds <= 1) {
    return { clvPct: null, beatClosingLine: null };
  }
  return {
    clvPct: Number((((savedOdds / closingOdds) - 1) * 100).toFixed(1)),
    beatClosingLine: savedOdds > closingOdds,
  };
}

export function computeTrackedOddsWindow({
  eventTimestampMs,
  priceHistory = [],
  fallbackTrackedOdds = null,
  fallbackTrackedObservedAt = null,
  openingOdds = null,
  openingObservedAt = null,
  latestObservedOdds = null,
  latestObservedAt = null,
  closingOdds = null,
  closingObservedAt = null,
} = {}) {
  let history = Array.isArray(priceHistory) ? priceHistory : [];
  history = mergeTrackingPriceHistory(history, {
    odds: fallbackTrackedOdds,
    observedAt: fallbackTrackedObservedAt,
    source: "tracked-fallback",
  });
  history = mergeTrackingPriceHistory(history, {
    odds: openingOdds,
    observedAt: openingObservedAt,
    source: "opening",
  });
  history = mergeTrackingPriceHistory(history, {
    odds: latestObservedOdds,
    observedAt: latestObservedAt,
    source: "latest",
  });
  history = mergeTrackingPriceHistory(history, {
    odds: closingOdds,
    observedAt: closingObservedAt,
    source: "closing",
  });

  const kickoffMs = toTimestampMs(eventTimestampMs);
  const prematchHistory = Number.isFinite(kickoffMs)
    ? history.filter((item) => item.observedTimestampMs < kickoffMs)
    : history;

  const savedPoint = prematchHistory[0] || null;
  const latestPrematchPoint = prematchHistory[prematchHistory.length - 1] || null;
  const hasClosingObservation = prematchHistory.length > 1;
  const closingPoint = hasClosingObservation ? latestPrematchPoint : null;
  const metrics = buildClvMetrics(savedPoint?.odds ?? null, closingPoint?.odds ?? null);

  return {
    savedOdds: savedPoint?.odds ?? null,
    savedObservedAt: savedPoint?.observedAt ?? null,
    closingOdds: closingPoint?.odds ?? null,
    closingObservedAt: closingPoint?.observedAt ?? null,
    latestPrematchOdds: latestPrematchPoint?.odds ?? null,
    latestPrematchObservedAt: latestPrematchPoint?.observedAt ?? null,
    clvPct: metrics.clvPct,
    beatClosingLine: metrics.beatClosingLine,
    prematchObservationCount: prematchHistory.length,
    hasClosingObservation,
    priceHistory: history,
    prematchPriceHistory: prematchHistory,
  };
}
