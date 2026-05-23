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
  const { createdAt: runCreatedAt = now, ...runDocForUpdate } = runDoc;

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
  const { createdAt: snapshotCreatedAt = now, ...snapshotForUpdate } = snapshot;

  await db.collection(AUTO_ANALYSIS_RUN_COLLECTION).updateOne(
    deterministicRunId ? { runId } : { runId },
    {
      $set: {
        ...runDocForUpdate,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: runCreatedAt || now,
      },
    },
    { upsert: true }
  );

  if (result.candidates.length) {
    await db.collection(AUTO_ANALYSIS_BET_COLLECTION).bulkWrite(
      result.candidates.map((candidate) => {
        const { createdAt: candidateCreatedAt = now, ...candidateForUpdate } = candidate;

        return {
          updateOne: {
            filter: { runId: candidate.runId, trackingKey: candidate.trackingKey },
            update: {
              $set: {
                ...candidateForUpdate,
                updatedAt: now,
              },
              $setOnInsert: {
                createdAt: candidateCreatedAt || now,
              },
            },
            upsert: true,
          },
        };
      })
    );
  }

  await db.collection(SNAPSHOT_COLLECTION).updateOne(
    { runId },
    {
      $set: {
        ...snapshotForUpdate,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: snapshotCreatedAt || now,
      },
    },
    { upsert: true }
  );

  return result;
}