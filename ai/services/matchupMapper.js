"use client";

import { toNum } from "@/lib/utils/matchups";
import { getStatKeyLabel } from "@/lib/utils/statKeyLabels";

function normalizeLabel(value) {
  if (!value) return null;
  return String(value).trim();
}

export function mapMatchupEntries(rawRows = [], direction = "over") {
  if (!Array.isArray(rawRows)) return [];
  return rawRows
    .map((entry) => {
      const statKey = entry?.statKey ?? entry?.stat ?? entry?.statLabel ?? null;
      if (!statKey) return null;
      const matchLabel =
        normalizeLabel(entry?.match) ||
        normalizeLabel(entry?.matchLabel) ||
        `${normalizeLabel(entry?.home) || "Hemmalaget"} vs ${normalizeLabel(
          entry?.away
        ) || "Bortalaget"}`;
      return {
        matchId: normalizeLabel(entry?.matchId) || matchLabel,
        statKey,
        statLabel: normalizeLabel(entry?.statLabel) || getStatKeyLabel(statKey),
        cluster: entry?.cluster ?? null,
        scope: normalizeLabel(entry?.scope) || "total",
        period: normalizeLabel(entry?.period) || "ALL",
        matchLabel,
        leagueName: normalizeLabel(entry?.league) || normalizeLabel(entry?.leagueName) || null,
        direction,
        score: toNum(entry?.score ?? entry?.sortKey ?? entry?.value),
      };
    })
    .filter(Boolean);
}
