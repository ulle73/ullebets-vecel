from __future__ import annotations

import json
import math
import re
import statistics
from datetime import datetime
from pathlib import Path

DATASET_FILENAME_RE_NEW = re.compile(
    r"^(?P<stat_key>.+)_(?P<scope>home|away|total)_(?P<period>ALL|1ST|2ND)_(?P<feature_mode>strict|extended)_(?P<split>train|val|test)\.jsonl$"
)

CONSENSUS_KEYS_NEW = [
    "formula_count",
    "formula_std",
    "formula_median",
]


def _parse_iso(date_string: str) -> datetime:
    return datetime.fromisoformat(str(date_string).replace("Z", "+00:00"))


def _safe_mean(values):
    return statistics.mean(values) if values else 0.0


def _safe_median(values):
    return statistics.median(values) if values else 0.0


def _safe_pstdev(values):
    return statistics.pstdev(values) if len(values) > 1 else 0.0


def build_walk_forward_slices(samples, min_train_size=40, min_val_size=15, max_folds=4):
    ordered = sorted(samples, key=lambda sample: _parse_iso(sample["metadata"]["date"]))
    total = len(ordered)
    if total < (min_train_size + min_val_size):
        return []

    last_train_size = total - min_val_size
    if last_train_size < min_train_size:
        return []

    available_starts = list(range(min_train_size, last_train_size + 1))
    if len(available_starts) <= max_folds:
        train_sizes = available_starts
    else:
        step = max(1, (len(available_starts) - 1) // max(1, max_folds - 1))
        train_sizes = [available_starts[index] for index in range(0, len(available_starts), step)]
        if train_sizes[-1] != available_starts[-1]:
            train_sizes.append(available_starts[-1])
        train_sizes = train_sizes[:max_folds]

    folds = []
    for train_size in train_sizes:
        remaining = total - train_size
        if remaining < min_val_size:
            continue
        val_size = max(min_val_size, min(remaining, max(min_val_size, total // 6)))
        val_size = min(val_size, remaining)
        train_end = train_size - 1
        val_start = train_size
        val_end = train_size + val_size - 1
        folds.append(
            {
                "train_start": 0,
                "train_end": train_end,
                "val_start": val_start,
                "val_end": val_end,
                "train_size": train_size,
                "val_size": val_size,
            }
        )
    return folds


def compute_summary_metrics(targets, predictions, lines=None):
    if len(targets) != len(predictions):
        raise ValueError("targets and predictions must be the same length")
    if not targets:
        return {
            "mae": 0.0,
            "rmse": 0.0,
            "r2": 0.0,
            "line_direction_accuracy": 0.0,
        }

    absolute_errors = [abs(target - prediction) for target, prediction in zip(targets, predictions)]
    squared_errors = [(target - prediction) ** 2 for target, prediction in zip(targets, predictions)]
    mae = _safe_mean(absolute_errors)
    rmse = math.sqrt(_safe_mean(squared_errors))

    target_mean = _safe_mean(targets)
    total_variance = sum((target - target_mean) ** 2 for target in targets)
    residual_variance = sum((target - prediction) ** 2 for target, prediction in zip(targets, predictions))
    r2 = 0.0 if total_variance == 0 else 1 - (residual_variance / total_variance)

    directional_pairs = []
    if lines is not None:
        for target, prediction, line in zip(targets, predictions, lines):
            if line is None:
                continue
            try:
                numeric_line = float(line)
            except (TypeError, ValueError):
                continue
            directional_pairs.append(((target > numeric_line), (prediction > numeric_line)))

    if directional_pairs:
        line_direction_accuracy = sum(
            1 for target_dir, prediction_dir in directional_pairs if target_dir == prediction_dir
        ) / len(directional_pairs)
    else:
        line_direction_accuracy = 0.0

    return {
        "mae": mae,
        "rmse": rmse,
        "r2": r2,
        "line_direction_accuracy": line_direction_accuracy,
    }


def aggregate_fold_metrics(fold_metrics):
    maes = [fold["mae"] for fold in fold_metrics]
    rmses = [fold["rmse"] for fold in fold_metrics]
    r2s = [fold["r2"] for fold in fold_metrics]
    line_accs = [fold.get("line_direction_accuracy", 0.0) for fold in fold_metrics]
    return {
        "median_mae": _safe_median(maes),
        "median_rmse": _safe_median(rmses),
        "median_r2": _safe_median(r2s),
        "median_line_direction_accuracy": _safe_median(line_accs),
        "stability_penalty": _safe_pstdev(maes),
    }


def rank_candidate_records(records):
    return sorted(
        records,
        key=lambda record: (
            record["aggregate"]["median_mae"],
            record["aggregate"]["median_rmse"],
            -record["aggregate"]["median_r2"],
            record["aggregate"]["stability_penalty"],
            -record["aggregate"].get("median_line_direction_accuracy", 0.0),
            record.get("label", ""),
        ),
    )


def load_jsonl_samples(file_path):
    samples = []
    path = Path(file_path)
    if not path.exists():
        return samples
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            samples.append(json.loads(line))
    return samples


def parse_dataset_filename_new(file_name):
    match = DATASET_FILENAME_RE_NEW.match(Path(file_name).name)
    if not match:
        raise ValueError(f"Invalid dataset filename: {file_name}")
    return match.groupdict()


def discover_dataset_groups_new(dataset_dir):
    dataset_dir = Path(dataset_dir)
    grouped = {}
    for file_path in sorted(dataset_dir.glob("*.jsonl")):
        parsed = parse_dataset_filename_new(file_path.name)
        combo_key = f"{parsed['stat_key']}_{parsed['scope']}_{parsed['period']}"
        feature_mode = parsed["feature_mode"]
        split = parsed["split"]
        grouped.setdefault(combo_key, {}).setdefault(feature_mode, {})[split] = file_path
    return grouped


def load_dataset_bundle_new(dataset_dir, combo_key, feature_mode):
    dataset_dir = Path(dataset_dir)
    bundle = {"train": [], "val": [], "test": []}
    for split in bundle:
        file_path = dataset_dir / f"{combo_key}_{feature_mode}_{split}.jsonl"
        bundle[split] = load_jsonl_samples(file_path)
    return bundle


def sort_samples_by_date_new(samples):
    return sorted(samples, key=lambda sample: _parse_iso(sample["metadata"]["date"]))


def extract_targets_new(samples):
    return [float(sample["target"]) for sample in samples]


def extract_lines_new(samples):
    return [sample.get("metadata", {}).get("line") for sample in samples]


def feature_matrix_new(samples):
    return [sample["raw_features"] for sample in samples]


def transform_targets_new(values, target_transform):
    if target_transform == "log1p":
        return [math.log1p(max(0.0, float(value))) for value in values]
    return [float(value) for value in values]


def inverse_predictions_new(values, target_transform):
    if target_transform == "log1p":
        return [max(0.0, math.expm1(float(value))) for value in values]
    return [max(0.0, float(value)) for value in values]


def build_tier1_candidates_new():
    candidates = [{"family": "baseline_mean", "label": "baseline_mean", "params": {}, "target_transform": "raw"}]
    square_grid = [
        {"n_estimators": 80, "max_depth": 3, "learning_rate": 0.08, "reg_lambda": 1.0},
        {"n_estimators": 120, "max_depth": 4, "learning_rate": 0.05, "reg_lambda": 2.0},
        {"n_estimators": 160, "max_depth": 3, "learning_rate": 0.06, "reg_lambda": 2.0},
    ]
    log_grid = [
        {"n_estimators": 100, "max_depth": 3, "learning_rate": 0.07, "reg_lambda": 1.0},
        {"n_estimators": 140, "max_depth": 4, "learning_rate": 0.05, "reg_lambda": 1.5},
    ]
    poisson_grid = [
        {"n_estimators": 100, "max_depth": 3, "learning_rate": 0.08, "reg_lambda": 1.0},
        {"n_estimators": 140, "max_depth": 4, "learning_rate": 0.05, "reg_lambda": 1.5},
    ]
    for index, params in enumerate(square_grid, start=1):
        candidates.append(
            {
                "family": "xgb_square",
                "label": f"xgb_square_{index}",
                "params": params,
                "target_transform": "raw",
                "objective": "reg:squarederror",
            }
        )
    for index, params in enumerate(log_grid, start=1):
        candidates.append(
            {
                "family": "xgb_log",
                "label": f"xgb_log_{index}",
                "params": params,
                "target_transform": "log1p",
                "objective": "reg:squarederror",
            }
        )
    for index, params in enumerate(poisson_grid, start=1):
        candidates.append(
            {
                "family": "xgb_poisson",
                "label": f"xgb_poisson_{index}",
                "params": params,
                "target_transform": "raw",
                "objective": "count:poisson",
            }
        )
    return candidates


def build_tier2_candidates_new():
    candidates = [{"family": "baseline_mean", "label": "baseline_mean", "params": {}, "target_transform": "raw"}]
    square_grid = [
        {"n_estimators": 60, "max_depth": 3, "learning_rate": 0.08, "reg_lambda": 1.0},
        {"n_estimators": 100, "max_depth": 4, "learning_rate": 0.05, "reg_lambda": 1.5},
    ]
    log_grid = [
        {"n_estimators": 80, "max_depth": 3, "learning_rate": 0.07, "reg_lambda": 1.0},
        {"n_estimators": 120, "max_depth": 4, "learning_rate": 0.05, "reg_lambda": 1.5},
    ]
    for index, params in enumerate(square_grid, start=1):
        candidates.append(
            {
                "family": "xgb_square",
                "label": f"xgb_square_{index}",
                "params": params,
                "target_transform": "raw",
                "objective": "reg:squarederror",
            }
        )
    for index, params in enumerate(log_grid, start=1):
        candidates.append(
            {
                "family": "xgb_log",
                "label": f"xgb_log_{index}",
                "params": params,
                "target_transform": "log1p",
                "objective": "reg:squarederror",
            }
        )
    return candidates


def fit_candidate_model_new(x_train, y_train, candidate):
    if candidate["family"] == "baseline_mean":
        transformed = transform_targets_new(y_train, candidate["target_transform"])
        return {
            "family": candidate["family"],
            "target_transform": candidate["target_transform"],
            "mean_value": _safe_mean(transformed),
        }

    import xgboost as xgb
    import numpy as np

    model = xgb.XGBRegressor(
        objective=candidate["objective"],
        subsample=0.85,
        colsample_bytree=0.85,
        random_state=42,
        verbosity=0,
        **candidate["params"],
    )
    transformed_y = transform_targets_new(y_train, candidate["target_transform"])
    model.fit(np.array(x_train), np.array(transformed_y), verbose=False)
    return {
        "family": candidate["family"],
        "target_transform": candidate["target_transform"],
        "model": model,
    }


def predict_candidate_model_new(artifact, x_values):
    if artifact["family"] == "baseline_mean":
        return inverse_predictions_new(
            [artifact["mean_value"]] * len(x_values),
            artifact["target_transform"],
        )

    import numpy as np

    raw_predictions = artifact["model"].predict(np.array(x_values))
    return inverse_predictions_new(raw_predictions.tolist(), artifact["target_transform"])


def save_xgboost_model_new(model, file_path):
    file_path = Path(file_path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    model.save_model(str(file_path))


def write_json_new(file_path, payload):
    file_path = Path(file_path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with file_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def build_formula_keys_new(samples):
    keys = set()
    for sample in samples:
        for key, value in (sample.get("formula_predictions") or {}).items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                keys.add(key)
    return sorted(keys)


def build_tier2_feature_matrix_new(samples, formula_keys, tier1_predictions):
    rows = []
    for sample, tier1_prediction in zip(samples, tier1_predictions):
        row = list(sample["raw_features"])
        formula_predictions = sample.get("formula_predictions") or {}
        for key in formula_keys:
            value = formula_predictions.get(key, 0.0)
            row.append(float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0)
        consensus = sample.get("consensus_features") or {}
        for key in CONSENSUS_KEYS_NEW:
            row.append(float(consensus.get(key, 0.0)))
        row.append(float(tier1_prediction))
        rows.append(row)
    return rows
