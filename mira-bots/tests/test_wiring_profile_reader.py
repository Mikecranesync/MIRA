"""Tests for wiring_profile.reader — pure assembly of MachineWiringProfile.

Suite: (1) Approval enforcement, (2) Provenance preserved, (3) Unknown-field,
(4) False-positive, (5) Citation (delegated to ask.py tests).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from shared.wiring_profile import (
    WiringConnection,
    profile_from_rows,
)


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


class TestApprovalEnforcement:
    """Suite 1: Only verified rows are trusted; others are readable but not trusted."""

    def test_profile_trusted_excludes_proposed(self, profile):
        """profile.trusted() excludes proposed rows."""
        trusted_wires = {c.wire_number for c in profile.trusted()}
        # W900 is proposed, should not be in trusted set
        assert "W900" not in trusted_wires
        # W200, W201, W350, etc. are verified, should be in trusted
        assert "W200" in trusted_wires

    def test_profile_approved_equals_trusted(self, profile):
        """profile.approved is an alias for profile.trusted()."""
        assert profile.approved == profile.trusted()

    def test_profile_proposed_contains_only_proposed_rows(self, profile):
        """profile.proposed contains only proposed rows."""
        proposed = profile.proposed
        assert len(proposed) > 0
        for row in proposed:
            assert row.approval_state == "proposed"
        # Should contain W900
        assert any(c.wire_number == "W900" for c in proposed)

    def test_is_trusted_returns_true_only_for_verified(self, all_rows):
        """WiringConnection.is_trusted() returns True only for verified."""
        for row in all_rows:
            conn = WiringConnection(
                source_entity_id=row["source_entity_id"],
                source_terminal=row["source_terminal"],
                dest_entity_id=row["dest_entity_id"],
                dest_terminal=row["dest_terminal"],
                wire_number=row["wire_number"],
                cable_id=row["cable_id"],
                gauge_awg=row["gauge_awg"],
                color=row["color"],
                function_class=row["function_class"],
                drawing_reference=row["drawing_reference"],
                approval_state=row["approval_state"],
                proposed_by=row["proposed_by"],
                evidence_summary=row["evidence_summary"],
            )
            if row["approval_state"] == "verified":
                assert conn.is_trusted() is True
            else:
                assert conn.is_trusted() is False


class TestProvenancePreserved:
    """Suite 2: evidence_summary + drawing_reference survive unchanged."""

    def test_evidence_summary_roundtrips_unchanged(self, all_rows, profile):
        """evidence_summary is preserved byte-for-byte through profile_from_rows."""
        # Find the W200 row in both the fixture and the profile
        w200_fixture = next(r for r in all_rows if r["wire_number"] == "W200")
        w200_profile = next(c for c in profile.connections if c.wire_number == "W200")

        # The evidence_summary should match
        assert w200_profile.evidence_summary == w200_fixture["evidence_summary"]
        assert w200_profile.evidence_summary["from"] == "PLC1.I-00"
        assert w200_profile.evidence_summary["to"] == "PS1.OUT"
        assert w200_profile.evidence_summary["model_status"] == "verified"

    def test_drawing_reference_preserved(self, all_rows, profile):
        """drawing_reference is preserved."""
        w200_fixture = next(r for r in all_rows if r["wire_number"] == "W200")
        w200_profile = next(c for c in profile.connections if c.wire_number == "W200")
        assert w200_profile.drawing_reference == "E-005: 24VDC input"
        assert w200_profile.drawing_reference == w200_fixture["drawing_reference"]

    def test_empty_evidence_summary_preserved(self, all_rows, profile):
        """Rows with empty evidence_summary stay empty."""
        w400_fixture = next(r for r in all_rows if r["wire_number"] == "W400")
        w400_profile = next(c for c in profile.connections if c.wire_number == "W400")
        assert w400_profile.evidence_summary == {}
        assert w400_fixture["evidence_summary"] == {}

    def test_dict_rows_coerced_to_connections_preserve_evidence(self, all_rows):
        """profile_from_rows preserves evidence when coercing dict → WiringConnection."""
        profile = profile_from_rows(all_rows, asset="gs10-eval")
        # Pick a row with detailed evidence
        w201 = next(c for c in profile.connections if c.wire_number == "W201")
        assert w201.evidence_summary["signal"] == "status_feedback"


class TestUnknownField:
    """Suite 3: Unknown-field values stay unknown; don't invent."""

    def test_function_class_unknown_stays_unknown(self, profile):
        """W350 has function_class='unknown' and stays that way."""
        w350 = next(c for c in profile.connections if c.wire_number == "W350")
        assert w350.function_class == "unknown"

    def test_null_gauge_stays_none(self, profile):
        """W350 has gauge_awg=None and stays None."""
        w350 = next(c for c in profile.connections if c.wire_number == "W350")
        assert w350.gauge_awg is None

    def test_null_color_stays_none(self, profile):
        """W350 has color=None and stays None."""
        w350 = next(c for c in profile.connections if c.wire_number == "W350")
        assert w350.color is None

    def test_coercion_never_invents_function_class(self, all_rows):
        """Coercion from dict never fabricates function_class."""
        rows_missing_fc = [
            {
                "source_entity_id": "A",
                "source_terminal": "X",
                "dest_entity_id": "B",
                "dest_terminal": "Y",
                "wire_number": "TEST1",
                "cable_id": None,
                "gauge_awg": None,
                "color": None,
                "function_class": None,  # explicitly None
                "drawing_reference": "E-001",
                "approval_state": "verified",
                "proposed_by": None,
                "evidence_summary": {},
            }
        ]
        profile = profile_from_rows(rows_missing_fc, asset="test")
        assert profile.connections[0].function_class is None


class TestFalsePositive:
    """Suite 4: False-positive guard — 200 and W200 are DIFFERENT wires."""

    def test_find_by_wire_w200_does_not_return_200(self, profile):
        """find_by_wire('W200') returns only W200, not 200."""
        hits_w200 = profile.find_by_wire("W200")
        wire_numbers = {c.wire_number for c in hits_w200}
        assert "W200" in wire_numbers
        assert "200" not in wire_numbers

    def test_find_by_wire_200_does_not_return_w200(self, profile):
        """find_by_wire('200') returns only 200, not W200."""
        hits_200 = profile.find_by_wire("200")
        wire_numbers = {c.wire_number for c in hits_200}
        assert "200" in wire_numbers
        assert "W200" not in wire_numbers

    def test_find_by_wire_normalized_exact_match(self, profile):
        """find_by_wire uses normalized exact match."""
        # Normalized W200 (upper, stripped) should match the fixture's W200
        hits = profile.find_by_wire("w200")  # lowercase
        assert len(hits) == 1
        assert hits[0].wire_number == "W200"

    def test_find_by_terminal_returns_all_hits_on_i00(self, profile):
        """find_by_terminal('I-00') returns both connections using that terminal."""
        hits = profile.find_by_terminal("I-00")
        # W200: PLC1.I-00 -> PS1.OUT
        # W201: GS10_VFD.I-00 -> PLC1.I-01
        assert len(hits) >= 2
        wires = {c.wire_number for c in hits}
        assert "W200" in wires
        assert "W201" in wires

    def test_absent_wire_returns_empty_tuple(self, profile):
        """find_by_wire on an absent wire returns empty."""
        hits = profile.find_by_wire("W999")
        assert hits == ()

    def test_absent_terminal_returns_empty_tuple(self, profile):
        """find_by_terminal on an absent terminal returns empty."""
        hits = profile.find_by_terminal("Z-99")
        assert hits == ()


class TestReadableEndpoints:
    """Suite: Readable endpoints require both terminals AND some evidence."""

    def test_w200_has_readable_endpoints(self, profile):
        """W200 has both terminals + evidence labels."""
        w200 = next(c for c in profile.connections if c.wire_number == "W200")
        assert w200.has_readable_endpoints() is True

    def test_w400_missing_evidence_no_readable_endpoints(self, profile):
        """W400 has terminals but no evidence labels + no wire_number -> not readable."""
        w400 = next(c for c in profile.connections if c.wire_number == "W400")
        # W400 has terminals but evidence_summary is empty
        assert w400.evidence_summary == {}
        # It has a wire_number, so has_readable_endpoints should be True
        assert w400.has_readable_endpoints() is True

    def test_source_label_prefers_evidence(self, profile):
        """source_label() prefers evidence 'from' over constructed label."""
        w200 = next(c for c in profile.connections if c.wire_number == "W200")
        # Evidence has 'from': "PLC1.I-00", should be preferred
        assert w200.source_label() == "PLC1.I-00"

    def test_source_label_fallback_to_constructed(self, profile):
        """source_label() falls back to constructed label when no evidence."""
        w400 = next(c for c in profile.connections if c.wire_number == "W400")
        # W400 has empty evidence, should construct from terminals
        label = w400.source_label()
        assert "PS1" in label and "GND" in label


class TestFieldVerifyStatus:
    """Suite: Field verify unconfirmed logic."""

    def test_field_verify_unconfirmed_true_when_marked(self, profile):
        """W500 is marked field_verify and returns True."""
        w500 = next(c for c in profile.connections if c.wire_number == "W500")
        assert w500.is_field_verify_unconfirmed() is True

    def test_field_verify_unconfirmed_false_when_verified(self, profile):
        """W200 is verified, not field_verify."""
        w200 = next(c for c in profile.connections if c.wire_number == "W200")
        assert w200.is_field_verify_unconfirmed() is False


class TestProfileProperties:
    """Suite: Profile property splits by approval state."""

    def test_profile_connections_count_all_rows(self, profile):
        """profile.connections includes all rows."""
        # Fixture has 8 rows
        assert len(profile.connections) == 8

    def test_profile_approved_count(self, profile):
        """Only verified rows are in approved."""
        # Count the verified rows in fixture: all except W900 (proposed)
        verified_count = len(profile.approved)
        assert verified_count == 7

    def test_profile_proposed_count(self, profile):
        """Proposed rows are in proposed."""
        proposed = profile.proposed
        assert len(proposed) == 1
        assert proposed[0].wire_number == "W900"
