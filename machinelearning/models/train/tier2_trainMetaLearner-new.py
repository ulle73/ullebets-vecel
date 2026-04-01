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
DEFAULT_TIER1_DIR = REPO_ROOT / "machinelearning" / "models" / "trained" / "tier1-new"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "machinelearning" / "models" / "trained" / "tier2-new"


def load_tier1_metadata(tier1_dir):
    tier1_dir = Path(tier1_dir)
    metadata = {}
    for file_path in sorted(tier1_dir.glob("*_raw_new_metadata.json")):
        payload = json.loads(file_path.read_text(encoding="utf-8"))
        combo_key = payload.get("combo_key")
        if combo_key:
            metadata[combo_key] = payload
    return metadata


def build_tier1_candidate_from_metadata(metadata):
    selected = metadata["selected_candidate"]
    return {
        "family": selected["family"],
        "label": selected["label"],
        "params": selected.get("params", {}),
        "target_transform": selected.get("target_transform", "raw"),
        "objective": selected.get("objective"),
    }


def evaluate_tier2_candidate(dev_samples, formula_keys, tier1_candidate, tier2_candidate):
    folds = common.build_walk_forward_slices(dev_samples, min_train_size=24, min_val_size=8, max_folds=4)
    if not folds:
        return None

    fold_metrics = []
    for fold in folds:
        train_samples = dev_samples[fold["train_start"] : fold["train_end"] + 1]
        val_samples = dev_samples[fold["val_start"] : fold["val_end"] + 1]

        tier1_artifact = common.fit_candidate_model_new(
            common.feature_matrix_new(train_samples),
            common.extract_targets_new(train_samples),
            tier1_candidate,
        )
        tier1_train_predictions = common.predict_candidate_model_new(
            tier1_artifact,
            common.feature_matrix_new(train_samples),
        )
        tier1_val_predictions = common.predict_candidate_model_new(
            tier1_artifact,
            common.feature_matrix_new(val_samples),
        )

        x_train = common.build_tier2_feature_matrix_new(
            train_samples,
            formula_keys,
            tier1_train_predictions,
        )
        y_train = common.extract_targets_new(train_samples)
        x_val = common.build_tier2_feature_matrix_new(
            val_samples,
            formula_keys,
            tier1_val_predictions,
        )
        y_val = common.extract_targets_new(val_samples)
        lines = common.extract_lines_new(val_samples)

        tier2_artifact = common.fit_candidate_model_new(x_train, y_train, tier2_candidate)
        predictions = common.predict_candidate_model_new(tier2_artifact, x_val)
        fold_metrics.append(common.compute_summary_metrics(y_val, predictions, lines))

    return {
        "label": tier2_candidate["label"],
        "family": tier2_candidate["family"],
        "candidate": tier2_candidate,
        "folds": fold_metrics,
        "aggregate": common.aggregate_fold_metrics(fold_metrics),
    }


def train_final_tier2(dev_samples, test_samples, formula_keys, tier1_candidate, tier2_candidate):
    tier1_artifact = common.fit_candidate_model_new(
        common.feature_matrix_new(dev_samples),
        common.extract_targets_new(dev_samples),
        tier1_candidate,
    )
    tier1_dev_predictions = common.predict_candidate_model_new(
        tier1_artifact,
        common.feature_matrix_new(dev_samples),
    )
    x_dev = common.build_tier2_feature_matrix_new(dev_samples, formula_keys, tier1_dev_predictions)
    y_dev = common.extract_targets_new(dev_samples)
    tier2_artifact = common.fit_candidate_model_new(x_dev, y_dev, tier2_candidate)

    test_metrics = None
    if test_samples:
        tier1_test_predictions = common.predict_candidate_model_new(
            tier1_artifact,
            common.feature_matrix_new(test_samples),
        )
        x_test = common.build_tier2_feature_matrix_new(test_samples, formula_keys, tier1_test_predictions)
        y_test = common.extract_targets_new(test_samples)
        lines = common.extract_lines_new(test_samples)
        predictions = common.predict_candidate_model_new(tier2_artifact, x_test)
        test_metrics = common.compute_summary_metrics(y_test, predictions, lines)

    return tier2_artifact, test_metrics


def write_skip_metadata(output_dir, combo_key, reason, tier1_metadata, extra=None):
    payload = {
        "combo_key": combo_key,
        "model_type": "tier2_new",
        "status": "skipped",
        "reason": reason,
        "tier1_selected_feature_mode": tier1_metadata.get("selected_feature_mode"),
    }
    if extra:
        payload.update(extra)
    common.write_json_new(output_dir / f"{combo_key}_stacked_new_metadata.json", payload)
    return payload


def train_combo(dataset_dir, output_dir, combo_key, tier1_metadata):
    if tier1_metadata.get("status") != "trained":
        return write_skip_metadata(output_dir, combo_key, "tier1_not_trained", tier1_metadata)

    feature_mode = tier1_metadata["selected_feature_mode"]
    bundle = common.load_dataset_bundle_new(dataset_dir, combo_key, feature_mode)
    dev_samples = common.sort_samples_by_date_new(bundle["train"] + bundle["val"])
    test_samples = common.sort_samples_by_date_new(bundle["test"])
    if len(dev_samples) < 32:
        return write_skip_metadata(
            output_dir,
            combo_key,
            "insufficient_dev_samples",
            tier1_metadata,
            {"bundle_counts": {split: len(samples) for split, samples in bundle.items()}},
        )

    formula_keys = common.build_formula_keys_new(dev_samples + test_samples)
    if not formula_keys:
        return write_skip_metadata(output_dir, combo_key, "no_formula_predictions", tier1_metadata)

    tier1_candidate = build_tier1_candidate_from_metadata(tier1_metadata)

    records = []
    for tier2_candidate in common.build_tier2_candidates_new():
        result = evaluate_tier2_candidate(dev_samples, formula_keys, tier1_candidate, tier2_candidate)
        if result:
            records.append(result)

    if not records:
        return write_skip_metadata(output_dir, combo_key, "no_valid_tier2_candidates", tier1_metadata)

    ranked = common.rank_candidate_records(records)
    best = ranked[0]
    artifact, test_metrics = train_final_tier2(
        dev_samples,
        test_samples,
        formula_keys,
        tier1_candidate,
        best["candidate"],
    )

    metadata = {
        "combo_key": combo_key,
        "stat_key": combo_key.rsplit("_", 2)[0],
        "scope": combo_key.rsplit("_", 2)[1],
        "period": combo_key.rsplit("_", 2)[2],
        "model_type": "tier2_new",
        "status": "trained",
        "selected_feature_mode": feature_mode,
        "formula_keys": formula_keys,
        "tier1_selected_candidate": tier1_metadata["selected_candidate"],
        "selected_candidate": {
            "label": best["label"],
            "family": best["family"],
            "params": best["candidate"].get("params", {}),
            "target_transform": best["candidate"].get("target_transform", "raw"),
            "objective": best["candidate"].get("objective"),
        },
        "selection_metrics": best["aggregate"],
        "test_metrics": test_metrics,
        "candidate_rankings": [
            {
                "label": record["label"],
                "family": record["family"],
                "aggregate": record["aggregate"],
            }
            for record in ranked[:10]
        ],
    }

    if artifact["family"] != "baseline_mean":
        common.save_xgboost_model_new(
            artifact["model"],
            output_dir / f"{combo_key}_stacked_new.json",
        )
    else:
        metadata["baseline_mean"] = artifact["mean_value"]

    common.write_json_new(output_dir / f"{combo_key}_stacked_new_metadata.json", metadata)
    return metadata


def main():
    parser = argparse.ArgumentParser(description="Train Tier 2 stacked prediction models for the -new pipeline")
    parser.add_argument("--dataset-dir", default=str(DEFAULT_DATASET_DIR))
    parser.add_argument("--tier1-dir", default=str(DEFAULT_TIER1_DIR))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--combo")
    parser.add_argument("--limit-combos", type=int)
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir)
    tier1_dir = Path(args.tier1_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    tier1_metadata = load_tier1_metadata(tier1_dir)
    combo_keys = sorted(tier1_metadata.keys())
    if args.combo:
        combo_keys = [combo for combo in combo_keys if combo == args.combo]
    if args.limit_combos:
        combo_keys = combo_keys[: args.limit_combos]

    results = []
    for combo_key in combo_keys:
        print(f"[tier2-new] Training {combo_key}")
        metadata = train_combo(dataset_dir, output_dir, combo_key, tier1_metadata[combo_key])
        results.append(metadata)
        if metadata.get("status") == "trained":
            print(
                f"  -> {metadata['selected_candidate']['label']} / "
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
