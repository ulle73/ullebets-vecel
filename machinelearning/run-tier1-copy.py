import json
import math
import statistics
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def _pct_improvement(prev, curr, higher_is_better=True):
    """Return percentage improvement from prev to curr. None if not computable."""
    if prev is None or curr is None:
        return None
    if prev == 0:
        return None
    if higher_is_better:
        return (curr - prev) / abs(prev) * 100.0
    return (prev - curr) / prev * 100.0


def _fmt_pct(val):
    if val is None:
        return "n/a"
    sign = "+" if val >= 0 else ""
    return f"{sign}{val:.1f}%"


def _build_comparison_summary(all_runs, tier_label="Tier 1"):
    """Compare latest run models against previous occurrence per model key."""
    if not all_runs:
        return "No runs yet."

    latest = all_runs[-1]
    latest_ts = latest.get("timestamp", "")[:10]
    prev_lookup = {}
    for run in all_runs[:-1]:
        ts = run.get("timestamp", "")[:10]
        for m in run.get("models", []) or []:
            key = (m.get("stat_key"), m.get("scope"), m.get("period"))
            prev_lookup[key] = (ts, m)

    models = latest.get("models", []) or []
    models_sorted = sorted(
        models,
        key=lambda m: m.get("metrics", {}).get("val_r2", float("-inf")),
        reverse=True,
    )

    lines = [f"All {tier_label} Models (sorted by Val R²) – {latest_ts}"]
    for idx, m in enumerate(models_sorted, 1):
        stat_key = m.get("stat_key")
        scope = m.get("scope")
        period = m.get("period")
        metrics = m.get("metrics", {})
        curr_r2 = metrics.get("val_r2")
        curr_mae = metrics.get("val_mae")

        key = (stat_key, scope, period)
        prev = prev_lookup.get(key)

        if prev:
            prev_ts, prev_model = prev
            prev_metrics = prev_model.get("metrics", {})
            prev_r2 = prev_metrics.get("val_r2")
            prev_mae = prev_metrics.get("val_mae")

            r2_pct = _pct_improvement(prev_r2, curr_r2, higher_is_better=True)
            mae_pct = _pct_improvement(prev_mae, curr_mae, higher_is_better=False)

            line = (
                f"{idx}. {stat_key}_{scope}_{period}: "
                f"{prev_ts} R²={prev_r2:.3f}, MAE={prev_mae:.2f} -> "
                f"{latest_ts} R²={curr_r2:.3f} ({_fmt_pct(r2_pct)}), "
                f"MAE={curr_mae:.2f} ({_fmt_pct(mae_pct)})"
            )
        else:
            line = (
                f"{idx}. {stat_key}_{scope}_{period}: "
                f"{latest_ts} R²={curr_r2:.3f}, MAE={curr_mae:.2f} (new)"
            )
        lines.append(line)

    return "\n".join(lines)


ROLLING_WINDOW = 5
MIN_ROLLING_RUNS = 3
GO_LIVE_MIN_R2 = 0.10
GO_LIVE_MIN_ROLLING_R2 = 0.10
GO_LIVE_MIN_MAE_IMPROVEMENT_PCT = 5.0


def _is_number(val):
    return isinstance(val, (int, float)) and not isinstance(val, bool)


def _load_targets(jsonl_path):
    targets = []
    if not jsonl_path.exists():
        return targets
    with jsonl_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            target = data.get("target")
            if _is_number(target):
                targets.append(float(target))
    return targets


def _split_train_val(train_targets):
    if not train_targets:
        return [], []
    split_idx = int(len(train_targets) * 0.8)
    if split_idx <= 0 or split_idx >= len(train_targets):
        return train_targets, []
    return train_targets[:split_idx], train_targets[split_idx:]


def _calc_metrics(y_true, y_pred):
    if not y_true:
        return None
    n = len(y_true)
    mae = sum(abs(a - b) for a, b in zip(y_true, y_pred)) / n
    mse = sum((a - b) ** 2 for a, b in zip(y_true, y_pred)) / n
    rmse = math.sqrt(mse)
    mean_y = sum(y_true) / n
    ss_tot = sum((y - mean_y) ** 2 for y in y_true)
    ss_res = sum((a - b) ** 2 for a, b in zip(y_true, y_pred))
    r2 = 1 - (ss_res / ss_tot) if ss_tot else 0.0
    return {"val_mae": mae, "val_rmse": rmse, "val_r2": r2}


def _compute_baseline(train_targets, val_targets):
    if not train_targets or not val_targets:
        return None
    mean_pred = statistics.mean(train_targets)
    median_pred = statistics.median(train_targets)
    mean_metrics = _calc_metrics(val_targets, [mean_pred] * len(val_targets))
    median_metrics = _calc_metrics(val_targets, [median_pred] * len(val_targets))
    return {
        "train_mean": mean_pred,
        "train_median": median_pred,
        "mean": mean_metrics,
        "median": median_metrics,
    }


def _compute_baseline_for_model(stat_key, scope, period, datasets_dir, cache):
    key = (stat_key, scope, period)
    if key in cache:
        return cache[key]
    train_path = datasets_dir / f"{stat_key}_{scope}_{period}_train.jsonl"
    val_path = datasets_dir / f"{stat_key}_{scope}_{period}_val.jsonl"
    if not train_path.exists():
        cache[key] = None
        return None
    train_targets = _load_targets(train_path)
    val_targets = _load_targets(val_path) if val_path.exists() else []
    if not val_targets:
        train_targets, val_targets = _split_train_val(train_targets)
    baseline = _compute_baseline(train_targets, val_targets)
    cache[key] = baseline
    return baseline


def _best_baseline_mae(baseline):
    if not baseline:
        return None
    mean_mae = (baseline.get("mean") or {}).get("val_mae")
    median_mae = (baseline.get("median") or {}).get("val_mae")
    mae_candidates = [v for v in [mean_mae, median_mae] if v is not None]
    return min(mae_candidates) if mae_candidates else None


def _compare_to_baseline(model_metrics, baseline):
    if not model_metrics or not baseline:
        return None
    mean_metrics = baseline.get("mean") or {}
    median_metrics = baseline.get("median") or {}
    val_mae = model_metrics.get("val_mae")
    val_r2 = model_metrics.get("val_r2")
    mean_mae = mean_metrics.get("val_mae")
    median_mae = median_metrics.get("val_mae")
    mean_r2 = mean_metrics.get("val_r2")
    return {
        "mae_improve_vs_mean_pct": _pct_improvement(mean_mae, val_mae, higher_is_better=False),
        "mae_improve_vs_median_pct": _pct_improvement(median_mae, val_mae, higher_is_better=False),
        "r2_delta_vs_mean": (val_r2 - mean_r2) if val_r2 is not None and mean_r2 is not None else None,
    }


def _find_model(run, key):
    for model in run.get("models", []) or []:
        if (model.get("stat_key"), model.get("scope"), model.get("period")) == key:
            return model
    return None


def _safe_stat(values, stat_fn):
    clean = [v for v in values if v is not None]
    return stat_fn(clean) if clean else None


def _rolling_stats(all_runs, key):
    models = []
    for run in reversed(all_runs):
        model = _find_model(run, key)
        if model:
            models.append(model)
        if len(models) >= ROLLING_WINDOW:
            break
    if not models:
        return None
    models = list(reversed(models))
    r2_vals = [m.get("metrics", {}).get("val_r2") for m in models]
    mae_vals = [m.get("metrics", {}).get("val_mae") for m in models]
    gate_flags = [
        m.get("gate", {}).get("status") == "GO"
        for m in models
        if isinstance(m.get("gate"), dict)
    ]
    pass_rate = (sum(gate_flags) / len(gate_flags)) if gate_flags else None
    return {
        "window": ROLLING_WINDOW,
        "count": len(models),
        "val_r2_mean": _safe_stat(r2_vals, statistics.mean),
        "val_r2_median": _safe_stat(r2_vals, statistics.median),
        "val_mae_mean": _safe_stat(mae_vals, statistics.mean),
        "val_mae_median": _safe_stat(mae_vals, statistics.median),
        "gate_pass_rate": pass_rate,
    }


def _evaluate_go_live(model, rolling):
    metrics = model.get("metrics") or {}
    val_r2 = metrics.get("val_r2")
    val_mae = metrics.get("val_mae")
    reasons = []
    if val_r2 is None or val_mae is None:
        return {"status": "NO", "reasons": ["missing_metrics"]}
    if val_r2 < GO_LIVE_MIN_R2:
        reasons.append("val_r2_below_min")
    baseline = model.get("baseline")
    best_baseline_mae = _best_baseline_mae(baseline)
    if best_baseline_mae is None:
        reasons.append("missing_baseline")
    else:
        required_mae = best_baseline_mae * (1 - GO_LIVE_MIN_MAE_IMPROVEMENT_PCT / 100.0)
        if val_mae > required_mae:
            reasons.append("mae_not_better_than_baseline")
    if rolling and rolling.get("count", 0) >= MIN_ROLLING_RUNS:
        rolling_r2_med = rolling.get("val_r2_median")
        if rolling_r2_med is not None and rolling_r2_med < GO_LIVE_MIN_ROLLING_R2:
            reasons.append("rolling_r2_below_min")
    else:
        reasons.append("insufficient_history")
    status = "GO" if not reasons else "NO"
    return {
        "status": status,
        "reasons": reasons,
        "thresholds": {
            "min_val_r2": GO_LIVE_MIN_R2,
            "min_rolling_r2": GO_LIVE_MIN_ROLLING_R2,
            "min_mae_improvement_pct": GO_LIVE_MIN_MAE_IMPROVEMENT_PCT,
            "rolling_window": ROLLING_WINDOW,
            "min_rolling_runs": MIN_ROLLING_RUNS,
        },
    }


def _fmt_num(val, digits=3):
    if val is None:
        return "n/a"
    return f"{val:.{digits}f}"


def _build_go_live_summary(models, tier_label="Tier 1"):
    if not models:
        return "No models in latest run."
    lines = [
        f"{tier_label} Go-Live Gate Summary",
        (
            "Thresholds: "
            f"min_r2={GO_LIVE_MIN_R2:.2f}, "
            f"min_mae_improve={GO_LIVE_MIN_MAE_IMPROVEMENT_PCT:.1f}%, "
            f"rolling_window={ROLLING_WINDOW}, "
            f"min_rolling_runs={MIN_ROLLING_RUNS}, "
            f"min_rolling_r2={GO_LIVE_MIN_ROLLING_R2:.2f}"
        ),
    ]
    models_sorted = sorted(
        models,
        key=lambda m: m.get("metrics", {}).get("val_r2", float("-inf")),
        reverse=True,
    )
    for idx, model in enumerate(models_sorted, 1):
        key = f"{model.get('stat_key')}_{model.get('scope')}_{model.get('period')}"
        metrics = model.get("metrics", {})
        val_r2 = metrics.get("val_r2")
        val_mae = metrics.get("val_mae")
        baseline = model.get("baseline")
        best_baseline_mae = _best_baseline_mae(baseline)
        comparison = model.get("baseline_comparison", {}) or {}
        mae_improve = comparison.get("mae_improve_vs_median_pct") or comparison.get("mae_improve_vs_mean_pct")
        rolling = model.get("rolling", {}) or {}
        rolling_med = rolling.get("val_r2_median")
        rolling_count = rolling.get("count")
        gate = model.get("gate", {}) or {}
        status = gate.get("status", "NO")
        reasons = ",".join(gate.get("reasons", []))
        gate_marker = "✅" if status == "GO" else "❌"
        gate_suffix = "" if status == "GO" else f" [{reasons}]"
        line = (
            f"{idx}. {key}: "
            f"R²={_fmt_num(val_r2, 3)}, MAE={_fmt_num(val_mae, 2)}, "
            f"baseline_best={_fmt_num(best_baseline_mae, 2)}, "
            f"MAEΔ={_fmt_pct(mae_improve)}, "
            f"rollingR²_med={_fmt_num(rolling_med, 3)} (n={rolling_count}), "
            f"gate={gate_marker}{gate_suffix}"
        )
        lines.append(line)
    return "\n".join(lines)


FEATURE_NAMES = [
    "line",
    "over_odds",
    "implied_over",
    "under_odds",
    "implied_under",
    "market_margin",
    "home_opta_rank",
    "home_opta_rating",
    "away_opta_rank",
    "away_opta_rating",
    "opta_rank_diff",
    "opta_rating_diff",
    "home_stat_value",
    "home_stat_rank",
    "away_stat_value",
    "away_stat_rank",
    "home_rank_for",
    "home_rank_against",
    "away_rank_for",
    "away_rank_against",
    "matchup_score",
    "home_wma5_for",
    "home_wma15_for",
    "home_wma30_for",
    "away_wma5_for",
    "away_wma15_for",
    "away_wma30_for",
    "home_wma5_against",
    "home_wma15_against",
    "home_wma30_against",
    "away_wma5_against",
    "away_wma15_against",
    "away_wma30_against",
    # Period features: 2 periods × 8 features = 16 features (padded for fixed size)
    "period1_home_for_value",
    "period1_home_for_rank",
    "period1_home_against_value",
    "period1_home_against_rank",
    "period1_away_for_value",
    "period1_away_for_rank",
    "period1_away_against_value",
    "period1_away_against_rank",
    "period2_home_for_value",
    "period2_home_for_rank",
    "period2_home_against_value",
    "period2_home_against_rank",
    "period2_away_for_value",
    "period2_away_for_rank",
    "period2_away_against_value",
    "period2_away_against_rank",
    # Situational features
    "home_score_first_pct",
    "away_score_first_pct",
    "score_first_diff",
    "home_shots_per_min_leading",
    "home_shots_per_min_trailing",
    "home_shots_per_min_tied",
    "away_shots_per_min_leading",
    "away_shots_per_min_trailing",
    "away_shots_per_min_tied",
    "home_shots_per_10_min",
    "away_shots_per_10_min",
    # Extra team profile features (ALL period) - 23 keys × 4 = 92 features
    "ballPossession_home_for_all",
    "ballPossession_away_for_all",
    "ballPossession_home_against_all",
    "ballPossession_away_against_all",
    "passes_home_for_all",
    "passes_away_for_all",
    "passes_home_against_all",
    "passes_away_against_all",
    "accuratePasses_home_for_all",
    "accuratePasses_away_for_all",
    "accuratePasses_home_against_all",
    "accuratePasses_away_against_all",
    "finalThirdEntries_home_for_all",
    "finalThirdEntries_away_for_all",
    "finalThirdEntries_home_against_all",
    "finalThirdEntries_away_against_all",
    "touchesInOppBox_home_for_all",
    "touchesInOppBox_away_for_all",
    "touchesInOppBox_home_against_all",
    "touchesInOppBox_away_against_all",
    "expectedGoals_home_for_all",
    "expectedGoals_away_for_all",
    "expectedGoals_home_against_all",
    "expectedGoals_away_against_all",
    "bigChanceCreated_home_for_all",
    "bigChanceCreated_away_for_all",
    "bigChanceCreated_home_against_all",
    "bigChanceCreated_away_against_all",
    "bigChanceMissed_home_for_all",
    "bigChanceMissed_away_for_all",
    "bigChanceMissed_home_against_all",
    "bigChanceMissed_away_against_all",
    "bigChanceScored_home_for_all",
    "bigChanceScored_away_for_all",
    "bigChanceScored_home_against_all",
    "bigChanceScored_away_against_all",
    "shotsOffGoal_home_for_all",
    "shotsOffGoal_away_for_all",
    "shotsOffGoal_home_against_all",
    "shotsOffGoal_away_against_all",
    "totalShotsInsideBox_home_for_all",
    "totalShotsInsideBox_away_for_all",
    "totalShotsInsideBox_home_against_all",
    "totalShotsInsideBox_away_against_all",
    "totalShotsOutsideBox_home_for_all",
    "totalShotsOutsideBox_away_for_all",
    "totalShotsOutsideBox_home_against_all",
    "totalShotsOutsideBox_away_against_all",
    "accurateCross_home_for_all",
    "accurateCross_away_for_all",
    "accurateCross_home_against_all",
    "accurateCross_away_against_all",
    "accurateLongBalls_home_for_all",
    "accurateLongBalls_away_for_all",
    "accurateLongBalls_home_against_all",
    "accurateLongBalls_away_against_all",
    "ballRecovery_home_for_all",
    "ballRecovery_away_for_all",
    "ballRecovery_home_against_all",
    "ballRecovery_away_against_all",
    "interceptionWon_home_for_all",
    "interceptionWon_away_for_all",
    "interceptionWon_home_against_all",
    "interceptionWon_away_against_all",
    "dispossessed_home_for_all",
    "dispossessed_away_for_all",
    "dispossessed_home_against_all",
    "dispossessed_away_against_all",
    "blockedScoringAttempt_home_for_all",
    "blockedScoringAttempt_away_for_all",
    "blockedScoringAttempt_home_against_all",
    "blockedScoringAttempt_away_against_all",
    "duelWonPercent_home_for_all",
    "duelWonPercent_away_for_all",
    "duelWonPercent_home_against_all",
    "duelWonPercent_away_against_all",
    "groundDuelsPercentage_home_for_all",
    "groundDuelsPercentage_away_for_all",
    "groundDuelsPercentage_home_against_all",
    "groundDuelsPercentage_away_against_all",
    "aerialDuelsPercentage_home_for_all",
    "aerialDuelsPercentage_away_for_all",
    "aerialDuelsPercentage_home_against_all",
    "aerialDuelsPercentage_away_against_all",
    "cleanSheets_home_for_all",
    "cleanSheets_away_for_all",
    "cleanSheets_home_against_all",
    "cleanSheets_away_against_all",
    "goalsConceded_home_for_all",
    "goalsConceded_away_for_all",
    "goalsConceded_home_against_all",
    "goalsConceded_away_against_all",
    "tackles_home_for_all",
    "tackles_away_for_all",
    "tackles_home_against_all",
    "tackles_away_against_all",
    "clearances_home_for_all",
    "clearances_away_for_all",
    "clearances_home_against_all",
    "clearances_away_against_all",
    "dribbles_home_for_all",
    "dribbles_away_for_all",
    "dribbles_home_against_all",
    "dribbles_away_against_all",
    "dribblesCompleted_home_for_all",
    "dribblesCompleted_away_for_all",
    "dribblesCompleted_home_against_all",
    "dribblesCompleted_away_against_all",
    "touches_home_for_all",
    "touches_away_for_all",
    "touches_home_against_all",
    "touches_away_against_all",
    "duels_home_for_all",
    "duels_away_for_all",
    "duels_home_against_all",
    "duels_away_against_all",
    "groundDuels_home_for_all",
    "groundDuels_away_for_all",
    "groundDuels_home_against_all",
    "groundDuels_away_against_all",
    "aerialDuels_home_for_all",
    "aerialDuels_away_for_all",
    "aerialDuels_home_against_all",
    "aerialDuels_away_against_all",
    "no_odds_flag",
    "home_advantage",
    "league_id",
    "formula_evPctMultifactor",
    "formula_evPctUniversalOptimized",
    "formula_evPctOptaCombined",
    "formula_evPctLeagueAvg",
    "formula_evPctOptaRating",
]
# Total: 6 market + 7 opta + 4 stat + 4 rank + 1 matchup + 12 WMA + 16 period + 11 situational + 128 extra + 3 + 5 = 197 features


def name_feature_importance(models):
    if not models:
        return models
    named = []
    for model in models:
        fi = model.get("feature_importance")
        shap_fi = model.get("shap_importance")
        dim = model.get("feature_dim")
        if not fi or not isinstance(fi, dict) or dim != len(FEATURE_NAMES):
            named.append(model)
            continue
        mapped = {}
        for key, val in fi.items():
            try:
                idx = int(key.split("_", 1)[1])
            except Exception:
                continue
            if 0 <= idx < len(FEATURE_NAMES):
                mapped[FEATURE_NAMES[idx]] = val
        shap_mapped = {}
        if shap_fi and isinstance(shap_fi, dict):
            for key, val in shap_fi.items():
                try:
                    idx = int(key.split("_", 1)[1])
                except Exception:
                    continue
                if 0 <= idx < len(FEATURE_NAMES):
                    shap_mapped[FEATURE_NAMES[idx]] = val
        enriched = {**model, "feature_importance_named": mapped, "shap_importance_named": shap_mapped}
        named.append(enriched)
    return named


def run_and_log():
    repo_root = Path(__file__).resolve().parent
    target_script = repo_root / "models" / "train" / "tier1_trainRawFeatures.py"
    log_dir = repo_root / "logs"
    log_path = log_dir / "tier1_runs.json"
    summary_path = log_dir / "tier1_comparison_summary.txt"
    gate_summary_path = log_dir / "tier1_go_live_summary.txt"
    metadata_dir = repo_root / "models" / "trained" / "tier1"
    datasets_dir = repo_root / "data" / "datasets"

    log_dir.mkdir(parents=True, exist_ok=True)

    start = time.time()
    proc = subprocess.run(
        ["python", str(target_script)],
        capture_output=True,
        text=True,
    )
    duration = time.time() - start

    # Collect metadata files modified during/after this run
    models = []
    if metadata_dir.exists():
        for meta_file in metadata_dir.glob("*_metadata.json"):
            try:
                mtime = meta_file.stat().st_mtime
                if mtime >= start - 1:  # small buffer
                    data = json.loads(meta_file.read_text(encoding="utf-8"))
                    models.append(data)
            except Exception:
                continue

    models = name_feature_importance(models)
    baseline_cache = {}
    for model in models:
        stat_key = model.get("stat_key")
        scope = model.get("scope")
        period = model.get("period")
        baseline = _compute_baseline_for_model(stat_key, scope, period, datasets_dir, baseline_cache)
        if baseline:
            model["baseline"] = baseline
            comparison = _compare_to_baseline(model.get("metrics"), baseline)
            if comparison:
                model["baseline_comparison"] = comparison

    entry = {
        "timestamp": iso_now(),
        "script": str(target_script),
        "returncode": proc.returncode,
        "duration_sec": round(duration, 3),
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "models": models,
    }

    existing = []
    if log_path.exists():
        try:
            data = json.loads(log_path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                existing = data
        except json.JSONDecodeError:
            existing = []

    existing.append(entry)
    for model in entry.get("models", []) or []:
        key = (model.get("stat_key"), model.get("scope"), model.get("period"))
        rolling = _rolling_stats(existing, key)
        if rolling:
            model["rolling"] = rolling
        model["gate"] = _evaluate_go_live(model, rolling)

    log_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")

    summary_text = None
    gate_summary_text = None
    if proc.returncode == 0 and entry.get("models"):
        # Build and persist comparison summary (does not affect training logic)
        summary_text = _build_comparison_summary(existing, tier_label="Tier 1")
        summary_path.write_text(summary_text, encoding="utf-8")
        gate_summary_text = _build_go_live_summary(entry.get("models"), tier_label="Tier 1")
        gate_summary_path.write_text(gate_summary_text, encoding="utf-8")

    # Mirror outputs to console for convenience
    print(proc.stdout, end="")
    if proc.stderr:
        import sys

        print(proc.stderr, end="", file=sys.stderr)

    if proc.returncode != 0:
        raise SystemExit(proc.returncode)

    if summary_text:
        print("\n=== Tier 1 Comparison Summary ===")
        print(summary_text)
    if gate_summary_text:
        print("\n=== Tier 1 Go-Live Gate Summary ===")
        print(gate_summary_text)


if __name__ == "__main__":
    run_and_log()
