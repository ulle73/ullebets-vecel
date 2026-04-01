# Prediction Pipeline New Design

**Goal**

Build a fully separate v2 prediction pipeline for machine-learning count projections that leaves the current pipeline untouched, covers all current stat/scope/period combinations, and improves methodological quality for projection work.

**Scope**

- New extractor, trainers, runners, metadata, and logs only
- No edits to existing `machinelearning` pipeline files
- Coverage for the current combo universe:
  - `cornerKicks`
  - `fouls`
  - `freeKicks`
  - `goalKicks`
  - `offsides`
  - `shotsOnGoal`
  - `throwIns`
  - `totalShots`
  - `totalShotsOnGoal`
  - `yellowCards`
- All scopes: `home`, `away`, `total`
- All periods: `ALL`, `1ST`, `2ND`

**Non-Goals**

- This v2 pipeline is for count projection quality, not direct EV optimization
- No replacement of production inference paths in this change
- No edits to current training outputs under `models/trained/tier1` or `tier2`

## Problem

The current pipeline is usable, but it has three material weaknesses for projection quality:

1. It mixes historically safer features with current-state `teamprofiles`, which weakens historical truthfulness.
2. It selects models mostly from a single fixed validation window.
3. Tier 2 uses a thin, mostly fixed training configuration rather than robust selection.

## Approach

Create a parallel v2 pipeline with new files only.

### Data Extraction

New extractor writes datasets into `machinelearning/data/datasets-new/`.

For each combo it produces:

- `strict` dataset:
  - market features when available
  - Opta team quality features
  - historical WMA features from `teamstats`
  - formula prediction features from historical `evDetails` when available
  - no `teamprofiles` features
- `extended` dataset:
  - all `strict` features
  - plus `teamprofiles`-derived features
  - plus extra feature groups already used by the old pipeline

This explicitly separates the more historically trustworthy feature set from the richer but riskier set.

The extractor also writes:

- a manifest containing combo counts by split and mode
- feature names for each mode
- data-source coverage

### Tier 1

Tier 1 v2 trains projection models directly from `raw_features`.

Candidate families:

- `baseline_mean`
- XGBoost squared error on raw target
- XGBoost squared error on `log1p(target)`
- XGBoost Poisson objective

Model selection uses walk-forward validation on `train + val` only.

Primary selection criteria:

1. lower median MAE
2. lower median RMSE
3. higher median R²
4. lower instability penalty across folds

Final model is retrained on `train + val` and reported on `test`.

### Tier 2

Tier 2 v2 stacks:

- raw features
- formula predictions
- consensus statistics
- out-of-fold style Tier 1 predictions generated inside each fold from the chosen Tier 1 family

Tier 2 uses the same walk-forward selection pattern and then retrains on `train + val`, reporting final `test` metrics.

### Combo Coverage

The new pipeline works from an explicit combo universe and skips only when there is not enough data.

This means:

- all current stats/scopes/periods are attempted
- combos with thin data are recorded as skipped with reasons in metadata
- the pipeline does not silently drop coverage

## Output Layout

- `machinelearning/data/extract/extractTrainingData-new.js`
- `machinelearning/data/extract/pipelineConfig-new.js`
- `machinelearning/data/extract/featureBuilder-new.js`
- `machinelearning/models/train/common-new.py`
- `machinelearning/models/train/tier1_trainRawFeatures-new.py`
- `machinelearning/models/train/tier2_trainMetaLearner-new.py`
- `machinelearning/run-tier1-new.py`
- `machinelearning/run-tier2-new.py`
- `machinelearning/logs/tier1_runs_new.json`
- `machinelearning/logs/tier2_runs_new.json`
- `machinelearning/logs/tier1_comparison_summary_new.txt`
- `machinelearning/logs/tier2_comparison_summary_new.txt`
- `machinelearning/models/trained/tier1-new/`
- `machinelearning/models/trained/tier2-new/`

## Error Handling

- Missing or weak combo data is not fatal
- Each combo reports:
  - sample counts
  - mode used
  - candidate families attempted
  - skip reasons if no model is trained
- Extractor failures for individual matches are logged and counted, not fatal to the whole run

## Testing Strategy

Write tests before implementation for:

- combo universe discovery
- dataset filename parsing
- walk-forward split generation
- scoring and model ranking
- feature mode behavior where `strict` excludes profile-driven features

Then smoke-test:

- extractor on real repo data
- Tier 1 new on one or two combos
- Tier 2 new on one or two combos

## Operational Usage

Because existing files must stay untouched, the new pipeline is run manually via direct script invocation rather than by editing the current `package.json`.

Expected commands:

```bash
node machinelearning/data/extract/extractTrainingData-new.js
python machinelearning/run-tier1-new.py
python machinelearning/run-tier2-new.py
```

## Risks

1. `teamprofiles` may still reflect current-state information. This is why v2 separates `strict` and `extended`.
2. Some combos may have too little data for stable Tier 2 training.
3. XGBoost Poisson support may be weaker for some combos; the pipeline must degrade gracefully and retain the better family.

## Recommendation

Build v2 exactly as a parallel pipeline, keep old outputs intact, and use v2 metadata to compare projection quality combo-by-combo before any production adoption.
