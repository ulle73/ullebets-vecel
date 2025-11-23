"""
Tier 2 Training: Meta-Learning / Stacking Model
Combines predictions from all existing formulas (including Tier 1) to make final prediction
"""

import json
import os
import sys
from pathlib import Path
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import numpy as np

sys.path.append(str(Path(__file__).parent.parent.parent))

DATASETS_DIR = Path(__file__).parent.parent.parent / 'data' / 'datasets'
TIER1_DIR = Path(__file__).parent.parent / 'trained' / 'tier1'
OUTPUT_DIR = Path(__file__).parent.parent / 'trained' / 'tier2'

def load_jsonl(filepath):
    """Load JSONL file"""
    samples = []
    with open(filepath, 'r') as f:
        for line in f:
            samples.append(json.loads(line))
    return samples

def load_tier1_model(stat_key, scope, period):
    """Load Tier 1 model if it exists"""
    model_path = TIER1_DIR / f"{stat_key}_{scope}_{period}_raw.json"
    if model_path.exists():
        model = xgb.XGBRegressor()
        model.load_model(str(model_path))
        return model
    return None

def build_tier2_features(sample, tier1_model=None):
    """Build Tier 2 feature vector from existing formula predictions"""
    features = []
    
    # 1. Raw features (keep them for context)
    features.extend(sample['raw_features'])
    
    # 2. All formula predictions from evDetails
    formula_preds = sample.get('formula_predictions', {})
    pred_values = list(formula_preds.values())
    
    if pred_values:
        features.extend(pred_values)
        
        # 3. Consensus features
        features.append(np.std(pred_values))  # Formula agreement
        features.append(np.max(pred_values) - np.min(pred_values))  # Range
        features.append(np.max(pred_values))  # Optimistic
        features.append(np.min(pred_values))  # Pessimistic
        features.append(np.median(pred_values))  # Median
    else:
        # No formula predictions, add zeros
        features.extend([0] * 5)
    
    # 4. Tier 1 prediction (if available)
    if tier1_model is not None:
        raw_feats = np.array(sample['raw_features']).reshape(1, -1)
        tier1_pred = tier1_model.predict(raw_feats)[0]
        features.append(tier1_pred)
    else:
        features.append(0)  # No Tier 1 model
    
    return features

def train_tier2_model(stat_key, scope, period):
    """Train Tier 2 meta-learner"""
    print(f"\n{'='*60}")
    print(f"Training Tier 2: {stat_key}_{scope}_{period}")
    print(f"{'='*60}")
    
    # Load data
    train_file = DATASETS_DIR / f"{stat_key}_{scope}_{period}_train.jsonl"
    val_file = DATASETS_DIR / f"{stat_key}_{scope}_{period}_val.jsonl"
    
    if not train_file.exists():
        print(f"⚠️  No training data, skipping")
        return None
    
    train_samples = load_jsonl(train_file)
    val_samples = load_jsonl(val_file) if val_file.exists() else []
    
    print(f"Train samples: {len(train_samples)}")
    print(f"Val samples: {len(val_samples)}")
    
    if len(train_samples) < 5:
        print(f"⚠️  Too few samples, skipping")
        return None
    
    # Check if we have formula predictions
    has_formulas = any('formula_predictions' in s and len(s.get('formula_predictions', {})) > 0 
                       for s in train_samples)
    
    if not has_formulas:
        print(f"⚠️  No formula predictions in data, cannot train Tier 2")
        return None
    
    # Load Tier 1 model if available
    tier1_model = load_tier1_model(stat_key, scope, period)
    if tier1_model:
        print(f"✅ Loaded Tier 1 model")
    else:
        print(f"⚠️  No Tier 1 model (will train without it)")
    
    # Build features
    print("Building Tier 2 features...")
    X_train = np.array([build_tier2_features(s, tier1_model) for s in train_samples])
    y_train = np.array([s['target'] for s in train_samples])
    
    if len(val_samples) > 0:
        X_val = np.array([build_tier2_features(s, tier1_model) for s in val_samples])
        y_val = np.array([s['target'] for s in val_samples])
    else:
        # Split train data
        split_idx = int(len(X_train) * 0.8)
        X_val = X_train[split_idx:]
        y_val = y_train[split_idx:]
        X_train = X_train[:split_idx]
        y_train = y_train[:split_idx]
    
    print(f"Tier 2 feature dimension: {X_train.shape[1]}")
    print(f"Target range: [{y_train.min():.1f}, {y_train.max():.1f}]")
    
    # Train Tier 2 (shallower trees since we're combining pre-engineered features)
    print("\nTraining Tier 2 meta-learner...")
    
    model = xgb.XGBRegressor(
        objective='reg:squarederror',
        n_estimators=50,   # Fewer trees (formulas already did feature engineering)
        max_depth=3,       # Very shallow (just learn combinations)
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        verbosity=0
    )
    
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        verbose=False
    )
    
    # Evaluate
    train_pred = model.predict(X_train)
    val_pred = model.predict(X_val)
    
    train_mae = mean_absolute_error(y_train, train_pred)
    val_mae = mean_absolute_error(y_val, val_pred)
    train_rmse = np.sqrt(mean_squared_error(y_train, train_pred))
    val_rmse = np.sqrt(mean_squared_error(y_val, val_pred))
    val_r2 = r2_score(y_val, val_pred)
    
    print(f"\n📊 Tier 2 Results:")
    print(f"  Train MAE: {train_mae:.2f}")
    print(f"  Val MAE:   {val_mae:.2f}")
    print(f"  Val RMSE:  {val_rmse:.2f}")
    print(f"  Val R²:    {val_r2:.3f}")
    
    # Feature importance
    importance = model.feature_importances_
    top_idx = np.argsort(importance)[-5:][::-1]
    
    print(f"\n🔍 Top 5 Features:")
    for idx in top_idx:
        if importance[idx] > 0:
            print(f"  Feature {idx}: {importance[idx]:.3f}")
    
    # Save model
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    model_path = OUTPUT_DIR / f"{stat_key}_{scope}_{period}_stacked.json"
    model.save_model(str(model_path))
    print(f"\n✅ Saved Tier 2 model to {model_path}")
    
    # Save metadata
    metadata = {
        'stat_key': stat_key,
        'scope': scope,
        'period': period,
        'model_type': 'xgboost_tier2_stacking',
        'has_tier1': tier1_model is not None,
        'n_train_samples': len(train_samples),
        'n_val_samples': len(val_samples),
        'feature_dim': X_train.shape[1],
        'metrics': {
            'train_mae': float(train_mae),
            'val_mae': float(val_mae),
            'val_rmse': float(val_rmse),
            'val_r2': float(val_r2)
        }
    }
    
    metadata_path = OUTPUT_DIR / f"{stat_key}_{scope}_{period}_stacked_metadata.json"
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    return metadata

def main():
    """Train all Tier 2 models"""
    print("🚀 Starting Tier 2 Meta-Learning Training")
    print("=" * 60)
    
    # Find all datasets
    train_files = list(DATASETS_DIR.glob("*_train.jsonl"))
    
    print(f"\nFound {len(train_files)} datasets\n")
    
    results = []
    
    for train_file in train_files:
        # Parse filename
        parts = train_file.stem.split('_')
        period = parts[-2]
        scope = parts[-3]
        stat_key = '_'.join(parts[:-3])
        
        try:
            metadata = train_tier2_model(stat_key, scope, period)
            if metadata:
                results.append(metadata)
        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
            continue
    
    # Summary
    print("\n" + "="*60)
    print("📊 TIER 2 TRAINING SUMMARY")
    print("="*60)
    print(f"\nTotal Tier 2 models trained: {len(results)}")
    
    if results:
        avg_val_mae = np.mean([r['metrics']['val_mae'] for r in results])
        avg_val_r2 = np.mean([r['metrics']['val_r2'] for r in results])
        
        print(f"Average Val MAE: {avg_val_mae:.2f}")
        print(f"Average Val R²:  {avg_val_r2:.3f}")
        
        print(f"\n🏆 Best Tier 2 Models (by Val MAE):")
        sorted_results = sorted(results, key=lambda x: x['metrics']['val_mae'])
        for i, r in enumerate(sorted_results[:5], 1):
            tier1_mark = "✅" if r['has_tier1'] else "⚠️"
            print(f"{i}. {r['stat_key']}_{r['scope']}_{r['period']} {tier1_mark}: "
                  f"MAE={r['metrics']['val_mae']:.2f}, R²={r['metrics']['val_r2']:.3f}")
    
    print("\n✅ Tier 2 training complete!")
    print("\n💡 Next: Tier 2 models are ready to use in production!")
    print("   When you have more data, retrain Tier 1 and Tier 2 will improve automatically.")

if __name__ == '__main__':
    main()
