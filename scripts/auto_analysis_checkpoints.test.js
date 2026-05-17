import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_ANALYSIS_CHECKPOINTS,
  buildAutoAnalysisCheckpointTargets,
  buildAutoAnalysisRunKey,
  getAutoAnalysisCheckpoint,
} from "../lib/autoAnalysis/checkpoints.js";

test("buildAutoAnalysisCheckpointTargets returns d3 and matchday dates in Stockholm time", () => {
  const targets = buildAutoAnalysisCheckpointTargets({
    now: new Date("2026-05-15T09:00:00.000+02:00"),
  });

  assert.equal(targets.length, AUTO_ANALYSIS_CHECKPOINTS.length);
  assert.deepEqual(
    targets.map((target) => ({ key: target.key, date: target.date })),
    [
      { key: "d3", date: "2026-05-18" },
      { key: "matchday", date: "2026-05-15" },
    ]
  );
});

test("buildAutoAnalysisCheckpointTargets can filter to a single checkpoint", () => {
  const targets = buildAutoAnalysisCheckpointTargets({
    now: new Date("2026-05-15T09:00:00.000+02:00"),
    checkpointKey: "matchday",
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].key, "matchday");
  assert.equal(targets[0].date, "2026-05-15");
});

test("buildAutoAnalysisRunKey creates deterministic idempotency keys per checkpoint", () => {
  assert.equal(
    buildAutoAnalysisRunKey({ date: "2026-05-18", strategyId: "balanced", checkpointKey: "d3" }),
    "2026-05-18:balanced:d3"
  );
  assert.equal(getAutoAnalysisCheckpoint("d3")?.label, "3 dagar innan");
});
