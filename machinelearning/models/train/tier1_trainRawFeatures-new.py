from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path


def _load_common_new():
    module_path = Path(__file__).with_name("common-new.py")
    spec = importlib.util.spec_from_file_location("common_new", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


common = _load_common_new()

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATASET_DIR = REPO_ROOT / "machinelearning" / "data" / "datasets-new"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "machinelearning" / "models" / "trained" / "tier1-new"


def evaluate_candidate(samples, candidate):
    folds = common.build_walk_forward_slices(samples, min_train_size=24, min_val_size=8, max_folds=4)
    if not folds:
        return None

    candidate_folds = []
    for fold in folds:
        train_samples = samples[fold["train_start"] : fold["train_end"] + 1]
        val_samples = samples[fold["val_start"] : fold["val_end"] + 1]
        x_train = common.feature_matrix_new(train_samples)
        y_train = common.extract_targets_new(train_samples)
        x_val = common.feature_matrix_new(val_samples)
        y_val = common.extract_targets_new(val_samples)
        lines = common.extract_lines_new(val_samples)

        artifact = common.fit_candidate_model_new(x_train, y_train, candidate)
        predictions = common.predict_candidate_model_new(artifact, x_val)
        metrics = common.compute_summary_metrics(y_val, predictions, lines)
        candidate_folds.append(metrics)

    aggregate = common.aggregate_fold_metrics(candidate_folds)
    return {
        "label": candidate["label"],
        "family": candidate["family"],
        "candidate": candidate,
        "folds": candidate_folds,
        "aggregate": aggregate,
    }


def train_final_model(dev_samples, test_samples, candidate):
    x_dev = common.feature_matrix_new(dev_samples)
    y_dev = common.extract_targets_new(dev_samples)
    artifact = common.fit_candidate_model_new(x_dev, y_dev, candidate)
    test_metrics = None
    if test_samples:
        x_test = common.feature_matrix_new(test_samples)
        y_test = common.extract_targets_new(test_samples)
        lines = common.extract_lines_new(test_samples)
        predictions = common.predict_candidate_model_new(artifact, x_test)
        test_metrics = common.compute_summary_metrics(y_test, predictions, lines)
    return artifact, test_metrics


def write_skip_metadata(output_dir, combo_key, reason, bundle_counts):
    payload = {
        "combo_key": combo_key,
        "model_type": "tier1_new",
        "status": "skipped",
        "reason": reason,
        "bundle_counts": bundle_counts,
    }
    common.write_json_new(output_dir / f"{combo_key}_raw_new_metadata.json", payload)
    return payload


def train_combo(dataset_dir, output_dir, combo_key, feature_mode_limit=None):
    mode_records = []
    bundle_counts = {}
    for feature_mode in ["strict", "extended"]:
        if feature_mode_limit and feature_mode != feature_mode_limit:
            continue
        bundle = common.load_dataset_bundle_new(dataset_dir, combo_key, feature_mode)
        bundle_counts[feature_mode] = {split: len(samples) for split, samples in bundle.items()}
        dev_samples = common.sort_samples_by_date_new(bundle["train"] + bundle["val"])
        test_samples = common.sort_samples_by_date_new(bundle["test"])
        if len(dev_samples) < 32:
            continue

        for candidate in common.build_tier1_candidates_new():
            result = evaluate_candidate(dev_samples, candidate)
            if not result:
                continue
            result["feature_mode"] = feature_mode
            mode_records.append(result)

    if not mode_records:
        return write_skip_metadata(output_dir, combo_key, "insufficient_dev_samples", bundle_counts)

    ranked = common.rank_candidate_records(mode_records)
    best = ranked[0]
    best_feature_mode = best["feature_mode"]
    best_bundle = common.load_dataset_bundle_new(dataset_dir, combo_key, best_feature_mode)
    dev_samples = common.sort_samples_by_date_new(best_bundle["train"] + best_bundle["val"])
    test_samples = common.sort_samples_by_date_new(best_bundle["test"])
    artifact, test_metrics = train_final_model(dev_samples, test_samples, best["candidate"])

    metadata = {
        "combo_key": combo_key,
        "stat_key": combo_key.rsplit("_", 2)[0],
        "scope": combo_key.rsplit("_", 2)[1],
        "period": combo_key.rsplit("_", 2)[2],
        "model_type": "tier1_new",
        "status": "trained",
        "selected_feature_mode": best_feature_mode,
        "selected_candidate": {
            "label": best["label"],
            "family": best["family"],
            "params": best["candidate"].get("params", {}),
            "target_transform": best["candidate"].get("target_transform", "raw"),
            "objective": best["candidate"].get("objective"),
        },
        "selection_metrics": best["aggregate"],
        "test_metrics": test_metrics,
        "bundle_counts": bundle_counts,
        "candidate_rankings": [
            {
                "label": record["label"],
                "family": record["family"],
                "feature_mode": record["feature_mode"],
                "aggregate": record["aggregate"],
            }
            for record in ranked[:10]
        ],
    }

    if artifact["family"] != "baseline_mean":
        common.save_xgboost_model_new(
            artifact["model"],
            output_dir / f"{combo_key}_raw_new.json",
        )
    else:
        metadata["baseline_mean"] = artifact["mean_value"]

    common.write_json_new(output_dir / f"{combo_key}_raw_new_metadata.json", metadata)
    return metadata


def main():
    parser = argparse.ArgumentParser(description="Train Tier 1 prediction models for the -new pipeline")
    parser.add_argument("--dataset-dir", default=str(DEFAULT_DATASET_DIR))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--combo")
    parser.add_argument("--limit-combos", type=int)
    parser.add_argument("--feature-mode", choices=["strict", "extended"])
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    grouped = common.discover_dataset_groups_new(dataset_dir)
    combo_keys = sorted(grouped.keys())
    if args.combo:
        combo_keys = [combo for combo in combo_keys if combo == args.combo]
    if args.limit_combos:
        combo_keys = combo_keys[: args.limit_combos]

    results = []
    for combo_key in combo_keys:
        print(f"[tier1-new] Training {combo_key}")
        metadata = train_combo(
            dataset_dir,
            output_dir,
            combo_key,
            feature_mode_limit=args.feature_mode,
        )
        results.append(metadata)
        status = metadata.get("status")
        if status == "trained":
            print(
                f"  -> {metadata['selected_feature_mode']} / {metadata['selected_candidate']['label']} / "
                f"MAE {metadata['selection_metrics']['median_mae']:.3f}"
            )
        else:
            print(f"  -> skipped: {metadata.get('reason')}")

    summary = {
        "combo_count": len(combo_keys),
        "trained": sum(1 for result in results if result.get("status") == "trained"),
        "skipped": sum(1 for result in results if result.get("status") == "skipped"),
        "results": results,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
