import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import { calcTuple } from "@/lib/backtest/tuples";
import { findTeamstatsMatchSelections } from "@/lib/teamstatsLookup";

export const runtime = "nodejs";

const DB_NAME = process.env.MONGODB_DB || "app";
const SNAPSHOT_COLLECTION = "analysis-snapshots";
const TEAMSTATS_COLLECTION = "teamstats";
const FINAL_STATUSES = new Set(["closed", "ended", "finished", "afterextra", "afterpenalties"]);

function clamp(min, value, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

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
    return { result: "push", roiUnits: 0 };
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
    roiUnits: Number(roiUnits.toFixed(2)),
  };
}

function normalizeShortlistEntry(snapshot, item) {
  if (!item?.matchId || !item?.bet?.statKey || item?.bet?.line == null) {
    return null;
  }

  return {
    snapshotCreatedAt: snapshot?.createdAt || null,
    strategyId: snapshot?.strategyId || null,
    strategyLabel: snapshot?.strategyLabel || null,
    matchId: String(item.matchId),
    leagueName: item.leagueName || null,
    primaryEv: Number(item.primaryEv) || 0,
    confidenceScore: Number(item.confidenceScore) || 0,
    agreementPct: Number(item.agreementPct) || 0,
    bet: item.bet,
  };
}

function createBucket(key, label) {
  return {
    key,
    label,
    bets: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    roiUnits: 0,
    avgEvSum: 0,
    confidenceSum: 0,
    agreementSum: 0,
  };
}

function updateBucket(map, key, label, entry) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, createBucket(key, label));
  }
  const bucket = map.get(key);
  bucket.bets += 1;
  if (entry.result === "win") bucket.wins += 1;
  if (entry.result === "loss") bucket.losses += 1;
  if (entry.result === "push") bucket.pushes += 1;
  bucket.roiUnits += entry.roiUnits || 0;
  bucket.avgEvSum += entry.primaryEv || 0;
  bucket.confidenceSum += entry.confidenceScore || 0;
  bucket.agreementSum += entry.agreementPct || 0;
}

function finalizeBucket(bucket) {
  const roiPct = bucket.bets ? Number(((bucket.roiUnits / bucket.bets) * 100).toFixed(1)) : 0;
  const winRatePct = bucket.bets ? Math.round((bucket.wins / bucket.bets) * 100) : 0;
  const avgEv = bucket.bets ? Number((bucket.avgEvSum / bucket.bets).toFixed(1)) : 0;
  const avgConfidence = bucket.bets ? Math.round(bucket.confidenceSum / bucket.bets) : 0;
  const avgAgreement = bucket.bets ? Math.round(bucket.agreementSum / bucket.bets) : 0;
  const sampleFactor = clamp(0, bucket.bets / 24, 1);
  const rawAdjustment = roiPct * 0.22 + (winRatePct - 50) * 0.35 + (avgConfidence - 50) * 0.08;
  const adjustment = Number(clamp(-14, rawAdjustment * sampleFactor, 14).toFixed(1));
  const confidencePct = Math.round(sampleFactor * 100);

  return {
    ...bucket,
    roiPct,
    winRatePct,
    avgEv,
    avgConfidence,
    avgAgreement,
    confidencePct,
    adjustment,
  };
}

function sortBuckets(items) {
  return items.sort((a, b) => {
    if (b.adjustment !== a.adjustment) return b.adjustment - a.adjustment;
    return b.bets - a.bets;
  });
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 350, 50), 800);
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 90, 7), 365);
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
    for (const entry of dedupedEntries) {
      const match = matchMap.get(entry.matchId)?.match;
      if (!match || !isFinishedMatch(match)) continue;

      const actualValue = resolveActualValue(match, entry.bet);
      const settlement = settleBet(actualValue, entry.bet);
      if (!settlement) continue;

      settled.push({
        ...entry,
        result: settlement.result,
        roiUnits: settlement.roiUnits,
      });
    }

    const statBuckets = new Map();
    const scopePeriodBuckets = new Map();
    const leagueStatBuckets = new Map();

    for (const entry of settled) {
      const statKey = entry.bet?.statKey || "unknown";
      const scopePeriodKey = `${entry.bet?.scope || "total"}|${entry.bet?.period || "ALL"}`;
      const leagueSlug = normalizeKey(entry.leagueName || "unknown-league");
      const leagueStatKey = `${leagueSlug}|${statKey}`;

      updateBucket(statBuckets, statKey, statKey, entry);
      updateBucket(scopePeriodBuckets, scopePeriodKey, scopePeriodKey, entry);
      updateBucket(leagueStatBuckets, leagueStatKey, leagueStatKey, entry);
    }

    const stats = sortBuckets([...statBuckets.values()].map(finalizeBucket));
    const scopePeriods = sortBuckets([...scopePeriodBuckets.values()].map(finalizeBucket));
    const leagueStats = sortBuckets([...leagueStatBuckets.values()].map(finalizeBucket));

    const buildLookup = (items) =>
      Object.fromEntries(
        items.map((item) => [
          item.key,
          {
            adjustment: item.adjustment,
            confidencePct: item.confidencePct,
            bets: item.bets,
            roiPct: item.roiPct,
            winRatePct: item.winRatePct,
            avgEv: item.avgEv,
            avgConfidence: item.avgConfidence,
          },
        ])
      );

    return NextResponse.json({
      summary: {
        settledBets: settled.length,
        samplesWindowDays: days,
        snapshots: snapshots.length,
      },
      lookups: {
        stat: buildLookup(stats),
        scopePeriod: buildLookup(scopePeriods),
        leagueStat: buildLookup(leagueStats),
      },
      leaders: {
        stat: stats.slice(0, 10),
        scopePeriod: scopePeriods.slice(0, 10),
        leagueStat: leagueStats.slice(0, 10),
      },
    });
  } catch (error) {
    console.error("[api/ranking-feedback] GET error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
