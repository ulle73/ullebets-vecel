#!/usr/bin/env node
import dotenv from "dotenv";

import clientPromise from "../lib/mongo.js";
import { fetchTeamMatches } from "../lib/backtest/data.js";
import { getFormulaConfig } from "../lib/backtest/formulaConfig.js";
import { computeBaseProjection } from "../lib/backtest/methods/base.js";
import { buildTuples, teamSlug } from "../lib/backtest/tuples.js";
import {
  SUPPORTED_RAW_REPLAY_STATS,
  buildReplayFormulaValues,
  evPctToProbability,
  filterMatchesBeforeCutoff,
  inferPoissonLambdaFromProbability,
  normalizeConditionToIsOver,
  scoreReplaySelections,
} from "./formula_raw_replay_core.js";

dotenv.config({ path: ".env.local", quiet: true });

function parseArgs(argv) {
  const args = {
    json: false,
    limit: 100,
    statKey: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") args.json = true;
    if (arg === "--limit" && argv[index + 1]) {
      args.limit = Number(argv[index + 1]) || null;
      index += 1;
    }
    if (arg === "--statKey" && argv[index + 1]) {
      args.statKey = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function toTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickLeagueRawEv(evDetails = {}) {
  if (Number.isFinite(evDetails?.rawEvPctLeagueAvg)) {
    return evDetails.rawEvPctLeagueAvg;
  }
  if (Number.isFinite(evDetails?.evPctLeagueAvg)) {
    return evDetails.evPctLeagueAvg;
  }
  return null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildGuardrails(summary) {
  const selected = Number(summary?.metrics?.selectedBets) || 0;
  const settled = Number(summary?.metrics?.settledBets) || 0;
  return {
    hasSelectedBets: selected > 0,
    hasSettledBets: settled > 0,
    ok: selected > 0 && settled > 0,
  };
}

async function loadReplayDocuments(client) {
  const db = client.db(process.env.MONGODB_DB || "app");
  return db
    .collection("unibet-backtest")
    .find(
      { "lines.statKey": { $in: SUPPORTED_RAW_REPLAY_STATS } },
      {
        projection: {
          _id: 0,
          homeTeam: 1,
          awayTeam: 1,
          matchDate: 1,
          generatedAt: 1,
          lines: 1,
        },
      }
    )
    .toArray();
}

function flattenDocumentReplayCandidates(docs = []) {
  const rows = [];

  for (const doc of Array.isArray(docs) ? docs : []) {
    for (const line of Array.isArray(doc?.lines) ? doc.lines : []) {
      if (!SUPPORTED_RAW_REPLAY_STATS.includes(line?.statKey)) continue;
      if (line?.win == null) continue;
      rows.push({
        ...line,
        homeTeam: doc?.homeTeam ?? null,
        awayTeam: doc?.awayTeam ?? null,
        matchDate: doc?.matchDate ?? null,
        snapshotFetchedAt: doc?.generatedAt ?? null,
      });
    }
  }

  return rows;
}

async function buildTeamMatchCache(client, candidates) {
  const db = client.db(process.env.MONGODB_DB || "app");
  const teamstats = db.collection("teamstats");
  const requests = [];
  const seen = new Set();

  for (const row of candidates) {
    const pairs = [
      { teamName: row?.homeTeam, role: "home" },
      { teamName: row?.awayTeam, role: "away" },
    ];
    for (const pair of pairs) {
      const key = `${String(pair.teamName || "").toLowerCase()}|${pair.role}`;
      if (!pair.teamName || seen.has(key)) continue;
      seen.add(key);
      requests.push(pair);
    }
  }

  if (!requests.length) return new Map();

  const docs = await teamstats
    .find(
      {
        $or: requests.map((request) => ({
          "_importMeta.teamRole": request.role,
          "_importMeta.teamName": {
            $regex: `^${escapeRegExp(request.teamName)}$`,
            $options: "i",
          },
        })),
      },
      {
        projection: {
          _id: 0,
          _importMeta: 1,
          full: 1,
        },
      }
    )
    .toArray();

  const cache = new Map();
  for (const doc of docs) {
    const key = `${String(doc?._importMeta?.teamName || "").toLowerCase()}|${doc?._importMeta?.teamRole}`;
    cache.set(key, Array.isArray(doc?.full) ? doc.full : []);
  }
  return cache;
}

async function rebuildReplayRow(row, teamMatchCache) {
  const cutoffTimestamp = toTimestamp(row?.snapshotFetchedAt) ?? toTimestamp(row?.matchDate);
  if (!Number.isFinite(cutoffTimestamp)) {
    return { skipReason: "missing-cutoff" };
  }

  const isOver = normalizeConditionToIsOver(row?.condition ?? row?.direction);
  if (isOver == null) {
    return { skipReason: "unsupported-condition" };
  }

  const homeCacheKey = `${String(row.homeTeam || "").toLowerCase()}|home`;
  const awayCacheKey = `${String(row.awayTeam || "").toLowerCase()}|away`;
  const [homeFallback, awayFallback] = await Promise.all([
    teamMatchCache?.has(homeCacheKey) ? null : fetchTeamMatches(row.homeTeam, "home"),
    teamMatchCache?.has(awayCacheKey) ? null : fetchTeamMatches(row.awayTeam, "away"),
  ]);
  const homeMatchesRaw = teamMatchCache?.get(homeCacheKey) || homeFallback || [];
  const awayMatchesRaw = teamMatchCache?.get(awayCacheKey) || awayFallback || [];

  const homeMatches = filterMatchesBeforeCutoff(homeMatchesRaw, cutoffTimestamp);
  const awayMatches = filterMatchesBeforeCutoff(awayMatchesRaw, cutoffTimestamp);
  if (!homeMatches.length || !awayMatches.length) {
    return { skipReason: "missing-team-matches" };
  }

  const tuples = buildTuples({
    homeMatches,
    awayMatches,
    statKey: row.statKey,
    periodKey: row.period || "ALL",
  });
  if (!tuples.length) {
    return { skipReason: "missing-tuples" };
  }

  const config = getFormulaConfig(row.statKey);
  const baseResult = computeBaseProjection({
    tuples,
    statKey: row.statKey,
    scope: row.scope || "total",
    over: isOver,
    line: Number(row.line),
    formLimit: Infinity,
    homeSlug: teamSlug(row.homeTeam),
    awaySlug: teamSlug(row.awayTeam),
    homeImportance: 5,
    awayImportance: 5,
    neutralGround: false,
    blendWeight: config?.blendWeight,
  });

  if (!Number.isFinite(baseResult?.prob)) {
    return { skipReason: "missing-base-prob" };
  }

  const leagueProbability = evPctToProbability(
    pickLeagueRawEv(row?.evDetails),
    row?.odds
  );
  const leagueLambda = inferPoissonLambdaFromProbability({
    probability: leagueProbability,
    line: row?.line,
    isOver,
  });

  const formulaValues = buildReplayFormulaValues({
    row,
    baseResult: {
      ...baseResult,
      tuples,
    },
    leagueLambda,
    homeSlug: teamSlug(row.homeTeam),
    awaySlug: teamSlug(row.awayTeam),
  });

  return {
    ...row,
    formulaValues,
    sampleSize: tuples.length,
    replayCutoff: new Date(cutoffTimestamp).toISOString(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = await clientPromise;

  try {
    const docs = await loadReplayDocuments(client);
    let candidates = flattenDocumentReplayCandidates(docs);

    if (args.statKey) {
      candidates = candidates.filter((row) => row.statKey === args.statKey);
    }

    candidates.sort((left, right) => {
      const leftTs = toTimestamp(left.snapshotFetchedAt) ?? 0;
      const rightTs = toTimestamp(right.snapshotFetchedAt) ?? 0;
      return rightTs - leftTs;
    });

    if (Number.isFinite(args.limit) && args.limit > 0) {
      candidates = candidates.slice(0, args.limit);
    }

    const teamMatchCache = await buildTeamMatchCache(client, candidates);
    const rebuiltRows = [];
    const skipped = Object.create(null);

    for (const candidate of candidates) {
      const rebuilt = await rebuildReplayRow(candidate, teamMatchCache);
      if (rebuilt?.skipReason) {
        skipped[rebuilt.skipReason] = (skipped[rebuilt.skipReason] || 0) + 1;
        continue;
      }
      rebuiltRows.push(rebuilt);
    }

    const summary = scoreReplaySelections(rebuiltRows);
    const payload = {
      mode: "raw-replay",
      metrics: summary.metrics,
      topExamples: summary.topExamples,
      samples: {
        documents: docs.length,
        replayCandidates: candidates.length,
        rebuiltCandidates: rebuiltRows.length,
        skipped,
      },
      guardrails: buildGuardrails(summary),
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("Formula raw replay summary");
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    if (client?.close) {
      await client.close();
    }
  }
}

main().catch((error) => {
  console.error("Failed to run raw formula replay eval", error);
  process.exit(1);
});
