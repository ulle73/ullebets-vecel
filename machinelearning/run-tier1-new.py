from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent
TARGET_SCRIPT = REPO_ROOT / "models" / "train" / "tier1_trainRawFeatures-new.py"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "models" / "trained" / "tier1-new"
LOG_SCRIPT = REPO_ROOT / "log-tier1-new.py"


def main():
    parser = argparse.ArgumentParser(description="Run the Tier 1 new prediction trainer and log results")
    parser.add_argument("--limit-combos", type=int)
    parser.add_argument("--combo")
    parser.add_argument("--feature-mode")
    parser.add_argument("--dataset-dir")
    parser.add_argument("--output-dir")
    args = parser.parse_args()

    output_dir = Path(args.output_dir) if args.output_dir else DEFAULT_OUTPUT_DIR

    command = [sys.executable, str(TARGET_SCRIPT)]
    if args.limit_combos:
        command.extend(["--limit-combos", str(args.limit_combos)])
    if args.combo:
        command.extend(["--combo", args.combo])
    if args.feature_mode:
        command.extend(["--feature-mode", args.feature_mode])
    if args.dataset_dir:
        command.extend(["--dataset-dir", args.dataset_dir])
    command.extend(["--output-dir", str(output_dir)])

    proc = subprocess.run(command, capture_output=True, text=True)

    if proc.stdout:
        print(proc.stdout)
    if proc.stderr:
        print(proc.stderr, file=sys.stderr)

    if proc.returncode == 0:
        log_command = [
            sys.executable,
            str(LOG_SCRIPT),
            "--metadata-dir",
            str(output_dir),
        ]
        log_proc = subprocess.run(log_command, capture_output=True, text=True)
        if log_proc.stdout:
            print(log_proc.stdout)
        if log_proc.stderr:
            print(log_proc.stderr, file=sys.stderr)
        if log_proc.returncode != 0:
            sys.exit(log_proc.returncode)

    sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
