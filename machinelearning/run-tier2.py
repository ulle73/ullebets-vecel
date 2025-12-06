import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def run_and_log():
    repo_root = Path(__file__).resolve().parent
    target_script = repo_root / "models" / "train" / "tier2_trainMetaLearner.py"
    log_dir = repo_root / "logs"
    log_path = log_dir / "tier2_runs.json"
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

    # Mirror outputs to console for convenience
    print(proc.stdout, end="")
    if proc.stderr:
        import sys

        print(proc.stderr, end="", file=sys.stderr)

    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


if __name__ == "__main__":
    run_and_log()
