import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

export const runtime = "nodejs";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "analysis-snapshots";

function pickBetPayload(item = {}) {
  const bet = item?.bet && typeof item.bet === "object" ? item.bet : {};
  return {
    key: typeof bet.key === "string" ? bet.key : null,
    statKey: typeof bet.statKey === "string" ? bet.statKey : null,
    line: Number.isFinite(Number(bet.line)) ? Number(bet.line) : null,
    direction: bet.direction === "under" ? "under" : "over",
    scope: typeof bet.scope === "string" ? bet.scope : "total",
    period: typeof bet.period === "string" ? bet.period : "ALL",
    odds: Number.isFinite(Number(bet.odds)) ? Number(bet.odds) : null,
    homeTeam: typeof bet.homeTeam === "string" ? bet.homeTeam : null,
    awayTeam: typeof bet.awayTeam === "string" ? bet.awayTeam : null,
  };
}

function sanitizeShortlistItem(item = {}) {
  return {
    matchId: item.matchId != null ? String(item.matchId) : null,
    homeTeamName: typeof item.homeTeamName === "string" ? item.homeTeamName : null,
    awayTeamName: typeof item.awayTeamName === "string" ? item.awayTeamName : null,
    leagueName: typeof item.leagueName === "string" ? item.leagueName : null,
    headline: typeof item.headline === "string" ? item.headline : null,
    primaryEv: Number.isFinite(Number(item.primaryEv)) ? Number(item.primaryEv) : null,
    confidenceScore: Number.isFinite(Number(item.confidenceScore)) ? Number(item.confidenceScore) : null,
    agreementPct: Number.isFinite(Number(item.agreementPct)) ? Number(item.agreementPct) : null,
    strategyScore: Number.isFinite(Number(item.strategyScore)) ? Number(item.strategyScore) : null,
    scopeLabel: typeof item.scopeLabel === "string" ? item.scopeLabel : null,
    periodLabel: typeof item.periodLabel === "string" ? item.periodLabel : null,
    rationale: typeof item.rationale === "string" ? item.rationale : null,
    riskFlags: Array.isArray(item.riskFlags)
      ? item.riskFlags.slice(0, 8).map((flag) => ({
          id: typeof flag?.id === "string" ? flag.id : null,
          label: typeof flag?.label === "string" ? flag.label : null,
          severity: Number.isFinite(Number(flag?.severity)) ? Number(flag.severity) : 0,
        }))
      : [],
    entries: Array.isArray(item.entries)
      ? item.entries.slice(0, 8).map((entry) => ({
          key: typeof entry?.key === "string" ? entry.key : null,
          label: typeof entry?.label === "string" ? entry.label : null,
          value: Number.isFinite(Number(entry?.value)) ? Number(entry.value) : null,
        }))
      : [],
    rankReasons: Array.isArray(item.rankReasons)
      ? item.rankReasons.slice(0, 6).map((reason) => ({
          id: typeof reason?.id === "string" ? reason.id : null,
          label: typeof reason?.label === "string" ? reason.label : null,
          tone: typeof reason?.tone === "string" ? reason.tone : null,
        }))
      : [],
    ranking: item?.ranking && typeof item.ranking === "object"
      ? {
          edgeScore: Number.isFinite(Number(item.ranking.edgeScore)) ? Number(item.ranking.edgeScore) : null,
          confidenceScore: Number.isFinite(Number(item.ranking.confidenceScore)) ? Number(item.ranking.confidenceScore) : null,
          consensusScore: Number.isFinite(Number(item.ranking.consensusScore)) ? Number(item.ranking.consensusScore) : null,
          sampleScore: Number.isFinite(Number(item.ranking.sampleScore)) ? Number(item.ranking.sampleScore) : null,
          priceScore: Number.isFinite(Number(item.ranking.priceScore)) ? Number(item.ranking.priceScore) : null,
          marketScore: Number.isFinite(Number(item.ranking.marketScore)) ? Number(item.ranking.marketScore) : null,
          formulaSpread: Number.isFinite(Number(item.ranking.formulaSpread)) ? Number(item.ranking.formulaSpread) : null,
          formulaDeviation: Number.isFinite(Number(item.ranking.formulaDeviation)) ? Number(item.ranking.formulaDeviation) : null,
        }
      : null,
    bet: pickBetPayload(item),
  };
}

function sanitizeSnapshot(body = {}) {
  const shortlist = Array.isArray(body.shortlist)
    ? body.shortlist.slice(0, 20).map(sanitizeShortlistItem)
    : [];

  return {
    date: typeof body.date === "string" ? body.date : null,
    strategyId: typeof body.strategyId === "string" ? body.strategyId : null,
    strategyLabel: typeof body.strategyLabel === "string" ? body.strategyLabel : null,
    analyzedMatches: Number(body.analyzedMatches) || 0,
    shortlist,
    createdAt: new Date(),
  };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 10, 1), 50);

    const client = await clientPromise;
    const docs = await client
      .db(DB_NAME)
      .collection(COLLECTION)
      .find({}, {
        projection: {
          shortlist: 1,
          date: 1,
          strategyId: 1,
          strategyLabel: 1,
          analyzedMatches: 1,
          createdAt: 1,
        },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({ items: docs });
  } catch (error) {
    console.error("[api/analysis-snapshots] GET error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const snapshot = sanitizeSnapshot(body || {});

    if (!snapshot.date || !snapshot.strategyId) {
      return NextResponse.json({ message: "Missing snapshot metadata" }, { status: 400 });
    }

    const client = await clientPromise;
    const collection = client.db(DB_NAME).collection(COLLECTION);
    await collection.insertOne(snapshot);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/analysis-snapshots] POST error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
