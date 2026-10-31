import unittest

from answer_radar.jev_human_readiness import SIGNALS, compare


def row(i, truth, prob):
    return {
        "case_id": "case",
        "surface": "hub",
        "rep": i,
        "human_review": {
            "labels_locked_before_jev": True,
            "blind_jev_labels": {s: truth for s in SIGNALS},
            "blind_jev_failure_class": "overreach" if truth else "none",
        },
        "jev": {
            "signals": {s: prob for s in SIGNALS},
            "failure_class": "overreach" if truth else "none",
            "latency_ms": 205,
            "input_tokens": 964,
        },
    }


class JevComparisonTests(unittest.TestCase):
    def test_separation_reports_auc_not_a_chosen_threshold(self):
        out = compare({"attempts": [row(0, True, 0.8), row(1, False, 0.2)]})
        self.assertEqual(out["signals"]["over_specificity"]["auc"], 1.0)
        self.assertEqual(out["jev_input_tokens"]["total"], 1928)
        self.assertEqual(out["failure_class"]["accuracy"], 1.0)
        self.assertNotIn("production_threshold", out)

    def test_missing_blind_label_cannot_be_scored(self):
        bad = row(0, True, 0.9)
        bad["human_review"]["labels_locked_before_jev"] = False
        out = compare({"attempts": [bad]})
        self.assertEqual(len(out["unlabeled"]), 1)
        self.assertIsNone(out["signals"]["over_specificity"]["auc"])

    def test_skips_and_one_class_do_not_fake_accuracy(self):
        skipped = row(1, False, 0.1)
        skipped["jev"] = {"skipped_reason": "disabled"}
        out = compare({"attempts": [row(0, True, 0.9), skipped]})
        self.assertEqual(len(out["jev_skipped"]), 1)
        self.assertIsNone(out["signals"]["over_specificity"]["auc"])

    def test_correct_refusal_called_missing_evidence_is_class_error(self):
        refusal = row(0, False, 0.1)
        refusal["jev"]["failure_class"] = "missing_evidence"
        out = compare({"attempts": [refusal]})
        self.assertEqual(out["failure_class"]["accuracy"], 0.0)
        self.assertEqual(out["failure_class"]["confusion"][0]["truth"], "none")


if __name__ == "__main__":
    unittest.main()
