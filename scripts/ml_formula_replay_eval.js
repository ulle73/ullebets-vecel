#!/usr/bin/env node
import dotenv from "dotenv";

import clientPromise from "../lib/mongo.js";
import { calculateEVFromData } from "../lib/backtest/engine.js";
import {
  fetchLeaguesAndTeams,
  fetchTeamMatches,
  fetchTeamProfilesBundle,
} from "../lib/backtest/data.js";
import { isPhase1MlCombo } from "../lib/backtest/mlPhase1Combos.js";
import {
  filterMatchesBeforeCutoff,
  normalizeConditionToIsOver,
} from "./formula_raw_replay_core.js";
import { summarizeConfiguredFormulaResults } from "./formula_research_core.js";

dotenv.config({ path: ".env.local", quiet: true });

const DEFAULT_FORM = "all";
const DEFAULT_IMPORTANCE = 5;
const DEFAULT_NEUTRAL = false;

function parseArgs(argv) {
  const args = {
    json: false,
    limit: 25,
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

function collectEvDetails(result) {
  if (!result || typeof result !== "object") return {};

  const evDetails = {};
  for (const [key, value] of Object.entries(result)) {
    if (
      key.startsWith("evPct") ||
      key === "legacyEvPct" ||
      key.startsWith("ml_")
    ) {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue)) {
        evDetails[key] = numericValue;
      }
    }
  }
  return evDetails;
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

async function withSuppressedOutput(fn) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

function buildReplayKey(line) {
  return [
    line?.statKey || "unknown",
    line?.scope || "total",
    line?.period || "ALL",
    Number(line?.line),
  ].join("::");
}

function flattenDocumentReplayCandidates(docs = []) {
  const rows = [];

  for (const doc of Array.isArray(docs) ? docs : []) {
    const grouped = new Map();
    for (const line of Array.isArray(doc?.lines) ? doc.lines : []) {
      const key = buildReplayKey(line);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(line);
    }

    for (const line of Array.isArray(doc?.lines) ? doc.lines : []) {
      const statKey = line?.statKey;
      const scope = line?.scope || "total";
      const period = line?.period || "ALL";
      if (!isPhase1MlCombo(statKey, scope, period)) continue;
      if (line?.win == null) continue;

      const peers = grouped.get(buildReplayKey(line)) || [];
      const isOver = normalizeConditionToIsOver(line?.condition ?? line?.direction);
      const opposite = peers.find((candidate) => {
        const candidateIsOver = normalizeConditionToIsOver(
          candidate?.condition ?? candidate?.direction
        );
        return candidate !== line && candidateIsOver != null && candidateIsOver !== isOver;
      });

      rows.push({
        ...line,
        homeTeam: doc?.homeTeam ?? null,
        awayTeam: doc?.awayTeam ?? null,
        matchDate: doc?.matchDate ?? null,
        snapshotFetchedAt: doc?.generatedAt ?? null,
        underOdds:
          isOver === true ? Number(opposite?.odds) || null : Number(line?.odds) || null,
        overOdds:
          isOver === false ? Number(opposite?.odds) || null : Number(line?.odds) || null,
      });
    }
  }

  return rows;
}

async function loadReplayDocuments(client) {
  const db = client.db(process.env.MONGODB_DB || "app");
  return db
    .collection("unibet-backtest")
    .find(
      {
        "lines.statKey": { $in: ["totalShots", "shotsOnGoal"] },
        "lines.period": "ALL",
      },
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

function buildTeamMatchCacheKey(teamName, role) {
  return `${String(teamName || "").toLowerCase()}|${role}`;
}

async function getCached(cache, key, loader) {
  if (!cache.has(key)) {
    cache.set(key, Promise.resolve().then(loader));
  }
  return cache.get(key);
}

async function rebuildReplayRow({
  row,
  bundleCache,
  matchCache,
  leaguesData,
}) {
  const cutoffTimestamp = toTimestamp(row?.snapshotFetchedAt) ?? toTimestamp(row?.matchDate);
  if (!Number.isFinite(cutoffTimestamp)) {
    return { skipReason: "missing-cutoff" };
  }

  const isOver = normalizeConditionToIsOver(row?.condition ?? row?.direction);
  if (isOver == null) {
    return { skipReason: "unsupported-condition" };
  }

  const [homeBundle, awayBundle, homeMatchesRawAll, awayMatchesRawAll] = await Promise.all([
    getCached(bundleCache, String(row.homeTeam || "").toLowerCase(), () =>
      fetchTeamProfilesBundle(row.homeTeam)
    ),
    getCached(bundleCache, String(row.awayTeam || "").toLowerCase(), () =>
      fetchTeamProfilesBundle(row.awayTeam)
    ),
    getCached(matchCache, buildTeamMatchCacheKey(row.homeTeam, "home"), () =>
      fetchTeamMatches(row.homeTeam, "home")
    ),
    getCached(matchCache, buildTeamMatchCacheKey(row.awayTeam, "away"), () =>
      fetchTeamMatches(row.awayTeam, "away")
    ),
  ]);

  if (!homeBundle || !awayBundle) {
    return { skipReason: "missing-bundle" };
  }

  const homeMatchesRaw = filterMatchesBeforeCutoff(homeMatchesRawAll, cutoffTimestamp);
  const awayMatchesRaw = filterMatchesBeforeCutoff(awayMatchesRawAll, cutoffTimestamp);
  if (!homeMatchesRaw.length || !awayMatchesRaw.length) {
    return { skipReason: "missing-team-matches" };
  }

  const result = await calculateEVFromData(
    {
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      stat: row.statKey,
      scope: row.scope || "total",
      period: row.period || "ALL",
      line: Number(row.line),
      over: isOver,
      odds: Number(row.odds),
      underOdds: row.underOdds,
      form: DEFAULT_FORM,
      neutralGround: DEFAULT_NEUTRAL,
      home_importance: DEFAULT_IMPORTANCE,
      away_importance: DEFAULT_IMPORTANCE,
      matchDate: new Date(cutoffTimestamp).toISOString(),
    },
    {
      homeBundle,
      awayBundle,
      homeMatchesRaw,
      awayMatchesRaw,
      leaguesData,
    }
  );

  return {
    ...row,
    evDetails: collectEvDetails(result),
    replayCutoff: new Date(cutoffTimestamp).toISOString(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.env.ENABLE_ML_TIER2 = "1";

  const client = await clientPromise;
  try {
    const payload = await withSuppressedOutput(async () => {
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

      const leaguesData = await fetchLeaguesAndTeams();
      const bundleCache = new Map();
      const matchCache = new Map();
      const rebuiltRows = [];
      const skipped = Object.create(null);

      for (const candidate of candidates) {
        const rebuilt = await rebuildReplayRow({
          row: candidate,
          bundleCache,
          matchCache,
          leaguesData,
        });
        if (rebuilt?.skipReason) {
          skipped[rebuilt.skipReason] = (skipped[rebuilt.skipReason] || 0) + 1;
          continue;
        }
        rebuiltRows.push(rebuilt);
      }

      const summary = summarizeConfiguredFormulaResults(rebuiltRows);
      return {
        mode: "ml-replay",
        metrics: summary.metrics,
        topExamples: summary.topExamples,
        statBreakdown: summary.statBreakdown,
        samples: {
          documents: docs.length,
          replayCandidates: candidates.length,
          rebuiltCandidates: rebuiltRows.length,
          skipped,
        },
        guardrails: buildGuardrails(summary),
        notes: [
          "Replays current runtime ML against historical settled lines.",
          "Team profile bundles are current-state, so this replay is directional rather than leakage-free.",
        ],
      };
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }

    process.stdout.write("ML formula replay summary\n");
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } finally {
    if (client?.close) {
      await client.close();
    }
  }
}

main().catch((error) => {
  console.error("Failed to run ML replay eval", error);
  process.exit(1);
});
