import copy
import unittest

from answer_radar.human_readiness import DIMENSIONS, score
from answer_radar.score import answer_identity


SHA = "ae03a3877912c7c1242e18fdd84e0dea39df15ab"
MANIFEST = {
    "version": 1,
    "cases": [
        {
            "id": "one",
            "question": "Question one",
            "surfaces": ["web"],
            "repeats": 1,
            "critical": True,
            "latency_class": "answer_only",
            "requires_source_review": True,
            "required_receipts": ["citation_open"],
        },
        {
            "id": "two",
            "question": "Question two",
            "surfaces": ["hub"],
            "repeats": 1,
            "critical": False,
            "latency_class": "answer_only",
            "requires_source_review": True,
        },
    ],
}


QUESTIONS = {"one": "Question one", "two": "Question two"}


def grading_row(cid, answer="Answer", passages=()):
    """The row the graders saw, shaped as human_readiness_capture builds it."""
    return {
        "question": {"question_id": cid, "normalized_question": QUESTIONS[cid]},
        "evaluation": {
            "answer_text": answer,
            "citations": [f"doc p.{i + 1}" for i in range(len(passages))],
            "cited_passages": list(passages),
            "source_documents": [],
        },
        "hub": {"turn_status": "answered", "answer_origin": "content_frames"},
    }


def attempt(cid, surface):
    row = grading_row(cid)
    h = answer_identity(row)
    return {
        "case_id": cid,
        "surface": surface,
        "rep": 0,
        "build_sha": SHA,
        "trace_id": "trace",
        "turn_id": "turn",
        "rendered_answer": "Answer",
        "turn_status": "answered",
        "hard_blockers": [],
        "scores": {d: 2 for d in DIMENSIONS},
        "score_reasons": {d: "Observed action and answer" for d in DIMENSIONS},
        "action_receipts": {"citation_open": "screen recording at passage"},
        "human_review": {"reviewer": "technician-1", "signed_at": "2026-09-29T01:00:00Z"},
        "source_review": {
            "passage_bound": True,
            "independent_providers": ["anthropic", "openai"],
            "agree_pass": True,
            "answer_sha256": h,
            "grade_answer_hashes": [h, h],
        },
        "grading_row": row,
        "jev": {"skipped_reason": "disabled"},
        "latency_ms": {"first_meaningful": 3000, "total": 5000},
    }


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

    def _photo_case(self, receipt):
        manifest = copy.deepcopy(MANIFEST)
        manifest["cases"][0]["fixture"] = "photo.jpg"
        manifest["cases"][0]["fixture_sha256"] = "a" * 64
        manifest["cases"][0]["required_receipts"] = ["citation_open", "photo_link"]
        run = good()
        run["attempts"][0]["action_receipts"]["photo_link"] = receipt
        return score(manifest, run)

    def test_photo_receipt_matching_the_pin_can_go(self):
        self.assertEqual(self._photo_case({"sha256": "a" * 64})["decision"], "GO")

    def test_photo_receipt_for_other_bytes_holds(self):
        """#4109 review F5: a different image cannot satisfy a pinned fixture."""
        for receipt in ({"sha256": "b" * 64}, "uploaded", {"sha256": None}, {}):
            with self.subTest(receipt=receipt):
                report = self._photo_case(receipt)
                self.assertEqual(report["decision"], "HOLD")
                self.assertIn("does not match the pinned fixture", " ".join(report["reasons"]))

    def test_unpinned_photo_fixture_cannot_go(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest["cases"][0]["fixture"] = "photo.jpg"
        manifest["cases"][0]["fixture_sha256"] = None
        report = score(manifest, good())
        self.assertEqual(report["decision"], "HOLD")
        self.assertIn("photo fixture hash not pinned", " ".join(report["reasons"]))


if __name__ == "__main__":
    unittest.main()


class ReviewBindingTests(unittest.TestCase):
    """#4109 review F1/F3: grades bind THIS attempt, and observed failures HOLD."""

    def _reasons(self, run):
        report = score(MANIFEST, run)
        return report["decision"], " ".join(report["reasons"] + report.get("hard_blockers", []))

    def test_changing_the_rendered_answer_after_grading_holds(self):
        run = good()
        run["attempts"][1]["rendered_answer"] = "A different, ungraded answer"
        decision, why = self._reasons(run)
        self.assertEqual(decision, "HOLD")
        self.assertIn("not bound to this attempt", why)

    def test_changing_the_passages_after_grading_holds(self):
        run = good()
        run["attempts"][1]["cited_passages"] = [{"quote": "a passage nobody graded"}]
        self.assertEqual(score(MANIFEST, run)["decision"], "HOLD")

    def test_a_grading_row_for_another_question_holds(self):
        run = good()
        row = grading_row("one")  # case "one"'s question under case "two"
        run["attempts"][1]["grading_row"] = row
        h = answer_identity(row)
        run["attempts"][1]["source_review"].update(answer_sha256=h, grade_answer_hashes=[h, h])
        decision, why = self._reasons(run)
        self.assertEqual(decision, "HOLD")
        self.assertIn("graded question differs", why)

    def test_missing_grading_row_holds(self):
        run = good()
        del run["attempts"][1]["grading_row"]
        self.assertEqual(score(MANIFEST, run)["decision"], "HOLD")

    def test_an_error_status_holds_even_with_passing_review(self):
        run = good()
        run["attempts"][1]["turn_status"] = "error"
        decision, why = self._reasons(run)
        self.assertEqual(decision, "HOLD")
        self.assertIn("did not complete", why)

    def test_a_machine_derived_blocker_holds_even_with_an_empty_human_list(self):
        run = good()
        run["attempts"][1]["derived_hard_blockers"] = ["app could not complete the turn"]
        self.assertEqual(score(MANIFEST, run)["decision"], "HOLD")

    def test_a_missing_second_provider_is_not_independence(self):
        run = good()
        run["attempts"][1]["source_review"]["independent_providers"] = ["anthropic", None]
        self.assertEqual(score(MANIFEST, run)["decision"], "HOLD")
