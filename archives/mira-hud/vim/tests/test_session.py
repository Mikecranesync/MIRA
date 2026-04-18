"""Tests for the VIM session state machine (Layer 3).

Tests state transitions, IoU deduplication, stale marking, manifest capping,
session logging, and step advancement edge cases.

Usage:
    cd mira-hud
    uv run --with opencv-python-headless --with numpy --with pytest \
      pytest vim/tests/test_session.py -v -s
"""

from __future__ import annotations

import time

from vim.classifier import Classification
from vim.config import SessionConfig, SessionState
from vim.scene_scanner import BoundingBox
from vim.session import (
    Detection,
    _iou,
    advance_step,
    complete_session,
    create_session,
    load_procedure,
    reset_session,
    select_component,
    update_manifest,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_classification(
    class_name: str = "vfd",
    confidence: float = 0.85,
    x: int = 100,
    y: int = 100,
    w: int = 200,
    h: int = 150,
) -> Classification:
    """Create a Classification with a given bounding box."""
    bbox = BoundingBox(x=x, y=y, w=w, h=h, area=w * h, aspect_ratio=round(w / h, 3))
    return Classification(
        class_name=class_name,
        confidence=confidence,
        bbox=bbox,
        yolo_class_id=0,
        yolo_class_name=class_name,
    )


def _make_detection(
    class_name: str = "vfd",
    x: int = 100,
    y: int = 100,
    w: int = 200,
    h: int = 150,
) -> Detection:
    """Create a Detection for testing."""
    cls = _make_classification(class_name=class_name, x=x, y=y, w=w, h=h)
    now = time.time()
    return Detection(
        detection_id="test-det-001",
        classification=cls,
        first_seen=now,
        last_seen=now,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_forward_state_transitions():
    """All 5 forward state transitions must succeed in order."""
    config = SessionConfig()

    # IDLE → SCANNING (first update_manifest with detections)
    session = create_session("tech-001", equipment_context="CH-46E")
    assert session.current_state == SessionState.IDLE

    cls1 = _make_classification("vfd", x=100, y=100, w=200, h=150)
    session = update_manifest(session, [cls1], config)
    assert session.current_state == SessionState.SCANNING

    # SCANNING → MANIFEST_READY (second update_manifest)
    session = update_manifest(session, [cls1], config)
    assert session.current_state == SessionState.MANIFEST_READY

    # MANIFEST_READY → COMPONENT_SELECTED
    det = session.component_manifest[0]
    session = select_component(session, det)
    assert session.current_state == SessionState.COMPONENT_SELECTED

    # COMPONENT_SELECTED → PROCEDURE_ACTIVE
    steps = ["Step 1: De-energize", "Step 2: LOTO", "Step 3: Inspect"]
    session = load_procedure(session, steps, rag_context="TM 55-1520 Chapter 4")
    assert session.current_state == SessionState.PROCEDURE_ACTIVE

    # PROCEDURE_ACTIVE → IDLE
    session = complete_session(session)
    assert session.current_state == SessionState.IDLE

    print("\n  All 5 forward transitions passed")


def test_reset_from_every_state():
    """reset_session must return to IDLE from every state."""
    config = SessionConfig()

    for target_state in SessionState:
        session = create_session("tech-reset")

        # Drive session to target state
        if target_state == SessionState.IDLE:
            pass  # already there
        elif target_state == SessionState.SCANNING:
            cls1 = _make_classification("relay")
            session = update_manifest(session, [cls1], config)
        elif target_state == SessionState.MANIFEST_READY:
            cls1 = _make_classification("relay")
            session = update_manifest(session, [cls1], config)
            session = update_manifest(session, [cls1], config)
        elif target_state == SessionState.COMPONENT_SELECTED:
            cls1 = _make_classification("relay")
            session = update_manifest(session, [cls1], config)
            session = update_manifest(session, [cls1], config)
            session = select_component(session, session.component_manifest[0])
        elif target_state == SessionState.PROCEDURE_ACTIVE:
            cls1 = _make_classification("relay")
            session = update_manifest(session, [cls1], config)
            session = update_manifest(session, [cls1], config)
            session = select_component(session, session.component_manifest[0])
            session = load_procedure(session, ["Step 1"])

        assert session.current_state == target_state
        session = reset_session(session)
        assert session.current_state == SessionState.IDLE, (
            f"reset from {target_state.value} did not return to IDLE"
        )

    print(f"\n  Reset from all {len(SessionState)} states passed")


def test_iou_dedup_high_overlap():
    """Two detections with >0.7 IoU + same class → manifest has 1 item."""
    config = SessionConfig()
    session = create_session("tech-iou")

    # First detection
    cls1 = _make_classification("vfd", x=100, y=100, w=200, h=150)
    session = update_manifest(session, [cls1], config)

    # Second detection — nearly identical bbox (shifted 10px), same class
    cls2 = _make_classification("vfd", x=110, y=105, w=200, h=150)
    session = update_manifest(session, [cls2], config)

    active = [d for d in session.component_manifest if d.status == "active"]
    assert len(active) == 1, f"Expected 1 active, got {len(active)}"

    # Verify IoU is actually >0.7
    iou_val = _iou(cls1.bbox, cls2.bbox)
    assert iou_val > 0.7, f"IoU {iou_val} should be > 0.7"
    print(f"\n  IoU dedup: {iou_val:.3f} -> 1 item in manifest")


def test_iou_dedup_low_overlap():
    """Two detections with <0.7 IoU → manifest has 2 items."""
    config = SessionConfig()
    session = create_session("tech-iou-low")

    # Two detections far apart
    cls1 = _make_classification("vfd", x=100, y=100, w=200, h=150)
    cls2 = _make_classification("vfd", x=500, y=500, w=200, h=150)
    session = update_manifest(session, [cls1, cls2], config)

    active = [d for d in session.component_manifest if d.status == "active"]
    assert len(active) == 2, f"Expected 2 active, got {len(active)}"

    iou_val = _iou(cls1.bbox, cls2.bbox)
    assert iou_val < 0.7, f"IoU {iou_val} should be < 0.7"
    print(f"\n  Low IoU: {iou_val:.3f} -> 2 items in manifest")


def test_stale_detection():
    """Component absent >15 seconds → status is 'stale'."""
    config = SessionConfig(stale_timeout_s=15.0)
    session = create_session("tech-stale")

    # Add a detection
    cls1 = _make_classification("relay", x=100, y=100, w=200, h=150)
    session = update_manifest(session, [cls1], config)
    assert session.component_manifest[0].status == "active"

    # Simulate 16 seconds passing by backdating last_seen
    session.component_manifest[0].last_seen = time.time() - 16.0

    # Update with a DIFFERENT detection (the original is now absent)
    cls2 = _make_classification("contactor", x=500, y=500, w=200, h=150)
    session = update_manifest(session, [cls2], config)

    # Find the original relay detection
    relay = [d for d in session.component_manifest if d.classification.class_name == "relay"]
    assert len(relay) == 1
    assert relay[0].status == "stale", f"Expected stale, got {relay[0].status}"
    print("\n  Stale detection after 16s: status='stale'")


def test_max_manifest_cap():
    """9 detections → only 8 active in manifest."""
    config = SessionConfig(max_manifest_items=8)
    session = create_session("tech-cap")

    # Add 9 unique detections at different positions
    classifications = [
        _make_classification(f"component_{i}", x=i * 250, y=100, w=100, h=100) for i in range(9)
    ]
    session = update_manifest(session, classifications, config)

    active = [d for d in session.component_manifest if d.status == "active"]
    assert len(active) <= 8, f"Expected <=8 active, got {len(active)}"
    assert len(session.component_manifest) == 9, "All 9 should still be in manifest"
    print(f"\n  Manifest cap: {len(active)} active / {len(session.component_manifest)} total")


def test_session_log_captures_transitions():
    """Session log must capture all state transitions with timestamps."""
    config = SessionConfig()
    session = create_session("tech-log")

    # Drive through transitions
    cls1 = _make_classification("vfd")
    session = update_manifest(session, [cls1], config)
    session = update_manifest(session, [cls1], config)
    session = select_component(session, session.component_manifest[0])
    session = load_procedure(session, ["Step 1"])
    session = complete_session(session)

    # Check log
    assert len(session.session_log) > 0, "Session log is empty"

    transition_events = [e for e in session.session_log if e["event"] == "state_transition"]
    assert len(transition_events) >= 4, (
        f"Expected >=4 state transitions, got {len(transition_events)}"
    )

    # All events must have timestamps
    for event in session.session_log:
        assert "timestamp" in event, f"Event missing timestamp: {event}"
        assert isinstance(event["timestamp"], float)

    print(
        f"\n  Session log: {len(session.session_log)} events, {len(transition_events)} transitions"
    )
    for e in session.session_log:
        print(f"    {e['event']}: {e}")


def test_advance_step_clamps_at_max():
    """advance_step at last step must not crash (clamps to max index)."""
    session = create_session("tech-step")
    session.active_procedure_steps = ["Step 1", "Step 2", "Step 3"]
    session.current_step_index = 0

    # Advance to step 1
    session = advance_step(session)
    assert session.current_step_index == 1

    # Advance to step 2 (last)
    session = advance_step(session)
    assert session.current_step_index == 2

    # Advance past end — should clamp, not crash
    session = advance_step(session)
    assert session.current_step_index == 2, (
        f"Expected clamped at 2, got {session.current_step_index}"
    )

    # Advance again — still clamped
    session = advance_step(session)
    assert session.current_step_index == 2

    print("\n  advance_step clamps at max index (2)")
