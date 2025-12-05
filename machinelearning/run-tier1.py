import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


def iso_now():
    return datetime.now(timezone.utc).isoformat()


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
    "home_1st_for_value",
    "home_1st_for_rank",
    "home_1st_against_value",
    "home_1st_against_rank",
    "away_1st_for_value",
    "away_1st_for_rank",
    "away_1st_against_value",
    "away_1st_against_rank",
    "home_2nd_for_value",
    "home_2nd_for_rank",
    "home_2nd_against_value",
    "home_2nd_against_rank",
    "away_2nd_for_value",
    "away_2nd_for_rank",
    "away_2nd_against_value",
    "away_2nd_against_rank",
    "home_all_for_value",
    "home_all_for_rank",
    "home_all_against_value",
    "home_all_against_rank",
    "away_all_for_value",
    "away_all_for_rank",
    "away_all_against_value",
    "away_all_against_rank",
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
    # Extra team profile features (ALL period)
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
    "home_advantage",
    "league_id",
]


def name_feature_importance(models):
    if not models:
        return models
    named = []
    for model in models:
        fi = model.get("feature_importance")
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
        enriched = {**model, "feature_importance_named": mapped}
        named.append(enriched)
    return named


def run_and_log():
    repo_root = Path(__file__).resolve().parent
    target_script = repo_root / "models" / "train" / "tier1_trainRawFeatures.py"
    log_dir = repo_root / "logs"
    log_path = log_dir / "tier1_runs.json"
    metadata_dir = repo_root / "models" / "trained" / "tier1"

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
