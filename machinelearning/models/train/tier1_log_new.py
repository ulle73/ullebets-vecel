from __future__ import annotations

import json
import statistics
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_RUNS_PATH = REPO_ROOT / "machinelearning" / "logs" / "tier1_runs_new.json"
DEFAULT_SUMMARY_PATH = REPO_ROOT / "machinelearning" / "logs" / "tier1_comparison_summary_new.txt"
DEFAULT_GATE_SUMMARY_PATH = REPO_ROOT / "machinelearning" / "logs" / "tier1_go_live_summary_new.txt"


def iso_date(ts: str) -> str:
    if not ts:
        return "unknown"
    return str(ts)[:10]


def load_runs_new(runs_path: Path = DEFAULT_RUNS_PATH):
    runs_path = Path(runs_path)
    if not runs_path.exists():
        return []
    try:
        data = json.loads(runs_path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _pct_improvement(prev, curr, higher_is_better=True):
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


def _selection_metrics(model):
    return model.get("selection_metrics") or {}


def _test_metrics(model):
    return model.get("test_metrics") or {}


def _model_key(model):
    return (model.get("stat_key"), model.get("scope"), model.get("period"))


def _pretty_key(model):
    return "_".join([str(model.get("stat_key")), str(model.get("scope")), str(model.get("period"))])


def _fmt_num(value, digits=3):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return "n/a"
    return f"{value:.{digits}f}"


def _model_label(model):
    return _pretty_key(model)


def _model_status(model):
    return str(model.get("status") or "trained")


def _model_reason(model):
    return model.get("reason") or "unknown"


def _safe_r2(model):
    value = _selection_metrics(model).get("median_r2")
    return value if isinstance(value, (int, float)) else float("-inf")


def build_comparison_summary_new(all_runs):
    if not all_runs:
        return "No runs yet."

    latest = all_runs[-1]
    latest_ts = iso_date(latest.get("timestamp", ""))
    prev_lookup = {}
    for run in all_runs[:-1]:
        ts = iso_date(run.get("timestamp", ""))
        for model in run.get("models", []) or []:
            prev_lookup[_model_key(model)] = (ts, model)

    models = latest.get("models", []) or []
    models_sorted = sorted(models, key=_safe_r2, reverse=True)

    lines = [f"All Tier 1 New Models (sorted by Val R²) – {latest_ts}"]
    for idx, model in enumerate(models_sorted, 1):
        status = _model_status(model)
        if status != "trained":
            lines.append(f"{idx}. {_model_label(model)}: skipped | {_model_reason(model)}")
            continue

        metrics = _selection_metrics(model)
        curr_r2 = metrics.get("median_r2")
        curr_mae = metrics.get("median_mae")
        key = _model_key(model)
        prev = prev_lookup.get(key)

        if prev:
            prev_ts, prev_model = prev
            prev_metrics = _selection_metrics(prev_model)
            prev_r2 = prev_metrics.get("median_r2")
            prev_mae = prev_metrics.get("median_mae")
            r2_pct = _pct_improvement(prev_r2, curr_r2, higher_is_better=True)
            mae_pct = _pct_improvement(prev_mae, curr_mae, higher_is_better=False)
            line = (
                f"{idx}. {_model_label(model)}: "
                f"{prev_ts} R²={_fmt_num(prev_r2, 3)}, MAE={_fmt_num(prev_mae, 2)} -> "
                f"{latest_ts} R²={_fmt_num(curr_r2, 3)} ({_fmt_pct(r2_pct)}), "
                f"MAE={_fmt_num(curr_mae, 2)} ({_fmt_pct(mae_pct)})"
            )
        else:
            line = (
                f"{idx}. {_model_label(model)}: "
                f"{latest_ts} R²={_fmt_num(curr_r2, 3)}, MAE={_fmt_num(curr_mae, 2)} (new)"
            )
        lines.append(line)

    return "\n".join(lines)


ROLLING_WINDOW = 5
MIN_ROLLING_RUNS = 3
GO_LIVE_MIN_R2 = 0.10
GO_LIVE_MIN_TEST_R2 = 0.05
GO_LIVE_MAX_TEST_MAE_DRIFT_PCT = 10.0


def _rolling_stats(all_runs, key):
    models = []
    for run in reversed(all_runs):
        for model in run.get("models", []) or []:
            if _model_key(model) == key:
                models.append(model)
                break
        if len(models) >= ROLLING_WINDOW:
            break

    if not models:
        return None

    models = list(reversed(models))
    r2_vals = [(_selection_metrics(model).get("median_r2")) for model in models]
    mae_vals = [(_selection_metrics(model).get("median_mae")) for model in models]
    clean_r2 = [value for value in r2_vals if isinstance(value, (int, float))]
    clean_mae = [value for value in mae_vals if isinstance(value, (int, float))]
    return {
        "window": ROLLING_WINDOW,
        "count": len(models),
        "val_r2_mean": statistics.mean(clean_r2) if clean_r2 else None,
        "val_r2_median": statistics.median(clean_r2) if clean_r2 else None,
        "val_mae_mean": statistics.mean(clean_mae) if clean_mae else None,
        "val_mae_median": statistics.median(clean_mae) if clean_mae else None,
    }


def _evaluate_go_live(model, rolling):
    selection = _selection_metrics(model)
    test = _test_metrics(model)
    val_r2 = selection.get("median_r2")
    val_mae = selection.get("median_mae")
    test_r2 = test.get("r2")
    test_mae = test.get("mae")
    reasons = []

    if val_r2 is None or val_mae is None:
        return {"status": "NO", "reasons": ["missing_selection_metrics"]}
    if test_r2 is None or test_mae is None:
        reasons.append("missing_test_metrics")
    if val_r2 < GO_LIVE_MIN_R2:
        reasons.append("val_r2_below_min")
    if test_r2 is not None and test_r2 < GO_LIVE_MIN_TEST_R2:
        reasons.append("test_r2_below_min")
    if test_mae is not None and val_mae > 0:
        drift_pct = ((test_mae - val_mae) / val_mae) * 100.0
        if drift_pct > GO_LIVE_MAX_TEST_MAE_DRIFT_PCT:
            reasons.append("test_mae_drift_too_high")
    if rolling and rolling.get("count", 0) < MIN_ROLLING_RUNS:
        reasons.append("insufficient_history")
    elif rolling:
        rolling_r2 = rolling.get("val_r2_median")
        if rolling_r2 is not None and rolling_r2 < GO_LIVE_MIN_R2:
            reasons.append("rolling_r2_below_min")

    status = "GO" if not reasons else "NO"
    return {
        "status": status,
        "reasons": reasons,
        "thresholds": {
            "min_val_r2": GO_LIVE_MIN_R2,
            "min_test_r2": GO_LIVE_MIN_TEST_R2,
            "max_test_mae_drift_pct": GO_LIVE_MAX_TEST_MAE_DRIFT_PCT,
            "rolling_window": ROLLING_WINDOW,
            "min_rolling_runs": MIN_ROLLING_RUNS,
        },
    }


def build_go_live_summary_new(models, all_runs=None):
    if not models:
        return "No models in latest run."

    all_runs = all_runs or []
    lines = [
        "Tier 1 New Go-Live Gate Summary",
        (
            "Thresholds: "
            f"min_val_r2={GO_LIVE_MIN_R2:.2f}, "
            f"min_test_r2={GO_LIVE_MIN_TEST_R2:.2f}, "
            f"max_test_mae_drift_pct={GO_LIVE_MAX_TEST_MAE_DRIFT_PCT:.1f}%, "
            f"rolling_window={ROLLING_WINDOW}, "
            f"min_rolling_runs={MIN_ROLLING_RUNS}"
        ),
    ]
    models_sorted = sorted(
        models,
        key=lambda model: _selection_metrics(model).get("median_r2", float("-inf")),
        reverse=True,
    )
    for idx, model in enumerate(models_sorted, 1):
        status = _model_status(model)
        if status != "trained":
            lines.append(f"{idx}. {_model_label(model)}: skipped | {_model_reason(model)}")
            continue

        key = _model_key(model)
        selection = _selection_metrics(model)
        test = _test_metrics(model)
        rolling = _rolling_stats(all_runs, key) if all_runs else None
        gate = _evaluate_go_live(model, rolling)
        status = gate.get("status", "NO")
        reasons = ",".join(gate.get("reasons", []))
        marker = "✅" if status == "GO" else "❌"
        lines.append(
            f"{idx}. {_model_label(model)}: "
            f"selR²={_fmt_num(selection.get('median_r2'), 3)}, selMAE={_fmt_num(selection.get('median_mae'), 2)}, "
            f"testR²={_fmt_num(test.get('r2'), 3)}, testMAE={_fmt_num(test.get('mae'), 2)}, "
            f"rollingR²_med={_fmt_num(rolling.get('val_r2_median') if rolling else None, 3)}, "
            f"gate={marker}" + ("" if status == "GO" else f" [{reasons}]")
        )
    return "\n".join(lines)


def write_tier1_logs_new(
    runs_path: Path = DEFAULT_RUNS_PATH,
    summary_path: Path = DEFAULT_SUMMARY_PATH,
    gate_summary_path: Path = DEFAULT_GATE_SUMMARY_PATH,
):
    runs = load_runs_new(runs_path)
    latest_run = runs[-1] if runs else {"models": []}
    summary = build_comparison_summary_new(runs)
    gate_summary = build_go_live_summary_new(latest_run.get("models", []) or [], runs)

    summary_path = Path(summary_path)
    gate_summary_path = Path(gate_summary_path)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    gate_summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(summary + "\n", encoding="utf-8")
    gate_summary_path.write_text(gate_summary + "\n", encoding="utf-8")

    return {
        "runs": runs,
        "latest_run": latest_run,
        "summary": summary,
        "gate_summary": gate_summary,
        "summary_path": summary_path,
        "gate_summary_path": gate_summary_path,
    }
