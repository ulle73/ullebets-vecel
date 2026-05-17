import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import mapUnibetOdds from "@/components/backtest/unibetOddsMapper";
import { findUnibetEventForMatch } from "@/lib/backtest/unibetAuto";
import {
  buildTrackedObservationHistory,
  buildTrackingPriceSnapshot,
  computeTrackedOddsWindow,
  mergeTrackingPriceHistory,
} from "@/lib/clvTracking";
import { findTeamstatsMatchSelections } from "@/lib/teamstatsLookup";

export const runtime = "nodejs";

const DB_NAME = process.env.MONGODB_DB || "app";
const SNAPSHOT_COLLECTION = "analysis-snapshots";
const RESULT_LOOP_COLLECTION = "result-loop-bets";
const TEAMSTATS_COLLECTION = "teamstats";
const CLV_COLLECTION = "closing-line-tracking";
const UNIBET_BASE_URL = "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event";

function toDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toTimestampMs(value) {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildTrackingKey(entry) {
  if (entry?.trackingKey) return entry.trackingKey;
  return `${entry.matchId}:${entry.bet.key || `${entry.bet.statKey}:${entry.bet.scope}:${entry.bet.period}:${entry.bet.line}:${entry.bet.direction}`}`;
}

function normalizeShortlistEntry(snapshot, item) {
  if (!item?.matchId || !item?.bet?.statKey || item?.bet?.line == null || !item?.bet?.odds) {
    return null;
  }

  return {
    trackedAt: snapshot?.createdAt || null,
    trackingSource: "shortlist",
    date: snapshot?.date || null,
    strategyId: snapshot?.strategyId || null,
    strategyLabel: snapshot?.strategyLabel || null,
    matchId: String(item.matchId),
    homeTeamName: item.homeTeamName || null,
    awayTeamName: item.awayTeamName || null,
    leagueName: item.leagueName || null,
    headline: item.headline || null,
    timestamp: item.timestamp ?? null,
    primaryEv: Number(item.primaryEv) || 0,
    confidenceScore: Number(item.confidenceScore) || 0,
    agreementPct: Number(item.agreementPct) || 0,
    strategyScore: Number(item.strategyScore) || 0,
    bet: item.bet,
  };
}

function normalizeResultLoopEntry(item) {
  if (!item?.trackingKey || !item?.matchId || !item?.bet?.statKey || item?.bet?.line == null || !item?.bet?.odds) {
    return null;
  }

  return {
    trackedAt: item?.createdAt || item?.updatedAt || null,
    trackingSource: "result-loop",
    date: null,
    strategyId: item?.ranking?.strategyId || null,
    strategyLabel: item?.ranking?.strategyLabel || null,
    trackingKey: item.trackingKey,
    matchId: String(item.matchId),
    homeTeamName: item.homeTeamName || null,
    awayTeamName: item.awayTeamName || null,
    leagueName: item.leagueName || null,
    headline: item.headline || null,
    timestamp: item.timestamp ?? null,
    eventTimestampMs: item.eventTimestampMs ?? null,
    primaryEv: Number(item.primaryEv) || 0,
    confidenceScore: Number(item.confidenceScore) || 0,
    agreementPct: Number(item?.ranking?.agreementPct) || 0,
    strategyScore: Number(item.strategyScore) || 0,
    bet: item.bet,
  };
}

function normalizeMatchMeta(match, entry) {
  return {
    timestampMs:
      toTimestampMs(match?.timestamp) ||
      toTimestampMs(match?.startTimestamp) ||
      toTimestampMs(match?.start) ||
      toTimestampMs(entry?.eventTimestampMs) ||
      toTimestampMs(entry?.timestamp) ||
      toTimestampMs(match?.matchDetails?.start) ||
      null,
    homeTeamName: match?.homeTeamName || match?.homeTeam || entry?.homeTeamName || null,
    awayTeamName: match?.awayTeamName || match?.awayTeam || entry?.awayTeamName || null,
    leagueName: match?.leagueName || match?.league || entry?.leagueName || null,
  };
}

async function fetchUnibetOdds(eventId) {
  if (!eventId) {
    throw new Error("Missing Unibet event id");
  }
  const url = `${UNIBET_BASE_URL}/${eventId}.json?lang=sv_SE&market=SE&client_id=2&channel_id=1&includeParticipants=true`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) {
    throw new Error(`Unibet request failed with status ${res.status}`);
  }
  return res.json();
}

function findCurrentOddsForBet(mappedOdds, bet) {
  const line = Number(bet?.line);
  const side = bet?.direction === "under" ? "under" : "over";

  const tuple = (Array.isArray(mappedOdds) ? mappedOdds : []).find((item) => {
    if (!item) return false;
    return (
      item.statKey === bet?.statKey &&
      item.scope === (bet?.scope || "total") &&
      item.period === (bet?.period || "ALL") &&
      Math.abs(Number(item.line) - line) < 0.051 &&
      Number.isFinite(Number(item?.odds?.[side]))
    );
  });

  if (!tuple) return null;
  return Number(tuple.odds[side]);
}

function buildClvMetrics(openingOdds, closingOdds) {
  if (!Number.isFinite(openingOdds) || !Number.isFinite(closingOdds) || openingOdds <= 1 || closingOdds <= 1) {
    return {
      clvPct: null,
      impliedEdgeDelta: null,
      beatClosingLine: null,
    };
  }

  const clvPct = Number((((openingOdds / closingOdds) - 1) * 100).toFixed(1));
  const impliedEdgeDelta = Number((((1 / closingOdds) - (1 / openingOdds)) * 100).toFixed(2));
  return {
    clvPct,
    impliedEdgeDelta,
    beatClosingLine: openingOdds > closingOdds,
  };
}

function buildObservationHistory(entry, existing, { keepMarketHistory = true } = {}) {
  const rawObservations = Array.isArray(entry?.observations)
    ? entry.observations
    : [
        {
          odds: entry?.bet?.odds,
          observedAt: entry?.trackedAt || null,
          source: entry?.trackingSource || (entry?.trackingKey ? "result-loop" : "shortlist"),
        },
      ];

  let priceHistory = buildTrackedObservationHistory(rawObservations);
  const storedMarketHistory = keepMarketHistory && Array.isArray(existing?.priceHistory)
    ? existing.priceHistory.filter((item) => item?.source === "market")
    : [];
  for (const snapshot of storedMarketHistory) {
    priceHistory = mergeTrackingPriceHistory(priceHistory, snapshot);
  }
  return priceHistory;
}

function buildAuditPayload(entry, existing, meta, found) {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const eventTimestampMs =
    meta.timestampMs ||
    toTimestampMs(entry?.eventTimestampMs) ||
    toTimestampMs(entry?.timestamp) ||
    toTimestampMs(found?.eventStart) ||
    toTimestampMs(existing?.eventTimestampMs) ||
    null;
  const eventStarted = Number.isFinite(eventTimestampMs) ? nowMs >= eventTimestampMs : false;
  const currentMarketOdds = Number(found?.currentOdds);
  const hasValidCurrentMarketOdds = Number.isFinite(currentMarketOdds) && currentMarketOdds > 0;
  const trackedAt = entry?.trackedAt || existing?.createdAt || nowIso;
  let priceHistory = buildObservationHistory(entry, existing, {
    keepMarketHistory: hasValidCurrentMarketOdds,
  });

  if (!eventStarted && hasValidCurrentMarketOdds) {
    priceHistory = mergeTrackingPriceHistory(
      priceHistory,
      buildTrackingPriceSnapshot({
        odds: currentMarketOdds,
        observedAt: nowIso,
        source: "market",
      })
    );
  }

  const trackedOdds = computeTrackedOddsWindow({
    eventTimestampMs,
    priceHistory,
    fallbackTrackedOdds: entry?.bet?.odds,
    fallbackTrackedObservedAt: trackedAt,
  });

  const latestObservedOdds = !eventStarted && hasValidCurrentMarketOdds
    ? currentMarketOdds
    : trackedOdds.latestPrematchOdds;
  const latestObservedAt = !eventStarted && hasValidCurrentMarketOdds
    ? nowIso
    : trackedOdds.latestPrematchObservedAt || null;
  const closingOdds = eventStarted ? trackedOdds.closingOdds : null;
  const closingObservedAt = eventStarted ? trackedOdds.closingObservedAt : null;
  const metrics = buildClvMetrics(trackedOdds.savedOdds, closingOdds);

  return {
    trackingKey: buildTrackingKey(entry),
    matchId: entry.matchId,
    timestamp: entry.timestamp ?? null,
    strategyId: entry.strategyId || null,
    strategyLabel: entry.strategyLabel || null,
    leagueName: entry.leagueName || meta.leagueName || null,
    homeTeamName: entry.homeTeamName || meta.homeTeamName || null,
    awayTeamName: entry.awayTeamName || meta.awayTeamName || null,
    headline: entry.headline || null,
    openingOdds: trackedOdds.savedOdds,
    openingObservedAt: trackedOdds.savedObservedAt,
    latestObservedOdds,
    latestObservedAt,
    closingOdds,
    closingObservedAt,
    clvPct: metrics.clvPct,
    impliedEdgeDelta: metrics.impliedEdgeDelta,
    beatClosingLine: metrics.beatClosingLine,
    eventTimestampMs,
    eventStarted,
    eventId: found?.eventId || existing?.eventId || null,
    eventUrl: found?.eventUrl || existing?.eventUrl || null,
    status: eventStarted
      ? closingOdds
        ? "closed"
        : "insufficient-history"
      : latestObservedOdds
        ? "tracking"
        : "unmatched",
    prematchObservationCount: trackedOdds.prematchObservationCount,
    priceHistory,
    bet: entry.bet,
    updatedAt: nowIso,
    createdAt: existing?.createdAt || nowIso,
  };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 80, 10), 200);
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 14, 1), 90);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const snapshots = await db
      .collection(SNAPSHOT_COLLECTION)
      .find({ createdAt: { $gte: cutoff } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    const resultLoopItems = await db
      .collection(RESULT_LOOP_COLLECTION)
      .find({ createdAt: { $gte: cutoff } }, { projection: { _id: 0 } })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(Math.min(limit * 4, 300))
      .toArray();

    const flatEntries = [
      ...snapshots.flatMap((snapshot) =>
      (Array.isArray(snapshot?.shortlist) ? snapshot.shortlist : [])
        .map((item) => normalizeShortlistEntry(snapshot, item))
        .filter(Boolean)
      ),
      ...resultLoopItems.map((item) => normalizeResultLoopEntry(item)).filter(Boolean),
    ];

    const groupedMap = new Map();
    for (const entry of flatEntries) {
      const trackingKey = buildTrackingKey(entry);
      const nextDate = toDate(entry?.trackedAt)?.getTime() || 0;
      const existingGroup = groupedMap.get(trackingKey);
      if (!existingGroup) {
        groupedMap.set(trackingKey, {
          trackingKey,
          latestEntry: entry,
          latestTrackedAtMs: nextDate,
          entries: [entry],
        });
        continue;
      }

      existingGroup.entries.push(entry);
      if (nextDate >= existingGroup.latestTrackedAtMs) {
        existingGroup.latestEntry = entry;
        existingGroup.latestTrackedAtMs = nextDate;
      }
    }

    const dedupedEntries = [...groupedMap.values()]
      .sort((left, right) => right.latestTrackedAtMs - left.latestTrackedAtMs)
      .slice(0, limit)
      .map((group) => ({
        ...group.latestEntry,
        trackingKey: group.trackingKey,
        observations: group.entries
          .map((entry) => ({
            odds: entry?.bet?.odds,
            observedAt: entry?.trackedAt || null,
            source: entry?.trackingSource || (entry?.trackingKey ? "result-loop" : "shortlist"),
          }))
          .filter((item) => item.observedAt != null && item.odds != null),
      }));
    const uniqueMatchIds = [...new Set(dedupedEntries.map((entry) => entry.matchId))];

    const matchMap = await findTeamstatsMatchSelections(db, uniqueMatchIds, {
      collectionName: TEAMSTATS_COLLECTION,
    });
    const existingDocs = await db
      .collection(CLV_COLLECTION)
      .find({ trackingKey: { $in: dedupedEntries.map(buildTrackingKey) } })
      .toArray();
    const existingMap = new Map(existingDocs.map((doc) => [doc.trackingKey, doc]));

    const audits = [];

    for (const entry of dedupedEntries) {
      const trackingKey = buildTrackingKey(entry);
      const existing = existingMap.get(trackingKey) || null;
      const match = matchMap.get(entry.matchId)?.match || null;
      const meta = normalizeMatchMeta(match, entry);

      let found = null;
      const eventStartedFromMeta = Number.isFinite(meta.timestampMs) ? Date.now() >= meta.timestampMs : false;
      if (!eventStartedFromMeta) {
        try {
          const event = await findUnibetEventForMatch({
            homeTeam: entry.homeTeamName || meta.homeTeamName,
            awayTeam: entry.awayTeamName || meta.awayTeamName,
            leagueName: entry.leagueName || meta.leagueName,
            timestamp: meta.timestampMs,
          });

          if (event?.eventId) {
            const oddsPayload = await fetchUnibetOdds(event.eventId);
            const mappedOdds = mapUnibetOdds(
              oddsPayload?.betOffers || [],
              entry.homeTeamName || meta.homeTeamName,
              entry.awayTeamName || meta.awayTeamName
            );
            const currentOdds = findCurrentOddsForBet(mappedOdds, entry.bet);
            found = {
              eventId: String(event.eventId),
              eventUrl: event.eventUrl,
              eventStart: event.start || null,
              currentOdds,
            };
          }
        } catch {
          found = null;
        }
      }

      const payload = buildAuditPayload(entry, existing, meta, found);
      audits.push(payload);

      await db.collection(CLV_COLLECTION).updateOne(
        { trackingKey },
        { $set: payload },
        { upsert: true }
      );
    }

    const closed = audits.filter((item) => Number.isFinite(item.closingOdds));
    const tracked = audits.filter((item) => Number.isFinite(item.latestObservedOdds));
    const avgClv = closed.length
      ? Number((closed.reduce((sum, item) => sum + (item.clvPct || 0), 0) / closed.length).toFixed(1))
      : null;
    const beatClosePct = closed.length
      ? Math.round((closed.filter((item) => item.beatClosingLine).length / closed.length) * 100)
      : null;

    return NextResponse.json({
      summary: {
        trackedBets: tracked.length,
        closedBets: closed.length,
        beatClosePct,
        avgClv,
      },
      recent: audits
        .sort((a, b) => (b.eventTimestampMs || 0) - (a.eventTimestampMs || 0))
        .slice(0, 20),
    });
  } catch (error) {
    console.error("[api/closing-lines] GET error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
