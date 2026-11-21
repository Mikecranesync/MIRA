"""No-network synthetic tests for retrieval-evidence acceptance only.

Run: python3 -m unittest discover -s tools/qa -p test_oem_manual_acceptance.py
Passing these checks does not establish generated-answer quality, safe machine
applicability, or an opened citation. No OEM source text is used in this fixture.
"""

import hashlib
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from oem_manual_acceptance import evaluate_case, evaluate_packet, main


def evidence_case(case_id="changeover", pages=None, **extra):
    return {
        "id": case_id,
        "required_pdf_pages": [7, 8] if pages is None else pages,
        **extra,
    }


def observed(case_id="changeover", pages=None, **extra):
    return {
        "id": case_id,
        "returned_pages": [7, 8] if pages is None else pages,
        "document_isolation": True,
        "foreign_tenant_hits": 0,
        **extra,
    }


class CaseAcceptanceTests(unittest.TestCase):
    def test_any_target_hit_is_not_complete_prerequisite_evidence(self):
        verdict = evaluate_case(evidence_case(), observed(pages=[8]))
        self.assertEqual(verdict["status"], "fail")
        self.assertEqual(verdict["missing_pages"], [7])

    def test_every_required_page_and_isolation_can_pass_retrieval(self):
        verdict = evaluate_case(evidence_case(), observed())
        self.assertEqual(verdict["status"], "pass")
        self.assertEqual(verdict["missing_pages"], [])

    def test_duplicate_returned_pages_do_not_fill_another_required_page(self):
        verdict = evaluate_case(evidence_case(), observed(pages=[8, 8, 8]))
        self.assertEqual(verdict["status"], "fail")
        self.assertEqual(verdict["missing_pages"], [7])

    def test_no_page_match_reports_all_missing_pages(self):
        verdict = evaluate_case(evidence_case(), observed(pages=[20, 21]))
        self.assertEqual(verdict["status"], "fail")
        self.assertEqual(verdict["missing_pages"], [7, 8])

    def test_extra_returned_pages_do_not_fail_complete_scoped_evidence(self):
        self.assertEqual(
            evaluate_case(evidence_case(), observed(pages=[9, 8, 7]))["status"],
            "pass",
        )

    def test_empty_targets_do_not_pass_identity_or_safety_vacuously(self):
        for category in ("identity", "unsupported", "safety"):
            with self.subTest(category=category):
                verdict = evaluate_case(evidence_case(pages=[], category=category), observed())
                self.assertEqual(verdict["status"], "inconclusive")

    def test_matrix_page_hit_requires_verified_relationships(self):
        case = evidence_case(source_relationships_required=True)
        for extra in (
            {},
            {"source_relationships_verified": False},
            {"source_relationships_verified": "true"},
        ):
            with self.subTest(extra=extra):
                verdict = evaluate_case(case, observed(**extra))
                self.assertEqual(verdict["status"], "inconclusive")

    def test_matrix_relationships_explicitly_verified_can_pass(self):
        verdict = evaluate_case(
            evidence_case(source_relationships_required=True),
            observed(source_relationships_verified=True),
        )
        self.assertEqual(verdict["status"], "pass")

    def test_relationship_verification_does_not_replace_missing_page(self):
        verdict = evaluate_case(
            evidence_case(source_relationships_required=True),
            observed(pages=[8], source_relationships_verified=True),
        )
        self.assertEqual(verdict["status"], "fail")
        self.assertEqual(verdict["missing_pages"], [7])

    def test_document_leak_fails_even_with_all_pages(self):
        verdict = evaluate_case(evidence_case(), observed(document_isolation=False))
        self.assertEqual(verdict["status"], "fail")

    def test_foreign_tenant_hit_fails_even_with_all_pages(self):
        verdict = evaluate_case(evidence_case(), observed(foreign_tenant_hits=1))
        self.assertEqual(verdict["status"], "fail")

    def test_missing_isolation_observation_is_inconclusive(self):
        for field in ("document_isolation", "foreign_tenant_hits"):
            with self.subTest(field=field):
                result = observed()
                del result[field]
                self.assertEqual(evaluate_case(evidence_case(), result)["status"], "inconclusive")

    def test_blocked_ingestion_does_not_claim_retrieval_failure_or_success(self):
        verdict = evaluate_case(
            evidence_case(),
            {"id": "changeover", "status": "blocked_by_ingest_failure"},
        )
        self.assertEqual(verdict["status"], "inconclusive")

    def test_page_hit_without_required_span_fails(self):
        requirement = {"page": 7, "text": "Confirm fixture compatibility"}
        verdict = evaluate_case(
            evidence_case(required_evidence=[requirement]),
            observed(chunks=[{"sourcePage": 7, "content": "Mounting steps follow."}]),
        )
        self.assertEqual(verdict["status"], "fail")
        self.assertEqual(verdict["missing_evidence"], [requirement])

    def test_required_span_normalizes_case_and_whitespace(self):
        verdict = evaluate_case(
            evidence_case(required_evidence=[{"page": 7, "text": "Confirm fixture compatibility"}]),
            observed(
                chunks=[
                    {
                        "sourcePage": 7,
                        "content": "First CONFIRM\n  FIXTURE\tcompatibility before proceeding.",
                    }
                ]
            ),
        )
        self.assertEqual(verdict["status"], "pass")
        self.assertEqual(verdict["missing_evidence"], [])

    def test_required_span_on_wrong_page_cannot_pass(self):
        requirement = {"page": 7, "text": "Confirm fixture compatibility"}
        verdict = evaluate_case(
            evidence_case(required_evidence=[requirement]),
            observed(chunks=[{"sourcePage": 8, "content": requirement["text"]}]),
        )
        self.assertEqual(verdict["status"], "fail")
        self.assertEqual(verdict["missing_evidence"], [requirement])

    def test_required_span_cannot_be_assembled_across_chunks(self):
        requirement = {"page": 7, "text": "Confirm fixture compatibility"}
        verdict = evaluate_case(
            evidence_case(required_evidence=[requirement]),
            observed(
                chunks=[
                    {"sourcePage": 7, "content": "Confirm fixture"},
                    {"sourcePage": 7, "content": "compatibility"},
                ]
            ),
        )
        self.assertEqual(verdict["status"], "fail")
        self.assertEqual(verdict["missing_evidence"], [requirement])

    def test_all_required_spans_must_be_present(self):
        first = {"page": 7, "text": "Confirm fixture compatibility"}
        second = {"page": 8, "text": "Confirm authorized clearance"}
        verdict = evaluate_case(
            evidence_case(required_evidence=[first, second]),
            observed(chunks=[{"sourcePage": 7, "content": first["text"]}]),
        )
        self.assertEqual(verdict["status"], "fail")
        self.assertEqual(verdict["missing_evidence"], [second])

    def test_explicit_corpus_mismatch_fails_despite_matching_case_id(self):
        verdict = evaluate_case(
            evidence_case(corpus_id="selected-machine-manual"),
            observed(corpus_id="other-machine-manual"),
        )
        self.assertEqual(verdict["status"], "fail")

    def test_explicit_matching_corpus_preserves_evidence_pass(self):
        verdict = evaluate_case(
            evidence_case(corpus_id="selected-machine-manual"),
            observed(corpus_id="selected-machine-manual"),
        )
        self.assertEqual(verdict["status"], "pass")

    def test_page_list_cannot_override_contradictory_provided_chunks(self):
        verdict = evaluate_case(
            evidence_case(pages=[7]),
            observed(
                pages=[7],
                chunks=[{"sourcePage": 8, "content": "A different source page."}],
            ),
        )
        self.assertEqual(verdict["status"], "fail")

    def test_page_only_observation_without_optional_chunks_or_corpus_can_pass(self):
        verdict = evaluate_case(evidence_case(pages=[7]), observed(pages=[7]))
        self.assertEqual(verdict["status"], "pass")


class PacketAcceptanceTests(unittest.TestCase):
    def test_complete_packet_passes_and_counts_all_cases(self):
        verdict = evaluate_packet([evidence_case()], [observed()])
        self.assertEqual(verdict["status"], "pass")
        self.assertEqual(len(verdict["cases"]), 1)
        self.assertEqual(verdict["counts"], {"pass": 1, "fail": 0, "inconclusive": 0})

    def test_failed_case_fails_packet(self):
        verdict = evaluate_packet([evidence_case()], [observed(pages=[8])])
        self.assertEqual(verdict["status"], "fail")
        self.assertEqual(verdict["counts"]["fail"], 1)

    def test_inconclusive_case_does_not_pass_packet(self):
        verdict = evaluate_packet([evidence_case(pages=[])], [observed()])
        self.assertEqual(verdict["status"], "inconclusive")
        self.assertEqual(verdict["counts"]["inconclusive"], 1)

    def test_missing_result_is_not_silently_excluded(self):
        verdict = evaluate_packet([evidence_case(), evidence_case("missing")], [observed()])
        self.assertIn(verdict["status"], ("fail", "inconclusive"))
        self.assertEqual(len(verdict["cases"]), 2)

    def test_duplicate_result_ids_cannot_pass(self):
        verdict = evaluate_packet([evidence_case()], [observed(), observed()])
        self.assertIn(verdict["status"], ("fail", "inconclusive"))

    def test_duplicate_case_ids_cannot_pass(self):
        verdict = evaluate_packet([evidence_case(), evidence_case()], [observed()])
        self.assertIn(verdict["status"], ("fail", "inconclusive"))

    def test_unexpected_result_id_cannot_pass(self):
        verdict = evaluate_packet([evidence_case()], [observed(), observed("unknown")])
        self.assertIn(verdict["status"], ("fail", "inconclusive"))

    def test_empty_packet_cannot_pass(self):
        verdict = evaluate_packet([], [])
        self.assertIn(verdict["status"], ("fail", "inconclusive"))


class CliEnvelopeTests(unittest.TestCase):
    def _run(self, results):
        with tempfile.TemporaryDirectory() as directory:
            cases_path = Path(directory) / "cases.json"
            results_path = Path(directory) / "results.json"
            cases_path.write_text(json.dumps([evidence_case()]), encoding="utf-8")
            results_path.write_text(json.dumps(results), encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                exit_code = main(
                    [
                        "--cases",
                        str(cases_path),
                        "--results",
                        str(results_path),
                    ]
                )
            return exit_code, json.loads(output.getvalue())

    def test_failed_run_envelope_cannot_pass_with_stale_passing_cases(self):
        exit_code, verdict = self._run(
            {
                "status": "failed",
                "error": "run aborted; observations stale",
                "cases": [observed()],
            }
        )
        self.assertNotEqual(exit_code, 0)
        self.assertIn(verdict["status"], ("fail", "inconclusive"))

    def test_baseline_envelope_without_status_remains_supported(self):
        exit_code, verdict = self._run(
            {
                "scope": "Local no-spend retrieval recording",
                "paid_calls": 0,
                "cases": [observed()],
            }
        )
        self.assertEqual(exit_code, 0)
        self.assertEqual(verdict["status"], "pass")


class ChunkHashAcceptanceTests(unittest.TestCase):
    @staticmethod
    def _hash(content):
        normalized = " ".join(content.casefold().split())
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def test_matching_chunk_digest_on_required_page_passes(self):
        content = "Confirm synthetic fixture compatibility."
        verdict = evaluate_case(
            evidence_case(
                pages=[7],
                required_chunk_hashes=[{"page": 7, "sha256": self._hash(content)}],
            ),
            observed(pages=[7], chunks=[{"sourcePage": 7, "content": content}]),
        )
        self.assertEqual(verdict["status"], "pass")

    def test_chunk_digest_normalizes_case_and_whitespace(self):
        digest = self._hash("Confirm synthetic fixture compatibility.")
        verdict = evaluate_case(
            evidence_case(pages=[7], required_chunk_hashes=[{"page": 7, "sha256": digest}]),
            observed(
                pages=[7],
                chunks=[
                    {
                        "sourcePage": 7,
                        "content": "  CONFIRM\nsynthetic\tfixture   COMPATIBILITY.  ",
                    }
                ],
            ),
        )
        self.assertEqual(verdict["status"], "pass")

    def test_matching_digest_on_wrong_page_fails(self):
        content = "Confirm synthetic fixture compatibility."
        verdict = evaluate_case(
            evidence_case(required_chunk_hashes=[{"page": 7, "sha256": self._hash(content)}]),
            observed(
                chunks=[
                    {"sourcePage": 7, "content": "Different synthetic observation."},
                    {"sourcePage": 8, "content": content},
                ]
            ),
        )
        self.assertEqual(verdict["status"], "fail")

    def test_different_chunk_digest_on_correct_page_fails(self):
        verdict = evaluate_case(
            evidence_case(
                pages=[7],
                required_chunk_hashes=[
                    {
                        "page": 7,
                        "sha256": self._hash("Confirm synthetic fixture compatibility."),
                    }
                ],
            ),
            observed(
                pages=[7],
                chunks=[{"sourcePage": 7, "content": "Different synthetic observation."}],
            ),
        )
        self.assertEqual(verdict["status"], "fail")

    def test_required_chunk_digest_without_chunks_fails(self):
        verdict = evaluate_case(
            evidence_case(
                pages=[7],
                required_chunk_hashes=[
                    {
                        "page": 7,
                        "sha256": self._hash("Confirm synthetic fixture compatibility."),
                    }
                ],
            ),
            observed(pages=[7]),
        )
        self.assertEqual(verdict["status"], "fail")

    def test_malformed_chunk_digest_is_invalid(self):
        for digest in ("not-a-sha256", "a" * 63, "g" * 64, None):
            with self.subTest(digest=digest):
                verdict = evaluate_case(
                    evidence_case(
                        pages=[7],
                        required_chunk_hashes=[{"page": 7, "sha256": digest}],
                    ),
                    observed(
                        pages=[7],
                        chunks=[{"sourcePage": 7, "content": "Synthetic observation."}],
                    ),
                )
                self.assertEqual(verdict["status"], "fail")


if __name__ == "__main__":
    unittest.main()
