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
import shap

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
    
    print(f"Feature dimension: {X_train.shape[1]} (expected ~197)")
    print(f"Target range: [{y_train.min():.1f}, {y_train.max():.1f}]")
    
    # Train XGBoost (small param sweep to avoid overfitting on små dataset)
    print("\nTraining XGBoost model (small param search)...")

    param_grid = [
        {"n_estimators": 50, "max_depth": 3, "learning_rate": 0.1, "reg_lambda": 0.5},
        {"n_estimators": 80, "max_depth": 3, "learning_rate": 0.08, "reg_lambda": 1.0},
        {"n_estimators": 100, "max_depth": 3, "learning_rate": 0.1, "reg_lambda": 1.0},
        {"n_estimators": 120, "max_depth": 4, "learning_rate": 0.05, "reg_lambda": 2.0},
        {"n_estimators": 150, "max_depth": 4, "learning_rate": 0.08, "reg_lambda": 1.5},
        {"n_estimators": 100, "max_depth": 5, "learning_rate": 0.05, "reg_lambda": 2.0},
        {"n_estimators": 200, "max_depth": 3, "learning_rate": 0.06, "reg_lambda": 2.0},
        {"n_estimators": 60, "max_depth": 4, "learning_rate": 0.12, "reg_lambda": 0.5},
        {"n_estimators": 90, "max_depth": 4, "learning_rate": 0.09, "reg_lambda": 1.5},
        {"n_estimators": 130, "max_depth": 5, "learning_rate": 0.04, "reg_lambda": 2.5},
        {"n_estimators": 70, "max_depth": 3, "learning_rate": 0.15, "reg_lambda": 0.8},
        {"n_estimators": 110, "max_depth": 4, "learning_rate": 0.07, "reg_lambda": 1.2},
    ]

    best = None
    for params in param_grid:
        model = xgb.XGBRegressor(
            objective='reg:squarederror',
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            verbosity=0,
            **params,
        )

        model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            verbose=False
        )

        train_pred = model.predict(X_train)
        val_pred = model.predict(X_val)

        metrics = {
            "train_mae": mean_absolute_error(y_train, train_pred),
            "val_mae": mean_absolute_error(y_val, val_pred),
            "train_rmse": np.sqrt(mean_squared_error(y_train, train_pred)),
            "val_rmse": np.sqrt(mean_squared_error(y_val, val_pred)),
            "val_r2": r2_score(y_val, val_pred),
        }

        if best is None or metrics["val_mae"] < best["metrics"]["val_mae"]:
            best = {"model": model, "metrics": metrics, "params": params}

    model = best["model"]
    train_mae = best["metrics"]["train_mae"]
    val_mae = best["metrics"]["val_mae"]
    train_rmse = best["metrics"]["train_rmse"]
    val_rmse = best["metrics"]["val_rmse"]
    val_r2 = best["metrics"]["val_r2"]
    
    print(f"\n📊 Results:")
    print(f"  Train MAE: {train_mae:.2f}")
    print(f"  Val MAE:   {val_mae:.2f}")
    print(f"  Val RMSE:  {val_rmse:.2f}")
    print(f"  Val R²:    {val_r2:.3f}")
    print(f"  Params:    {best['params']}")
    
    # Feature importance
    importance = model.feature_importances_
    top_features = np.argsort(importance)[-5:][::-1]
    print(f"\n🔍 Top 5 Features (Gain):")
    for idx in top_features:
        print(f"  Feature {idx}: {importance[idx]:.3f}")

    # SHAP importance and feature selection
    try:
        explainer = shap.TreeExplainer(model)
        shap_values = explainer.shap_values(X_val)
        shap_importance = np.abs(shap_values).mean(axis=0)
        top_shap = np.argsort(shap_importance)[-5:][::-1]
        print(f"\n🔍 Top 5 Features (SHAP):")
        for idx in top_shap:
            print(f"  Feature {idx}: {shap_importance[idx]:.3f}")

        # Feature selection: Select top features by SHAP importance
        # Keep features that contribute to 80% of total SHAP importance
        sorted_shap_idx = np.argsort(shap_importance)[::-1]
        cumulative_importance = np.cumsum(shap_importance[sorted_shap_idx]) / np.sum(shap_importance)
        n_features_to_keep = np.where(cumulative_importance >= 0.8)[0][0] + 1  # At least 1 feature
        n_features_to_keep = min(n_features_to_keep, len(shap_importance) // 2)  # Max 50% of features
        selected_features = sorted_shap_idx[:n_features_to_keep]

        print(f"\n🔧 Feature Selection: Keeping {len(selected_features)}/{len(shap_importance)} features (80% importance)")

        # Retrain with selected features
        X_train_selected = X_train[:, selected_features]
        X_val_selected = X_val[:, selected_features]

        print("Retraining with selected features...")
        model_selected = xgb.XGBRegressor(
            objective='reg:squarederror',
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            verbosity=0,
            **best['params'],
        )

        model_selected.fit(
            X_train_selected, y_train,
            eval_set=[(X_val_selected, y_val)],
            verbose=False
        )

        # Evaluate selected model
        train_pred_selected = model_selected.predict(X_train_selected)
        val_pred_selected = model_selected.predict(X_val_selected)

        train_mae_selected = mean_absolute_error(y_train, train_pred_selected)
        val_mae_selected = mean_absolute_error(y_val, val_pred_selected)
        val_rmse_selected = np.sqrt(mean_squared_error(y_val, val_pred_selected))
        val_r2_selected = r2_score(y_val, val_pred_selected)

        print(f"\n📊 Selected Features Results:")
        print(f"  Train MAE: {train_mae_selected:.2f}")
        print(f"  Val MAE:   {val_mae_selected:.2f}")
        print(f"  Val RMSE:  {val_rmse_selected:.2f}")
        print(f"  Val R²:    {val_r2_selected:.3f}")

        # Use selected model if better or similar
        if val_mae_selected <= val_mae or val_r2_selected > val_r2:
            print("✅ Using feature-selected model (better or equal performance)")
            model = model_selected
            train_mae = train_mae_selected
            val_mae = val_mae_selected
            val_rmse = val_rmse_selected
            val_r2 = val_r2_selected
            X_train = X_train_selected
            X_val = X_val_selected
        else:
            print("⚠️  Keeping original model (feature selection didn't improve)")
            selected_features = None  # Don't use selected features if not using selected model

    except Exception as e:
        print(f"\n⚠️  SHAP computation failed: {e}")
        top_shap = top_features
        selected_features = None
    
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
        'best_params': best['params'],
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
        },
        'shap_importance': {
            f'feature_{i}': float(shap_importance[i])
            for i in top_shap
        } if 'shap_importance' in locals() else {},
        'selected_features': selected_features.tolist() if 'selected_features' in locals() and selected_features is not None else None
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
        
        print(f"\n🏆 All Models (sorted by Val MAE):")
        sorted_results = sorted(results, key=lambda x: x['metrics']['val_mae'])
        for i, r in enumerate(sorted_results, 1):
            print(f"{i}. {r['stat_key']}_{r['scope']}_{r['period']}: "
                  f"MAE={r['metrics']['val_mae']:.2f}, R²={r['metrics']['val_r2']:.3f}")

        print(f"\n🏆 All Models (sorted by Val R²):")
        sorted_results_r2 = sorted(results, key=lambda x: x['metrics']['val_r2'], reverse=True)
        for i, r in enumerate(sorted_results_r2, 1):
            print(f"{i}. {r['stat_key']}_{r['scope']}_{r['period']}: "
                  f"R²={r['metrics']['val_r2']:.3f}, MAE={r['metrics']['val_mae']:.2f}")
    
    print("\n✅ Tier 1 training complete!")

if __name__ == '__main__':
    main()
