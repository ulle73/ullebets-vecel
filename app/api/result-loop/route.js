import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import { calcTuple } from "@/lib/backtest/tuples";
import { isFinishedMatchSnapshot } from "@/lib/teamstatsSnapshots";
import { findTeamstatsMatchSelections } from "@/lib/teamstatsLookup";

export const runtime = "nodejs";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "result-loop-bets";
const TEAMSTATS_COLLECTION = "teamstats";
const CLV_COLLECTION = "closing-line-tracking";

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

function settleBet(actualValue, bet, stakeUnits = 1) {
  if (!Number.isFinite(actualValue)) return null;
  const line = Number(bet?.line);
  if (!Number.isFinite(line)) return null;
  const direction = bet?.direction === "under" ? "under" : "over";
  if (actualValue === line) return { result: "push", roiUnits: 0, pnlUnits: 0 };
  const isWin = direction === "over" ? actualValue > line : actualValue < line;
  const odds = Number(bet?.odds);
  const roiUnits = isWin ? (Number.isFinite(odds) && odds > 1 ? odds - 1 : 0) : -1;
  return {
    result: isWin ? "win" : "loss",
    roiUnits: Number(roiUnits.toFixed(2)),
    pnlUnits: Number((roiUnits * (Number(stakeUnits) || 1)).toFixed(2)),
  };
}

function sanitizeBody(body = {}) {
  return {
    trackingKey: typeof body.trackingKey === "string" ? body.trackingKey : null,
    matchId: body.matchId != null ? String(body.matchId) : null,
    homeTeamName: typeof body.homeTeamName === "string" ? body.homeTeamName : null,
    awayTeamName: typeof body.awayTeamName === "string" ? body.awayTeamName : null,
    leagueName: typeof body.leagueName === "string" ? body.leagueName : null,
    headline: typeof body.headline === "string" ? body.headline : null,
    source: typeof body.source === "string" ? body.source : "manual",
    strategyScore: Number.isFinite(Number(body.strategyScore)) ? Number(body.strategyScore) : null,
    confidenceScore: Number.isFinite(Number(body.confidenceScore)) ? Number(body.confidenceScore) : null,
    primaryEv: Number.isFinite(Number(body.primaryEv)) ? Number(body.primaryEv) : null,
    stakeUnits: Number.isFinite(Number(body.stakeUnits)) ? Number(body.stakeUnits) : 1,
    eventUrl: typeof body.eventUrl === "string" ? body.eventUrl : null,
    bet: body?.bet && typeof body.bet === "object" ? body.bet : null,
    proof: body?.proof && typeof body.proof === "object" ? body.proof : null,
    ranking: body?.ranking && typeof body.ranking === "object" ? body.ranking : null,
  };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 120, 10), 300);
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 180, 1), 365);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const docs = await db
      .collection(COLLECTION)
      .find({ createdAt: { $gte: cutoff } }, { projection: { _id: 0 } })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(limit)
      .toArray();

    const uniqueMatchIds = [...new Set(docs.map((item) => item.matchId).filter(Boolean))];
    const matchMap = await findTeamstatsMatchSelections(db, uniqueMatchIds, {
      collectionName: TEAMSTATS_COLLECTION,
    });

    const clvDocs = docs.length
      ? await db.collection(CLV_COLLECTION).find({ trackingKey: { $in: docs.map((item) => item.trackingKey) } }).toArray()
      : [];
    const clvMap = new Map(clvDocs.map((doc) => [doc.trackingKey, doc]));

    const items = docs.map((doc) => {
      const matchSelection = matchMap.get(doc.matchId) || null;
      const match = matchSelection?.match || null;
      const clv = clvMap.get(doc.trackingKey) || null;
      const finished = match ? isFinishedMatchSnapshot(match) : false;
      const actualValue = match ? resolveActualValue(match, doc.bet) : null;
      const settlement = finished ? settleBet(actualValue, doc.bet, doc.stakeUnits) : null;
      const status = settlement ? "settled" : !match ? "pending" : finished ? "unresolved" : "open";
      const statusReason = settlement
        ? "settled"
        : !match
          ? "missing-teamstats"
          : finished && !Number.isFinite(actualValue)
            ? "missing-stat-value"
            : finished
              ? "missing-settlement"
              : "match-not-finished";

      return {
        ...doc,
        status,
        statusReason,
        actualValue,
        result: settlement?.result || null,
        roiUnits: settlement?.roiUnits ?? null,
        pnlUnits: settlement?.pnlUnits ?? null,
        closingOdds: Number.isFinite(Number(clv?.closingOdds)) ? Number(clv.closingOdds) : null,
        clvPct: Number.isFinite(Number(clv?.clvPct)) ? Number(clv.clvPct) : null,
        beatClosingLine: typeof clv?.beatClosingLine === "boolean" ? clv.beatClosingLine : null,
        latestObservedOdds: Number.isFinite(Number(clv?.latestObservedOdds)) ? Number(clv.latestObservedOdds) : null,
        updatedAt: doc.updatedAt || doc.createdAt,
        snapshotCandidateCount: Number(matchSelection?.meta?.candidateCount) || 0,
        snapshotFinishedCandidates: Number(matchSelection?.meta?.finishedCandidateCount) || 0,
        snapshotSourceDocCount: Number(matchSelection?.meta?.sourceDocCount) || 0,
      };
    });

    const settled = items.filter((item) => item.status === "settled");
    const open = items.filter((item) => item.status === "open");
    const unresolved = items.filter((item) => item.status === "unresolved");
    const pending = items.filter((item) => item.status === "pending");
    const clvClosed = items.filter((item) => Number.isFinite(item.clvPct));
    const wins = settled.filter((item) => item.result === "win").length;
    const pnlTotal = settled.reduce((sum, item) => sum + (Number(item.pnlUnits) || 0), 0);
    const stakedUnits = items.reduce((sum, item) => sum + (Number(item.stakeUnits) || 1), 0);
    const proofReadyCount = items.filter((item) => item.proof?.historicalReady).length;

    return NextResponse.json({
      summary: {
        trackedBets: items.length,
        openBets: open.length,
        unresolvedBets: unresolved.length,
        pendingBets: pending.length,
        settledBets: settled.length,
        winRatePct: settled.length ? Math.round((wins / settled.length) * 100) : 0,
        roiPct: stakedUnits ? Number(((pnlTotal / stakedUnits) * 100).toFixed(1)) : 0,
        pnlUnits: Number(pnlTotal.toFixed(2)),
        beatClosePct: clvClosed.length ? Math.round((clvClosed.filter((item) => item.beatClosingLine).length / clvClosed.length) * 100) : 0,
        proofReadyPct: items.length ? Math.round((proofReadyCount / items.length) * 100) : 0,
      },
      items,
    });
  } catch (error) {
    console.error("[api/result-loop] GET error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const item = sanitizeBody(body || {});
    if (!item.trackingKey || !item.matchId || !item.bet) {
      return NextResponse.json({ message: "Missing result loop payload" }, { status: 400 });
    }

    const client = await clientPromise;
    const now = new Date();
    await client.db(DB_NAME).collection(COLLECTION).updateOne(
      { trackingKey: item.trackingKey },
      {
        $set: {
          ...item,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/result-loop] POST error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const body = await req.json().catch(() => null);
    const trackingKey = typeof body?.trackingKey === "string" ? body.trackingKey : null;
    if (!trackingKey) {
      return NextResponse.json({ message: "Missing trackingKey" }, { status: 400 });
    }

    const client = await clientPromise;
    await client.db(DB_NAME).collection(COLLECTION).deleteOne({ trackingKey });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/result-loop] DELETE error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
