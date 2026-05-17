import { createLiveAutoAnalysisDeps } from "./liveDeps.js";
import { runAutoAnalysis } from "./runAutoAnalysis.js";
import { buildAutoAnalysisRunKey } from "./checkpoints.js";
import { buildRankingFeedbackLookups } from "./rankingFeedback.js";
import {
  AUTO_ANALYSIS_BET_COLLECTION,
  AUTO_ANALYSIS_RUN_COLLECTION,
  sanitizeAnalysisSnapshot,
} from "./store.js";

const SNAPSHOT_COLLECTION = "analysis-snapshots";

export function buildRunId({ date, strategyId = "balanced", checkpointKey = null, now = new Date(), deterministic = false } = {}) {
  if (deterministic) {
    return buildAutoAnalysisRunKey({
      date,
      strategyId,
      checkpointKey: checkpointKey || "manual",
    });
  }
  return `${date || "unknown-date"}:${strategyId || "balanced"}:${checkpointKey || "manual"}:${now.getTime()}`;
}

export async function executeAndPersistAutoAnalysisRun({
  db,
  date,
  matches,
  strategyId = "balanced",
  strategyLabel = null,
  source = "manual-ui",
  learningProfile = null,
  checkpoint = null,
  now = new Date(),
  deterministicRunId = false,
} = {}) {
  if (!db) throw new Error("executeAndPersistAutoAnalysisRun requires db");
  if (!date) throw new Error("executeAndPersistAutoAnalysisRun requires date");
  if (!Array.isArray(matches) || !matches.length) {
    throw new Error("executeAndPersistAutoAnalysisRun requires matches");
  }

  const effectiveLearningProfile = learningProfile || await buildRankingFeedbackLookups(db);
  const runId = buildRunId({
    date,
    strategyId,
    checkpointKey: checkpoint?.key || null,
    now,
    deterministic: deterministicRunId,
  });
  const runKey = checkpoint?.key
    ? buildAutoAnalysisRunKey({ date, strategyId, checkpointKey: checkpoint.key })
    : null;

  const result = await runAutoAnalysis(
    {
      date,
      matches,
      strategyId,
      strategyLabel,
      source,
      learningProfile: effectiveLearningProfile,
      runId,
      runKey,
      checkpoint,
      createdAt: now,
    },
    createLiveAutoAnalysisDeps()
  );

  const runDoc = {
    ...result.run,
    shortlist: result.shortlist.map((entry) => entry.bestBet),
  };

  const snapshot = sanitizeAnalysisSnapshot({
    runId,
    runKey,
    date,
    strategyId: result.run.strategyId,
    strategyLabel: result.run.strategyLabel,
    checkpointKey: checkpoint?.key || null,
    checkpointLabel: checkpoint?.label || null,
    checkpointTargetDays: checkpoint?.targetDays ?? null,
    analyzedMatches: result.run.analyzedMatches,
    shortlist: result.shortlist.map((entry) => entry.bestBet),
    createdAt: now,
  });

  await db.collection(AUTO_ANALYSIS_RUN_COLLECTION).updateOne(
    deterministicRunId ? { runId } : { runId },
    {
      $set: {
        ...runDoc,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );

  if (result.candidates.length) {
    await db.collection(AUTO_ANALYSIS_BET_COLLECTION).bulkWrite(
      result.candidates.map((candidate) => ({
        updateOne: {
          filter: { runId: candidate.runId, trackingKey: candidate.trackingKey },
          update: {
            $set: {
              ...candidate,
              updatedAt: now,
            },
            $setOnInsert: {
              createdAt: candidate.createdAt || now,
            },
          },
          upsert: true,
        },
      }))
    );
  }

  await db.collection(SNAPSHOT_COLLECTION).updateOne(
    { runId },
    {
      $set: snapshot,
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return result;
}
