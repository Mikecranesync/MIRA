"""Tests for wiring_intake — pure logic + thin DB glue (no real DB, no HTTP).

Covers: intent parsing, missing-asset handling, payload→rows conversion,
fake-cursor writes, preview rendering, and answer formatting doctrine.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from shared import wiring_intake
from shared.wiring_profile import profile_from_rows


@pytest.fixture
def fixture_dir():
    """Path to wiring_intake fixtures."""
    return Path(__file__).parent / "fixtures" / "wiring_intake"


@pytest.fixture
def schematic_payload(fixture_dir):
    """Load a realistic `/api/kg/schematic` payload."""
    with open(fixture_dir / "schematic_payload.json", encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture
def wiring_rows_fixture(fixture_dir):
    """Load wiring rows: one verified, one proposed."""
    with open(fixture_dir / "wiring_rows.json", encoding="utf-8") as fh:
        return json.load(fh)


# ── Intent parsing (pure) ────────────────────────────────────────────────────


class TestIntentParsing:
    """Intent parsing — core routing logic."""

    def test_intake_phrase_recognized(self):
        """'add this wiring' → intake kind."""
        intent = wiring_intake.parse_wiring_intent("CV-101 add this wiring")
        assert intent.kind == "intake"
        assert intent.asset == "cv-101"
        assert intent.question is None

    def test_intake_with_alt_phrase(self):
        """'add to documentation' → intake kind."""
        intent = wiring_intake.parse_wiring_intent("CV-101 add to documentation")
        assert intent.kind == "intake"
        assert intent.asset == "cv-101"

    def test_intake_graceful_add_documentation(self):
        """'Add this to documentation for CV-101' → intake (fuzzy match)."""
        intent = wiring_intake.parse_wiring_intent("Add this to documentation for CV-101")
        assert intent.kind == "intake"
        assert intent.asset == "cv-101"

    def test_intake_no_asset(self):
        """Intake without an asset → asset=None."""
        intent = wiring_intake.parse_wiring_intent("add this wiring")
        assert intent.kind == "intake"
        assert intent.asset is None

    def test_question_marker_and_wire_token(self):
        """'Where does W200 land?' → question kind."""
        intent = wiring_intake.parse_wiring_intent("Where does W200 land?")
        assert intent.kind == "question"
        assert intent.asset is None
        assert intent.question == "Where does W200 land?"

    def test_question_marker_and_terminal_token(self):
        """'What is connected to X1:3?' → question kind."""
        intent = wiring_intake.parse_wiring_intent("What is connected to X1:3?")
        assert intent.kind == "question"
        assert intent.question == "What is connected to X1:3?"

    def test_question_with_asset_in_text(self):
        """'CV-101 what does W200 land on?' → question with asset."""
        intent = wiring_intake.parse_wiring_intent("CV-101 what does W200 land on?")
        assert intent.kind == "question"
        assert intent.asset == "cv-101"

    def test_marker_without_token_is_not_question(self):
        """'Where is it?' has marker but no wire/terminal token → none."""
        intent = wiring_intake.parse_wiring_intent("Where is it?")
        assert intent.kind == "none"

    def test_token_without_marker_is_not_question(self):
        """'W200 is brown' has a token but no question marker → none."""
        intent = wiring_intake.parse_wiring_intent("W200 is brown")
        assert intent.kind == "none"

    def test_unrelated_text_is_none(self):
        """'hello' or 'thanks' → none kind."""
        for text in ["hello", "thanks", "what's the weather", ""]:
            intent = wiring_intake.parse_wiring_intent(text)
            assert intent.kind == "none"

    def test_asset_normalization(self):
        """Asset tokens are normalized: CV-101, CV 101, cv_101 all → 'cv-101'."""
        for text in ["CV-101 add this wiring", "CV 101 add this wiring", "cv_101 add this wiring"]:
            intent = wiring_intake.parse_wiring_intent(text)
            assert intent.asset == "cv-101"

    def test_asset_extraction_conservative(self):
        """Asset regex is conservative: GS10, filler01 match; W200, X1:3 don't."""
        assert wiring_intake.extract_asset("GS10 add this") == "gs10"
        assert wiring_intake.extract_asset("filler01 add this") == "filler01"
        assert wiring_intake.extract_asset("W200 land on") is None
        assert wiring_intake.extract_asset("X1:3 land on") is None


# ── Payload → rows (pure) ────────────────────────────────────────────────────


class TestPayloadToProposedRows:
    """Payload→rows conversion: only electrically_connected, no controls."""

    def test_payload_to_rows_filters_relationship_type(self, schematic_payload):
        """Only `electrically_connected` rels become rows; `controls` dropped."""
        rows = wiring_intake.payload_to_proposed_rows(
            schematic_payload,
            "cv-101",
            drawing_ref="E-005",
            proposed_by="test:intake",
            source="test:source",
        )

        # Payload has 3 electrically_connected + 1 controls = should get 3 rows
        # (filtering happens in kg_payload_to_rows, not here)
        assert len(rows) == 3
        # All rows have the basic attributes (source, dest, etc.)
        for row in rows:
            assert row.source_entity_id
            assert row.dest_entity_id
            assert row.approval_state == "proposed"

    def test_all_rows_proposed_by_construction(self, schematic_payload):
        """Every row has approval_state='proposed'."""
        rows = wiring_intake.payload_to_proposed_rows(
            schematic_payload,
            "cv-101",
            drawing_ref="E-005",
            proposed_by="test:intake",
            source="test:source",
        )

        for row in rows:
            assert row.approval_state == "proposed"
            assert row.proposed_by == "test:intake"

    def test_evidence_carries_asset_and_source(self, schematic_payload):
        """Evidence summary includes asset and source."""
        rows = wiring_intake.payload_to_proposed_rows(
            schematic_payload,
            "cv-101",
            drawing_ref="E-005",
            proposed_by="test:intake",
            source="test:schematic",
        )

        for row in rows:
            evidence = row.evidence_summary or {}
            assert evidence.get("asset") == "cv-101"
            assert evidence.get("source") == "test:schematic"


# ── Pure formatters ──────────────────────────────────────────────────────────


class TestConnectionCounting:
    """count_connections — how many electrically_connected rels in payload."""

    def test_count_connections_in_payload(self, schematic_payload):
        """Payload with 3 electrically_connected rels → count=3."""
        count = wiring_intake.count_connections(schematic_payload)
        assert count == 3

    def test_count_connections_filters_type(self):
        """Count ignores non-electrically_connected relationships."""
        payload = {
            "relationships": [
                {"relationship_type": "electrically_connected"},
                {"relationship_type": "controls"},
                {"relationship_type": "electrically_connected"},
            ]
        }
        count = wiring_intake.count_connections(payload)
        assert count == 2


class TestSampleWiresTerminals:
    """sample_wires_terminals — human-readable wire/terminal samples."""

    def test_sample_returns_up_to_n_lines(self, schematic_payload):
        """sample_wires_terminals(payload, n=2) returns ≤2 lines."""
        samples = wiring_intake.sample_wires_terminals(schematic_payload, n=2)
        assert len(samples) <= 2

    def test_sample_format_includes_wire_number(self, schematic_payload):
        """Sample line includes 'wire N' if wire_number exists."""
        samples = wiring_intake.sample_wires_terminals(schematic_payload, n=5)
        # At least one sample should mention a wire number
        text = " ".join(samples)
        assert "wire" in text.lower() or "W" in text

    def test_sample_from_empty_payload(self):
        """Empty payload → empty samples list."""
        samples = wiring_intake.sample_wires_terminals({})
        assert samples == []


class TestBuildIntakePreview:
    """build_intake_preview — the reply after proposing rows."""

    def test_preview_includes_asset_name(self, schematic_payload):
        """Preview includes asset name."""
        preview = wiring_intake.build_intake_preview(
            schematic_payload, inserted=3, skipped=0, asset="cv-101"
        )
        assert "cv-101" in preview.lower()

    def test_preview_includes_counts(self, schematic_payload):
        """Preview includes proposed/skipped counts."""
        preview = wiring_intake.build_intake_preview(
            schematic_payload, inserted=5, skipped=2, asset="cv-101"
        )
        assert "5" in preview
        assert "2" in preview

    def test_preview_includes_samples(self, schematic_payload):
        """Preview includes wire/terminal samples."""
        preview = wiring_intake.build_intake_preview(
            schematic_payload, inserted=1, skipped=0, asset="cv-101"
        )
        # Should mention at least one connection
        assert "->" in preview or "Sample" in preview

    def test_preview_includes_proposed_warning(self, schematic_payload):
        """Preview warns that rows are PROPOSED, not trusted yet."""
        preview = wiring_intake.build_intake_preview(
            schematic_payload, inserted=1, skipped=0, asset="cv-101"
        )
        assert "PROPOSED" in preview
        assert "approve" in preview.lower()

    def test_missing_asset_reply_is_canonical(self):
        """MISSING_ASSET_REPLY is the exact ask text."""
        reply = wiring_intake.MISSING_ASSET_REPLY
        assert "Which asset" in reply
        assert "CV-101" in reply
        assert "ambiguous" in reply


# ── Answer formatting doctrine ───────────────────────────────────────────────


class TestFormatWiringAnswer:
    """format_wiring_answer — doctrine: trusted → citations; proposed/none → no."""

    def test_trusted_answer_includes_sources_block(self, wiring_rows_fixture):
        """Verified match → answer + Sources: block + metadata footer."""
        profile = profile_from_rows(wiring_rows_fixture, asset="cv-101")
        answer = wiring_intake.answer_wiring_question(profile, "Where does W200 land?")

        assert answer.matched is True
        formatted = wiring_intake.format_wiring_answer(answer, "cv-101")

        # Should include Sources block
        assert "Sources:" in formatted
        # Should include metadata footer
        assert "read_only=" in formatted
        assert "source=wiring_connections" in formatted
        # Should NOT be just the answer verbatim
        assert len(formatted) > len(answer.answer)

    def test_trusted_answer_includes_citations_in_sources(self, wiring_rows_fixture):
        """Each citation line includes approval_state, label, excerpt."""
        profile = profile_from_rows(wiring_rows_fixture, asset="cv-101")
        answer = wiring_intake.answer_wiring_question(profile, "Where does W200 land?")

        assert answer.matched is True
        assert len(answer.citations) >= 1

        formatted = wiring_intake.format_wiring_answer(answer, "cv-101")
        # Each citation should be in brackets: [verified]
        assert "[verified]" in formatted

    def test_asset_prefixed_question_answers_the_wire(self, wiring_rows_fixture):
        """Regression: an asset-prefixed question ("CV-101 what does W200 land
        on?") must answer the WIRE, not mis-read the asset as a terminal.

        `parse_wiring_intent` strips the asset token from `.question`, so the
        wire/terminal reader sees a clean "what does W200 land on?" — without
        the fix it read "CV-101" as a terminal (`-` separator) and returned
        "no record of CV-101".
        """
        intent = wiring_intake.parse_wiring_intent("CV-101 what does W200 land on?")
        assert intent.kind == "question"
        assert intent.asset == "cv-101"
        assert "cv-101" not in (intent.question or "").lower()  # asset stripped

        profile = profile_from_rows(wiring_rows_fixture, asset="cv-101")
        answer = wiring_intake.answer_wiring_question(profile, intent.question)
        assert answer.matched is True
        assert answer.answer_source == "wiring_connections"
        assert len(answer.citations) >= 1

    def test_proposed_only_answer_refuses_no_sources(self, wiring_rows_fixture):
        """Proposed-only match (W900) → refusal, NO Sources block."""
        profile = profile_from_rows(wiring_rows_fixture, asset="cv-101")
        answer = wiring_intake.answer_wiring_question(profile, "Where does W900 land?")

        assert answer.matched is False
        assert answer.answer_source == "none"
        assert answer.citations == []

        formatted = wiring_intake.format_wiring_answer(answer, "cv-101")
        # Should be the refusal text verbatim, no Sources block
        assert formatted == answer.answer
        assert "Sources:" not in formatted
        assert "read_only=" not in formatted

    def test_no_record_answer_no_sources(self, wiring_rows_fixture):
        """Absent wire (W999) → "no record", NO Sources block."""
        profile = profile_from_rows(wiring_rows_fixture, asset="cv-101")
        answer = wiring_intake.answer_wiring_question(profile, "Where does W999 land?")

        assert answer.matched is False
        assert answer.citations == []

        formatted = wiring_intake.format_wiring_answer(answer, "cv-101")
        # Should mention "no" / "record" / "won't"
        assert (
            "no" in formatted.lower()
            or "record" in formatted.lower()
            or "won't" in formatted.lower()
        )
        # NO generic sentence added by formatter
        assert "Sources:" not in formatted

    def test_formatter_never_invents_citations(self, wiring_rows_fixture):
        """Formatter NEVER adds a citation without one in answer."""
        profile = profile_from_rows(wiring_rows_fixture, asset="cv-101")
        answer = wiring_intake.answer_wiring_question(profile, "Where does W999 land?")

        formatted = wiring_intake.format_wiring_answer(answer, "cv-101")
        # If no citations, NO [verified] or sources
        if answer.citations == []:
            assert "[verified]" not in formatted or "Sources:" not in formatted


# ── DB glue (fake cursor) ────────────────────────────────────────────────────


class FakeCursor:
    """Mock DB cursor that records execute calls."""

    def __init__(self):
        self.execute_calls = []

    def execute(self, sql: str, params=None):
        self.execute_calls.append({"sql": sql, "params": params or ()})
        # Simulate a successful call
        return None


class TestWriteProposedRowsRLS:
    """write_proposed_rows — RLS set_config + idempotent insert."""

    def test_write_sets_rls_config(self):
        """First call to write_proposed_rows issues set_config for RLS."""
        fake_cur = FakeCursor()

        # Mock the reused writer to do nothing (just record it was called)
        original_write = wiring_intake._schematic.base.write_rows

        def mock_write(cur, tenant_id, rows):
            return (len(rows), 0)

        wiring_intake._schematic.base.write_rows = mock_write

        try:
            wiring_intake.write_proposed_rows(fake_cur, "tenant-123", [])
            # Should have called set_config
            rls_calls = [
                c for c in fake_cur.execute_calls if "set_config" in c["sql"].lower()
            ]
            assert len(rls_calls) >= 1
            assert "app.current_tenant_id" in rls_calls[0]["sql"]
            assert "tenant-123" in str(rls_calls[0]["params"])
        finally:
            wiring_intake._schematic.base.write_rows = original_write

    def test_write_returns_inserted_skipped(self):
        """write_proposed_rows returns (inserted, skipped) tuple."""
        fake_cur = FakeCursor()

        original_write = wiring_intake._schematic.base.write_rows

        def mock_write(cur, tenant_id, rows):
            return (10, 3)

        wiring_intake._schematic.base.write_rows = mock_write

        try:
            inserted, skipped = wiring_intake.write_proposed_rows(
                fake_cur, "tenant-123", []
            )
            assert inserted == 10
            assert skipped == 3
        finally:
            wiring_intake._schematic.base.write_rows = original_write


# ── Asset normalization ──────────────────────────────────────────────────────


class TestNormalizeAsset:
    """normalize_asset — lowercase, spaces/underscores → hyphens."""

    def test_normalize_cv_101(self):
        assert wiring_intake.normalize_asset("CV-101") == "cv-101"

    def test_normalize_spaces(self):
        assert wiring_intake.normalize_asset("CV 101") == "cv-101"

    def test_normalize_underscores(self):
        assert wiring_intake.normalize_asset("CV_101") == "cv-101"

    def test_normalize_mixed_case(self):
        assert wiring_intake.normalize_asset("Cv-101") == "cv-101"

    def test_normalize_gs10(self):
        assert wiring_intake.normalize_asset("GS10") == "gs10"

    def test_normalize_filler01(self):
        assert wiring_intake.normalize_asset("filler01") == "filler01"
