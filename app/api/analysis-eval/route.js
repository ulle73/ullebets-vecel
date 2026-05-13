import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import { calcTuple } from "@/lib/backtest/tuples";
import { findTeamstatsMatchSelections } from "@/lib/teamstatsLookup";

export const runtime = "nodejs";

const DB_NAME = process.env.MONGODB_DB || "app";
const SNAPSHOT_COLLECTION = "analysis-snapshots";
const TEAMSTATS_COLLECTION = "teamstats";
const FINAL_STATUSES = new Set(["closed", "ended", "finished", "afterextra", "afterpenalties"]);

function toDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isFinishedMatch(match) {
  const status = String(
    match?.status?.type ||
      match?.status?.description ||
      match?.matchDetails?.status?.type ||
      match?.matchDetails?.status?.description ||
      ""
  ).toLowerCase();

  if (FINAL_STATUSES.has(status)) return true;

  const homeScore = Number(match?.homeScore ?? match?.matchDetails?.homeScore);
  const awayScore = Number(match?.awayScore ?? match?.matchDetails?.awayScore);
  if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
    return true;
  }

  const timestamp = Number(match?.timestamp || match?.startTimestamp || 0);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    const tsMs = timestamp > 1e12 ? timestamp : timestamp * 1000;
    return Date.now() - tsMs > 3 * 60 * 60 * 1000;
  }

  return false;
}

function resolveActualValue(match, bet) {
  const statKey = bet?.statKey;
  if (!statKey) return null;
  const tuple = calcTuple(match, statKey, bet?.period || "ALL");
  const stat = tuple?.[statKey];
  if (!stat) return null;

  if (bet?.scope === "home") return Number(stat.home);
  if (bet?.scope === "away") return Number(stat.away);
  return Number(stat.total);
}

function settleBet(actualValue, bet) {
  if (!Number.isFinite(actualValue)) return null;
  const line = Number(bet?.line);
  if (!Number.isFinite(line)) return null;
  const direction = bet?.direction === "under" ? "under" : "over";

  if (actualValue === line) {
    return { result: "push", edgeDelta: 0, roiUnits: 0 };
  }

  const isWin = direction === "over" ? actualValue > line : actualValue < line;
  const odds = Number(bet?.odds);
  const roiUnits = isWin
    ? Number.isFinite(odds) && odds > 1
      ? odds - 1
      : 0
    : -1;

  return {
    result: isWin ? "win" : "loss",
    edgeDelta: Number((actualValue - line).toFixed(2)),
    roiUnits: Number(roiUnits.toFixed(2)),
  };
}

function aggregateBucket(map, key, settledEntry) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, {
      key,
      bets: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      roiUnits: 0,
      avgEvSum: 0,
    });
  }
  const bucket = map.get(key);
  bucket.bets += 1;
  if (settledEntry.result === "win") bucket.wins += 1;
  if (settledEntry.result === "loss") bucket.losses += 1;
  if (settledEntry.result === "push") bucket.pushes += 1;
  bucket.roiUnits += settledEntry.roiUnits || 0;
  bucket.avgEvSum += Number(settledEntry.primaryEv) || 0;
}

function finalizeBuckets(map) {
  return [...map.values()]
    .map((bucket) => ({
      ...bucket,
      winRatePct: bucket.bets ? Math.round((bucket.wins / bucket.bets) * 100) : 0,
      roiPct: bucket.bets ? Number(((bucket.roiUnits / bucket.bets) * 100).toFixed(1)) : 0,
      avgEv: bucket.bets ? Number((bucket.avgEvSum / bucket.bets).toFixed(1)) : 0,
    }))
    .sort((a, b) => {
      if (b.roiPct !== a.roiPct) return b.roiPct - a.roiPct;
      return b.bets - a.bets;
    });
}

function normalizeShortlistEntry(snapshot, item) {
  if (!item?.matchId || !item?.bet?.statKey || item?.bet?.line == null) {
    return null;
  }

  return {
    snapshotId: snapshot?._id ? String(snapshot._id) : null,
    snapshotCreatedAt: snapshot?.createdAt || null,
    date: snapshot?.date || null,
    strategyId: snapshot?.strategyId || null,
    strategyLabel: snapshot?.strategyLabel || null,
    matchId: String(item.matchId),
    homeTeamName: item.homeTeamName || null,
    awayTeamName: item.awayTeamName || null,
    leagueName: item.leagueName || null,
    headline: item.headline || null,
    primaryEv: Number(item.primaryEv) || 0,
    confidenceScore: Number(item.confidenceScore) || 0,
    agreementPct: Number(item.agreementPct) || 0,
    strategyScore: Number(item.strategyScore) || 0,
    rationale: item.rationale || null,
    riskFlags: Array.isArray(item.riskFlags) ? item.riskFlags : [],
    bet: item.bet,
  };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 250, 20), 500);
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 45, 1), 180);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const snapshots = await db
      .collection(SNAPSHOT_COLLECTION)
      .find({ createdAt: { $gte: cutoff } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const flatEntries = snapshots.flatMap((snapshot) =>
      (Array.isArray(snapshot?.shortlist) ? snapshot.shortlist : [])
        .map((item) => normalizeShortlistEntry(snapshot, item))
        .filter(Boolean)
    );

    const dedupedMap = new Map();
    for (const entry of flatEntries) {
      const dedupeKey = `${entry.strategyId || "na"}:${entry.matchId}:${entry.bet.key || `${entry.bet.statKey}:${entry.bet.line}:${entry.bet.direction}`}`;
      const prev = dedupedMap.get(dedupeKey);
      const prevDate = toDate(prev?.snapshotCreatedAt)?.getTime() || 0;
      const nextDate = toDate(entry?.snapshotCreatedAt)?.getTime() || 0;
      if (!prev || nextDate >= prevDate) {
        dedupedMap.set(dedupeKey, entry);
      }
    }

    const dedupedEntries = [...dedupedMap.values()];
    const uniqueMatchIds = [...new Set(dedupedEntries.map((entry) => entry.matchId))];

    const matchMap = await findTeamstatsMatchSelections(db, uniqueMatchIds, {
      collectionName: TEAMSTATS_COLLECTION,
    });

    const settled = [];
    let unsettledCount = 0;
    let missingMetadataCount = flatEntries.length - dedupedEntries.length;

    for (const entry of dedupedEntries) {
      const match = matchMap.get(entry.matchId)?.match;
      if (!match || !isFinishedMatch(match)) {
        unsettledCount += 1;
        continue;
      }

      const actualValue = resolveActualValue(match, entry.bet);
      const settlement = settleBet(actualValue, entry.bet);
      if (!settlement) {
        unsettledCount += 1;
        continue;
      }

      settled.push({
        ...entry,
        actualValue,
        result: settlement.result,
        edgeDelta: settlement.edgeDelta,
        roiUnits: settlement.roiUnits,
        settledAt: new Date().toISOString(),
      });
    }

    const totals = settled.reduce(
      (acc, entry) => {
        acc.bets += 1;
        if (entry.result === "win") acc.wins += 1;
        if (entry.result === "loss") acc.losses += 1;
        if (entry.result === "push") acc.pushes += 1;
        acc.roiUnits += entry.roiUnits || 0;
        acc.evSum += entry.primaryEv || 0;
        acc.confidenceSum += entry.confidenceScore || 0;
        return acc;
      },
      { bets: 0, wins: 0, losses: 0, pushes: 0, roiUnits: 0, evSum: 0, confidenceSum: 0 }
    );

    const byStrategy = new Map();
    const byStat = new Map();
    const byLeague = new Map();

    for (const entry of settled) {
      aggregateBucket(byStrategy, entry.strategyLabel || entry.strategyId || "Okänd", entry);
      aggregateBucket(byStat, entry.bet?.statKey || "okänd", entry);
      aggregateBucket(byLeague, entry.leagueName || "Okänd liga", entry);
    }

    return NextResponse.json({
      summary: {
        snapshots: snapshots.length,
        dedupedBets: dedupedEntries.length,
        settledBets: totals.bets,
        unsettledBets: unsettledCount,
        duplicateSnapshotsSkipped: missingMetadataCount,
        winRatePct: totals.bets ? Math.round((totals.wins / totals.bets) * 100) : 0,
        roiPct: totals.bets ? Number(((totals.roiUnits / totals.bets) * 100).toFixed(1)) : 0,
        avgEv: totals.bets ? Number((totals.evSum / totals.bets).toFixed(1)) : 0,
        avgConfidence: totals.bets ? Math.round(totals.confidenceSum / totals.bets) : 0,
      },
      byStrategy: finalizeBuckets(byStrategy).slice(0, 8),
      byStat: finalizeBuckets(byStat).slice(0, 8),
      byLeague: finalizeBuckets(byLeague).slice(0, 8),
      recentSettled: settled
        .sort((a, b) => {
          const aTs = toDate(a.snapshotCreatedAt)?.getTime() || 0;
          const bTs = toDate(b.snapshotCreatedAt)?.getTime() || 0;
          return bTs - aTs;
        })
        .slice(0, 20),
    });
  } catch (error) {
    console.error("[api/analysis-eval] GET error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
