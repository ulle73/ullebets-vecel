import json
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


def _build_comparison_summary(all_runs, tier_label="Tier 2"):
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


def run_and_log():
    repo_root = Path(__file__).resolve().parent
    target_script = repo_root / "models" / "train" / "tier2_trainMetaLearner.py"
    log_dir = repo_root / "logs"
    log_path = log_dir / "tier2_runs.json"
    summary_path = log_dir / "tier2_comparison_summary.txt"
    metadata_dir = repo_root / "models" / "trained" / "tier2"

    log_dir.mkdir(parents=True, exist_ok=True)

    start = time.time()
    proc = subprocess.run(
        ["python", str(target_script)],
        capture_output=True,
        text=True,
    )
    duration = time.time() - start

    models = []
    if metadata_dir.exists():
        for meta_file in metadata_dir.glob("*_metadata.json"):
            try:
                mtime = meta_file.stat().st_mtime
                if mtime >= start - 1:
                    data = json.loads(meta_file.read_text(encoding="utf-8"))
                    models.append(data)
            except Exception:
                continue

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
    log_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")

    summary_text = None
    if proc.returncode == 0 and entry.get("models"):
        # Build and persist comparison summary (does not affect training logic)
        summary_text = _build_comparison_summary(existing, tier_label="Tier 2")
        summary_path.write_text(summary_text, encoding="utf-8")

    # Mirror outputs to console for convenience
    print(proc.stdout, end="")
    if proc.stderr:
        import sys

        print(proc.stderr, end="", file=sys.stderr)

    if proc.returncode != 0:
        raise SystemExit(proc.returncode)

    if summary_text:
        print("\n=== Tier 2 Comparison Summary ===")
        print(summary_text)


if __name__ == "__main__":
    run_and_log()
