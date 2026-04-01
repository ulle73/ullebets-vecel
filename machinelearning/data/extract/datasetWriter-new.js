import fs from "node:fs/promises";
import path from "node:path";

import {
  DATASET_SPLITS_NEW,
  FEATURE_MODES_NEW,
  buildDatasetFileNameNew,
  buildDatasetKeyNew,
} from "./pipelineConfig-new.js";

function buildEmptyCountsNew() {
  return {};
}

function buildManifestFromCountsNew({ counts, featureNameMap }) {
  const combos = {};
  for (const [comboKey, perMode] of Object.entries(counts)) {
    combos[comboKey] = {};
    for (const featureMode of FEATURE_MODES_NEW) {
      const splitCounts = {};
      let total = 0;
      for (const split of DATASET_SPLITS_NEW) {
        const count = perMode?.[featureMode]?.[split] ?? 0;
        splitCounts[split] = count;
        total += count;
      }
      combos[comboKey][featureMode] = {
        ...splitCounts,
        total,
      };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    comboCount: Object.keys(combos).length,
    featureModes: Object.fromEntries(
      FEATURE_MODES_NEW.map((featureMode) => [
        featureMode,
        {
          featureCount: featureNameMap[featureMode]?.length ?? 0,
          featureNames: featureNameMap[featureMode] ?? [],
        },
      ]),
    ),
    combos,
  };
}

async function cleanOutputDirNew(outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".jsonl") || entry.name === "manifest-new.json") {
      await fs.unlink(path.join(outputDir, entry.name));
    }
  }
}

export async function createDatasetWriterNew({
  outputDir,
  featureNameMap,
  flushThreshold = 250,
}) {
  await cleanOutputDirNew(outputDir);

  const pending = new Map();
  const counts = buildEmptyCountsNew();

  async function flushBufferKey(bufferKey) {
    const rows = pending.get(bufferKey);
    if (!rows?.length) return;
    const filePath = path.join(outputDir, bufferKey);
    const content = `${rows.join("\n")}\n`;
    await fs.appendFile(filePath, content, "utf8");
    pending.set(bufferKey, []);
  }

  function ensureCountPath(comboKey, featureMode) {
    counts[comboKey] ??= {};
    counts[comboKey][featureMode] ??= {};
    for (const split of DATASET_SPLITS_NEW) {
      counts[comboKey][featureMode][split] ??= 0;
    }
  }

  return {
    async append(sample, split) {
      const { statKey, scope, period, featureMode } = sample.metadata ?? {};
      const comboKey = buildDatasetKeyNew(statKey, scope, period);
      ensureCountPath(comboKey, featureMode);
      counts[comboKey][featureMode][split] += 1;

      const fileName = buildDatasetFileNameNew({
        statKey,
        scope,
        period,
        featureMode,
        split,
      });
      pending.set(fileName, pending.get(fileName) ?? []);
      pending.get(fileName).push(JSON.stringify(sample));

      if (pending.get(fileName).length >= flushThreshold) {
        await flushBufferKey(fileName);
      }
    },
    getPendingCount() {
      let total = 0;
      for (const rows of pending.values()) {
        total += rows.length;
      }
      return total;
    },
    async finalize() {
      for (const bufferKey of pending.keys()) {
        await flushBufferKey(bufferKey);
      }
      return buildManifestFromCountsNew({ counts, featureNameMap });
    },
  };
}
