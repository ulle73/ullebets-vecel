# Implementation plan: leakage-safe ROI calibration

Date: 2026-06-20  
Repo: `ulle73/ullebets-vecel`  
Requested target file: `implementation-2026-06-20.md`

This document is a technical implementation plan for offline model validation, data-quality checks, timestamp safety and ROI/CLV evaluation. It does not assume the current historical results are reliable until the data audit passes.

## 1. Objective

Build a new evaluation layer that estimates ROI per candidate from information that existed before the candidate was created.

For each candidate, the system should estimate:

```text
p_win
p_push
p_loss
expected_roi_units
expected_roi_pct
probability_of_positive_clv
```

ROI accounting:

```text
EV_units = p_win * (odds - 1) - p_loss
ROI_pct = EV_units * 100
```

Push must be handled as zero return, not dropped from the sample.

## 2. Main risk

The biggest risk is lookahead leakage.

A model is invalid if any feature includes information that was only known after the candidate timestamp.

Before training, every row must prove:

```text
candidate.createdAt < matchStart
oddsObservedAt < matchStart
teamstats_used_at <= candidate.createdAt or at least < matchStart
profile_features_used_at <= candidate.createdAt or are rebuilt from pre-cutoff matches
closingObservedAt < matchStart
result/stat labels are observed after match completion
```

If this cannot be proven, the row must be excluded or marked as non-leakage-safe.

## 3. What is confirmed from the current code

### 3.1 Auto-analysis flow

Confirmed paths:

```text
app/api/auto-analysis-runs/route.js
lib/autoAnalysis/executeRun.js
lib/autoAnalysis/runAutoAnalysis.js
```

Observed behavior:

- The API receives `date`, `strategyId` and `matches`.
- `executeAndPersistAutoAnalysisRun` runs auto-analysis and persists data.
- Runs are stored in `auto-analysis-runs`.
- Candidates are stored in `auto-analysis-bets`.
- Analysis snapshots are stored in `analysis-snapshots`.
- `runAutoAnalysis` maps market tuples, creates over/under candidates and evaluates them in batch.
- `MAX_BETS_PER_MATCH` is currently `120`.
- Candidates are stored with `stakeUnits: 1`.

Important implication:

For model training, use the full candidate universe from `auto-analysis-bets`, not only shortlist snapshots. Shortlist-only training would create selection bias.

### 3.2 Market data flow

Confirmed paths:

```text
lib/autoAnalysis/liveDeps.js
lib/backtest/unibetAuto.js
components/backtest/unibetOddsMapper.js
```

Observed behavior:

- Market data is fetched through Unibet/Kambi event payloads.
- Direct `eventId` is used when available.
- Otherwise the app tries to resolve the event through `findUnibetEventForMatch`.
- Market labels are mapped into stat keys such as:
  - `shotsOnGoal`
  - `totalShots`
  - `cornerKicks`
  - `yellowCards`
  - `freeKicks`
  - `fouls`
  - `totalTackle`
  - `offsides`
- Decimal odds can be parsed from `oddsDecimal`, `odds`, or `oddsFractional`.
- Line parsing handles Kambi-style scaled values.

Must verify:

- Raw Kambi line values are converted correctly for all stat types.
- Both sides of the same market are retained: over and under.
- Player-specific markets are excluded correctly.
- Home/away scope is not corrupted by alias matching.

### 3.3 Teamstats and profile flow

Confirmed path:

```text
lib/backtest/data.js
```

Observed behavior:

- `teamstats` is fetched by `_importMeta.teamName` and `_importMeta.teamRole`, with fallback to the first match in `full`.
- `teamprofiles` is fetched by `meta.matchType` and `meta.lagnamn`.
- Teamstats and profiles are cached.
- League rankings can be read locally or from configured URLs.

Must verify:

- Current live fetches do not filter future matches by default.
- Replay scripts must therefore rebuild or filter historical inputs before the candidate timestamp.
- Current-state teamprofiles must not be used as historical training features unless they are rebuilt or snapshot-safe.

### 3.4 Replay safety

Confirmed paths:

```text
scripts/formula_raw_replay_core.js
scripts/formula_raw_replay_eval.js
scripts/ml_formula_replay_eval.js
```

Observed behavior:

- `filterMatchesBeforeCutoff` exists and filters matches to timestamps before cutoff.
- Formula replay uses `snapshotFetchedAt` or `matchDate` as cutoff.
- ML replay also filters raw team matches before cutoff.

Important limitation:

The current ML replay script explicitly notes that team profile bundles are current-state, so current ML replay is directional rather than fully leakage-free.

Required fix:

Any final evaluation must rebuild profile-derived features from pre-cutoff match data or use historical profile snapshots.

### 3.5 Replay coverage limitation

Current raw replay support appears limited.

Confirmed supported raw replay stat keys:

```text
cornerKicks
totalShots
yellowCards
```

The ML replay path focuses on:

```text
totalShots
shotsOnGoal
period ALL
phase1 ML combinations
```

Required fix:

The audit must report which stat/scope/period combinations are truly covered by leakage-safe replay.

### 3.6 Result and ROI accounting

Confirmed path:

```text
app/api/result-loop/route.js
```

Observed behavior:

- Result-loop resolves actual values from match statistics.
- Win returns `odds - 1` units.
- Loss returns `-1` unit.
- Push returns `0` units.
- Summary ROI is based on total PnL units divided by staked units.

Must verify:

- Actual-value mapping is correct for every stat key, scope and period.
- Half-lines and whole-lines are handled correctly.
- Period-specific results are not silently mapped to full-match results.

### 3.7 CLV / closing-line data

Confirmed paths:

```text
app/api/result-loop/route.js
lib/clvTracking.js
```

Observed behavior:

- `closing-line-tracking` stores price history.
- `computeTrackedOddsWindow` filters observations before kickoff.
- First prematch observation is treated as saved/opening price.
- Latest prematch observation is treated as closing observation if more than one prematch observation exists.
- CLV is computed from saved odds vs latest prematch odds.

Must verify:

- There is an active process that refreshes price history before kickoff.
- `closingObservedAt` is actually close to kickoff.
- Observations after kickoff are never used as prematch close.
- The observed market signature matches the original candidate market.

## 4. Pre-implementation data audit

Create:

```text
scripts/roi_data_audit.js
```

Example commands:

```bash
node scripts/roi_data_audit.js --days 365 --json
node scripts/roi_data_audit.js --from 2025-01-01 --to 2026-06-20 --json
```

Read these collections:

```text
auto-analysis-runs
auto-analysis-bets
analysis-snapshots
result-loop-bets
closing-line-tracking
teamstats
teamprofiles
unibet-backtest
```

Minimum output:

```text
runs_total
runs_with_candidates
avg_candidates_per_run
avg_qualifying_candidates_per_run
avg_shortlist_per_run
candidates_total
candidates_with_match_id
candidates_with_created_at
candidates_created_after_start
candidates_with_valid_odds
candidates_with_both_market_sides
settled_candidates
win_loss_push_counts
candidates_with_clv
candidates_with_2plus_prematch_observations
median_minutes_saved_to_kickoff
median_minutes_closing_to_kickoff
closing_after_start_count
stat_breakdown
scope_breakdown
period_breakdown
league_breakdown
missing_result_reasons
missing_clv_reasons
missing_market_side_reasons
```

Hard fail suggestions:

```text
created_after_start_rate > 0.5%
settled_without_actual_value_rate > 2%
missing_match_start_rate > 5%
settled_without_odds_rate > 10%
closing_after_start_rate > 1%
both_market_sides_available_rate < 50%
```

The audit should write:

```text
data/roi_data_audit_latest.json
```

## 5. Training dataset builder

Create:

```text
scripts/build_roi_training_dataset.js
```

Output:

```text
data/roi_training_dataset.jsonl
```

One row per candidate, not one row per selected shortlist item.

Required fields:

```json
{
  "candidateId": "...",
  "runId": "...",
  "trackingKey": "...",
  "matchId": "...",
  "createdAt": "...",
  "matchStart": "...",
  "leagueName": "...",
  "homeTeamName": "...",
  "awayTeamName": "...",
  "statKey": "cornerKicks",
  "scope": "total",
  "period": "ALL",
  "direction": "over",
  "line": 9.5,
  "odds": 1.95,
  "oddsOver": 1.95,
  "oddsUnder": 1.85,
  "marketNoVigProb": 0.4868,
  "marketOverround": 1.053,
  "primaryEv": 6.2,
  "formulaBaseEv": 4.1,
  "formulaMultiplierEv": 6.2,
  "formulaMultifactorEv": 5.4,
  "formulaLeagueAvgEv": -1.1,
  "agreementPct": 75,
  "confidenceScore": 71,
  "sampleSize": 18,
  "strategyScore": 82.4,
  "result": "win",
  "actualValue": 11,
  "pnlUnits": 0.95,
  "roiUnits": 0.95,
  "savedOdds": 1.95,
  "closingOdds": 1.78,
  "clvPct": 9.6,
  "beatClosingLine": true,
  "leakageSafe": true
}
```

Labels:

```text
label_win
label_push
label_loss
label_roi_units
label_beat_close
label_clv_pct
```

Feature rule:

```text
closingOdds, clvPct, beatClosingLine, result, actualValue, pnlUnits and roiUnits are labels/evaluation fields only.
They must not be used as model input features.
```

## 6. Market baseline

Before ML, build a market-implied baseline.

For paired over/under markets:

```text
p_over_market = (1 / oddsOver) / ((1 / oddsOver) + (1 / oddsUnder))
p_under_market = 1 - p_over_market
```

Then for the selected direction:

```text
marketNoVigProb = p_over_market or p_under_market
marketBaselineEV = marketNoVigProb * odds - 1
```

This baseline is essential. The model must add value over market-implied probability, not just over internal formula EV.

## 7. Baseline evaluation scripts

Create:

```text
scripts/evaluate_roi_baselines.js
```

Compare:

```text
market baseline
current balanced strategy
current safe strategy
highest primaryEv per match
highest strategyScore per match
random positive-EV candidate baseline
```

Output:

```text
bets
settled_bets
win_rate
avg_odds
roi_pct
pnl_units
max_drawdown_units
beat_close_pct
avg_clv_pct
roi_by_statKey
roi_by_scope
roi_by_period
roi_by_league
roi_by_odds_bucket
```

## 8. Calibration model v1

Create:

```text
scripts/train_roi_calibration_model.js
scripts/evaluate_roi_walk_forward.js
```

Start with regularized logistic calibration, not a black-box model.

Conceptual model:

```text
logit(p_outcome) =
  logit(marketNoVigProb)
  + beta_1 * primaryEv
  + beta_2 * agreementPct
  + beta_3 * confidenceScore
  + beta_4 * sampleSize
  + stat/scope/period effects
```

The purpose is to test whether the app's current signals contain incremental information beyond the market.

## 9. ML model v1

Only build ML after calibration shows signal.

Recommended structure:

```text
Model A: outcome probability
- p_win
- p_push
- p_loss

Model B: CLV probability
- p_beat_close
- expected_clv_pct
```

Potential implementation:

```text
machinelearning/roi_model_v1.py
```

But keep dataset-building and walk-forward evaluation reproducible from repo scripts.

## 10. Walk-forward evaluation

Create:

```text
scripts/evaluate_roi_walk_forward.js
```

Default split:

```text
train_window_days = 180
test_window_days = 14
step_days = 14
min_train_candidates = 500
```

Metrics:

```text
bets
settled_bets
wins
losses
pushes
hit_rate
avg_odds
flat_stake_roi
pnl_units
max_drawdown_units
brier_score
log_loss
calibration_by_bucket
beat_close_pct
avg_clv_pct
breakdown_by_stat_scope_period_league
```

No threshold may be selected on the test window.

## 11. Required code/data changes

### 11.1 Store both sides of the market

Each candidate should store:

```text
oddsOver
oddsUnder
selectedOdds
selectedDirection
marketNoVigProb
marketOverround
```

### 11.2 Store odds observation timestamp

Add:

```text
oddsObservedAt
oddsSource
oddsEventId
oddsEventUrl
```

`createdAt` is not enough if odds fetching and persistence happen at different times.

### 11.3 Preserve full candidate snapshots

Either use `auto-analysis-bets` as the training source or create a full candidate snapshot collection.

Do not train on shortlist-only snapshots.

### 11.4 Make historical profile features leakage-safe

Options:

```text
rebuild profile features from pre-cutoff teamstats
snapshot teamprofiles per run going forward
create teamprofile-snapshots with validAt timestamps
```

### 11.5 Verify or build CLV refresh

If no active refresh process exists, create:

```text
scripts/update_closing_line_tracking.js
```

It should append prematch price observations to `closing-line-tracking.priceHistory` and never classify post-kickoff observations as prematch close.

## 12. Acceptance criteria

Do not trust model output until:

```text
roi_data_audit passes hard checks
training rows are timestamp-safe
market side availability is sufficient
result mapping is manually verified per stat type
walk-forward evaluation is positive in multiple windows
CLV is positive or at least not contradictory where available
calibration buckets are not obviously broken
performance is not concentrated in one tiny league/stat bucket
```

If ROI is positive but CLV is negative, assume noise or overfit until proven otherwise.

If CLV is positive but short-term ROI is negative, keep evaluating but do not overreact to a small sample.

## 13. Implementation order

1. `scripts/roi_data_audit.js`
2. Add full market-side storage to candidates if missing.
3. Add odds observation timestamps if missing.
4. Verify/build CLV refresh.
5. `scripts/build_roi_training_dataset.js`
6. `scripts/evaluate_roi_baselines.js`
7. `scripts/train_roi_calibration_model.js`
8. `scripts/evaluate_roi_walk_forward.js`
9. Optional ML model v1 only after calibrated baseline shows signal.

## 14. Definition of done

The repo should be able to run:

```bash
node scripts/roi_data_audit.js --days 365 --json
node scripts/build_roi_training_dataset.js --days 365
node scripts/evaluate_roi_baselines.js --dataset data/roi_training_dataset.jsonl
node scripts/train_roi_calibration_model.js --dataset data/roi_training_dataset.jsonl
node scripts/evaluate_roi_walk_forward.js --dataset data/roi_training_dataset.jsonl --model artifacts/roi_calibration_v1.json
```

And produce:

```text
data audit report
leakage checks
baseline comparison
walk-forward ROI
CLV metrics
calibration buckets
drawdown
stat/scope/period/league breakdown
```

Until this exists, historical ROI should be treated as research output, not proof.
