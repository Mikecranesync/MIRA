import unittest

from answer_radar.jev_human_readiness import SIGNALS, compare


def row(i, truth, prob):
    return {"case_id": "case", "surface": "hub", "rep": i,
            "human_review": {"labels_locked_before_jev": True,
                             "blind_jev_labels": {s: truth for s in SIGNALS}},
            "jev": {"signals": {s: prob for s in SIGNALS},
                    "latency_ms": 205, "input_tokens": 964}}


class JevComparisonTests(unittest.TestCase):
    def test_separation_reports_auc_not_a_chosen_threshold(self):
        out = compare({"attempts": [row(0, True, .8), row(1, False, .2)]})
        self.assertEqual(out["signals"]["over_specificity"]["auc"], 1.0)
        self.assertEqual(out["jev_input_tokens"]["total"], 1928)
        self.assertNotIn("production_threshold", out)

    def test_missing_blind_label_cannot_be_scored(self):
        bad = row(0, True, .9)
        bad["human_review"]["labels_locked_before_jev"] = False
        out = compare({"attempts": [bad]})
        self.assertEqual(len(out["unlabeled"]), 1)
        self.assertIsNone(out["signals"]["over_specificity"]["auc"])

    def test_skips_and_one_class_do_not_fake_accuracy(self):
        skipped = row(1, False, .1)
        skipped["jev"] = {"skipped_reason": "disabled"}
        out = compare({"attempts": [row(0, True, .9), skipped]})
        self.assertEqual(len(out["jev_skipped"]), 1)
        self.assertIsNone(out["signals"]["over_specificity"]["auc"])


if __name__ == "__main__":
    unittest.main()
