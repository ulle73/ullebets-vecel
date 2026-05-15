import test from "node:test";
import assert from "node:assert/strict";

import {
  getCapturedCheckpointKeys,
  pickDueCheckpoint,
} from "./lib/unibet/oddsCheckpoints.js";
import { buildSnapshotTimingFields } from "./lib/repos/snapshotFields.js";

test("pickDueCheckpoint returns d5 when a match is inside the 5-day window and no checkpoint exists", () => {
  const checkpoint = pickDueCheckpoint({
    matchStart: "2026-05-20T18:00:00.000Z",
    now: "2026-05-15T15:00:00.000Z",
    snapshots: [],
  });

  assert.equal(checkpoint?.key, "d5");
  assert.equal(checkpoint?.snapshotType, "forward");
});

test("pickDueCheckpoint skips already captured checkpoints and picks the next due window", () => {
  const checkpoint = pickDueCheckpoint({
    matchStart: "2026-05-18T18:00:00.000Z",
    now: "2026-05-15T15:00:00.000Z",
    snapshots: [{ checkpointKey: "d5" }],
  });

  assert.equal(checkpoint?.key, "d3");
  assert.deepEqual(getCapturedCheckpointKeys([{ checkpointKey: "d5" }, { checkpointKey: "t2h" }]), [
    "d5",
    "t2h",
  ]);
});

test("pickDueCheckpoint returns t15m close to kickoff and never after start", () => {
  const beforeKickoff = pickDueCheckpoint({
    matchStart: "2026-05-15T18:00:00.000Z",
    now: "2026-05-15T17:48:00.000Z",
    snapshots: [{ checkpointKey: "d5" }, { checkpointKey: "d3" }, { checkpointKey: "d1" }, { checkpointKey: "t2h" }],
  });

  const afterKickoff = pickDueCheckpoint({
    matchStart: "2026-05-15T18:00:00.000Z",
    now: "2026-05-15T18:01:00.000Z",
    snapshots: [],
  });

  assert.equal(beforeKickoff?.key, "t15m");
  assert.equal(afterKickoff, null);
});

test("buildSnapshotTimingFields uses capturedAt and checkpoint metadata instead of target date", () => {
  const timing = buildSnapshotTimingFields({
    matchDate: "2026-05-20T18:00:00.000Z",
    capturedAt: "2026-05-20T16:00:00.000Z",
    checkpointKey: "t2h",
  });

  assert.equal(timing.horizonDays, 0);
  assert.equal(timing.minutesToKickoff, 120);
});
