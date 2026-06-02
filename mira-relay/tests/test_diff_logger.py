"""Unit tests for mira-relay/diff_logger.py.

All tests are pure-function, no DB, no relay dependency.
Tests cover:
  - rising_edge / falling_edge for boolean tags
  - value_changed above and below threshold for numeric tags
  - fault_window_open + fault_window_close with correct window_start back-ref
  - allowlist drop (tag not in approved set is silently skipped)
  - first-call with no prev snapshot emits nothing
  - fault_window_close with no prior open (window_start = None, no crash)
"""
from __future__ import annotations

import sys
import os

# Allow running directly without pytest: python3 mira-relay/tests/test_diff_logger.py
# The pythonpath in pyproject.toml covers pytest runs; this covers the direct case.
_relay_dir = os.path.join(os.path.dirname(__file__), "..")
if _relay_dir not in sys.path:
    sys.path.insert(0, _relay_dir)

from datetime import datetime, timezone

import pytest

from diff_logger import (
    DiffLogger,
    detect_events,
    is_allowlisted,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TS = datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc)
TS2 = datetime(2026, 6, 2, 12, 0, 1, tzinfo=timezone.utc)
TENANT = "00000000-0000-0000-0000-000000000001"


def _approved_bool(tag_id: str, uns_path: str = "enterprise.garage.cv001") -> dict:
    """Return an approved-tags entry for a boolean tag."""
    return {tag_id: {"data_type": "bool", "threshold": None, "uns_path": uns_path}}


def _approved_float(
    tag_id: str, threshold: float = 0.0, uns_path: str = "enterprise.garage.cv001"
) -> dict:
    """Return an approved-tags entry for a float tag with given threshold."""
    return {tag_id: {"data_type": "float", "threshold": threshold, "uns_path": uns_path}}


def _approved_fault(tag_id: str, uns_path: str = "enterprise.garage.cv001") -> dict:
    """Return an approved-tags entry for a fault-code tag."""
    return {tag_id: {"data_type": "fault", "threshold": None, "uns_path": uns_path}}


def _detect(
    prev: dict | None,
    curr: dict,
    approved: dict | None = None,
    fault_windows: dict | None = None,
) -> list[dict]:
    """Convenience wrapper for detect_events with sensible defaults."""
    return detect_events(
        prev_snapshot=prev,
        curr_snapshot=curr,
        approved=approved or {},
        thresholds={},
        fault_windows=fault_windows if fault_windows is not None else {},
        tenant_id=TENANT,
        ts=TS,
    )


# ---------------------------------------------------------------------------
# Allowlist tests
# ---------------------------------------------------------------------------


class TestIsAllowlisted:
    def test_empty_approved_is_pass_all(self):
        assert is_allowlisted("any.tag", {}) is True

    def test_tag_in_approved(self):
        approved = {"CONV-001.motor_running": {"data_type": "bool"}}
        assert is_allowlisted("CONV-001.motor_running", approved) is True

    def test_tag_not_in_approved(self):
        approved = {"CONV-001.motor_running": {"data_type": "bool"}}
        assert is_allowlisted("CONV-001.temperature", approved) is False


# ---------------------------------------------------------------------------
# detect_events — no prev snapshot
# ---------------------------------------------------------------------------


class TestNoPrevSnapshot:
    def test_no_events_on_first_call(self):
        curr = {"CONV-001.motor_running": 1.0, "CONV-001.temperature": 45.2}
        events = _detect(prev=None, curr=curr)
        assert events == []


# ---------------------------------------------------------------------------
# Boolean tag — rising_edge / falling_edge
# ---------------------------------------------------------------------------


class TestBooleanEvents:
    def test_rising_edge(self):
        tag = "CONV-001.motor_running"
        approved = _approved_bool(tag)
        prev = {tag: 0.0}
        curr = {tag: 1.0}
        events = _detect(prev, curr, approved)
        assert len(events) == 1
        ev = events[0]
        assert ev["event_type"] == "rising_edge"
        assert ev["tag_id"] == tag
        assert ev["prev_value"] == 0.0
        assert ev["new_value"] == 1.0
        assert ev["delta"] is None

    def test_falling_edge(self):
        tag = "CONV-001.motor_running"
        approved = _approved_bool(tag)
        prev = {tag: 1.0}
        curr = {tag: 0.0}
        events = _detect(prev, curr, approved)
        assert len(events) == 1
        ev = events[0]
        assert ev["event_type"] == "falling_edge"
        assert ev["tag_id"] == tag

    def test_no_event_when_unchanged(self):
        tag = "CONV-001.motor_running"
        approved = _approved_bool(tag)
        prev = {tag: 1.0}
        curr = {tag: 1.0}
        events = _detect(prev, curr, approved)
        assert events == []

    def test_both_transitions_in_one_batch(self):
        """Two bools in the same batch: one rises, one falls."""
        approved = {
            **_approved_bool("CONV-001.motor_running"),
            **_approved_bool("CONV-001.fault_alarm"),
        }
        prev = {"CONV-001.motor_running": 0.0, "CONV-001.fault_alarm": 1.0}
        curr = {"CONV-001.motor_running": 1.0, "CONV-001.fault_alarm": 0.0}
        events = _detect(prev, curr, approved)
        types = {e["tag_id"]: e["event_type"] for e in events}
        assert types["CONV-001.motor_running"] == "rising_edge"
        assert types["CONV-001.fault_alarm"] == "falling_edge"


# ---------------------------------------------------------------------------
# Numeric tag — value_changed above / below threshold
# ---------------------------------------------------------------------------


class TestNumericThreshold:
    def test_value_changed_above_threshold(self):
        tag = "CONV-001.temperature"
        approved = _approved_float(tag, threshold=1.0)
        prev = {tag: 45.0}
        curr = {tag: 47.0}  # delta = 2.0 > 1.0
        events = _detect(prev, curr, approved)
        assert len(events) == 1
        ev = events[0]
        assert ev["event_type"] == "value_changed"
        assert ev["delta"] == pytest.approx(2.0)
        assert ev["threshold"] == pytest.approx(1.0)
        assert ev["prev_value"] == pytest.approx(45.0)
        assert ev["new_value"] == pytest.approx(47.0)

    def test_value_NOT_changed_below_threshold(self):
        tag = "CONV-001.temperature"
        approved = _approved_float(tag, threshold=5.0)
        prev = {tag: 45.0}
        curr = {tag: 46.0}  # delta = 1.0 < 5.0 → no event
        events = _detect(prev, curr, approved)
        assert events == []

    def test_value_changed_exactly_at_threshold_boundary(self):
        """abs(delta) == threshold → no event (strictly greater is required)."""
        tag = "CONV-001.temperature"
        approved = _approved_float(tag, threshold=2.0)
        prev = {tag: 45.0}
        curr = {tag: 47.0}  # abs(delta) == 2.0 == threshold → no event
        events = _detect(prev, curr, approved)
        assert events == []  # <=, not <, so exactly at boundary is not emitted

    def test_default_threshold_zero_emits_any_change(self):
        """No approved entry → threshold=0.0 → any change is an event."""
        tag = "CONV-001.speed"
        prev = {tag: 100.0}
        curr = {tag: 100.01}  # tiny change
        events = _detect(prev, curr)  # approved={}  → pass-all + threshold=0.0
        assert len(events) == 1
        ev = events[0]
        assert ev["event_type"] == "value_changed"


# ---------------------------------------------------------------------------
# Fault-code tags — fault_window_open / fault_window_close
# ---------------------------------------------------------------------------


class TestFaultWindow:
    def test_fault_window_open(self):
        tag = "CONV-001.error_code"
        approved = _approved_fault(tag)
        fault_windows: dict = {}
        prev = {tag: 0}
        curr = {tag: 4}  # F0004
        events = detect_events(
            prev_snapshot=prev,
            curr_snapshot=curr,
            approved=approved,
            thresholds={},
            fault_windows=fault_windows,
            tenant_id=TENANT,
            ts=TS,
        )
        assert len(events) == 1
        ev = events[0]
        assert ev["event_type"] == "fault_window_open"
        assert ev["fault_code"] == "4"
        assert ev["window_start"] == TS
        assert ev["window_end"] is None
        # Fault window state should be recorded.
        assert (TENANT, tag) in fault_windows

    def test_fault_window_close_with_window_start(self):
        tag = "CONV-001.error_code"
        approved = _approved_fault(tag)
        fault_windows: dict = {(TENANT, tag): TS}  # pre-populate open window

        prev = {tag: 4}  # fault was active
        curr = {tag: 0}  # fault cleared
        events = detect_events(
            prev_snapshot=prev,
            curr_snapshot=curr,
            approved=approved,
            thresholds={},
            fault_windows=fault_windows,
            tenant_id=TENANT,
            ts=TS2,
        )
        assert len(events) == 1
        ev = events[0]
        assert ev["event_type"] == "fault_window_close"
        assert ev["fault_code"] == "4"
        assert ev["window_start"] == TS   # correctly back-referenced
        assert ev["window_end"] == TS2
        # Window should be removed from the map on close.
        assert (TENANT, tag) not in fault_windows

    def test_fault_window_open_then_close_full_cycle(self):
        """End-to-end open + close via DiffLogger (stateful wrapper)."""
        dl = DiffLogger()
        tag = "CONV-001.error_code"
        approved = _approved_fault(tag)

        # First poll: no fault.
        rows1 = dl.process_batch(TENANT, approved, {tag: {"v": 0, "q": "Good"}}, "batch-1", TS)
        assert rows1 == []  # No prev snapshot yet — no events.

        # Second poll: fault appears.
        rows2 = dl.process_batch(TENANT, approved, {tag: {"v": 4, "q": "Good"}}, "batch-2", TS)
        assert len(rows2) == 1
        assert rows2[0]["event_type"] == "fault_window_open"
        assert rows2[0]["window_start"] == TS

        # Third poll: fault clears.
        rows3 = dl.process_batch(TENANT, approved, {tag: {"v": 0, "q": "Good"}}, "batch-3", TS2)
        assert len(rows3) == 1
        assert rows3[0]["event_type"] == "fault_window_close"
        assert rows3[0]["window_start"] == TS    # back-ref to open time
        assert rows3[0]["window_end"] == TS2

    def test_fault_window_close_without_prior_open(self):
        """Relay restarted mid-fault — close with no stored window_start."""
        tag = "CONV-001.error_code"
        approved = _approved_fault(tag)
        fault_windows: dict = {}  # empty — no open window tracked

        prev = {tag: 4}  # relay just started; fault was already active
        curr = {tag: 0}  # fault now cleared
        events = detect_events(
            prev_snapshot=prev,
            curr_snapshot=curr,
            approved=approved,
            thresholds={},
            fault_windows=fault_windows,
            tenant_id=TENANT,
            ts=TS2,
        )
        assert len(events) == 1
        ev = events[0]
        assert ev["event_type"] == "fault_window_close"
        assert ev["window_start"] is None   # no crash; window_start = NULL
        assert ev["window_end"] == TS2


# ---------------------------------------------------------------------------
# Allowlist drop
# ---------------------------------------------------------------------------


class TestAllowlistDrop:
    def test_tag_not_in_approved_is_dropped(self):
        """A tag not in the approved set should produce no events."""
        approved = _approved_bool("CONV-001.motor_running")  # only this tag
        prev = {
            "CONV-001.motor_running": 0.0,
            "CONV-001.temperature": 45.0,  # NOT in approved
        }
        curr = {
            "CONV-001.motor_running": 1.0,
            "CONV-001.temperature": 60.0,  # would emit value_changed if allowed
        }
        events = _detect(prev, curr, approved)
        assert len(events) == 1
        assert events[0]["tag_id"] == "CONV-001.motor_running"
        assert events[0]["event_type"] == "rising_edge"

    def test_empty_approved_passes_all_tags(self):
        """Empty approved set = no allowlist = all tags pass through."""
        prev = {
            "CONV-001.motor_running": 0.0,
            "CONV-001.temperature": 45.0,
        }
        curr = {
            "CONV-001.motor_running": 1.0,
            "CONV-001.temperature": 60.0,
        }
        events = _detect(prev, curr, approved={})
        # Both tags should emit events (rising_edge + value_changed).
        assert len(events) == 2


# ---------------------------------------------------------------------------
# DiffLogger stateful snapshot management
# ---------------------------------------------------------------------------


class TestDiffLoggerSnapshots:
    def test_first_batch_emits_no_events(self):
        dl = DiffLogger()
        tags = {"CONV-001.motor_running": {"v": 1.0, "q": "Good"}}
        rows = dl.process_batch(TENANT, {}, tags, "batch-1", TS)
        assert rows == []

    def test_second_batch_detects_change(self):
        dl = DiffLogger()
        tag = "CONV-001.temperature"
        approved = _approved_float(tag, threshold=0.5)

        # First batch: baseline.
        dl.process_batch(TENANT, approved, {tag: {"v": 45.0}}, "b1", TS)

        # Second batch: change > threshold.
        rows = dl.process_batch(TENANT, approved, {tag: {"v": 47.5}}, "b2", TS2)
        assert len(rows) == 1
        assert rows[0]["event_type"] == "value_changed"

    def test_relay_batch_id_attached(self):
        dl = DiffLogger()
        tag = "CONV-001.motor_running"
        approved = _approved_bool(tag)

        dl.process_batch(TENANT, approved, {tag: {"v": 0.0}}, "batch-0", TS)
        rows = dl.process_batch(TENANT, approved, {tag: {"v": 1.0}}, "batch-1", TS2)

        assert len(rows) == 1
        assert rows[0]["relay_batch_id"] == "batch-1"

    def test_event_id_is_uuid_string(self):
        import uuid as _uuid

        dl = DiffLogger()
        tag = "CONV-001.motor_running"
        approved = _approved_bool(tag)

        dl.process_batch(TENANT, approved, {tag: {"v": 0.0}}, "b0", TS)
        rows = dl.process_batch(TENANT, approved, {tag: {"v": 1.0}}, "b1", TS2)

        assert len(rows) == 1
        # Should be a valid UUID string.
        _uuid.UUID(rows[0]["event_id"])  # raises if invalid


# ---------------------------------------------------------------------------
# Direct runner (no pytest required)
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    import traceback

    test_classes = [
        TestIsAllowlisted,
        TestNoPrevSnapshot,
        TestBooleanEvents,
        TestNumericThreshold,
        TestFaultWindow,
        TestAllowlistDrop,
        TestDiffLoggerSnapshots,
    ]

    passed = 0
    failed = 0
    for cls in test_classes:
        instance = cls()
        methods = [m for m in dir(instance) if m.startswith("test_")]
        for method_name in methods:
            try:
                getattr(instance, method_name)()
                print(f"  PASS  {cls.__name__}.{method_name}")
                passed += 1
            except Exception:
                print(f"  FAIL  {cls.__name__}.{method_name}")
                traceback.print_exc()
                failed += 1

    print(f"\n{'='*60}")
    print(f"Results: {passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
