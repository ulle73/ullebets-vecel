"""
Tier 1 Training: Raw Features Model
Train XGBoost models directly from raw features (Opta, WMA, ranks, etc.)
"""

import json
import os
import sys
from pathlib import Path
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import numpy as np

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent.parent))

DATASETS_DIR = Path(__file__).parent.parent.parent / 'data' / 'datasets'
OUTPUT_DIR = Path(__file__).parent.parent / 'trained' / 'tier1'

def load_jsonl(filepath):
    """Load JSONL file"""
    samples = []
    with open(filepath, 'r') as f:
        for line in f:
            samples.append(json.loads(line))
    return samples

def train_model(stat_key, scope, period):
    """Train a single Tier 1 model"""
    print(f"\n{'='*60}")
    print(f"Training: {stat_key}_{scope}_{period}")
    print(f"{'='*60}")
    
    # Load data
    train_file = DATASETS_DIR / f"{stat_key}_{scope}_{period}_train.jsonl"
    val_file = DATASETS_DIR / f"{stat_key}_{scope}_{period}_val.jsonl"
    
    if not train_file.exists():
        print(f"⚠️  No training data found, skipping")
        return None
    
    train_samples = load_jsonl(train_file)
    val_samples = load_jsonl(val_file) if val_file.exists() else []
    
    print(f"Train samples: {len(train_samples)}")
    print(f"Val samples: {len(val_samples)}")
    
    if len(train_samples) < 5:
        print(f"⚠️  Too few training samples, skipping")
        return None
    
    # Extract features and targets
    X_train = np.array([s['raw_features'] for s in train_samples])
    y_train = np.array([s['target'] for s in train_samples])
    
    if len(val_samples) > 0:
        X_val = np.array([s['raw_features'] for s in val_samples])
        y_val = np.array([s['target'] for s in val_samples])
    else:
        # Use 20% of training as validation
        split_idx = int(len(X_train) * 0.8)
        X_val = X_train[split_idx:]
        y_val = y_train[split_idx:]
        X_train = X_train[:split_idx]
        y_train = y_train[:split_idx]
    
    print(f"Feature dimension: {X_train.shape[1]}")
    print(f"Target range: [{y_train.min():.1f}, {y_train.max():.1f}]")
    
    # Train XGBoost
    print("\nTraining XGBoost model...")
    
    model = xgb.XGBRegressor(
        objective='reg:squarederror',
        n_estimators=100,  # Lower for small datasets
        max_depth=4,       # Shallower to avoid overfitting
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
    
    print(f"\n📊 Results:")
    print(f"  Train MAE: {train_mae:.2f}")
    print(f"  Val MAE:   {val_mae:.2f}")
    print(f"  Val RMSE:  {val_rmse:.2f}")
    print(f"  Val R²:    {val_r2:.3f}")
    
    # Feature importance
    importance = model.feature_importances_
    top_features = np.argsort(importance)[-5:][::-1]
    print(f"\n🔍 Top 5 Features:")
    for idx in top_features:
        print(f"  Feature {idx}: {importance[idx]:.3f}")
    
    # Save model
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    model_path = OUTPUT_DIR / f"{stat_key}_{scope}_{period}_raw.json"
    model.save_model(str(model_path))
    print(f"\n✅ Saved model to {model_path}")
    
    # Save metadata
    metadata = {
        'stat_key': stat_key,
        'scope': scope,
        'period': period,
        'model_type': 'xgboost_tier1',
        'n_train_samples': len(train_samples),
        'n_val_samples': len(val_samples),
        'feature_dim': X_train.shape[1],
        'metrics': {
            'train_mae': float(train_mae),
            'val_mae': float(val_mae),
            'val_rmse': float(val_rmse),
            'val_r2': float(val_r2)
        },
        'feature_importance': {
            f'feature_{i}': float(importance[i])
            for i in top_features
        }
    }
    
    metadata_path = OUTPUT_DIR / f"{stat_key}_{scope}_{period}_raw_metadata.json"
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    return metadata

def main():
    """Train all Tier 1 models"""
    print("🚀 Starting Tier 1 Model Training")
    print("=" * 60)
    
    # Find all available datasets
    train_files = list(DATASETS_DIR.glob("*_train.jsonl"))
    
    print(f"\nFound {len(train_files)} datasets to train\n")
    
    results = []
    
    for train_file in train_files:
        # Parse filename: statKey_scope_period_train.jsonl
        parts = train_file.stem.split('_')
        period = parts[-2]
        scope = parts[-3]
        stat_key = '_'.join(parts[:-3])
        
        try:
            metadata = train_model(stat_key, scope, period)
            if metadata:
                results.append(metadata)
        except Exception as e:
            print(f"❌ Error training {stat_key}_{scope}_{period}: {e}")
            continue
    
    # Summary
    print("\n" + "="*60)
    print("📊 TRAINING SUMMARY")
    print("="*60)
    print(f"\nTotal models trained: {len(results)}")
    
    if results:
        avg_val_mae = np.mean([r['metrics']['val_mae'] for r in results])
        avg_val_r2 = np.mean([r['metrics']['val_r2'] for r in results])
        
        print(f"Average Val MAE: {avg_val_mae:.2f}")
        print(f"Average Val R²:  {avg_val_r2:.3f}")
        
        print(f"\n🏆 Best Models (by Val MAE):")
        sorted_results = sorted(results, key=lambda x: x['metrics']['val_mae'])
        for i, r in enumerate(sorted_results[:5], 1):
            print(f"{i}. {r['stat_key']}_{r['scope']}_{r['period']}: "
                  f"MAE={r['metrics']['val_mae']:.2f}, R²={r['metrics']['val_r2']:.3f}")
    
    print("\n✅ Tier 1 training complete!")

if __name__ == '__main__':
    main()
