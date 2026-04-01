from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent
TARGET_SCRIPT = REPO_ROOT / "models" / "train" / "tier2_trainMetaLearner-new.py"
OUTPUT_DIR = REPO_ROOT / "models" / "trained" / "tier2-new"
LOG_DIR = REPO_ROOT / "logs"
LOG_PATH = LOG_DIR / "tier2_runs_new.json"
SUMMARY_PATH = LOG_DIR / "tier2_comparison_summary_new.txt"


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def load_json(path):
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def write_log_entry(entry):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    payload = load_json(LOG_PATH)
    payload.append(entry)
    LOG_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def write_summary(entry):
    lines = [
        f"timestamp: {entry['timestamp']}",
        f"returncode: {entry['returncode']}",
        f"duration_seconds: {entry['duration_seconds']:.2f}",
        f"trained: {entry['trained_count']}",
        f"skipped: {entry['skipped_count']}",
        "",
    ]
    for model in entry["models"][:20]:
        if model.get("status") == "trained":
            lines.append(
                f"{model['combo_key']} | {model['selected_feature_mode']} | "
                f"{model['selected_candidate']['label']} | "
                f"mae={model['selection_metrics']['median_mae']:.3f}"
            )
        else:
            lines.append(f"{model['combo_key']} | skipped | {model.get('reason')}")
    SUMMARY_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def collect_metadata():
    if not OUTPUT_DIR.exists():
        return []
    models = []
    for file_path in sorted(OUTPUT_DIR.glob("*_stacked_new_metadata.json")):
        try:
            models.append(json.loads(file_path.read_text(encoding="utf-8")))
        except Exception:
            continue
    return models


def main():
    parser = argparse.ArgumentParser(description="Run the Tier 2 new prediction trainer and log results")
    parser.add_argument("--limit-combos", type=int)
    parser.add_argument("--combo")
    parser.add_argument("--dataset-dir")
    parser.add_argument("--tier1-dir")
    parser.add_argument("--output-dir")
    args = parser.parse_args()

    command = [sys.executable, str(TARGET_SCRIPT)]
    if args.limit_combos:
        command.extend(["--limit-combos", str(args.limit_combos)])
    if args.combo:
        command.extend(["--combo", args.combo])
    if args.dataset_dir:
        command.extend(["--dataset-dir", args.dataset_dir])
    if args.tier1_dir:
        command.extend(["--tier1-dir", args.tier1_dir])
    if args.output_dir:
        command.extend(["--output-dir", args.output_dir])

    start = time.time()
    proc = subprocess.run(command, capture_output=True, text=True)
    duration = time.time() - start
    models = collect_metadata()
    entry = {
        "timestamp": iso_now(),
        "script": str(TARGET_SCRIPT),
        "command": command,
        "returncode": proc.returncode,
        "duration_seconds": duration,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "trained_count": sum(1 for model in models if model.get("status") == "trained"),
        "skipped_count": sum(1 for model in models if model.get("status") == "skipped"),
        "models": models,
    }
    write_log_entry(entry)
    write_summary(entry)

    if proc.stdout:
        print(proc.stdout)
    if proc.stderr:
        print(proc.stderr, file=sys.stderr)
    sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
