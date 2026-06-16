"""Tests for cp_citation_groundedness — reward-hacking guard (#228).

Ensures numeric specs cited in responses (Hz, V, A, rpm, etc.) actually
appear in retrieved chunks. Blocks the fabricated-parameter failure mode.
"""
from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
# mira-bots/ on path so the shared relevance helper imports (else the P0-3
# vendor-relevance checkpoint fail-opens and the lie-tests would falsely pass).
_MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(_MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(_MIRA_BOTS))

from shared.citation_compliance import evaluate_citation_relevance  # noqa: E402
from tests.eval.grader import (  # noqa: E402
    cp_citation_groundedness,
    cp_citation_vendor_relevance,
    grade_scenario,
)


# ── cp_citation_groundedness tests ─────────────────────────────────────────


class TestCitationGroundedness:

    def test_no_citations_passes(self):
        """Response without numeric specs always passes."""
        result = cp_citation_groundedness(
            fixture={"id": "t"},
            last_response="Check the motor for binding",
            retrieved_chunks=[],
        )
        assert result.passed is True
        assert "No numeric specs" in result.reason

    def test_citation_matches_chunk_passes(self):
        """Cited spec that appears in retrieved chunks passes."""
        result = cp_citation_groundedness(
            fixture={"id": "t"},
            last_response="Set the parameter to 60Hz for 4-pole motors",
            retrieved_chunks=["Parameter F2-01 sets line frequency to 60Hz or 50Hz"],
        )
        assert result.passed is True

    def test_citation_no_chunk_fails(self):
        """Cited spec with empty chunks is ungrounded."""
        result = cp_citation_groundedness(
            fixture={"id": "t"},
            last_response="Set to 60Hz",
            retrieved_chunks=[],
        )
        assert result.passed is False
        assert "no KB chunks retrieved" in result.reason

    def test_citation_missing_from_chunks_fails(self):
        """Cited spec not present in any chunk fails."""
        result = cp_citation_groundedness(
            fixture={"id": "t"},
            last_response="Set the parameter to 73.5Hz",
            retrieved_chunks=["Default line frequency is 60Hz"],
        )
        assert result.passed is False
        assert "73.5Hz" in result.reason

    def test_multiple_citations_all_must_match(self):
        """Mix of grounded and ungrounded citations fails."""
        result = cp_citation_groundedness(
            fixture={"id": "t"},
            last_response="Use 60Hz and set current limit to 12.5A",
            retrieved_chunks=["Line frequency is 60Hz"],  # missing 12.5A
        )
        assert result.passed is False
        assert "12.5A" in result.reason

    def test_voltage_units(self):
        result = cp_citation_groundedness(
            fixture={"id": "t"},
            last_response="Supply voltage should be 480V",
            retrieved_chunks=["Rated input 480V three-phase"],
        )
        assert result.passed is True

    def test_space_between_number_and_unit(self):
        """'60 Hz' with space should match '60Hz' in chunk."""
        result = cp_citation_groundedness(
            fixture={"id": "t"},
            last_response="Set to 60 Hz",
            retrieved_chunks=["Default is 60Hz per nameplate"],
        )
        assert result.passed is True

    def test_chunk_has_space_response_does_not(self):
        """'60Hz' in response should match '60 Hz' in chunk."""
        result = cp_citation_groundedness(
            fixture={"id": "t"},
            last_response="Set to 60Hz",
            retrieved_chunks=["Set the value to 60 Hz"],
        )
        assert result.passed is True

    def test_rpm_and_temperature(self):
        result = cp_citation_groundedness(
            fixture={"id": "t"},
            last_response="Motor runs at 1800 rpm, ambient should be under 40°C",
            retrieved_chunks=["Nameplate: 1800rpm at 60Hz", "Max ambient 40°C"],
        )
        assert result.passed is True

    def test_none_chunks_skips_check(self):
        """retrieved_chunks=None skips the check (backward-compat)."""
        result = cp_citation_groundedness(
            fixture={"id": "t"},
            last_response="Set to 60Hz",  # Would fail if chunks=[]
            retrieved_chunks=None,
        )
        assert result.passed is True
        assert "skipped" in result.reason

    def test_fixture_opt_out_flag(self):
        """Fixture with skip_citation_check=True always passes."""
        result = cp_citation_groundedness(
            fixture={"id": "t", "skip_citation_check": True},
            last_response="Set to 60Hz",
            retrieved_chunks=[],
        )
        assert result.passed is True
        assert "fixture flag" in result.reason

    def test_case_insensitive(self):
        result = cp_citation_groundedness(
            fixture={"id": "t"},
            last_response="Set to 60HZ",  # uppercase
            retrieved_chunks=["Default is 60hz per spec"],  # lowercase
        )
        # Both should canonicalize to lowercase during comparison
        assert result.passed is True


# ── grade_scenario integration ─────────────────────────────────────────────


class TestGradeScenarioIntegration:

    def test_grade_scenario_includes_citation_check(self):
        """grade_scenario returns 7 checkpoints (incl. vendor relevance, P0-3)."""
        fixture = {
            "id": "test_sc",
            "expected_final_state": "Q1",
            "max_turns": 3,
            "expected_keywords": [],
        }
        grade = grade_scenario(
            fixture=fixture,
            final_fsm_state="Q1",
            responses=["short response"],
            latencies_ms=[200],
            http_statuses=[200],
            user_turn_count=1,
        )
        checkpoint_names = [c.name for c in grade.checkpoints]
        assert "cp_citation_groundedness" in checkpoint_names
        assert "cp_citation_vendor_relevance" in checkpoint_names
        assert len(grade.checkpoints) == 7

    def test_grade_scenario_backward_compat_no_chunks(self):
        """Without retrieved_chunks, citation check passes (legacy callers)."""
        fixture = {
            "id": "test_sc",
            "expected_final_state": "Q1",
            "max_turns": 3,
            "expected_keywords": [],
        }
        grade = grade_scenario(
            fixture=fixture,
            final_fsm_state="Q1",
            responses=["Set parameter to 60Hz"],  # would fail if checked
            latencies_ms=[200],
            http_statuses=[200],
            user_turn_count=1,
        )
        cp = next(c for c in grade.checkpoints if c.name == "cp_citation_groundedness")
        assert cp.passed is True
        assert "skipped" in cp.reason

    def test_grade_scenario_fails_ungrounded_citation(self):
        """With retrieved_chunks provided, ungrounded citation fails."""
        fixture = {
            "id": "test_sc",
            "expected_final_state": "Q1",
            "max_turns": 3,
            "expected_keywords": [],
        }
        grade = grade_scenario(
            fixture=fixture,
            final_fsm_state="Q1",
            responses=["Set parameter to 60Hz"],
            latencies_ms=[200],
            http_statuses=[200],
            user_turn_count=1,
            retrieved_chunks=["No mention of Hz at all"],
        )
        cp = next(c for c in grade.checkpoints if c.name == "cp_citation_groundedness")
        assert cp.passed is False


# ── P0-3: citation vendor relevance (alias-aware, fail-open) ─────────────────


class TestCitationVendorRelevance:
    """evaluate_citation_relevance — the 'stop the lie' core (beta P0-3)."""

    def test_wrong_vendor_is_caught(self):
        # The plan's canonical lie: Siemens cited on a Danfoss question.
        reply = "Check alarm A17. [Source: Siemens SINAMICS G120 — Faults]"
        rel = evaluate_citation_relevance(reply, "Danfoss")
        assert rel["relevant"] is False
        assert rel["expected_vendor"] == "Danfoss"
        assert "Siemens" in rel["cited_vendors"]
        assert rel["conflicting_tags"]

    def test_matching_vendor_is_relevant(self):
        reply = "Set P1-01. [Source: Danfoss VLT FC 302 — Parameters]"
        rel = evaluate_citation_relevance(reply, "Danfoss")
        assert rel["relevant"] is True

    def test_alias_match_not_suppressed(self):
        # Allen-Bradley / PowerFlex both canonicalize to Rockwell — must NOT flag.
        reply = "Clear F004. [Source: Allen-Bradley PowerFlex 525 — Ch.5]"
        rel = evaluate_citation_relevance(reply, "Rockwell Automation")
        assert rel["relevant"] is True

    def test_correct_citation_alongside_wrong_is_not_a_miss(self):
        # Conservative: a correct citation present means no miss, even if a
        # second tag names another vendor.
        reply = (
            "Do X. [Source: Danfoss VLT FC 302 — A] and [Source: Siemens G120 — B]"
        )
        rel = evaluate_citation_relevance(reply, "Danfoss")
        assert rel["relevant"] is True

    def test_unknown_expected_vendor_fails_open(self):
        reply = "Do X. [Source: Siemens SINAMICS — A]"
        rel = evaluate_citation_relevance(reply, "Acme Nonexistent Corp")
        assert rel["relevant"] is True  # can't judge → don't suppress

    def test_no_recognized_citation_fails_open(self):
        reply = "Do X. [Source: Generic Field Manual — A]"
        rel = evaluate_citation_relevance(reply, "Danfoss")
        assert rel["relevant"] is True


class TestCheckpointVendorRelevance:
    """cp_citation_vendor_relevance grader checkpoint (P0-3)."""

    def test_checkpoint_fails_on_wrong_vendor(self):
        fixture = {"id": "t", "expected_vendor": "Danfoss"}
        cp = cp_citation_vendor_relevance(
            fixture, "Alarm A17. [Source: Siemens SINAMICS G120 — Faults]"
        )
        assert cp.passed is False

    def test_checkpoint_passes_on_right_vendor(self):
        fixture = {"id": "t", "expected_vendor": "Danfoss"}
        cp = cp_citation_vendor_relevance(
            fixture, "Set P1-01. [Source: Danfoss VLT FC 302 — Parameters]"
        )
        assert cp.passed is True

    def test_checkpoint_no_expected_vendor_passes(self):
        cp = cp_citation_vendor_relevance({"id": "t"}, "anything")
        assert cp.passed is True
