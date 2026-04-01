# Prediction Pipeline New Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a fully separate v2 ML prediction pipeline with `-new` files only, covering all current stat/scope/period combinations and improving projection quality through safer feature modes and walk-forward validation.

**Architecture:** The new pipeline keeps extraction, Tier 1, Tier 2, logs, and model outputs fully parallel to the existing pipeline. It introduces two feature modes (`strict` and `extended`), walk-forward model selection, and explicit combo coverage metadata while reusing existing Mongo sources and historical backtest records.

**Tech Stack:** Node.js, MongoDB, Python, XGBoost, scikit-learn, Node test runner, Python unittest

---

### Task 1: Add design-safe coverage and split helpers

**Files:**
- Create: `machinelearning/data/extract/pipelineConfig-new.js`
- Create: `machinelearning/models/train/common-new.py`
- Test: `scripts/prediction_pipeline_new.test.js`
- Test: `machinelearning/models/train/test_common_new.py`

**Step 1: Write failing tests**

- Add a Node test for explicit combo generation and dataset filename parsing.
- Add a Python unittest for walk-forward split generation and ranking helper behavior.

**Step 2: Run tests to verify they fail**

Run:

```bash
node --test scripts/prediction_pipeline_new.test.js
python -m unittest machinelearning.models.train.test_common_new
```

Expected:
- missing module errors for the new helper files

**Step 3: Write minimal implementation**

- Implement explicit stat/scope/period universe in `pipelineConfig-new.js`
- Implement filename helpers in `pipelineConfig-new.js`
- Implement walk-forward and score helpers in `common-new.py`

**Step 4: Run tests to verify they pass**

Run:

```bash
node --test scripts/prediction_pipeline_new.test.js
python -m unittest machinelearning.models.train.test_common_new
```

**Step 5: Commit**

```bash
git add scripts/prediction_pipeline_new.test.js machinelearning/data/extract/pipelineConfig-new.js machinelearning/models/train/common-new.py machinelearning/models/train/test_common_new.py
git commit -m "feat: add prediction pipeline v2 core helpers"
```

### Task 2: Build new feature extraction modules

**Files:**
- Create: `machinelearning/data/extract/featureBuilder-new.js`
- Create: `machinelearning/data/extract/extractTrainingData-new.js`
- Test: `scripts/prediction_pipeline_new.test.js`

**Step 1: Write failing tests**

- Add tests for:
  - `strict` feature mode excluding profile features
  - dataset key naming
  - combo manifest shape

**Step 2: Run tests to verify they fail**

Run:

```bash
node --test scripts/prediction_pipeline_new.test.js
```

**Step 3: Write minimal implementation**

- Implement feature builders for `strict` and `extended`
- Implement extractor writing to `machinelearning/data/datasets-new/`
- Emit manifest and feature-name metadata

**Step 4: Run tests to verify they pass**

Run:

```bash
node --test scripts/prediction_pipeline_new.test.js
```

**Step 5: Commit**

```bash
git add machinelearning/data/extract/featureBuilder-new.js machinelearning/data/extract/extractTrainingData-new.js scripts/prediction_pipeline_new.test.js
git commit -m "feat: add prediction pipeline v2 extractor"
```

### Task 3: Build Tier 1 new trainer

**Files:**
- Create: `machinelearning/models/train/tier1_trainRawFeatures-new.py`
- Create: `machinelearning/run-tier1-new.py`
- Modify: `machinelearning/models/train/test_common_new.py`

**Step 1: Write failing tests**

- Add tests for:
  - candidate family parsing
  - model selection tie-break behavior
  - metadata summary shape

**Step 2: Run tests to verify they fail**

Run:

```bash
python -m unittest machinelearning.models.train.test_common_new
```

**Step 3: Write minimal implementation**

- Train across `strict` and `extended` datasets
- Use walk-forward selection on `train + val`
- Retrain final model on `train + val`
- Save to `models/trained/tier1-new/`

**Step 4: Run tests to verify they pass**

Run:

```bash
python -m unittest machinelearning.models.train.test_common_new
python machinelearning/run-tier1-new.py --limit-combos 1
```

**Step 5: Commit**

```bash
git add machinelearning/models/train/tier1_trainRawFeatures-new.py machinelearning/run-tier1-new.py machinelearning/models/train/test_common_new.py
git commit -m "feat: add prediction pipeline v2 tier1 trainer"
```

### Task 4: Build Tier 2 new trainer

**Files:**
- Create: `machinelearning/models/train/tier2_trainMetaLearner-new.py`
- Create: `machinelearning/run-tier2-new.py`
- Modify: `machinelearning/models/train/test_common_new.py`

**Step 1: Write failing tests**

- Add tests for:
  - Tier 2 feature assembly
  - out-of-fold Tier 1 prediction injection
  - safe fallback when formula predictions are sparse

**Step 2: Run tests to verify they fail**

Run:

```bash
python -m unittest machinelearning.models.train.test_common_new
```

**Step 3: Write minimal implementation**

- Train Tier 2 from formula predictions + consensus + Tier 1 fold predictions
- Save best model and metadata into `models/trained/tier2-new/`
- Write run logs into `machinelearning/logs/*_new*`

**Step 4: Run tests to verify they pass**

Run:

```bash
python -m unittest machinelearning.models.train.test_common_new
python machinelearning/run-tier2-new.py --limit-combos 1
```

**Step 5: Commit**

```bash
git add machinelearning/models/train/tier2_trainMetaLearner-new.py machinelearning/run-tier2-new.py machinelearning/models/train/test_common_new.py
git commit -m "feat: add prediction pipeline v2 tier2 trainer"
```

### Task 5: Smoke-test the end-to-end pipeline

**Files:**
- Create: `machinelearning/README-new.md`

**Step 1: Run extractor**

Run:

```bash
node machinelearning/data/extract/extractTrainingData-new.js
```

Expected:
- datasets written under `machinelearning/data/datasets-new/`
- manifest written with combo coverage

**Step 2: Run Tier 1**

Run:

```bash
python machinelearning/run-tier1-new.py --limit-combos 2
```

Expected:
- metadata and models written under `models/trained/tier1-new/`

**Step 3: Run Tier 2**

Run:

```bash
python machinelearning/run-tier2-new.py --limit-combos 2
```

Expected:
- metadata and models written under `models/trained/tier2-new/`

**Step 4: Write usage doc**

- Add `README-new.md` with exact commands and output paths

**Step 5: Commit**

```bash
git add machinelearning/README-new.md machinelearning/data/datasets-new machinelearning/models/trained/tier1-new machinelearning/models/trained/tier2-new
git commit -m "docs: add usage for prediction pipeline v2"
```
