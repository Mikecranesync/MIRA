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
not, the test is a strict ``known_gap``: it pins today's exact behaviour AND requires
the wanted assertion to fail. When someone repairs the path the test goes red and says
so — it cannot silently keep passing. Tracker for these gaps: issue #5528.
"""

from __future__ import annotations

import pytest

UNS = "enterprise.site.line.cv"
FWD_RUN = 18  # GS10 command word: forward + run
STOPPED = 0  # GS10 status word: stopped


def known_gap(issue: str, pinned, wanted) -> None:
    """Pin today's behaviour, and require the wanted behaviour to be absent."""
    pinned()
    try:
        wanted()
    except AssertionError:
        return
    pytest.fail(
        f"{issue} looks REPAIRED: the wanted behaviour now holds. "
        "Convert this known_gap into a plain assertion."
    )


def _snaps(tags: dict, ts: str = "t0"):
    from shared.live_snapshot import normalize

    return normalize(tags, UNS, source="t", ts=ts)


def _assess(tags: dict) -> str | None:
    from shared.live_snapshot import assess_snapshots

    return assess_snapshots(_snaps(tags))


# ── Timestamp and quality ─────────────────────────────────────────────────────


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

    def test_KNOWN_GAP_the_timestamp_is_the_callers_clock_not_the_readings(self):
        """One ``ts`` is stamped on the whole dictionary. Both production callers pass
        ``datetime.now()``, so the stamp is when MIRA received the tags, not when the
        drive produced them — an old reading is indistinguishable from a fresh one."""
        import inspect

        from shared import live_snapshot

        params = inspect.signature(live_snapshot.normalize).parameters

        def pinned():
            assert "ts" in params
            snaps = _snaps(
                {"vfd_comm_ok": True, "vfd_frequency": 300}, ts="2001-01-01T00:00:00+00:00"
            )
            # A reading stamped a quarter-century ago is still "good".
            assert all(s.quality == "good" for s in snaps)

        def wanted():
            snaps = _snaps(
                {"vfd_comm_ok": True, "vfd_frequency": 300}, ts="2001-01-01T00:00:00+00:00"
            )
            assert any(s.quality == "stale" for s in snaps)

        known_gap("#5528 age-based staleness", pinned, wanted)

    def test_KNOWN_GAP_unknown_comms_state_is_treated_as_good(self):
        """Staleness needs ``vfd_comm_ok`` to be present AND false. With the comms tag
        absent the drive values are reported good, not unknown."""

        def pinned():
            assert all(s.quality == "good" for s in _snaps({"vfd_frequency": 300}))

        def wanted():
            assert all(s.quality != "good" for s in _snaps({"vfd_frequency": 300}))

        known_gap("#5528 quality without a comms reading", pinned, wanted)


# ── Command is not feedback ───────────────────────────────────────────────────


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

    def test_KNOWN_GAP_a_run_command_alone_is_reported_as_the_machine_running(self):
        """No status word, no frequency, no current — only what the PLC asked for."""

        def pinned():
            assert _assess({"vfd_cmd_word": FWD_RUN}) == "Machine running. No active VFD fault."

        def wanted():
            assert "Machine running" not in (_assess({"vfd_cmd_word": FWD_RUN}) or "")

        known_gap("#5528 command taken as feedback", pinned, wanted)

    def test_KNOWN_GAP_run_command_overrides_feedback_that_says_stopped(self):
        """Commanded to run, drive reports STOPPED at 0 Hz — the mismatch a technician
        most needs to see — is summarised as running."""
        tags = {
            "vfd_comm_ok": True,
            "vfd_cmd_word": FWD_RUN,
            "vfd_status_word": STOPPED,
            "vfd_frequency": 0,
            "vfd_fault_code": 0,
        }

        def pinned():
            text = _assess(tags)
            assert text is not None and text.startswith("Machine running") and "0.0 Hz" in text

        def wanted():
            assert "Machine running" not in (_assess(tags) or "")

        known_gap("#5528 command/feedback mismatch hidden", pinned, wanted)


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

    def test_KNOWN_GAP_no_fault_reading_is_reported_as_no_active_fault(self):
        """The fault register was never read. The summary still says the drive is
        fault-free — a missing observation shown as a healthy value."""

        def pinned():
            assert (
                _assess({"vfd_frequency": 300})
                == "Machine running (output 3.0 Hz). No active VFD fault."
            )
            assert _assess({"vfd_frequency": 300, "vfd_fault_code": None}) == _assess(
                {"vfd_frequency": 300}
            )

        def wanted():
            assert "No active VFD fault" not in (_assess({"vfd_frequency": 300}) or "")

        known_gap("#5528 missing fault reading shown as healthy", pinned, wanted)
