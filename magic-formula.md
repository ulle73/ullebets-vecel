# Magic Formula: ML-Based Betting Optimization System

## 🎯 Objective
Build a machine learning system that learns the **optimal formula** for predicting football statistics (shots, corners, fouls, cards) by analyzing historical data, team profiles, Opta rankings, and actual betting outcomes.

## 📊 Problem Statement
Current formulas are hand-crafted with arbitrary weights. We want ML to find the optimal weights/coefficients for each:
- **StatKey**: `totalShotsOnGoal`, `shotsOnGoal`, `cornerKicks`, `fouls`, `yellowCards`, `offsides`, `goalKicks`, `throwIns`
- **Scope**: `home`, `away`, `total`
- **Period**: `ALL`, `1ST`, `2ND`

This creates **8 statKeys × 3 scopes × 3 periods = 72 separate models** (though some combinations may not exist in data).

---

## 🗃️ Data Sources (MongoDB Collections)

### 1. `leagues-and-teams`
```json
{
  "Premier League": {
    "teams": [{
      "name": "Arsenal",
      "optaRank": 1,
      "optaRating": 100,
      "id": 42
    }]
  }
}
```
**Provides**: Team quality indicators (Opta rank/rating)

### 2. `teamprofiles`
Stored as: `{league}/{teamname}_{matchType}.json`
```json
{
  "meta": { "lagnamn": "Arsenal", "matchType": "home" },
  "statistics": {
    "totalShotsOnGoal": { "ALL": { "value": 15.9, "rank": 6 } },
    "shotsOnGoal": { "ALL": { "value": 5.25, "rank": 8 } },
    "cornerKicks": { "ALL": { "value": 7.25, "rank": 3 } }
  },
  "games": { "ALL": 24, "1ST": 24, "2ND": 24 },
  "rankFor": 3,
  "rankAgainst": 12
}
```
**Provides**: Team averages, ranks, form metrics

### 3. `teamstats`
Stored as: `{teamname}_{matchType}_match_stats.json`
```json
{
  "_importMeta": { "teamName": "Arsenal", "teamRole": "home" },
  "full": [{
    "date": "2024-11-10",
    "homeTeamName": "Arsenal",
    "awayTeamName": "Liverpool",
    "matchDetails": {
      "statistics": [{
        "groups": [{
          "groupName": "Match overview",
          "statisticsItems": [{
            "key": "totalShotsOnGoal",
            "homeValue": "16",
            "awayValue": "12"
          }]
        }]
      }]
    }
  }]
}
```
**Provides**: Historical match data (last 30-40 games)

### 4. `unibet-backtest`
```json
{
  "_id": "arsenal-liverpool-2024-11-10",
  "homeTeam": "Arsenal",
  "awayTeam": "Liverpool",
  "matchDate": "2024-11-10",
  "lines": [{
    "statKey": "totalShotsOnGoal",
    "scope": "home",
    "period": "ALL",
    "line": 15.5,
    "condition": "över",
    "odds": 1.85,
    "actual": 16,
    "win": true,
    "evDetails": {
      "evPct": 3.81,
      "evPctWithMultiplier": 4.95,
      "evPctOptaCombined": 5.2
    }
  }]
}
```
**Provides**: 
- Historical predictions from all formulas (evPct, evPctOptaCombined, etc.)
- Actual results
- Odds offered
- **Win/loss outcomes** (after match is rättat)

> **🎯 KEY INSIGHT**: This is GOLD for ML! We can use a **meta-learning (stacking)** approach where the ML model learns WHEN each existing formula performs well/poorly. The model combines predictions from all formulas intelligently rather than starting from scratch.

---

## 🎭 ML Approach: Two-Tier System

We'll build **TWO types of models** that work together:

---

### **Tier 1: Raw Feature Models (evPctMLRaw)**

**Goal**: Learn optimal formulas directly from raw features (replace hand-crafted formulas)

**Input Features**:
- Team Quality (Opta rank/rating)
- Team Profile stats (averages, ranks)
- Historical WMA
- Matchup scores
- Period-specific features
- Cross-stat correlations

**Output**: Predicted statistic value (e.g., predicted shots)

**Model**: XGBoost Regressor

**Purpose**: 
- Find optimal weights for raw features automatically
- Discover non-linear relationships hand-crafted formulas miss
- Generate a NEW formula that can stand alongside existing ones

---

### **Tier 2: Meta-Learning Model (evPctMLStacked)**

**Goal**: Learn when to trust each formula (including Tier 1!)

**Input Features**:
- All raw features (from Tier 1)
- **Predictions from ALL formulas**:
  - evPct (base)
  - evPctOptaCombined
  - evPctMultifactor
  - evPctShotsAdvanced (stat-specific)
  - **evPctMLRaw** (from Tier 1!)
- Formula consensus metrics (std dev, range)
- Historical win rates per formula
- Calibration features

**Output**: Final predicted statistic value

**Model**: XGBoost Regressor (ensemble)

**Purpose**:
- Combine wisdom of all formulas
- Learn context-dependent weights
- Achieve highest accuracy

---

### Why Two Tiers?

**Tier 1 (Raw Features)**:
- ✅ Can replace weak hand-crafted formulas
- ✅ Discovers optimal feature combinations
- ✅ Serves as a strong baseline
- ✅ Becomes another "expert" for Tier 2

**Tier 2 (Meta-Learning)**:
- ✅ Leverages domain knowledge in existing formulas
- ✅ Ensemble effect (better than any single model)
- ✅ Learns when each formula (including Tier 1) works best
- ✅ Most accurate overall

**Together**: Best of both worlds!

---

### **Training Strategy**

1. **Train Tier 1 first** → Get evPctMLRaw predictions
2. **Add evPctMLRaw to unibet-backtest** (backfill historical predictions)
3. **Train Tier 2** using ALL formulas including Tier 1
4. **Deploy both** in production:
   - Tier 1 as standalone formula option
   - Tier 2 as the "ultimate" formula

---

### Model Type: **Gradient Boosted Trees (XGBoost/LightGBM)**
**Why?**
- Excellent for tabular data with mixed feature types
- Handles non-linear relationships
- Built-in feature importance
- Fast training and prediction
- Works well with 100s-1000s of samples

**Alternative**: Linear Regression with regularization (simpler, more interpretable)

### Target Variable
**Predict**: The actual statistic value (e.g., actual number of shots)
**Loss**: Mean Absolute Error (MAE) or RMSE

### Features (Drivers)

#### Team Quality Features (from leagues-and-teams)
1. `home_team_opta_rank` - Home team's Opta ranking (1 = best)
2. `home_team_opta_rating` - Home team's Opta rating (0-100)
3. `away_team_opta_rank` - Away team's Opta ranking
4. `away_team_opta_rating` - Away team's Opta rating
5. `opta_rank_diff` = home_rank - away_rank (negative = stronger away team)
6. `opta_rating_diff` = home_rating - away_rating

#### Team Profile Features (for target statKey)
7. `home_{statKey}_avg_ALL` - Average from teamprofile (home matches)
8. `home_{statKey}_rank_ALL` - Rank from teamprofile (home matches)
9. `away_{statKey}_avg_ALL` - Average from teamprofile (away matches)
10. `away_{statKey}_rank_ALL` - Rank from teamprofile (away matches)
11. `home_rank_for` - Offensive strength
12. `home_rank_against` - Defensive strength
13. `away_rank_for`
14. `away_rank_against`
15. `matchup_score` = home_rank_for / away_rank_against

#### Historical WMA Features (from last 5-30 games)
16. `home_wma_{statKey}_recent` - WMA weights [3,2,1] last 5 games
17. `home_wma_{statKey}_medium` - WMA last 15 games
18. `home_wma_{statKey}_long` - WMA last 30 games
19. `away_wma_{statKey}_recent`
20. `away_wma_{statKey}_medium`
21. `away_wma_{statKey}_long`

#### Cross-Stat Features (correlations)
22. `home_shots_to_sot_ratio` - Shot accuracy
23. `home_corners_per_shot` - Attack patterns
24. `home_fouls_per_tackle` - Aggression
25. Similar for away team

#### Period-Specific Features (if period != 'ALL')
26. `home_{statKey}_avg_1ST`
27. `home_{statKey}_avg_2ND`
28. `away_{statKey}_avg_1ST`
29. `away_{statKey}_avg_2ND`

#### Context Features
30. `home_advantage` = 1 (binary indicator)
31. `league_id` - Different leagues have different playing styles
32. `days_since_last_match` - Fatigue factor (if available)

---

### **🌟 Meta-Learning Features (The Secret Sauce!)**

These features use the **existing formula predictions** from `unibet-backtest`:

#### Existing Formula Predictions (from evDetails)
33. `pred_evPct` - Base formula prediction
34. `pred_evPctWithMultiplier`
35. `pred_evPctOptaCombined`
36. `pred_evPctOptaPlusBase`
37. `pred_evPctMultifactor`
38. `pred_evPctShotsAdvanced` (for shots)
39. `pred_evPctSoTAdvanced` (for SoT)
40. `pred_evPctFoulsAdvanced` (for fouls)
41. etc. for all relevant formulas

#### Formula Agreement Features
42. `formula_consensus` = std deviation of all predictions (low = formulas agree)
43. `formula_range` = max - min of predictions
44. `optimistic_formula` = max prediction
45. `pessimistic_formula` = min prediction
46. `median_formula_pred` = median of all predictions

#### Historical Performance Features (NEW!)
From analyzing past `unibet-backtest` documents with same statKey/scope/period:

47. `evPct_win_rate_last_50` - Win rate of base formula on similar bets
48. `optaCombined_win_rate_last_50` - Win rate of Opta formula
49. `multifactor_win_rate_last_50` - Win rate of multifactor
50. `best_performer_last_50` - Which formula won most recently?

#### Calibration Features
51. `avg_actual_vs_pred_diff` - Historical bias (does formula over/under-predict?)
52. `formula_confidence_score` - How confident is the consensus?

**Total**: ~50-65 features per model (35 raw + 15-30 meta)

---

### Why Meta-Learning is Superior

**Traditional ML**: 
```
Raw Features → ML Model → Prediction
(Learns everything from scratch)
```

**Meta-Learning (Stacking)**:
```
Raw Features → Existing Formulas → Predictions
                                        ↓
Raw Features + Formula Predictions → ML Model → Better Prediction
(Leverages domain knowledge + learns when to trust what)
```

**Benefits**:
1. **Faster convergence**: Start from good baselines
2. **Better performance**: Ensemble effect
3. **Interpretable**: Can see which formulas ML trusts
4. **Robust**: Even if ML fails, formulas provide fallback
5. **Data efficient**: Need fewer samples to learn

**Example**:
- If `evPctOptaCombined` has 70% win rate for "home corners in Premier League"
- And all formulas agree (low std dev)
- → ML learns to trust this consensus
- But if formulas disagree AND Opta diff is extreme
- → ML learns one formula is likely wrong, weights others higher



---

##  📁 Project Structure

```
machinelearning/
├── README.md
├── package.json                    # Node.js dependencies
├── requirements.txt                # Python dependencies (optional)
│
├── data/
│   ├── extract/                    # Scripts to pull from MongoDB
│   │   ├── extractTrainingData.js  # Main extraction script
│   │   ├── buildFeatures.js        # Feature engineering
│   │   ├── calculateWinRates.js    # Historical formula performance
│   │   └── utils.js
│   │
│   └── datasets/                   # Generated training data (gitignored)
│       ├── shots_home_ALL.jsonl    # Format: {features, formulas, target, metadata}
│       ├── shots_away_ALL.jsonl
│       ├── corners_total_ALL.jsonl
│       └── ...
│
├── models/
│   ├── train/                      # Training scripts
│   │   ├── tier1_trainRawFeatures.js/.py   # Train from raw features
│   │   ├── tier2_trainMetaLearner.js/.py   # Train ensemble/stacking
│   │   └── hyperparameter_search.py
│   │
│   ├── evaluate/
│   │   ├── evaluate.js            # Validation & testing
│   │   ├── compare_tiers.py       # Compare Tier 1 vs Tier 2 vs existing
│   │   └── visualize.py           # Charts & insights
│   │
│   └── trained/                    # Saved models (gitignored, but backed up)
│       ├── tier1/
│       │   ├── shots_home_ALL_raw.json    # Tier 1: Raw features model
│       │   ├── shots_home_ALL_raw.onnx
│       │   └── ...
│       └── tier2/
│           ├── shots_home_ALL_stacked.json  # Tier 2: Meta-learner
│           ├── shots_home_ALL_stacked.onnx
│           └── ...
│
├── inference/
│   ├── loadModel.js               # Load trained models in Node.js
│   ├── predict.js                 # Make predictions
│   └── formulas/
│       ├── evPctMLRaw.js          # Tier 1 formula
│       └── evPctMLStacked.js      # Tier 2 formula (final/best)
│
├── scripts/
│   ├── runPipeline.js             # Orchestrates full pipeline
│   └── update Models.js            # Weekly update script (for GitHub Actions)
│
└── .github/
    └── workflows/
        └── train-models.yml        # Weekly automated retraining
```

---

## 🔄 Workflow

### Phase 1: Data Extraction
1. **Connect to MongoDB** collections: `teamprofiles`, `teamstats`, `unibet-backtest`, `leagues-and-teams`
2. **For each completed match** in `unibet-backtest` (where `actual` !== null):
   - Extract home/away team names, date
   - Lookup Opta data from `leagues-and-teams`
   - Lookup teamprofiles for both teams
   - Calculate WMA from teamstats historical matches
   - **Extract all formula predictions** from `evDetails`
   - **Calculate historical win rates** for each formula (last 50 similar bets)
   - Build complete feature vector
3. **For each line** (statKey/scope/period combination):
   - Extract actual result
   - Extract all formula predictions
   - Calculate formula consensus metrics
   - Save as training sample: `{ features: [...], target: actualValue, formulas: {...} }`
4. **Split data**: 
   - Train: Matches before 2024-10-01 (80%)
   - Validation: 2024-10-01 to 2024-11-01 (10%)
   - Test: After 2024-11-01 (10%)
   - **Time-based split** prevents data leakage!

### Phase 2: Model Training

We train models in TWO phases:

#### Phase 2a: Train Tier 1 (Raw Features)

**Python (XGBoost) - RECOMMENDED**:
```python
import xgboost as xgb
import json

# Load data (only raw features, no formula predictions)
data = [json.loads(line) for line in open('data/datasets/shots_home_ALL.jsonl')]
X = [d['raw_features'] for d in data]  # Just Opta, WMA, ranks, etc.
y = [d['target'] for d in data]

# Train Tier 1
model_tier1 = xgb.XGBRegressor(
    objective='reg:squarederror',
    n_estimators=200,
    max_depth=6,
    learning_rate=0.05
)
model_tier1.fit(X_train, y_train)

# Evaluate
tier1_mae = mean_absolute_error(y_test, model_tier1.predict(X_test))
print(f"Tier 1 MAE: {tier1_mae}")

# Save
model_tier1.save_model('models/trained/tier1/shots_home_ALL_raw.json')

# Generate predictions for training set (for Tier 2)
tier1_train_preds = model_tier1.predict(X_train)
tier1_val_preds = model_tier1.predict(X_val)
```

#### Phase 2b: Train Tier 2 (Meta-Learning)

**Add Tier 1 predictions to features**:
```python
# Load same data, but now include formula predictions
data = [json.loads(line) for line in open('data/datasets/shots_home_ALL.jsonl')]

# Build Tier 2 features: raw features + all formula predictions + Tier 1
X_tier2 = []
for i, d in enumerate(data):
    features = d['raw_features']  # Same raw features
    features.extend(d['formula_predictions'].values())  # All existing formulas
    features.append(tier1_train_preds[i])  # Add Tier 1 prediction!
    features.extend(d['consensus_features'])  # std dev, range, etc.
    features.extend(d['historical_win_rates'])  # Formula performance
    X_tier2.append(features)

y = [d['target'] for d in data]

# Train Tier 2 (ensemble/stacking)
model_tier2 = xgb.XGBRegressor(
    objective='reg:squarederror',
    n_estimators=300,  # More trees for complex ensemble
    max_depth=4,       # Shallower (formulas already did feature engineering)
    learning_rate=0.03
)
model_tier2.fit(X_tier2_train, y_train)

# Evaluate
tier2_mae = mean_absolute_error(y_test, model_tier2.predict(X_tier2_test))
print(f"Tier 2 MAE: {tier2_mae} (vs Tier 1: {tier1_mae})")

# Feature importance - see which formulas Tier 2 trusts!
feature_importance = model_tier2.feature_importances_
print("Most important features:")
for idx in feature_importance.argsort()[-10:][::-1]:
    print(f"  {feature_names[idx]}: {feature_importance[idx]:.3f}")

# Save
model_tier2.save_model('models/trained/tier2/shots_home_ALL_stacked.json')
```

#### Phase 2c: Export to ONNX (for JavaScript inference)
```python
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

# Export Tier 1
initial_type = [('input', FloatTensorType([None, len(raw_features)]))]
onnx_tier1 = convert_sklearn(model_tier1, initial_types=initial_type)
with open('models/trained/tier1/shots_home_ALL_raw.onnx', 'wb') as f:
    f.write(onnx_tier1.SerializeToString())

# Export Tier 2
initial_type = [('input', FloatTensorType([None, len(tier2_features)]))]
onnx_tier2 = convert_sklearn(model_tier2, initial_types=initial_type)
with open('models/trained/tier2/shots_home_ALL_stacked.onnx', 'wb') as f:
    f.write(onnx_tier2.SerializeToString())
```

### Phase 3: Inference in Formulas

```javascript
// lib/backtest/formulas/evPctMLOptimized.js
import onnx from 'onnxjs';
import { buildFeatures } from '../../../machinelearning/inference/buildFeatures.js';

const models = {}; // Cache loaded models

async function loadModel(statKey, scope, period) {
  const key = `${statKey}_${scope}_${period}`;
  if (!models[key]) {
    const session = new onnx.InferenceSession();
    await session.loadModel(`machinelearning/models/trained/${key}.onnx`);
    models[key] = session;
  }
  return models[key];
}

export async function evPctMLOptimized(context) {
  const { homeTeam, awayTeam, statKey, scope, period, oddsValue } = context;
  
  // Build feature vector
  const features = await buildFeatures(context);
  
  // Load and run model
  const model = await loadModel(statKey, scope, period);
  const inputTensor = new onnx.Tensor(new Float32Array(features), 'float32', [1, features.length]);
  const outputMap = await model.run([inputTensor]);
  const predictedValue = outputMap.values().next().value.data[0];
  
  // Use predicted value as lambda for Poisson
  const modelProb = poissonCDF(predictedValue, line);
  const evPct = (modelProb * oddsValue * 100) - 100;
  
  return { evPct, predictedValue, confidence: 0.95 };
}
```

### Phase 4: Validation & Iteration
1. **Backtest** on held-out test set
2. **Compare** ML formula vs hand-crafted formulas
3. **Analyze** feature importance
4. **Iterate** on feature engineering
5. **Retrain** weekly with new data

---

## 🤖 GitHub Actions - Automated Retraining

`.github/workflows/train-models.yml`:
```yaml
name: Train ML Models

on:
  schedule:
    - cron: '0 2 * * 0'  # Every Sunday at 2 AM
  workflow_dispatch:      # Manual trigger

jobs:
  train:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'
      
      - name: Install dependencies
        run: |
          pip install -r machinelearning/requirements.txt
      
      - name: Extract training data
        env:
          MONGODB_URI: ${{ secrets.MONGODB_URI }}
        run: node machinelearning/data/extract/extractTrainingData.js
      
      - name: Train models
        run: python machinelearning/models/train/trainModel.py
      
      - name: Evaluate models
        run: python machinelearning/models/evaluate/evaluate.py
      
      - name: Commit trained models
        run: |
          git config user.name github-actions
          git config user.email github-actions@github.com
          git add machinelearning/models/trained/*.json
          git add machinelearning/models/trained/*.onnx
          git commit -m "chore: retrain ML models [automated]" || echo "No changes"
          git push
```

---

## 📊 Expected Performance

### Baseline (Current Best Hand-Crafted Formula)
- MAE: ~2-3 shots/corners
- Win rate on high-EV bets (>5%): ~55-60%
- Calibration: Fair (some systematic biases)

### Tier 1: ML from Raw Features (evPctMLRaw)
- MAE: ~1.6-2.2 shots/corners (**30-35% improvement**)
- Win rate: ~62-67%
- Learns optimal feature weights automatically
- Discovers non-linear patterns
- **Can replace weaker hand-crafted formulas**

### Tier 2: Meta-Learning Ensemble (evPctMLStacked)
- MAE: ~1.2-1.8 shots/corners (**40-50% improvement!**)
- Win rate: ~68-75%
- Combines ALL formulas intelligently
- Context-aware formula selection
- **Best overall performance**

### Performance Comparison Table

| Metric | Baseline | Tier 1 (Raw) | Tier 2 (Stacked) |
|--------|----------|--------------|------------------|
| MAE (shots) | 2.5 | 1.9 | 1.5 |
| MAE (corners) | 2.2 | 1.7 | 1.3 |
| Win rate (>5% EV) | 57% | 64% | 71% |
| ROI on high-EV bets | +3% | +8% | +14% |

### Why This Tiered Approach Works

**Tier 1 Benefits**:
- Standalone formula that beats hand-crafted
- Interpretable (can examine feature importance)
- Fast inference
- Good fallback if Tier 2 fails

**Tier 2 Benefits** (builds on Tier 1):
- Leverages domain knowledge in all formulas
- Adaptive to context (league, matchup type)
- Learns formula failure modes
- Ensemble robustness

**Real-world analogy**: 
- **Tier 1** = Hire one super-smart analyst who learns from data
- **Tier 2** = Have a committee of experts (including Tier 1) and learn which expert to trust for each case

---

## 🚀 Implementation Steps

### Week 1: Data Pipeline
- [ ] Create `machinelearning/` folder structure ✅
- [ ] Write `extractTrainingData.js` (raw features)
- [ ] Write `calculateWinRates.js` (formula performance history)
- [ ] Write `buildFeatures.js` (consensus, calibration)
- [ ] Generate datasets for all statKey/scope/period combinations
- [ ] Verify data quality (no NaNs, correct distributions)

### Week 2: Tier 1 Development
- [ ] Train Tier 1 models (raw features → predictions)
- [ ] Hyperparameter tuning
- [ ] Cross-validation
- [ ] Save models (JSON + ONNX)
- [ ] Create `evPctMLRaw.js` formula
- [ ] Backfill Tier 1 predictions for historical data

### Week 3: Tier 2 Development  
- [ ] Extract Tier 1 predictions for all training data
- [ ] Build Tier 2 feature vectors (raw + all formulas)
- [ ] Train Tier 2 meta-learner models
- [ ] Analyze feature importance (which formulas does it trust?)
- [ ] Create `evPctMLStacked.js` formula

### Week 4: Integration & Automation
- [ ] Register both formulas in formula index
- [ ] Test on recent matches
- [ ] Compare: Baseline vs Tier 1 vs Tier 2
- [ ] Set up GitHub Actions for weekly retraining
- [ ] Add model performance tracking dashboard

---

## 💡 Key Insights & Tips

### Feature Engineering is Key
- Don't just use raw averages, create **derived features**:
  - Ratios (shots/corners, fouls/tackles)
  - Trends (form over last 5 vs last 30 games)
  - Matchup-specific (home offense vs away defense)

### Start Simple, Then Iterate
1. **Baseline**: Linear regression with top 10 features
2. **Iteration 1**: Add non-linear model (XGBoost)
3. **Iteration 2**: Add period-specific features
4. **Iteration 3**: Add cross-stat features

### Model Interpretability
- Use SHAP values to understand predictions
- Compare learned weights vs hand-crafted formulas
- Sanity check: Does model favor similar features?

### Data Hygiene
- Remove matches with missing/corrupt data
- Handle outliers (e.g., red cards, extreme weather)
- Consider team changes (new managers, transfers)

### Retraining Frequency
- **Weekly**: Capture recent form shifts
- **After major events**: International breaks, transfer windows
- **Version control**: Keep history of model performance

---

## 📝 Config Format

`machinelearning/models/trained/shots_home_ALL.json`:
```json
{
  "modelType": "xgboost",
  "version": "1.2.0",
  "trainedAt": "2024-11-23T22:00:00Z",
  "metrics": {
    "mae": 1.87,
    "rmse": 2.34,
    "r2": 0.72
  },
  "features": [
    "home_team_opta_rating",
    "away_team_opta_rating",
    "opta_rating_diff",
    "home_totalShotsOnGoal_avg_ALL",
    "home_wma_recent",
    "matchup_score"
  ],
  "coefficients": {
    "home_team_opta_rating": 0.042,
    "away_team_opta_rating": -0.031,
    "opta_rating_diff": 0.015
  },
  "onnxPath": "./shots_home_ALL.onnx"
}
```

---

## 🎯 Success Criteria

1. **Accuracy**: MAE < 2.0 for shots, < 1.5 for corners
2. **Profitability**: Positive ROI on bets with ML-predicted EV > 5%
3. **Stability**: Models retrain without errors weekly
4. **Adoption**: ML formulas outperform hand-crafted on test set

---

## 🔮 Future Enhancements

1. **Ensemble methods**: Combine multiple models
2. **Time-series features**: Momentum, streaks
3. **Player-level data**: Key player injuries/absences
4. **Weather & context**: Stadium, referee, time of day
5. **Multi-output models**: Predict multiple stats simultaneously
6. **Uncertainty quantification**: Confidence intervals, not just point estimates
7. **Online learning**: Update models incrementally after each match

---

**Status**: Planning complete ✅  
**Next**: Begin Week 1 implementation
