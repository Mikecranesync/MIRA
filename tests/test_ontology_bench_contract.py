"""Bench context contract — the live-data half (drive readings on the conveyor bench).

Companion to ``mira-hub/tests/integration/ontology/bench-context-contract.integration.test.ts``
(the graph half). Everything here executes the REAL ``shared.live_snapshot`` code that
``mira-bots/shared/engine.py`` and ``mira-bots/ask_api/app.py`` call to turn a tag
dictionary into the text a technician reads. No source-text checks.

Three clauses of the minimum bench contract are exercised:

* timestamp / quality on every reading,
* a COMMAND is not FEEDBACK,
* a MISSING observation is shown as unknown, never as a healthy value.

Where the application honours a clause the test is a plain assertion. Where it does
not there are TWO tests, the same pattern ``tests/test_ontology_runtime_contract.py``
uses: a ``pinned`` test asserting today's exact behaviour (so an import or data error
cannot pass for the defect), and the wanted behaviour as a STRICT xfail. When someone
repairs the path the xfail becomes an unexpected pass and fails the suite. No dedicated
issue exists for these five gaps yet; they are tracked under #5528 until one is filed.
"""

from __future__ import annotations

import pytest

UNS = "enterprise.site.line.cv"
FWD_RUN = 18  # GS10 command word: forward + run
STOPPED = 0  # GS10 status word: stopped


def _snaps(tags: dict, ts: str = "t0"):
    from shared.live_snapshot import normalize

    return normalize(tags, UNS, source="t", ts=ts)


def _assess(tags: dict) -> str | None:
    from shared.live_snapshot import assess_snapshots

    return assess_snapshots(_snaps(tags))


# ── Timestamp and quality ─────────────────────────────────────────────────────

OLD = "2001-01-01T00:00:00+00:00"
GAP = "tracked under #5528 (no dedicated issue filed yet)"


class TestTimestampAndQuality:
    def test_every_reading_carries_a_timestamp_a_quality_and_a_source(self):
        snaps = _snaps({"vfd_comm_ok": True, "vfd_frequency": 300, "vfd_fault_code": 0})
        assert snaps
        for s in snaps:
            assert s.ts == "t0"
            assert s.quality in {"good", "stale", "unknown"}
            assert s.source == "t"
            assert s.uns_path.startswith(UNS)

    def test_lost_comms_marks_drive_values_stale_and_good_comms_does_not(self):
        from shared.live_snapshot import GOOD, STALE

        lost = [
            s
            for s in _snaps({"vfd_comm_ok": False, "vfd_frequency": 300})
            if s.datapoint != "vfd_comm_ok"
        ]
        fine = _snaps({"vfd_comm_ok": True, "vfd_frequency": 300})
        assert lost and all(s.quality == STALE for s in lost)
        assert all(s.quality == GOOD for s in fine)

    def test_pinned_a_reading_stamped_decades_ago_is_still_good(self):
        """One ``ts`` is stamped on the whole dictionary, and both production callers
        pass ``datetime.now()`` — when MIRA received the tags, not when the drive
        produced them. Nothing compares that stamp with the present."""
        snaps = _snaps({"vfd_comm_ok": True, "vfd_frequency": 300}, ts=OLD)
        assert snaps and all(s.quality == "good" and s.ts == OLD for s in snaps)

    @pytest.mark.xfail(strict=True, reason=f"age never affects quality — {GAP}")
    def test_an_old_reading_is_not_reported_as_good(self):
        snaps = _snaps({"vfd_comm_ok": True, "vfd_frequency": 300}, ts=OLD)
        assert any(s.quality != "good" for s in snaps)

    def test_pinned_without_a_comms_reading_drive_values_are_good(self):
        """Staleness needs ``vfd_comm_ok`` present AND false."""
        snaps = _snaps({"vfd_frequency": 300})
        assert snaps and all(s.quality == "good" for s in snaps)

    @pytest.mark.xfail(strict=True, reason=f"unknown comms state is treated as good — {GAP}")
    def test_without_a_comms_reading_drive_values_are_not_good(self):
        assert all(s.quality != "good" for s in _snaps({"vfd_frequency": 300}))


# ── Command is not feedback ───────────────────────────────────────────────────

MISMATCH = {
    "vfd_comm_ok": True,
    "vfd_cmd_word": FWD_RUN,
    "vfd_status_word": STOPPED,
    "vfd_frequency": 0,
    "vfd_fault_code": 0,
}


class TestCommandIsNotFeedback:
    def test_the_status_block_labels_the_command_as_a_command(self):
        from shared.live_snapshot import render_status_block

        block = render_status_block(_snaps({"vfd_cmd_word": FWD_RUN}))
        assert "Command: FWD+RUN" in block
        assert "Drive state" not in block

    def test_positive_control_real_feedback_reports_running(self):
        """The nearby valid case: with output-frequency feedback, "running" is earned."""
        text = _assess(
            {
                "vfd_comm_ok": True,
                "vfd_cmd_word": FWD_RUN,
                "vfd_frequency": 300,
                "vfd_fault_code": 0,
            }
        )
        assert text is not None and "Machine running" in text

    def test_pinned_a_run_command_alone_is_summarised_as_running(self):
        """No status word, no frequency, no current — only what the PLC asked for."""
        assert _assess({"vfd_cmd_word": FWD_RUN}) == "Machine running. No active VFD fault."

    @pytest.mark.xfail(strict=True, reason=f"a RUN command is taken as feedback — {GAP}")
    def test_a_run_command_alone_is_not_summarised_as_running(self):
        assert "Machine running" not in (_assess({"vfd_cmd_word": FWD_RUN}) or "")

    def test_pinned_a_run_command_overrides_feedback_that_says_stopped(self):
        """Commanded to run, drive reports STOPPED at 0 Hz — the mismatch a technician
        most needs to see — is summarised as running."""
        text = _assess(MISMATCH)
        assert text is not None and text.startswith("Machine running") and "0.0 Hz" in text

    @pytest.mark.xfail(strict=True, reason=f"a command/feedback mismatch is hidden — {GAP}")
    def test_a_stopped_drive_with_a_run_command_is_not_summarised_as_running(self):
        assert "Machine running" not in (_assess(MISMATCH) or "")


# ── Missing observations are unknown ──────────────────────────────────────────


class TestMissingObservationsAreUnknown:
    def test_a_missing_tag_produces_no_reading_at_all(self):
        from shared.live_snapshot import render_status_block

        snaps = _snaps({"vfd_frequency": 300, "vfd_fault_code": None, "vfd_current": None})
        assert [s.datapoint for s in snaps] == ["vfd_frequency"]
        assert "fault" not in render_status_block(snaps).lower()

    def test_no_readings_produces_no_assessment(self):
        assert _snaps({}) == []
        assert _assess({}) is None

    def test_positive_control_a_real_zero_fault_code_earns_no_active_fault(self):
        text = _assess({"vfd_comm_ok": True, "vfd_frequency": 300, "vfd_fault_code": 0})
        assert text is not None and "No active VFD fault" in text

    def test_pinned_an_unread_fault_register_is_summarised_as_no_active_fault(self):
        """The fault register was never read; the summary still says fault-free."""
        want = "Machine running (output 3.0 Hz). No active VFD fault."
        assert _assess({"vfd_frequency": 300}) == want
        assert _assess({"vfd_frequency": 300, "vfd_fault_code": None}) == want

    @pytest.mark.xfail(strict=True, reason=f"a missing fault reading is shown as healthy — {GAP}")
    def test_an_unread_fault_register_is_not_summarised_as_no_active_fault(self):
        assert "No active VFD fault" not in (_assess({"vfd_frequency": 300}) or "")
