#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: ".env.local" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const DB_NAME = process.env.MONGODB_DB || "app";
const SNAPSHOT_COLLECTION = "analysis-snapshots";
const TEAMSTATS_COLLECTION = "teamstats";
const CLV_COLLECTION = "closing-line-tracking";
const FINAL_STATUSES = new Set(["closed", "ended", "finished", "afterextra", "afterpenalties"]);
const uri = process.env.MONGODB_URI;

const STAT_PATTERNS = {
  totalShots: { keys: ["totalshots", "totalshotsongoal"], names: ["total shots"] },
  shotsOnGoal: { keys: ["shotsongoal"], names: ["shots on goal", "shots on target"] },
  cornerKicks: { keys: ["cornerkicks"], names: ["corner kicks", "corners"] },
  yellowCards: { keys: ["yellowcards"], names: ["yellow cards"] },
  throwIns: { keys: ["throwins"], names: ["throw-ins"] },
  freeKicks: { keys: ["freekicks"], names: ["free kicks"] },
  fouls: { keys: ["fouls"], names: ["fouls"] },
  totalTackle: { keys: ["totaltackle", "tackles"], names: ["tackles", "total tackles"] },
  offsides: { keys: ["offsides"], names: ["offsides"] },
};

function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function parseArgs(argv) {
  const args = { json: false, strategyId: "balanced", days: 90, limit: 600 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    if (arg === "--strategy" && argv[i + 1]) args.strategyId = argv[++i];
    if (arg === "--days" && argv[i + 1]) args.days = Number(argv[++i]) || args.days;
    if (arg === "--limit" && argv[i + 1]) args.limit = Number(argv[++i]) || args.limit;
  }
  return args;
}

async function loadPolicyModule() {
  const filePath = path.join(rootDir, "lib/backtest/rankingPolicy.js");
  const source = await fs.promises.readFile(filePath, "utf-8");
  const encoded = Buffer.from(source, "utf-8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

function toDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildTrackingKey(entry) {
  return `${entry.matchId}:${entry.bet?.key || `${entry.bet?.statKey}:${entry.bet?.scope}:${entry.bet?.period}:${entry.bet?.line}:${entry.bet?.direction}`}`;
}

function normalizeShortlistEntry(snapshot, item) {
  if (!item?.matchId || !item?.bet?.statKey || item?.bet?.line == null) return null;
  return {
    date: snapshot?.date || null,
    snapshotCreatedAt: snapshot?.createdAt || null,
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
    ranking: item.ranking && typeof item.ranking === "object" ? item.ranking : null,
    proof: item.proof && typeof item.proof === "object" ? item.proof : null,
    riskFlags: Array.isArray(item.riskFlags) ? item.riskFlags : [],
    bet: item.bet,
  };
}

function resolveStatisticsBlock(match, periodKey) {
  const details = match?.matchDetails || match?.details || null;
  const statistics = details?.statistics || match?.statistics;
  if (!statistics) return null;
  if (Array.isArray(statistics)) {
    const upper = String(periodKey || "ALL").toUpperCase();
    return statistics.find((entry) => String(entry.period || "").toUpperCase() === upper) || statistics[0] || null;
  }
  return statistics;
}

function calcTuple(match, statKey, periodKey) {
  const block = resolveStatisticsBlock(match, periodKey);
  if (!block?.groups) return null;

  const stats = {};
  const patterns = Object.entries(STAT_PATTERNS).map(([stat, { keys, names }]) => ({
    stat,
    keys: keys.map((key) => key.toLowerCase()),
    names: names.map((name) => name.toLowerCase()),
  }));

  for (const group of block.groups) {
    for (const row of group.statisticsItems || []) {
      const key = row.key?.toLowerCase();
      const name = row.name?.toLowerCase().trim();
      const matched = patterns.find((pattern) => (key && pattern.keys.includes(key)) || (name && pattern.names.includes(name)));
      if (!matched) continue;
      stats[matched.stat] = {
        home: Number(row.homeValue),
        away: Number(row.awayValue),
        total: Number(row.homeValue) + Number(row.awayValue),
      };
    }
  }

  for (const stat in STAT_PATTERNS) {
    if (stats[stat]) continue;
    const homeValue = match?.matchDetails?.homeStats?.[stat];
    const awayValue = match?.matchDetails?.awayStats?.[stat];
    if (Number.isFinite(homeValue) && Number.isFinite(awayValue)) {
      stats[stat] = { home: Number(homeValue), away: Number(awayValue), total: Number(homeValue) + Number(awayValue) };
    }
  }

  if (stats.freeKicks) {
    const offsides = stats.offsides || {};
    const homeAdjusted = safeNumber(stats.freeKicks.home) + safeNumber(offsides.away);
    const awayAdjusted = safeNumber(stats.freeKicks.away) + safeNumber(offsides.home);
    stats.freeKicks = { home: homeAdjusted, away: awayAdjusted, total: homeAdjusted + awayAdjusted };
  }

  return stats;
}

function isFinishedMatch(match) {
  const status = String(match?.status?.type || match?.status?.description || match?.matchDetails?.status?.type || match?.matchDetails?.status?.description || "").toLowerCase();
  if (FINAL_STATUSES.has(status)) return true;
  const homeScore = Number(match?.homeScore ?? match?.matchDetails?.homeScore);
  const awayScore = Number(match?.awayScore ?? match?.matchDetails?.awayScore);
  if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) return true;
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
  if (actualValue === line) return { result: "push", roiUnits: 0 };
  const isWin = direction === "over" ? actualValue > line : actualValue < line;
  const odds = Number(bet?.odds);
  const roiUnits = isWin ? (Number.isFinite(odds) && odds > 1 ? odds - 1 : 0) : -1;
  return { result: isWin ? "win" : "loss", roiUnits: Number(roiUnits.toFixed(2)) };
}

function buildTextReport(result) {
  return [
    `policy_version: ${result.policyVersion}`,
    `strategy: ${result.strategyId}`,
    `research_score: ${result.researchScore}`,
    `picked_dates: ${result.metrics.pickedDates}`,
    `picked_bets: ${result.metrics.pickedBets}`,
    `beat_close_pct_top${result.picksPerDate}: ${result.metrics.beatClosePct}`,
    `avg_clv_top${result.picksPerDate}: ${result.metrics.avgClv}`,
    `settled_roi_top${result.picksPerDate}: ${result.metrics.roiPct}`,
    `proof_coverage_pct: ${result.metrics.proofCoveragePct}`,
    `guardrails_ok: ${result.guardrails.ok}`,
  ].join("\n") + "\n";
}

async function main() {
  if (!uri) throw new Error("Missing MONGODB_URI");
  const args = parseArgs(process.argv.slice(2));
  const policy = await loadPolicyModule();
  const cutoff = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB_NAME);

  const snapshots = await db.collection(SNAPSHOT_COLLECTION).find({ createdAt: { $gte: cutoff } }).sort({ createdAt: -1 }).limit(args.limit).toArray();
  const flatEntries = snapshots.flatMap((snapshot) => (Array.isArray(snapshot?.shortlist) ? snapshot.shortlist : []).map((item) => normalizeShortlistEntry(snapshot, item)).filter(Boolean));

  const dedupedMap = new Map();
  for (const entry of flatEntries) {
    const dedupeKey = `${entry.date || "no-date"}:${buildTrackingKey(entry)}`;
    const prev = dedupedMap.get(dedupeKey);
    const prevDate = toDate(prev?.snapshotCreatedAt)?.getTime() || 0;
    const nextDate = toDate(entry?.snapshotCreatedAt)?.getTime() || 0;
    if (!prev || nextDate >= prevDate) dedupedMap.set(dedupeKey, entry);
  }

  const replayEntries = [...dedupedMap.values()].map((entry) => {
    const scored = policy.scoreCandidateWithPolicy(entry, args.strategyId);
    return { ...entry, policyScore: scored.score, policyBreakdown: scored.breakdown, trackingKey: buildTrackingKey(entry) };
  });

  const entriesByDate = new Map();
  for (const entry of replayEntries) {
    const dateKey = entry.date || "unknown-date";
    if (!entriesByDate.has(dateKey)) entriesByDate.set(dateKey, []);
    entriesByDate.get(dateKey).push(entry);
  }

  const picksPerDate = policy.RESEARCH_OBJECTIVE.picksPerDate;
  const topPicks = [...entriesByDate.entries()].flatMap(([dateKey, dateEntries]) =>
    dateEntries.sort((a, b) => (b.policyScore !== a.policyScore ? b.policyScore - a.policyScore : (b.primaryEv || 0) - (a.primaryEv || 0))).slice(0, picksPerDate).map((entry) => ({ ...entry, date: dateKey }))
  );

  const uniqueMatchIds = [...new Set(topPicks.map((entry) => entry.matchId))];
  const teamDocs = uniqueMatchIds.length ? await db.collection(TEAMSTATS_COLLECTION).find({ _id: { $in: uniqueMatchIds } }, { projection: { _id: 1, full: { $slice: 1 } } }).toArray() : [];
  const matchMap = new Map(teamDocs.map((doc) => [String(doc._id), Array.isArray(doc.full) ? doc.full[0] : null]));
  const clvDocs = topPicks.length ? await db.collection(CLV_COLLECTION).find({ trackingKey: { $in: topPicks.map((entry) => entry.trackingKey) } }).toArray() : [];
  const clvMap = new Map(clvDocs.map((doc) => [doc.trackingKey, doc]));

  const settled = [];
  const closedClv = [];
  let proofCoverageCount = 0;

  for (const entry of topPicks) {
    if (entry.proof?.historicalReady) proofCoverageCount += 1;
    const match = matchMap.get(entry.matchId);
    if (match && isFinishedMatch(match)) {
      const actualValue = resolveActualValue(match, entry.bet);
      const settlement = settleBet(actualValue, entry.bet);
      if (settlement) settled.push({ ...entry, result: settlement.result, roiUnits: settlement.roiUnits });
    }
    const clv = clvMap.get(entry.trackingKey);
    if (clv && Number.isFinite(Number(clv.clvPct)) && typeof clv.beatClosingLine === "boolean") {
      closedClv.push({ ...entry, clvPct: Number(clv.clvPct), beatClosingLine: Boolean(clv.beatClosingLine) });
    }
  }

  const pickedDates = new Set(topPicks.map((entry) => entry.date)).size;
  const beatClosePct = closedClv.length ? Math.round((closedClv.filter((item) => item.beatClosingLine).length / closedClv.length) * 100) : 0;
  const avgClv = closedClv.length ? Number((closedClv.reduce((sum, item) => sum + item.clvPct, 0) / closedClv.length).toFixed(2)) : 0;
  const roiPct = settled.length ? Number(((settled.reduce((sum, item) => sum + item.roiUnits, 0) / settled.length) * 100).toFixed(2)) : 0;
  const proofCoveragePct = topPicks.length ? Math.round((proofCoverageCount / topPicks.length) * 100) : 0;
  const researchScore = policy.computeResearchScore({ beatClosePct, avgClv, roiPct });

  const guardrails = {
    minPickedDates: pickedDates >= policy.RESEARCH_OBJECTIVE.guardrails.minPickedDates,
    minPickedBets: topPicks.length >= policy.RESEARCH_OBJECTIVE.guardrails.minPickedBets,
    minProofCoveragePct: proofCoveragePct >= policy.RESEARCH_OBJECTIVE.guardrails.minProofCoveragePct,
  };

  const result = {
    policyVersion: policy.POLICY_VERSION,
    strategyId: args.strategyId,
    picksPerDate,
    researchScore,
    metrics: { pickedDates, pickedBets: topPicks.length, settledBets: settled.length, closedClvBets: closedClv.length, beatClosePct, avgClv, roiPct, proofCoveragePct },
    samples: { snapshots: snapshots.length, replayEntries: replayEntries.length },
    guardrails: { ...guardrails, ok: Object.values(guardrails).every(Boolean) },
    topExamples: topPicks.slice(0, 5).map((entry) => ({ date: entry.date, headline: entry.headline, leagueName: entry.leagueName, policyScore: entry.policyScore, primaryEv: entry.primaryEv, proofScore: entry.proof?.proofScore || 0 })),
  };

  await client.close();

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(buildTextReport(result));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
