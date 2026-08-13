"""Tests for the retrieval probe.

Split deliberately: the query-construction and support-scoring logic is pure and
runs in CI, while anything needing a ledger or a database skips. Ledgers are
gitignored and local-only, so a ledger-backed assertion in CI would be a test
that can never fail — the pattern `test_replay.py` established.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "mira-bots"))

from tests.regime1_telethon.campaign import retrieval_probe  # noqa: E402

LEDGER_DIR = REPO / "tests" / "regime1_telethon" / "campaign" / "ledger"


class TestRecallQuery:
    """The probe is worthless if it asks a different question than production.

    rag_worker builds `f"{asset_identified} {message}"`. If that ever changes,
    these fail and the probe gets fixed with it — otherwise the probe silently
    measures a query MIRA never issued.
    """

    def test_asset_context_is_prepended(self):
        assert (
            retrieval_probe.recall_query("How do I reset it?", "Rockwell Automation, 525")
            == "Rockwell Automation, 525 How do I reset it?"
        )

    def test_no_asset_leaves_the_message_alone(self):
        assert retrieval_probe.recall_query("what's CE10 mean?", None) == "what's CE10 mean?"

    def test_blank_asset_is_not_a_leading_space(self):
        assert retrieval_probe.recall_query("hello", "   ") == "hello"


class TestParamSupport:
    """Both directions, because a one-directional check proves nothing.

    A detector that only ever reports "unsupported" is indistinguishable from a
    detector that is broken.
    """

    def test_a_token_present_in_a_chunk_is_supported(self):
        chunks = [{"content": "COM1 Time-out Detection is set by P09.03 in seconds."}]
        rows = retrieval_probe.param_support("Check P09.03 on the drive.", "", chunks)
        assert rows == [{"token": "P09.03", "supported": True, "n_chunks": 1}]

    def test_a_token_absent_from_every_chunk_is_unsupported(self):
        chunks = [{"content": "Ramped speed reference and rotor position reset."}]
        rows = retrieval_probe.param_support("Set P0594 = 1 to reset.", "", chunks)
        assert rows == [{"token": "P0594", "supported": False, "n_chunks": 1}]

    def test_matching_is_case_insensitive(self):
        chunks = [{"content": "parameter p09.03 governs the timeout"}]
        rows = retrieval_probe.param_support("See P09.03.", "", chunks)
        assert rows[0]["supported"] is True

    def test_empty_retrieval_reports_unsupported_and_says_so(self):
        """chunks==[] is an observation, not a missing one — but the reader must
        be able to tell "nothing was retrieved" from "retrieved, and absent"."""
        rows = retrieval_probe.param_support("Set P0594 = 1.", "", [])
        assert rows == [{"token": "P0594", "supported": False, "n_chunks": 0}]

    def test_a_parameter_the_technician_supplied_is_not_a_claim(self):
        """Inherited from fabrication.extract_param_claims: MIRA repeating a
        number the technician gave it is not MIRA asserting it."""
        rows = retrieval_probe.param_support(
            "P09.03 is your timeout.", "my P09.03 is set to 5s", []
        )
        assert rows == []

    def test_no_parameters_means_no_rows(self):
        assert retrieval_probe.param_support("Check the incoming voltage.", "", []) == []


class TestRecordedReplies:
    """The probe grades REAL replies; replay refuses to load them. Both are
    right, and the split is load-bearing enough to pin."""

    def test_recorded_replies_needs_a_ledger(self):
        with pytest.raises(FileNotFoundError):
            retrieval_probe.recorded_replies("no-such-campaign-xyz", "no-such-conv")

    @pytest.mark.skipif(not (LEDGER_DIR / "c7.jsonl").exists(), reason="ledger is local-only")
    def test_recorded_replies_returns_mira_turns_only(self):
        from tests.regime1_telethon.campaign import replay as replay_mod

        replies = retrieval_probe.recorded_replies("c7", "t2_005_pivot_after_fault")
        assert replies, "expected recorded MIRA replies"
        tech = {t["text"] for t in replay_mod.technician_turns("c7", "t2_005_pivot_after_fault")}
        assert not (set(replies.values()) & tech), "technician text leaked into MIRA replies"
