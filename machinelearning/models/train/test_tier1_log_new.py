from __future__ import annotations

import importlib.util
import json
import pathlib
import tempfile
import unittest


def _load_log_new():
    module_path = pathlib.Path(__file__).with_name("tier1_log_new.py")
    spec = importlib.util.spec_from_file_location("tier1_log_new", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class Tier1LogNewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.log_new = _load_log_new()

    def test_build_comparison_summary_uses_latest_run_and_previous_baseline(self):
        runs = [
            {
                "timestamp": "2026-03-31T10:00:00Z",
                "models": [
                    {
                        "stat_key": "shotsOnGoal",
                        "scope": "home",
                        "period": "ALL",
                        "selection_metrics": {"median_r2": 0.12, "median_mae": 1.5},
                    }
                ],
            },
            {
                "timestamp": "2026-04-01T10:00:00Z",
                "models": [
                    {
                        "stat_key": "shotsOnGoal",
                        "scope": "home",
                        "period": "ALL",
                        "selection_metrics": {"median_r2": 0.18, "median_mae": 1.2},
                    }
                ],
            },
        ]

        summary = self.log_new.build_comparison_summary_new(runs)

        self.assertIn("All Tier 1 New Models", summary)
        self.assertIn("shotsOnGoal_home_ALL", summary)
        self.assertIn("0.120", summary)
        self.assertIn("0.180", summary)

    def test_write_tier1_logs_new_writes_summary_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            runs_path = tmp_path / "tier1_runs_new.json"
            summary_path = tmp_path / "tier1_comparison_summary_new.txt"
            gate_path = tmp_path / "tier1_go_live_summary_new.txt"

            runs_path.write_text(
                json.dumps(
                    [
                        {
                            "timestamp": "2026-04-01T10:00:00Z",
                            "models": [
                                {
                                    "stat_key": "shotsOnGoal",
                                    "scope": "home",
                                    "period": "ALL",
                                    "selection_metrics": {"median_r2": 0.18, "median_mae": 1.2},
                                    "test_metrics": {"r2": 0.15, "mae": 1.1},
                                }
                            ],
                        }
                    ],
                    indent=2,
                ),
                encoding="utf-8",
            )

            result = self.log_new.write_tier1_logs_new(
                runs_path=runs_path,
                summary_path=summary_path,
                gate_summary_path=gate_path,
            )

            self.assertTrue(summary_path.exists())
            self.assertTrue(gate_path.exists())
            self.assertIn("shotsOnGoal_home_ALL", summary_path.read_text(encoding="utf-8"))
            self.assertIn("Tier 1 New Go-Live", gate_path.read_text(encoding="utf-8"))
            self.assertEqual(result["latest_run"]["timestamp"], "2026-04-01T10:00:00Z")

    def test_skipped_models_do_not_break_summaries(self):
        runs = [
            {
                "timestamp": "2026-04-01T10:00:00Z",
                "models": [
                    {
                        "combo_key": "cornerKicks_away_1ST",
                        "stat_key": "cornerKicks",
                        "scope": "away",
                        "period": "1ST",
                        "status": "skipped",
                        "reason": "insufficient_dev_samples",
                    }
                ],
            }
        ]

        summary = self.log_new.build_comparison_summary_new(runs)
        gate = self.log_new.build_go_live_summary_new(runs[0]["models"], runs)

        self.assertIn("skipped", summary)
        self.assertIn("skipped", gate)
        self.assertIn("insufficient_dev_samples", summary)
        self.assertIn("insufficient_dev_samples", gate)


if __name__ == "__main__":
    unittest.main()
