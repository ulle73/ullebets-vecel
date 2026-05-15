const MINUTES_PER_DAY = 24 * 60;

export const UNIBET_ODDS_CHECKPOINTS = [
  {
    key: "d5",
    label: "5 dagar före",
    snapshotType: "forward",
    targetDays: 5,
    minMinutesToKickoff: 4 * MINUTES_PER_DAY,
    maxMinutesToKickoff: 6 * MINUTES_PER_DAY,
  },
  {
    key: "d3",
    label: "3 dagar före",
    snapshotType: "forward",
    targetDays: 3,
    minMinutesToKickoff: 2 * MINUTES_PER_DAY,
    maxMinutesToKickoff: 4 * MINUTES_PER_DAY,
  },
  {
    key: "d1",
    label: "1 dag före",
    snapshotType: "forward",
    targetDays: 1,
    minMinutesToKickoff: 18 * 60,
    maxMinutesToKickoff: 36 * 60,
  },
  {
    key: "t2h",
    label: "2 timmar före",
    snapshotType: "closing",
    targetDays: 0,
    minMinutesToKickoff: 90,
    maxMinutesToKickoff: 150,
  },
  {
    key: "t15m",
    label: "Closing 10-15 min",
    snapshotType: "closing",
    targetDays: 0,
    minMinutesToKickoff: 8,
    maxMinutesToKickoff: 20,
  },
];

function toTimestampMs(value) {
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  }
  return null;
}

export function inferCheckpointTargetDays(checkpointKey) {
  const checkpoint = UNIBET_ODDS_CHECKPOINTS.find((item) => item.key === checkpointKey);
  return checkpoint ? checkpoint.targetDays : null;
}

export function getCapturedCheckpointKeys(snapshots = []) {
  if (!Array.isArray(snapshots)) return [];

  const captured = [];
  for (const snapshot of snapshots) {
    const key = typeof snapshot?.checkpointKey === "string" ? snapshot.checkpointKey.trim() : "";
    if (!key) continue;
    if (!captured.includes(key)) {
      captured.push(key);
    }
  }
  return captured;
}

export function pickDueCheckpoint({ matchStart, now = new Date(), snapshots = [] }) {
  const matchStartMs = toTimestampMs(matchStart);
  const nowMs = toTimestampMs(now);
  if (!Number.isFinite(matchStartMs) || !Number.isFinite(nowMs)) {
    return null;
  }

  const minutesToKickoff = Math.round((matchStartMs - nowMs) / 60000);
  if (!Number.isFinite(minutesToKickoff) || minutesToKickoff <= 0) {
    return null;
  }

  const captured = new Set(getCapturedCheckpointKeys(snapshots));
  return (
    UNIBET_ODDS_CHECKPOINTS.find((checkpoint) => {
      if (captured.has(checkpoint.key)) return false;
      return (
        minutesToKickoff >= checkpoint.minMinutesToKickoff &&
        minutesToKickoff < checkpoint.maxMinutesToKickoff
      );
    }) || null
  );
}
