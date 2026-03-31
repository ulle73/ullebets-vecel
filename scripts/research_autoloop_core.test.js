import test from "node:test";
import assert from "node:assert/strict";

import {
  applyNumericMutation,
  applyStringMutation,
  applyStringArrayMutation,
  decideExperimentStatus,
  parseEvalJson,
  readStringProperty,
  readStringArrayProperty,
  readNumericProperty,
} from "./research_autoloop_core.js";

test("parseEvalJson ignores leading shell noise", () => {
  const parsed = parseEvalJson(`
> ullebets-vecel@0.1.0 research:eval
> node scripts/research_eval.js --json

{
  "researchScore": 42,
  "metrics": { "roiPct": 7.5 },
  "guardrails": { "minPickedDates": true, "minPickedBets": false, "minProofCoveragePct": true, "ok": false }
}
`);

  assert.equal(parsed.researchScore, 42);
  assert.equal(parsed.metrics.roiPct, 7.5);
});

test("decideExperimentStatus prefers ROI when focus is roi and guardrails do not regress", () => {
  const baseline = {
    researchScore: 25,
    metrics: { roiPct: 1, beatClosePct: 40, avgClv: 0.4, pickedDates: 12, pickedBets: 24, proofCoveragePct: 40 },
    guardrails: { minPickedDates: true, minPickedBets: true, minProofCoveragePct: true, ok: true },
  };

  const candidate = {
    researchScore: 24,
    metrics: { roiPct: 3, beatClosePct: 35, avgClv: 0.2, pickedDates: 12, pickedBets: 24, proofCoveragePct: 40 },
    guardrails: { minPickedDates: true, minPickedBets: true, minProofCoveragePct: true, ok: true },
  };

  const decision = decideExperimentStatus({ baseline, candidate, focus: "roi" });
  assert.equal(decision.status, "keep");
  assert.match(decision.reason, /roi/i);
});

test("decideExperimentStatus discards candidates that regress guardrail coverage", () => {
  const baseline = {
    researchScore: 25,
    metrics: { roiPct: 1, beatClosePct: 40, avgClv: 0.4, pickedDates: 12, pickedBets: 24, proofCoveragePct: 40 },
    guardrails: { minPickedDates: true, minPickedBets: true, minProofCoveragePct: true, ok: true },
  };

  const candidate = {
    researchScore: 30,
    metrics: { roiPct: 6, beatClosePct: 55, avgClv: 1.1, pickedDates: 12, pickedBets: 24, proofCoveragePct: 10 },
    guardrails: { minPickedDates: true, minPickedBets: true, minProofCoveragePct: false, ok: false },
  };

  const decision = decideExperimentStatus({ baseline, candidate, focus: "researchScore" });
  assert.equal(decision.status, "discard");
  assert.match(decision.reason, /guardrail/i);
});

test("applyNumericMutation updates a nested numeric property without touching siblings", () => {
  const source = `export const STRATEGY_PROFILES = {
  balanced: {
    weights: {
      edge: 0.28,
      proof: 0.05,
    },
  },
};
`;

  const next = applyNumericMutation(source, {
    declarationName: "STRATEGY_PROFILES",
    propertyPath: ["balanced", "weights", "edge"],
    nextValue: 0.34,
  });

  assert.match(next, /edge: 0\.34,/);
  assert.match(next, /proof: 0\.05,/);
});

test("readNumericProperty returns the current numeric value for a nested property", () => {
  const source = `export const SCORE_SHAPING = {
  idealPriceCenter: 2.05,
  priceDistanceWeight: 55,
};
`;

  const value = readNumericProperty(source, "SCORE_SHAPING", ["idealPriceCenter"]);
  assert.equal(value, 2.05);
});

test("readStringArrayProperty returns the current string array for a nested property", () => {
  const source = `const INLINE_CONFIG = {
  totalShots: {
    display: ["leagueAvg", "base"],
    blendWeight: 0.8,
  },
};
`;

  const value = readStringArrayProperty(source, "INLINE_CONFIG", ["totalShots", "display"]);
  assert.deepEqual(value, ["leagueAvg", "base"]);
});

test("applyStringArrayMutation updates a nested string array without touching sibling properties", () => {
  const source = `const INLINE_CONFIG = {
  totalShots: {
    display: ["leagueAvg", "base"],
    blendWeight: 0.8,
  },
};
`;

  const next = applyStringArrayMutation(source, {
    declarationName: "INLINE_CONFIG",
    propertyPath: ["totalShots", "display"],
    nextValue: ["multiplier", "leagueAvg"],
  });

  assert.match(next, /display: \["multiplier", "leagueAvg"\],/);
  assert.match(next, /blendWeight: 0\.8,/);
});

test("readStringProperty returns the current string value for a nested property", () => {
  const source = `const INLINE_ML_SELECTION_POLICY = {
  totalShots: {
    total: {
      ALL: "off",
    },
  },
};
`;

  const value = readStringProperty(source, "INLINE_ML_SELECTION_POLICY", [
    "totalShots",
    "total",
    "ALL",
  ]);
  assert.equal(value, "off");
});

test("applyStringMutation updates a nested string value without touching sibling properties", () => {
  const source = `const INLINE_ML_SELECTION_POLICY = {
  totalShots: {
    total: {
      ALL: "off",
    },
    home: {
      ALL: "off",
    },
  },
};
`;

  const next = applyStringMutation(source, {
    declarationName: "INLINE_ML_SELECTION_POLICY",
    propertyPath: ["totalShots", "total", "ALL"],
    nextValue: "primary",
  });

  assert.match(next, /ALL: "primary",/);
  assert.match(next, /home: \{\s*ALL: "off",/s);
});
