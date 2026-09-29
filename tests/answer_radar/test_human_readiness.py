import copy
import unittest

from human_readiness import DIMENSIONS, score


SHA = "ae03a3877912c7c1242e18fdd84e0dea39df15ab"
MANIFEST = {"version": 1, "cases": [{"id": "one", "surfaces": ["web"],
             "repeats": 1, "critical": True, "latency_class": "answer_only",
             "requires_source_review": True, "required_receipts": ["citation_open"]},
            {"id": "two", "surfaces": ["hub"], "repeats": 1,
             "critical": False, "latency_class": "answer_only",
             "requires_source_review": True}]}


def attempt(cid, surface):
    return {"case_id": cid, "surface": surface, "rep": 0, "build_sha": SHA,
            "trace_id": "trace", "turn_id": "turn", "rendered_answer": "Answer",
            "turn_status": "answered", "hard_blockers": [],
            "scores": {d: 2 for d in DIMENSIONS},
            "score_reasons": {d: "Observed action and answer" for d in DIMENSIONS},
            "action_receipts": {"citation_open": "screen recording at passage"},
            "human_review": {"reviewer": "technician-1", "signed_at": "2026-09-29T01:00:00Z"},
            "source_review": {"passage_bound": True,
                              "independent_providers": ["anthropic", "openai"],
                              "agree_pass": True, "answer_sha256": "a" * 64,
                              "grade_answer_hashes": ["a" * 64, "a" * 64]},
            "jev": {"skipped_reason": "disabled"},
            "latency_ms": {"first_meaningful": 3000, "total": 5000}}


def good():
    return {"build_sha": SHA, "attempts": [attempt("one", "web"), attempt("two", "hub")]}


class HumanReadinessTests(unittest.TestCase):
    def test_complete_signed_run_can_go(self):
        self.assertEqual(score(MANIFEST, good())["decision"], "GO")

    def test_missing_attempt_holds(self):
        run = good()
        run["attempts"].pop()
        report = score(MANIFEST, run)
        self.assertEqual(report["decision"], "HOLD")
        self.assertIn("attempt missing", " ".join(report["reasons"]))

    def test_jev_positive_cannot_override_unsafe_or_missing_source_proof(self):
        run = good()
        run["attempts"][0]["jev"] = {"signals": {"follows_evidence": 0.99}}
        run["attempts"][0]["hard_blockers"] = ["invented machine torque"]
        run["attempts"][0]["source_review"]["passage_bound"] = False
        report = score(MANIFEST, run)
        self.assertEqual(report["decision"], "HOLD")
        self.assertEqual(len(report["hard_blockers"]), 1)
        self.assertIn("passage-bound", " ".join(report["reasons"]))

    def test_mixed_sha_and_missing_receipt_hold(self):
        run = good()
        run["attempts"][0]["build_sha"] = "f" * 40
        run["attempts"][0]["action_receipts"] = {}
        self.assertEqual(score(MANIFEST, run)["decision"], "HOLD")

    def test_stale_grader_hash_or_unrecorded_jev_holds(self):
        run = good()
        run["attempts"][0]["source_review"]["grade_answer_hashes"][1] = "b" * 64
        run["attempts"][0]["jev"] = {}
        report = score(MANIFEST, run)
        self.assertEqual(report["decision"], "HOLD")
        self.assertTrue(any("source review" in r for r in report["reasons"]))
        self.assertTrue(any("Jev verdict" in r for r in report["reasons"]))

    def test_critical_partial_and_latency_tail_hold(self):
        run = good()
        run["attempts"][0]["scores"]["ui"] = 1
        run["attempts"][1]["latency_ms"] = {"first_meaningful": 12000, "total": 30000}
        report = score(MANIFEST, run)
        self.assertEqual(report["decision"], "HOLD")
        self.assertTrue(any("critical flow" in r for r in report["reasons"]))

    def test_duplicate_and_unexpected_attempt_rejected(self):
        run = good()
        run["attempts"].append(copy.deepcopy(run["attempts"][0]))
        with self.assertRaises(ValueError):
            score(MANIFEST, run)


if __name__ == "__main__":
    unittest.main()
