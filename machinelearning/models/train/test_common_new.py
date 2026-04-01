import importlib.util
import pathlib
import unittest


def _load_common_new():
    module_path = pathlib.Path(__file__).with_name("common-new.py")
    spec = importlib.util.spec_from_file_location("common_new", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class CommonNewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.common = _load_common_new()

    def test_walk_forward_slices_are_time_ordered_and_non_overlapping(self):
        samples = [{"metadata": {"date": f"2025-01-{day:02d}T00:00:00.000Z"}} for day in range(1, 13)]

        folds = self.common.build_walk_forward_slices(samples, min_train_size=4, min_val_size=2, max_folds=3)

        self.assertGreaterEqual(len(folds), 2)
        for fold in folds:
          self.assertLess(fold["train_end"], fold["val_start"])
          self.assertLessEqual(fold["val_start"], fold["val_end"])
          self.assertGreaterEqual(fold["train_size"], 4)
          self.assertGreaterEqual(fold["val_size"], 2)

    def test_rank_candidate_records_prefers_lower_mae_then_lower_rmse(self):
        ranked = self.common.rank_candidate_records(
            [
                {
                    "label": "a",
                    "aggregate": {
                        "median_mae": 1.20,
                        "median_rmse": 2.00,
                        "median_r2": 0.20,
                        "stability_penalty": 0.10,
                    },
                },
                {
                    "label": "b",
                    "aggregate": {
                        "median_mae": 1.20,
                        "median_rmse": 1.90,
                        "median_r2": 0.10,
                        "stability_penalty": 0.20,
                    },
                },
                {
                    "label": "c",
                    "aggregate": {
                        "median_mae": 1.10,
                        "median_rmse": 2.50,
                        "median_r2": 0.30,
                        "stability_penalty": 0.05,
                    },
                },
            ]
        )

        self.assertEqual(ranked[0]["label"], "c")
        self.assertEqual(ranked[1]["label"], "b")
        self.assertEqual(ranked[2]["label"], "a")

    def test_compute_summary_metrics_handles_directional_line_accuracy(self):
        metrics = self.common.compute_summary_metrics(
            targets=[3.0, 5.0, 7.0],
            predictions=[2.8, 5.2, 6.0],
            lines=[2.5, 5.5, 6.5],
        )

        self.assertIn("mae", metrics)
        self.assertIn("rmse", metrics)
        self.assertIn("r2", metrics)
        self.assertIn("line_direction_accuracy", metrics)
        self.assertAlmostEqual(metrics["line_direction_accuracy"], 2 / 3, places=6)


if __name__ == "__main__":
    unittest.main()
