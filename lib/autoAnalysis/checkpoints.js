import { coerceDate, formatDateInZone } from "../utils/date.js";

export const AUTO_ANALYSIS_CHECKPOINTS = [
  {
    key: "d3",
    label: "3 dagar innan",
    targetDays: 3,
  },
  {
    key: "matchday",
    label: "Matchdag",
    targetDays: 0,
  },
];

const TIME_ZONE = "Europe/Stockholm";

export function getAutoAnalysisCheckpoint(checkpointKey) {
  return AUTO_ANALYSIS_CHECKPOINTS.find((checkpoint) => checkpoint.key === checkpointKey) || null;
}

export function buildAutoAnalysisRunKey({ date, strategyId = "balanced", checkpointKey = "manual" } = {}) {
  return `${date || "unknown-date"}:${strategyId || "balanced"}:${checkpointKey || "manual"}`;
}

export function buildAutoAnalysisCheckpointTargets({ now = new Date(), checkpointKey = null } = {}) {
  const reference = coerceDate(now) || new Date();
  const checkpoints = checkpointKey
    ? AUTO_ANALYSIS_CHECKPOINTS.filter((checkpoint) => checkpoint.key === checkpointKey)
    : AUTO_ANALYSIS_CHECKPOINTS;

  return checkpoints.map((checkpoint) => {
    const targetDate = new Date(reference);
    targetDate.setDate(targetDate.getDate() + checkpoint.targetDays);
    return {
      ...checkpoint,
      date: formatDateInZone(targetDate, TIME_ZONE),
      referenceDate: formatDateInZone(reference, TIME_ZONE),
    };
  });
}
