import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTrackingPriceSnapshot,
  computeTrackedOddsWindow,
  findMatchingClvDoc,
} from "./lib/clvTracking.js";

test("computeTrackedOddsWindow uses first and last pre-match odds and ignores post-start prices", () => {
  const eventTimestampMs = Date.parse("2026-05-15T18:00:00.000Z");
  const tracked = computeTrackedOddsWindow({
    eventTimestampMs,
    priceHistory: [
      buildTrackingPriceSnapshot({ odds: 1.91, observedAt: "2026-05-15T09:00:00.000Z", source: "tracked" }),
      buildTrackingPriceSnapshot({ odds: 1.84, observedAt: "2026-05-15T15:00:00.000Z", source: "market" }),
      buildTrackingPriceSnapshot({ odds: 1.73, observedAt: "2026-05-15T18:05:00.000Z", source: "market" }),
    ],
  });

  assert.deepEqual(
    {
      savedOdds: tracked.savedOdds,
      closingOdds: tracked.closingOdds,
      clvPct: tracked.clvPct,
      savedObservedAt: tracked.savedObservedAt,
      closingObservedAt: tracked.closingObservedAt,
      beatClosingLine: tracked.beatClosingLine,
    },
    {
      savedOdds: 1.91,
      closingOdds: 1.84,
      clvPct: 3.8,
      savedObservedAt: "2026-05-15T09:00:00.000Z",
      closingObservedAt: "2026-05-15T15:00:00.000Z",
      beatClosingLine: true,
    }
  );
});

test("computeTrackedOddsWindow hides tracked odds that were only observed after kickoff", () => {
  const tracked = computeTrackedOddsWindow({
    eventTimestampMs: Date.parse("2026-05-15T18:00:00.000Z"),
    priceHistory: [
      buildTrackingPriceSnapshot({ odds: 1.77, observedAt: "2026-05-15T18:03:00.000Z", source: "tracked" }),
    ],
    fallbackTrackedOdds: 1.77,
    fallbackTrackedObservedAt: "2026-05-15T18:03:00.000Z",
  });

  assert.equal(tracked.savedOdds, null);
  assert.equal(tracked.closingOdds, null);
  assert.equal(tracked.clvPct, null);
});

test("findMatchingClvDoc falls back to canonical bet signature when tracking keys differ", () => {
  const trackedBet = {
    trackingKey: "15237966:Botafogo::Mirassol::totalShots::home::ALL::14.5::over::all::false",
    matchId: "15237966",
    bet: {
      statKey: "totalShots",
      scope: "home",
      period: "ALL",
      line: 14.5,
      direction: "over",
    },
  };

  const clvDocs = [
    {
      trackingKey: "15237966:Botafogo::Mirassol::yellowCards::total::ALL::5.5::under::all::false",
      matchId: "15237966",
      bet: {
        statKey: "yellowCards",
        scope: "total",
        period: "ALL",
        line: 5.5,
        direction: "under",
      },
    },
    {
      trackingKey: "15237966:Botafogo::Mirassol::totalShotsOnGoal::home::ALL::14.5::over::all::false",
      matchId: "15237966",
      bet: {
        statKey: "totalShotsOnGoal",
        scope: "home",
        period: "ALL",
        line: 14.5,
        direction: "over",
      },
    },
  ];

  const match = findMatchingClvDoc(clvDocs, trackedBet);
  assert.equal(match?.trackingKey, clvDocs[1].trackingKey);
});
