"""Tests for wiring_profile.ask — Q&A over MachineWiringProfile.

Suites: (1) Approval enforcement, (4) False-positive, (5) Citation.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from shared.wiring_profile import answer_wiring_question, profile_from_rows


@pytest.fixture
def fixture_path():
    """Path to the synthetic machine fixture."""
    return Path(__file__).parent / "fixtures" / "wiring_profile" / "synthetic_machine.json"


@pytest.fixture
def all_rows(fixture_path):
    """Load all rows from the fixture."""
    with open(fixture_path, encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture
def profile(all_rows):
    """Build a MachineWiringProfile from all fixture rows."""
    return profile_from_rows(all_rows, asset="gs10-eval")


class TestApprovalEnforcementAsk:
    """Suite 1: Asking about proposed-only rows REFUSES; trusted answers have citations."""

    def test_ask_about_proposed_only_wire_refuses(self, profile):
        """W900 is proposed-only; a question about it REFUSES."""
        result = answer_wiring_question(profile, "Where does wire W900 land?")

        assert result.matched is False
        assert result.matched_kind == "wire"
        assert result.answer_source == "none"
        assert result.trusted_evidence is False
        assert result.citations == []
        # Message should explain it's unverified
        assert (
            "PROPOSED" in result.answer
            or "unverified" in result.answer
            or "approved" in result.answer
        )

    def test_ask_about_approved_wire_answers(self, profile):
        """W200 is approved; a question about it ANSWERS."""
        result = answer_wiring_question(profile, "Where does wire W200 land?")

        assert result.matched is True
        assert result.matched_kind == "wire"
        assert result.answer_source == "wiring_connections"
        assert result.trusted_evidence is True
        assert len(result.citations) >= 1
        assert "PLC1.I-00" in result.answer or "PS1.OUT" in result.answer

    def test_answer_must_have_citations_when_matched(self, profile):
        """Every matched answer has >=1 citation."""
        result = answer_wiring_question(profile, "What lands on terminal I-00?")

        if result.matched is True:
            assert len(result.citations) >= 1


class TestCitation:
    """Suite 5: Citation structure + trusted_evidence contract."""

    def test_citation_has_required_fields(self, profile):
        """Every citation carries drawing_reference, source, approval_state, excerpt."""
        result = answer_wiring_question(profile, "Where does W200 land?")

        assert result.matched is True
        for citation in result.citations:
            assert "drawing_reference" in citation
            assert "source" in citation
            assert "approval_state" in citation
            assert "excerpt" in citation

    def test_citation_approval_state_is_verified(self, profile):
        """All citations are from verified rows."""
        result = answer_wiring_question(profile, "Where does W200 land?")

        assert result.matched is True
        for citation in result.citations:
            assert citation["approval_state"] == "verified"

    def test_citation_excerpt_shows_connection(self, profile):
        """Citation excerpt shows from -> to."""
        result = answer_wiring_question(profile, "Where does W200 land?")

        assert result.matched is True
        excerpts = [c["excerpt"] for c in result.citations]
        excerpt_text = " ".join(excerpts).lower()
        # Should mention source and dest
        assert "i-00" in excerpt_text or "out" in excerpt_text

    def test_refusal_has_no_citations(self, profile):
        """Refusing an answer carries empty citations."""
        result = answer_wiring_question(profile, "Where does W900 land?")

        assert result.matched is False
        assert result.citations == []

    def test_no_record_has_no_citations(self, profile):
        """ "No record" answers carry empty citations."""
        result = answer_wiring_question(profile, "Where does W999 land?")

        assert result.matched is False
        assert result.citations == []


class TestWireMatching:
    """Suite 4: Wire number parsing and matching."""

    def test_ask_about_wire_200_finds_200(self, profile):
        """Question about wire 200 finds the 200 row (not W200)."""
        result = answer_wiring_question(profile, "Where does wire 200 land?")

        assert result.matched is True
        assert result.matched_kind == "wire"
        # Should mention DEVICE_A and DEVICE_B (the 200 row)
        assert "DEVICE" in result.answer

    def test_ask_about_wire_w200_finds_w200(self, profile):
        """Question about wire W200 finds the W200 row (not 200)."""
        result = answer_wiring_question(profile, "Where does wire W200 land?")

        assert result.matched is True
        assert result.matched_kind == "wire"
        # Should mention PLC1 and PS1 (the W200 row)
        assert "PLC1" in result.answer or "PS1" in result.answer

    def test_wire_200_and_w200_are_different_wires(self, profile):
        """Asking about 200 vs W200 gives different answers."""
        result_200 = answer_wiring_question(profile, "Where does wire 200 land?")
        result_w200 = answer_wiring_question(profile, "Where does wire W200 land?")

        # Both should match, but with different connections
        assert result_200.matched is True
        assert result_w200.matched is True
        assert result_200.answer != result_w200.answer

    def test_wire_parsing_case_insensitive(self, profile):
        """Wire parsing is case-insensitive."""
        result_upper = answer_wiring_question(profile, "Where does W200 land?")
        result_lower = answer_wiring_question(profile, "Where does w200 land?")

        assert result_upper.matched is True
        assert result_lower.matched is True
        # Both should match the same wire
        assert len(result_upper.citations) == len(result_lower.citations)

    def test_absent_wire_gives_no_record_answer(self, profile):
        """Asking about a non-existent wire gives "no record"."""
        result = answer_wiring_question(profile, "Where does wire W999 land?")

        assert result.matched is False
        assert result.matched_kind == "wire"
        assert result.answer_source == "none"
        assert "no record" in result.answer.lower() or "found" in result.answer.lower()


class TestTerminalMatching:
    """Suite 4: Terminal parsing and matching."""

    def test_ask_about_terminal_i00_finds_both_connections(self, profile):
        """Question about I-00 finds both W200 and W201."""
        result = answer_wiring_question(profile, "What is connected to I-00?")

        assert result.matched is True
        assert result.matched_kind == "terminal"
        # Should list multiple connections
        assert len(result.citations) >= 2

    def test_terminal_parsing_with_hyphen(self, profile):
        """Terminals with hyphens parse correctly."""
        result = answer_wiring_question(profile, "What lands on terminal I-00?")

        assert result.matched is True
        assert result.matched_kind == "terminal"

    def test_terminal_parsing_with_colon(self, profile):
        """Terminal parsing handles colons (X1:3 format)."""
        # Note: our fixture doesn't have colon-format terminals, but the parser should handle it
        result = answer_wiring_question(profile, "What is on X1:3?")
        # This won't match because we don't have X1:3 in the fixture
        assert result.matched is False

    def test_absent_terminal_gives_no_record_answer(self, profile):
        """Asking about a non-existent terminal gives "no record"."""
        result = answer_wiring_question(profile, "What lands on Z-99?")

        assert result.matched is False
        assert result.matched_kind == "terminal"
        assert result.answer_source == "none"


class TestParsingEdgeCases:
    """Suite: Token extraction edge cases."""

    def test_question_with_no_wire_or_terminal_refuses_to_parse(self, profile):
        """A question with no extractable token refuses."""
        result = answer_wiring_question(profile, "What is a wiring diagram?")

        assert result.matched is False
        assert result.matched_kind is None
        assert result.answer_source == "none"
        # Should explain it couldn't parse a wire/terminal
        assert "wire" in result.answer.lower() or "terminal" in result.answer.lower()

    def test_generic_greeting_no_parse(self, profile):
        """A greeting with no wire/terminal info."""
        result = answer_wiring_question(profile, "Hello, how are you?")

        assert result.matched is False
        assert result.matched_kind is None


class TestAnswerStructure:
    """Suite: WiringAnswer fields and invariants."""

    def test_answer_asset_matches_profile(self, profile):
        """WiringAnswer.asset matches the profile asset."""
        result = answer_wiring_question(profile, "Where does W200 land?")
        assert result.asset == "gs10-eval"

    def test_resolved_reflects_profile_state(self, profile):
        """resolved=True when profile has connections."""
        result = answer_wiring_question(profile, "Where does W200 land?")
        assert result.resolved is True  # profile has connections

    def test_read_only_always_true(self, profile):
        """read_only is always True."""
        for question in [
            "Where does W200 land?",
            "Where does W900 land?",
            "Where does W999 land?",
            "What is a wire?",
        ]:
            result = answer_wiring_question(profile, question)
            assert result.read_only is True

    def test_fallback_used_always_false(self, profile):
        """fallback_used is always False (no generic LLM fallback)."""
        for question in [
            "Where does W200 land?",
            "Where does W900 land?",
            "Where does W999 land?",
            "What is a wire?",
        ]:
            result = answer_wiring_question(profile, question)
            assert result.fallback_used is False

    def test_answer_source_is_either_wiring_connections_or_none(self, profile):
        """answer_source is one of two values."""
        for question in [
            "Where does W200 land?",
            "Where does W900 land?",
            "Where does W999 land?",
        ]:
            result = answer_wiring_question(profile, question)
            assert result.answer_source in {"wiring_connections", "none"}

    def test_matched_implies_answer_source_wiring_connections(self, profile):
        """If matched=True, answer_source must be wiring_connections."""
        result = answer_wiring_question(profile, "Where does W200 land?")
        if result.matched is True:
            assert result.answer_source == "wiring_connections"

    def test_matched_implies_trusted_evidence(self, profile):
        """If matched=True, trusted_evidence must be True."""
        result = answer_wiring_question(profile, "Where does W200 land?")
        if result.matched is True:
            assert result.trusted_evidence is True

    def test_answer_source_none_implies_no_citations(self, profile):
        """If answer_source=none, citations must be empty."""
        for question in ["Where does W999 land?", "Where does W900 land?"]:
            result = answer_wiring_question(profile, question)
            if result.answer_source == "none":
                assert result.citations == []


class TestAnswerToDict:
    """Suite: Serialization."""

    def test_to_dict_includes_all_fields(self, profile):
        """to_dict() includes all WiringAnswer fields."""
        result = answer_wiring_question(profile, "Where does W200 land?")
        d = result.to_dict()

        assert "asset" in d
        assert "resolved" in d
        assert "matched" in d
        assert "matched_kind" in d
        assert "answer" in d
        assert "citations" in d
        assert "answer_source" in d
        assert "fallback_used" in d
        assert "read_only" in d
        assert "trusted_evidence" in d


class TestIntegration:
    """Integration: realistic Q&A scenarios."""

    def test_technician_asks_about_24v_signal_wire(self, profile):
        """Technician asks: 'Where does W200 go?'"""
        result = answer_wiring_question(profile, "Where does W200 go?")

        assert result.matched is True
        assert result.answer_source == "wiring_connections"
        assert len(result.citations) >= 1
        # Should mention the actual connection
        assert "PLC1" in result.answer or "PS1" in result.answer

    def test_technician_asks_about_input_terminal(self, profile):
        """Technician asks: 'What's connected to I-00?'"""
        result = answer_wiring_question(profile, "What's connected to I-00?")

        assert result.matched is True
        assert result.answer_source == "wiring_connections"
        # Should have multiple citations (2 connections use I-00)
        assert len(result.citations) >= 2

    def test_technician_asks_about_unverified_connection(self, profile):
        """Technician asks about W900, which is proposed-only."""
        result = answer_wiring_question(profile, "What is W900?")

        assert result.matched is False
        assert result.answer_source == "none"
        assert len(result.citations) == 0
        assert "PROPOSED" in result.answer or "approved" in result.answer

    def test_technician_asks_about_unknown_wire(self, profile):
        """Technician asks about a non-existent wire."""
        result = answer_wiring_question(profile, "Where is W777?")

        assert result.matched is False
        assert result.answer_source == "none"
        assert "no record" in result.answer.lower()
