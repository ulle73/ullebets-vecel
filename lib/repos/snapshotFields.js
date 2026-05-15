import { inferCheckpointTargetDays } from "../unibet/oddsCheckpoints.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value, fallback = null) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : fallback;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : fallback;
  }
  return fallback;
}

export function buildSnapshotTimingFields({ matchDate, capturedAt, checkpointKey, minutesToKickoff } = {}) {
  const capturedAtDate = toDate(capturedAt, new Date());
  const matchDateValue = toDate(matchDate);
  const computedMinutesToKickoff = Number.isFinite(Number(minutesToKickoff))
    ? Math.round(Number(minutesToKickoff))
    : matchDateValue
      ? Math.round((matchDateValue.getTime() - capturedAtDate.getTime()) / 60000)
      : null;

  const checkpointDays = inferCheckpointTargetDays(checkpointKey);
  let horizonDays = checkpointDays;

  if (horizonDays == null && matchDateValue) {
    const diffMs = matchDateValue.getTime() - capturedAtDate.getTime();
    horizonDays = diffMs > 0 ? Math.max(0, Math.round(diffMs / DAY_MS)) : 0;
  }

  return {
    capturedAtDate,
    minutesToKickoff: computedMinutesToKickoff,
    horizonDays,
  };
}
