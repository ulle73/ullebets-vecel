import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  loadXGBoostRegressor,
  predictTier2Count,
  predictXGBoostRegressor,
} from "../lib/backtest/formulas/mlTier2Runtime.js";

const repoRoot = process.cwd();
const tier1TotalShotsModelPath = path.join(
  repoRoot,
  "machinelearning/models/trained/tier1/totalShots_total_ALL_raw.json"
);
const tier2TotalShotsModelPath = path.join(
  repoRoot,
  "machinelearning/models/trained/tier2/totalShots_total_ALL_stacked.json"
);
const totalShotsDatasetPath = path.join(
  repoRoot,
  "machinelearning/data/datasets/totalShots_total_ALL_train.jsonl"
);
const shotsOnGoalHomeDatasetPath = path.join(
  repoRoot,
  "machinelearning/data/datasets/shotsOnGoal_home_ALL_train.jsonl"
);

function readFirstJsonl(filePath) {
  const line = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .find((value) => value.trim().length > 0);
  return JSON.parse(line);
}

async function importFreshMlFactory() {
  const moduleUrl = pathToFileURL(
    path.join(repoRoot, "lib/backtest/formulas/mlTier2Factory.js")
  ).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

test("Phase 1 limits available ML formulas to totalShots and shotsOnGoal ALL only", async () => {
  process.env.ENABLE_ML_TIER2 = "1";
  const { getAvailableMLFormulas } = await importFreshMlFactory();

  assert.deepEqual(getAvailableMLFormulas(), [
    ["totalShots", "total", "ALL"],
    ["totalShots", "home", "ALL"],
    ["totalShots", "away", "ALL"],
    ["shotsOnGoal", "total", "ALL"],
    ["shotsOnGoal", "home", "ALL"],
    ["shotsOnGoal", "away", "ALL"],
  ]);
});

test("predictXGBoostRegressor matches the trained tier1 totalShots_total_ALL model", () => {
  const sample = readFirstJsonl(totalShotsDatasetPath);
  const model = loadXGBoostRegressor(tier1TotalShotsModelPath);

  const prediction = predictXGBoostRegressor(model, sample.raw_features);

  assert.ok(Math.abs(prediction - 24.1438446) < 0.00001);
});

test("predictTier2Count matches the trained totalShots_total_ALL stacked model", () => {
  const sample = readFirstJsonl(totalShotsDatasetPath);

  const prediction = predictTier2Count({
    statKey: "totalShots",
    scope: "total",
    period: "ALL",
    rawFeatures: sample.raw_features,
    formulaPredictions: sample.formula_predictions,
  });

  assert.ok(Math.abs(prediction - 23.5474148) < 0.00001);
});

test("predictTier2Count handles tier1 selected_features for shotsOnGoal_home_ALL", () => {
  const sample = readFirstJsonl(shotsOnGoalHomeDatasetPath);

  const prediction = predictTier2Count({
    statKey: "shotsOnGoal",
    scope: "home",
    period: "ALL",
    rawFeatures: sample.raw_features,
    formulaPredictions: sample.formula_predictions,
  });

  assert.ok(Math.abs(prediction - 1.1256635) < 0.00001);
});

test("ml_totalShots_total_ALL returns ML EV values for a matching Phase 1 context", async () => {
  process.env.ENABLE_ML_TIER2 = "1";
  const sample = readFirstJsonl(totalShotsDatasetPath);
  const { ml_totalShots_total_ALL } = await importFreshMlFactory();

  const result = ml_totalShots_total_ALL({
    oddsValue: 2.14,
    probabilityOf: (lambda) => Math.min(1, Math.max(0, lambda / 50)),
    params: {
      statKey: "totalShots",
      scope: "total",
      period: "ALL",
    },
    mlTier2Input: {
      rawFeatures: sample.raw_features,
      formulaPredictions: sample.formula_predictions,
    },
  });

  assert.equal(typeof result.ml_totalShots_total_ALL_prob, "number");
  assert.equal(typeof result.ml_totalShots_total_ALL, "number");
  assert.equal(typeof result.ml_totalShots_total_ALL_raw, "number");
});

test("ml_totalShots_total_ALL stays disabled on period mismatch", async () => {
  process.env.ENABLE_ML_TIER2 = "1";
  const sample = readFirstJsonl(totalShotsDatasetPath);
  const { ml_totalShots_total_ALL } = await importFreshMlFactory();

  const result = ml_totalShots_total_ALL({
    oddsValue: 2.14,
    params: {
      statKey: "totalShots",
      scope: "total",
      period: "1ST",
    },
    mlTier2Input: {
      rawFeatures: sample.raw_features,
      formulaPredictions: sample.formula_predictions,
    },
  });

  assert.deepEqual(result, {});
});
