from __future__ import annotations

import argparse
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent
LOG_MODULE_PATH = REPO_ROOT / "models" / "train" / "tier1_log_new.py"
DEFAULT_RUNS_PATH = REPO_ROOT / "logs" / "tier1_runs_new.json"


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path):
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return data if isinstance(data, list) else []


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def collect_metadata(metadata_dir: Path):
    metadata_dir = Path(metadata_dir)
    if not metadata_dir.exists():
        return []
    models = []
    for file_path in sorted(metadata_dir.glob("*_raw_new_metadata.json")):
        try:
            models.append(json.loads(file_path.read_text(encoding="utf-8")))
        except Exception:
            continue
    return models


def load_log_module():
    spec = importlib.util.spec_from_file_location("tier1_log_new", LOG_MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def append_run_entry(metadata_dir: Path, runs_path: Path):
    models = collect_metadata(metadata_dir)
    entry = {
        "timestamp": iso_now(),
        "script": "machinelearning/log-tier1-new.py",
        "metadata_dir": str(metadata_dir),
        "returncode": 0,
        "duration_seconds": 0.0,
        "stdout": "",
        "stderr": "",
        "trained_count": sum(1 for model in models if model.get("status") == "trained"),
        "skipped_count": sum(1 for model in models if model.get("status") == "skipped"),
        "models": models,
    }
    payload = load_json(runs_path)
    payload.append(entry)
    write_json(runs_path, payload)
    return entry


def main():
    parser = argparse.ArgumentParser(description="Rebuild Tier 1 new comparison and go-live logs")
    parser.add_argument("--metadata-dir", "--output-dir", dest="metadata_dir")
    parser.add_argument("--runs-path", default=str(DEFAULT_RUNS_PATH))
    parser.add_argument("--summary-path")
    parser.add_argument("--gate-summary-path")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    runs_path = Path(args.runs_path)
    metadata_dir = Path(args.metadata_dir) if args.metadata_dir else None
    if metadata_dir:
        append_run_entry(metadata_dir, runs_path)

    module = load_log_module()
    kwargs = {"runs_path": runs_path}
    if args.summary_path:
        kwargs["summary_path"] = Path(args.summary_path)
    if args.gate_summary_path:
        kwargs["gate_summary_path"] = Path(args.gate_summary_path)

    result = module.write_tier1_logs_new(**kwargs)

    if not args.quiet:
        print("=== Tier 1 New Comparison Summary ===")
        print(result["summary"])
        print("\n=== Tier 1 New Go-Live Gate Summary ===")
        print(result["gate_summary"])


if __name__ == "__main__":
    main()
