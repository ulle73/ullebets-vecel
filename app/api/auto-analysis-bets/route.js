import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import { buildAutoAnalysisQueryOptions, summarizeAutoAnalysisBets, AUTO_ANALYSIS_BET_COLLECTION } from "@/lib/autoAnalysis/store";
import { buildRapidContext, loadMatchStatisticsFallback } from "@/lib/matchupsEnrichment";
import { toTimestampMs } from "@/lib/clvTracking";
import { findTeamstatsMatchSelections } from "@/lib/teamstatsLookup";
import { isFinishedMatchSnapshot } from "@/lib/teamstatsSnapshots";
import { resolveMatchupActualValue } from "@/lib/matchupsOutcome";

export const runtime = "nodejs";

const DB_NAME = process.env.MONGODB_DB || "app";
const TEAMSTATS_COLLECTION = "teamstats";
const RAPID_FALLBACK_WINDOW_MS = 3 * 60 * 60 * 1000;

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

function computeStatus(doc, match) {
  if (!match) return "pending";
  if (!isFinishedMatchSnapshot(match)) return "open";
  const actualValue = resolveMatchupActualValue(match, doc.bet)?.actualValue ?? null;
  return Number.isFinite(actualValue) ? "settled" : "unresolved";
}

function aggregateBuckets(items, keySelector, labelSelector = keySelector) {
  const buckets = new Map();
  for (const item of items) {
    const key = keySelector(item);
    if (!key) continue;
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: labelSelector(item),
        bets: 0,
        expectedUnits: 0,
        pnlUnits: 0,
        evSum: 0,
        scoreSum: 0,
        wins: 0,
      });
    }
    const bucket = buckets.get(key);
    bucket.bets += 1;
    bucket.expectedUnits += Number(item.expectedUnits) || 0;
    bucket.pnlUnits += Number(item.pnlUnits) || 0;
    bucket.evSum += Number(item.primaryEv) || 0;
    bucket.scoreSum += Number(item.strategyScore) || 0;
    if (item.result === "win") bucket.wins += 1;
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      expectedUnits: Number(bucket.expectedUnits.toFixed(2)),
      pnlUnits: Number(bucket.pnlUnits.toFixed(2)),
      avgEv: bucket.bets ? Number((bucket.evSum / bucket.bets).toFixed(1)) : 0,
      avgStrategyScore: bucket.bets ? Number((bucket.scoreSum / bucket.bets).toFixed(1)) : 0,
      winRatePct: bucket.bets ? Math.round((bucket.wins / bucket.bets) * 100) : 0,
    }))
    .sort((a, b) => {
      if (b.pnlUnits !== a.pnlUnits) return b.pnlUnits - a.pnlUnits;
      return b.bets - a.bets;
    })
    .slice(0, 20);
}

function buildCheckpointComparison(items, leftKey = "d3", rightKey = "matchday") {
  const pairsByComparisonKey = new Map();
  for (const item of items) {
    if (!item?.comparisonKey || !item?.checkpointKey) continue;
    const bucket = pairsByComparisonKey.get(item.comparisonKey) || {};
    bucket[item.checkpointKey] = item;
    pairsByComparisonKey.set(item.comparisonKey, bucket);
  }

  const pairs = [];
  for (const bucket of pairsByComparisonKey.values()) {
    if (bucket[leftKey] && bucket[rightKey]) {
      pairs.push({ left: bucket[leftKey], right: bucket[rightKey] });
    }
  }

  const leftItems = pairs.map((pair) => pair.left);
  const rightItems = pairs.map((pair) => pair.right);
  const betterLeft = pairs.filter((pair) => (Number(pair.left?.bet?.odds) || 0) > (Number(pair.right?.bet?.odds) || 0)).length;
  const betterRight = pairs.filter((pair) => (Number(pair.right?.bet?.odds) || 0) > (Number(pair.left?.bet?.odds) || 0)).length;
  const sameOdds = pairs.length - betterLeft - betterRight;
  const avgOddsDelta = pairs.length
    ? Number(
        (
          pairs.reduce((sum, pair) => sum + ((Number(pair.right?.bet?.odds) || 0) - (Number(pair.left?.bet?.odds) || 0)), 0) / pairs.length
        ).toFixed(2)
      )
    : 0;
  const avgEvDelta = pairs.length
    ? Number(
        (
          pairs.reduce((sum, pair) => sum + ((Number(pair.right?.primaryEv) || 0) - (Number(pair.left?.primaryEv) || 0)), 0) / pairs.length
        ).toFixed(2)
      )
    : 0;

  return {
    leftKey,
    rightKey,
    pairCount: pairs.length,
    betterOddsPct: {
      [leftKey]: pairs.length ? Math.round((betterLeft / pairs.length) * 100) : 0,
      [rightKey]: pairs.length ? Math.round((betterRight / pairs.length) * 100) : 0,
      same: pairs.length ? Math.round((sameOdds / pairs.length) * 100) : 0,
    },
    avgOddsDelta,
    avgEvDelta,
    summaries: {
      [leftKey]: summarizeAutoAnalysisBets(leftItems),
      [rightKey]: summarizeAutoAnalysisBets(rightItems),
    },
    samplePairs: pairs.slice(0, 25).map((pair) => ({
      comparisonKey: pair.left.comparisonKey,
      matchId: pair.left.matchId,
      homeTeamName: pair.left.homeTeamName,
      awayTeamName: pair.left.awayTeamName,
      headline: pair.left.headline,
      [leftKey]: {
        odds: pair.left.bet?.odds ?? null,
        primaryEv: pair.left.primaryEv,
        strategyScore: pair.left.strategyScore,
        result: pair.left.result,
        pnlUnits: pair.left.pnlUnits,
      },
      [rightKey]: {
        odds: pair.right.bet?.odds ?? null,
        primaryEv: pair.right.primaryEv,
        strategyScore: pair.right.strategyScore,
        result: pair.right.result,
        pnlUnits: pair.right.pnlUnits,
      },
    })),
  };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const queryInput = Object.fromEntries(url.searchParams.entries());
    const { filter, limit } = buildAutoAnalysisQueryOptions(queryInput);
    const { status: statusFilter, result: resultFilter, ...mongoFilter } = filter;

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const rapidContext = buildRapidContext();
    const rapidFallbackCache = new Map();

    const docs = await db
      .collection(AUTO_ANALYSIS_BET_COLLECTION)
      .find(mongoFilter, { projection: { _id: 0 } })
      .sort({ strategyScore: -1, primaryEv: -1, createdAt: -1 })
      .limit(limit)
      .toArray();

    const uniqueMatchIds = [...new Set(docs.map((doc) => doc.matchId).filter(Boolean))];
    const matchMap = await findTeamstatsMatchSelections(db, uniqueMatchIds, {
      collectionName: TEAMSTATS_COLLECTION,
    });

    const enriched = await Promise.all(docs.map(async (doc) => {
      const matchSelection = matchMap.get(doc.matchId) || null;
      const baseMatch = matchSelection?.match || null;
      const fallbackTimestampMs = toTimestampMs(doc.timestamp);
      const fallbackEligible =
        !baseMatch &&
        Number.isFinite(fallbackTimestampMs) &&
        Date.now() - fallbackTimestampMs > RAPID_FALLBACK_WINDOW_MS;
      const match = fallbackEligible
        ? await loadMatchStatisticsFallback(
            doc.matchId,
            rapidContext,
            rapidFallbackCache,
            {
              timestamp: fallbackTimestampMs,
              homeTeamName: doc.homeTeamName || null,
              awayTeamName: doc.awayTeamName || null,
              leagueName: doc.leagueName || null,
            },
            console
          )
        : baseMatch;
      const actualValue = match ? resolveMatchupActualValue(match, doc.bet)?.actualValue ?? null : null;
      const settlement = match && isFinishedMatchSnapshot(match) ? settleBet(actualValue, doc.bet, doc.stakeUnits) : null;
      const computedStatus = computeStatus(doc, match);
      return {
        ...doc,
        status: computedStatus,
        actualValue,
        result: settlement?.result || null,
        roiUnits: settlement?.roiUnits ?? null,
        pnlUnits: settlement?.pnlUnits ?? null,
      };
    }));

    const filtered = enriched.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (resultFilter && item.result !== resultFilter) return false;
      return true;
    });

    const settledSource = filtered.filter((item) => item.status === "settled");

    return NextResponse.json({
      summary: {
        matchedBets: filtered.length,
        uniqueMatches: new Set(filtered.map((item) => item.matchId).filter(Boolean)).size,
        ...summarizeAutoAnalysisBets(filtered),
      },
      byCheckpoint: aggregateBuckets(filtered, (item) => item.checkpointKey || "manual"),
      byStat: aggregateBuckets(settledSource.length ? settledSource : filtered, (item) => item.bet?.statKey || "okänd"),
      byLeague: aggregateBuckets(settledSource.length ? settledSource : filtered, (item) => item.leagueName || "Okänd liga"),
      checkpointComparison: buildCheckpointComparison(filtered),
      items: filtered,
    });
  } catch (error) {
    console.error("[api/auto-analysis-bets] GET error", error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
