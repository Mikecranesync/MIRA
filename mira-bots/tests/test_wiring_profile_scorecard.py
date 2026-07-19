"""Tests for wiring_profile.scorecard — deterministic trust scoring.

Suite 6: Scorecard gates and trust levels.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from shared.wiring_profile import profile_from_rows, score_profile


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


@pytest.fixture
def trusted_only_rows(all_rows):
    """Subset: only approved, sourced, readable rows."""
    return [
        r
        for r in all_rows
        if r["approval_state"] == "verified" and r["wire_number"] not in {"W400", "W500"}
    ]


@pytest.fixture
def proposed_only_rows(all_rows):
    """Subset: only proposed rows."""
    return [r for r in all_rows if r["approval_state"] == "proposed"]


@pytest.fixture
def unsourced_rows(all_rows):
    """Subset: approved but unsourced (no drawing_reference or empty evidence)."""
    return [r for r in all_rows if r["approval_state"] == "verified" and r["wire_number"] == "W400"]


@pytest.fixture
def field_verify_rows(all_rows):
    """Subset: approved but field_verify status."""
    return [r for r in all_rows if r["approval_state"] == "verified" and r["wire_number"] == "W500"]


@pytest.fixture
def empty_rows():
    """Subset: no rows."""
    return []


class TestScorecardTrustedOnly:
    """All approved, all sourced, all readable, none field_verify."""

    def test_trusted_only_passes_all_gates(self, trusted_only_rows):
        """A profile with only approved, sourced, readable rows passes all gates."""
        profile = profile_from_rows(trusted_only_rows, asset="gs10-eval")
        score = score_profile(profile)

        assert score.trusted is True
        assert score.trust_level == "trusted"
        assert all(score.gates.values()) is True
        assert score.reasons == []

    def test_trusted_only_has_all_gates_true(self, trusted_only_rows):
        """Every gate is True."""
        profile = profile_from_rows(trusted_only_rows, asset="gs10-eval")
        score = score_profile(profile)

        assert score.gates["has_wiring"] is True
        assert score.gates["has_approved"] is True
        assert score.gates["approved_all_sourced"] is True
        assert score.gates["approved_human_readable"] is True
        assert score.gates["approved_field_confirmed"] is True


class TestScorecardProposedOnly:
    """Only proposed rows, no approved."""

    def test_proposed_only_fails_has_approved_gate(self, proposed_only_rows):
        """A profile with only proposed rows fails the has_approved gate."""
        profile = profile_from_rows(proposed_only_rows, asset="gs10-eval")
        score = score_profile(profile)

        assert score.trusted is False
        assert score.trust_level == "proposed_only"
        assert score.gates["has_wiring"] is True
        assert score.gates["has_approved"] is False

    def test_proposed_only_reason_mentions_proposed(self, proposed_only_rows):
        """Reason explains why has_approved failed."""
        profile = profile_from_rows(proposed_only_rows, asset="gs10-eval")
        score = score_profile(profile)

        reasons_text = " ".join(score.reasons).lower()
        assert "proposed" in reasons_text or "approved" in reasons_text


class TestScorecardUnsourced:
    """Approved but unsourced (missing drawing_reference or evidence)."""

    def test_unsourced_fails_approved_all_sourced_gate(self, unsourced_rows):
        """A profile with unsourced approved rows fails the approved_all_sourced gate."""
        profile = profile_from_rows(unsourced_rows, asset="gs10-eval")
        score = score_profile(profile)

        assert score.trusted is False
        assert score.trust_level == "partial"
        assert score.gates["has_wiring"] is True
        assert score.gates["has_approved"] is True
        assert score.gates["approved_all_sourced"] is False

    def test_unsourced_reason_mentions_missing_evidence(self, unsourced_rows):
        """Reason explains unsourced failure."""
        profile = profile_from_rows(unsourced_rows, asset="gs10-eval")
        score = score_profile(profile)

        reasons_text = " ".join(score.reasons).lower()
        assert (
            "unsourced" in reasons_text or "evidence" in reasons_text or "drawing" in reasons_text
        )


class TestScorecardFieldVerify:
    """Approved but model_status field_verify."""

    def test_field_verify_fails_approved_field_confirmed_gate(self, field_verify_rows):
        """A profile with field_verify rows fails the approved_field_confirmed gate."""
        profile = profile_from_rows(field_verify_rows, asset="gs10-eval")
        score = score_profile(profile)

        assert score.trusted is False
        assert score.trust_level == "partial"
        assert score.gates["has_wiring"] is True
        assert score.gates["has_approved"] is True
        assert score.gates["approved_field_confirmed"] is False

    def test_field_verify_reason_mentions_field_verify(self, field_verify_rows):
        """Reason explains field_verify failure."""
        profile = profile_from_rows(field_verify_rows, asset="gs10-eval")
        score = score_profile(profile)

        reasons_text = " ".join(score.reasons).lower()
        assert "field" in reasons_text or "unconfirmed" in reasons_text


class TestScorecardEmpty:
    """No rows at all."""

    def test_empty_fails_has_wiring_gate(self, empty_rows):
        """An empty profile fails the has_wiring gate."""
        profile = profile_from_rows(empty_rows, asset="gs10-eval")
        score = score_profile(profile)

        assert score.trusted is False
        assert score.trust_level == "no_wiring"
        assert score.gates["has_wiring"] is False

    def test_empty_reason_mentions_no_wiring(self, empty_rows):
        """Reason explains no wiring."""
        profile = profile_from_rows(empty_rows, asset="gs10-eval")
        score = score_profile(profile)

        reasons_text = " ".join(score.reasons).lower()
        assert "wiring" in reasons_text or "rows" in reasons_text


class TestScorecardCounts:
    """Verify count breakdowns by approval state."""

    def test_counts_breakdowns_match_profile_split(self, all_rows):
        """Counts in the score match the profile's state splits."""
        profile = profile_from_rows(all_rows, asset="gs10-eval")
        score = score_profile(profile)

        assert score.counts["total"] == len(profile.connections)
        assert score.counts["approved"] == len(profile.approved)
        assert score.counts["proposed"] == len(profile.proposed)
        assert score.counts["rejected"] == len(profile.rejected)

    def test_counts_total_equals_sum_of_splits(self, all_rows):
        """Total count equals sum of each state."""
        profile = profile_from_rows(all_rows, asset="gs10-eval")
        score = score_profile(profile)

        state_sum = (
            score.counts["approved"]
            + score.counts["proposed"]
            + score.counts["rejected"]
            + score.counts.get("needs_review", 0)
        )
        assert state_sum == score.counts["total"]


class TestScorecardToDict:
    """Serialization."""

    def test_to_dict_includes_all_fields(self, all_rows):
        """to_dict() includes all WiringTrustScore fields."""
        profile = profile_from_rows(all_rows, asset="gs10-eval")
        score = score_profile(profile)
        d = score.to_dict()

        assert "asset" in d
        assert "trusted" in d
        assert "trust_level" in d
        assert "gates" in d
        assert "reasons" in d
        assert "counts" in d


class TestScorecardIntegration:
    """Integration: full profiles with mixed states."""

    def test_mixed_profile_with_proposed_and_approved(self, all_rows):
        """A profile with both approved and proposed rows."""
        profile = profile_from_rows(all_rows, asset="gs10-eval")
        score = score_profile(profile)

        # Has both approved and proposed
        assert len(profile.approved) > 0
        assert len(profile.proposed) > 0
        # But should fail because some approved rows have issues
        assert score.trusted is False

    def test_mixed_profile_counts_correct(self, all_rows):
        """Counts match the splits."""
        profile = profile_from_rows(all_rows, asset="gs10-eval")
        score = score_profile(profile)

        # Fixture has 8 rows: 7 verified, 1 proposed
        assert score.counts["total"] == 8
        assert score.counts["approved"] == 7
        assert score.counts["proposed"] == 1
