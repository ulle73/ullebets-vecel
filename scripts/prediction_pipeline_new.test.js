import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_PERIODS_NEW,
  ALL_SCOPES_NEW,
  ALL_STATS_NEW,
  buildDatasetFileNameNew,
  buildDatasetKeyNew,
  buildFeatureNamesNew,
  buildSupportedCombosNew,
  parseDatasetFileNameNew,
} from "../machinelearning/data/extract/pipelineConfig-new.js";
import {
  buildSampleFeatureBundleNew,
  buildStrictProfileFlagsNew,
} from "../machinelearning/data/extract/featureBuilder-new.js";
import {
  TRAIN_END_DATE_NEW,
  VAL_END_DATE_NEW,
  buildMongoClientOptionsNew,
  buildExtractionOptionsFromArgsNew,
  buildDatasetManifestNew,
  connectMongoClientNew,
  isRetryableMongoReadErrorNew,
  runWithRetryNew,
  splitNameForDateNew,
} from "../machinelearning/data/extract/extractTrainingData-new.js";
import {
  createDatasetWriterNew,
} from "../machinelearning/data/extract/datasetWriter-new.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("pipeline config exposes the explicit stat, scope, and period universe", () => {
  assert.deepEqual(ALL_SCOPES_NEW, ["home", "away", "total"]);
  assert.deepEqual(ALL_PERIODS_NEW, ["ALL", "1ST", "2ND"]);
  assert.equal(ALL_STATS_NEW.includes("totalShots"), true);
  assert.equal(ALL_STATS_NEW.includes("freeKicks"), true);
  assert.equal(ALL_STATS_NEW.includes("yellowCards"), true);
});

test("supported combo generation covers every stat/scope/period combination", () => {
  const combos = buildSupportedCombosNew();

  assert.equal(combos.length, ALL_STATS_NEW.length * ALL_SCOPES_NEW.length * ALL_PERIODS_NEW.length);
  assert.deepEqual(combos[0], {
    statKey: ALL_STATS_NEW[0],
    scope: "home",
    period: "ALL",
  });
  assert.deepEqual(combos.at(-1), {
    statKey: ALL_STATS_NEW.at(-1),
    scope: "total",
    period: "2ND",
  });
});

test("dataset file helpers round-trip combo, mode, and split", () => {
  const fileName = buildDatasetFileNameNew({
    statKey: "totalShots",
    scope: "away",
    period: "ALL",
    featureMode: "strict",
    split: "train",
  });

  assert.equal(fileName, "totalShots_away_ALL_strict_train.jsonl");
  assert.deepEqual(parseDatasetFileNameNew(fileName), {
    statKey: "totalShots",
    scope: "away",
    period: "ALL",
    featureMode: "strict",
    split: "train",
  });
  assert.equal(buildDatasetKeyNew("totalShots", "away", "ALL"), "totalShots_away_ALL");
});

test("feature names separate strict and extended feature groups", () => {
  const strictFeatureNames = buildFeatureNamesNew("strict");
  const extendedFeatureNames = buildFeatureNamesNew("extended");

  assert.ok(strictFeatureNames.length > 10);
  assert.ok(extendedFeatureNames.length > strictFeatureNames.length);
  assert.equal(strictFeatureNames.includes("profile_home_value"), false);
  assert.equal(extendedFeatureNames.includes("profile_home_value"), true);
});

test("strict profile flags mark profile features as excluded", () => {
  assert.deepEqual(buildStrictProfileFlagsNew(), {
    includeProfileFeatures: false,
    includeExtendedProfileFeatures: false,
  });
});

test("strict feature mode excludes profile-driven values while extended keeps them", () => {
  const context = {
    statKey: "shotsOnGoal",
    scope: "home",
    period: "ALL",
    target: 4,
    market: {
      line: 3.5,
      overOdds: 1.9,
      underOdds: 1.9,
    },
    teams: {
      home: {
        optaRank: 10,
        optaRating: 83,
        wmaFor: { recent: 4.2, medium: 4.0, long: 3.8 },
        wmaAgainst: { recent: 3.1, medium: 3.0, long: 2.8 },
        profile: {
          statValue: 4.5,
          statRank: 12,
          rankFor: 18,
          rankAgainst: 22,
          scoreFirstPct: 58,
          shotsPerMinute: { leading: 0.12, trailing: 0.21, tied: 0.16 },
          shotsPerTenMinutes: 1.7,
          extraFor: { ballPossession: 62 },
          extraAgainst: { ballPossession: 44 },
        },
      },
      away: {
        optaRank: 25,
        optaRating: 76,
        wmaFor: { recent: 2.8, medium: 2.9, long: 3.0 },
        wmaAgainst: { recent: 4.1, medium: 4.0, long: 3.9 },
        profile: {
          statValue: 3.0,
          statRank: 35,
          rankFor: 29,
          rankAgainst: 31,
          scoreFirstPct: 45,
          shotsPerMinute: { leading: 0.08, trailing: 0.19, tied: 0.12 },
          shotsPerTenMinutes: 1.2,
          extraFor: { ballPossession: 48 },
          extraAgainst: { ballPossession: 57 },
        },
      },
    },
    formulaPredictions: {
      evPctLeagueAvg: 4.1,
      evPctMultifactor: 6.2,
    },
    metadata: {
      date: "2025-10-01T00:00:00.000Z",
      matchId: "match-1",
      source: "backtest",
    },
  };

  const strictBundle = buildSampleFeatureBundleNew(context, "strict");
  const extendedBundle = buildSampleFeatureBundleNew(context, "extended");

  assert.equal(strictBundle.raw_features.length, buildFeatureNamesNew("strict").length);
  assert.equal(extendedBundle.raw_features.length, buildFeatureNamesNew("extended").length);
  assert.equal(strictBundle.feature_flags.includeProfileFeatures, false);
  assert.equal(extendedBundle.feature_flags.includeProfileFeatures, true);
  assert.equal(strictBundle.raw_features.includes(4.5), false);
  assert.equal(extendedBundle.raw_features.includes(4.5), true);
});

test("date split helper assigns train, val, and test chronologically", () => {
  const trainDate = new Date(TRAIN_END_DATE_NEW.getTime() - 24 * 60 * 60 * 1000);
  const valDate = new Date(VAL_END_DATE_NEW.getTime() - 24 * 60 * 60 * 1000);
  const testDate = new Date(VAL_END_DATE_NEW.getTime() + 24 * 60 * 60 * 1000);

  assert.equal(splitNameForDateNew(trainDate), "train");
  assert.equal(splitNameForDateNew(valDate), "val");
  assert.equal(splitNameForDateNew(testDate), "test");
});

test("dataset manifest summarizes counts by combo and feature mode", () => {
  const manifest = buildDatasetManifestNew({
    datasets: {
      totalShots_total_ALL: {
        strict: {
          train: [{ target: 21 }, { target: 18 }],
          val: [{ target: 20 }],
          test: [],
        },
        extended: {
          train: [{ target: 21 }],
          val: [],
          test: [{ target: 19 }],
        },
      },
    },
    featureNameMap: {
      strict: buildFeatureNamesNew("strict"),
      extended: buildFeatureNamesNew("extended"),
    },
  });

  assert.equal(manifest.featureModes.strict.featureCount, buildFeatureNamesNew("strict").length);
  assert.equal(manifest.featureModes.extended.featureCount, buildFeatureNamesNew("extended").length);
  assert.deepEqual(manifest.combos.totalShots_total_ALL.strict, {
    train: 2,
    val: 1,
    test: 0,
    total: 3,
  });
  assert.deepEqual(manifest.combos.totalShots_total_ALL.extended, {
    train: 1,
    val: 0,
    test: 1,
    total: 2,
  });
});

test("dataset writer flushes to disk instead of growing in-memory buffers indefinitely", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "prediction-pipeline-new-"));
  const writer = await createDatasetWriterNew({
    outputDir,
    featureNameMap: {
      strict: buildFeatureNamesNew("strict"),
      extended: buildFeatureNamesNew("extended"),
    },
    flushThreshold: 2,
  });

  const baseSample = {
    raw_features: Array.from({ length: buildFeatureNamesNew("strict").length }, () => 0),
    formula_predictions: {},
    consensus_features: {},
    historical_win_rates: {},
    target: 1,
    metadata: {
      statKey: "shotsOnGoal",
      scope: "home",
      period: "ALL",
      featureMode: "strict",
      date: "2025-01-01T00:00:00.000Z",
    },
  };

  await writer.append(baseSample, "train");
  await writer.append({ ...baseSample, target: 2 }, "train");
  await writer.append({ ...baseSample, target: 3 }, "train");

  assert.ok(writer.getPendingCount() <= 1);

  const manifest = await writer.finalize();
  assert.deepEqual(manifest.combos.shotsOnGoal_home_ALL.strict, {
    train: 3,
    val: 0,
    test: 0,
    total: 3,
  });
});

test("mongo read retry helper retries retriable pool clear errors", async () => {
  let attempts = 0;
  const result = await runWithRetryNew(
    "unit test",
    async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("temporary network issue");
        error.name = "PoolClearedOnNetworkError";
        error.errorLabelSet = new Set(["PoolRequstedRetry"]);
        throw error;
      }
      return "ok";
    },
    { attempts: 2, baseDelayMs: 1 },
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
  assert.equal(
    isRetryableMongoReadErrorNew({
      name: "MongoNetworkTimeoutError",
      errorLabelSet: new Set(),
    }),
    true,
  );
});

test("mongo connect helper retries server selection errors with fresh clients", async () => {
  let attempts = 0;
  const createdClients = [];
  const client = await connectMongoClientNew("mongodb://example.test", {
    attempts: 2,
    baseDelayMs: 1,
    clientFactory: () => {
      attempts += 1;
      const fakeClient = {
        closed: false,
        async connect() {
          if (attempts === 1) {
            const error = new Error("selection timeout");
            error.name = "MongoServerSelectionError";
            throw error;
          }
        },
        async close() {
          fakeClient.closed = true;
        },
      };
      createdClients.push(fakeClient);
      return fakeClient;
    },
  });

  assert.equal(attempts, 2);
  assert.equal(client, createdClients[1]);
  assert.equal(createdClients[0].closed, true);
  assert.equal(createdClients[1].closed, false);
});

test("extractor CLI option builder supports skip-external", () => {
  const options = buildExtractionOptionsFromArgsNew(
    new Map([
      ["--limit-backtests", "5"],
      ["--skip-supervised", true],
      ["--skip-external", true],
    ]),
  );

  assert.deepEqual(options, {
    limitBacktests: 5,
    limitTeamStats: null,
    skipSupervised: true,
    skipExternal: true,
  });
});

test("mongo client options are conservative for Cosmos extractor runs", () => {
  const options = buildMongoClientOptionsNew();

  assert.equal(options.maxPoolSize, 2);
  assert.equal(options.connectTimeoutMS, 30_000);
  assert.equal(options.serverSelectionTimeoutMS, 45_000);
  assert.equal(options.socketTimeoutMS, 120_000);
});
