"""Tests for the VIM AR overlay renderer (Layer 5).

Tests mode-based display rules, WARNING/CAUTION extraction, manifest
capping, and edge cases.

Usage:
    cd mira-hud
    uv run --with opencv-python-headless --with numpy --with pytest \
      pytest vim/tests/test_ar_renderer.py -v -s
"""

from __future__ import annotations

import time

from vim.ar_renderer import OverlayFrame, render_overlay
from vim.classifier import Classification
from vim.config import SessionConfig, SessionState
from vim.scene_scanner import BoundingBox
from vim.session import (
    Detection,
    create_session,
    load_procedure,
    select_component,
    update_manifest,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_detection(
    class_name: str = "vfd",
    confidence: float = 0.85,
    x: int = 100,
    y: int = 100,
    w: int = 200,
    h: int = 150,
    det_id: str = "det-001",
    tm_reference: str | None = None,
) -> Detection:
    """Create a Detection for testing."""
    bbox = BoundingBox(x=x, y=y, w=w, h=h, area=w * h, aspect_ratio=round(w / h, 3))
    cls = Classification(
        class_name=class_name,
        confidence=confidence,
        bbox=bbox,
        yolo_class_id=0,
        yolo_class_name=class_name,
    )
    now = time.time()
    return Detection(
        detection_id=det_id,
        classification=cls,
        first_seen=now,
        last_seen=now,
        tm_reference=tm_reference,
    )


def _make_scanning_session_with_detections(n: int = 3) -> tuple:
    """Create a session in MANIFEST_READY with n detections."""
    config = SessionConfig()
    session = create_session("tech-test", equipment_context="CH-46E")

    detections = []
    classifications = []
    for i in range(n):
        cls = Classification(
            class_name=f"component_{i}",
            confidence=0.9 - i * 0.05,
            bbox=BoundingBox(x=i * 250, y=100, w=150, h=100, area=15000, aspect_ratio=1.5),
            yolo_class_id=i,
            yolo_class_name=f"component_{i}",
        )
        classifications.append(cls)

    # Drive to MANIFEST_READY
    session = update_manifest(session, classifications, config)
    session = update_manifest(session, classifications, config)
    detections = [d for d in session.component_manifest if d.status == "active"]
    return session, detections


RAG_WITH_WARNINGS = """
This section covers hydraulic system maintenance.
WARNING: De-energize all circuits before servicing hydraulic lines.
Normal operation requires 3000 PSI system pressure.
CAUTION: Do not exceed maximum torque specification of 45 ft-lbs.
WARNING: Hydraulic fluid is flammable. No open flames.
Check filter differential pressure gauge.
caution: wear safety glasses when handling hydraulic fittings.
"""


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_scanning_mode():
    """SCANNING mode: all boxes white, manifest populated, procedure_step is None."""
    session, detections = _make_scanning_session_with_detections(3)

    frame = render_overlay(session, detections)

    assert isinstance(frame, OverlayFrame)
    assert frame.mode == "SCANNING"
    assert len(frame.bounding_boxes) == 3
    for box in frame.bounding_boxes:
        assert box.color == "#FFFFFF"
        assert box.selected is False
    assert len(frame.hud_manifest) == 3
    assert frame.procedure_step is None
    assert frame.procedure_progress is None
    print(f"\n  SCANNING: {len(frame.bounding_boxes)} white boxes, {len(frame.hud_manifest)} items")


def test_focused_mode():
    """FOCUSED mode: selected box cyan, others gray, warnings still present."""
    session, detections = _make_scanning_session_with_detections(3)
    selected = detections[0]
    session = select_component(session, selected)

    frame = render_overlay(session, detections, rag_context=RAG_WITH_WARNINGS)

    assert frame.mode == "FOCUSED"
    cyan_boxes = [b for b in frame.bounding_boxes if b.color == "#00FFFF"]
    gray_boxes = [b for b in frame.bounding_boxes if b.color == "#888888"]
    assert len(cyan_boxes) == 1
    assert len(gray_boxes) == 2
    assert cyan_boxes[0].selected is True
    # Warnings must be present even in FOCUSED mode
    assert len(frame.warnings) >= 2
    print(f"\n  FOCUSED: 1 cyan, 2 gray, {len(frame.warnings)} warnings")


def test_procedure_mode():
    """PROCEDURE mode: manifest minimized, procedure_step populated."""
    session, detections = _make_scanning_session_with_detections(3)
    selected = detections[0]
    session = select_component(session, selected)
    steps = ["Step 1: De-energize", "Step 2: LOTO", "Step 3: Inspect"]
    session = load_procedure(session, steps, rag_context="WARNING: High voltage")

    frame = render_overlay(session, detections, rag_context="WARNING: High voltage")

    assert frame.mode == "PROCEDURE"
    assert len(frame.bounding_boxes) == 1
    assert frame.bounding_boxes[0].color == "#00FFFF"
    assert len(frame.hud_manifest) == 1
    assert frame.procedure_step == "Step 1: De-energize"
    assert frame.procedure_progress == "Step 1 of 3"
    print(
        f"\n  PROCEDURE: 1 box, step='{frame.procedure_step}', progress='{frame.procedure_progress}'"
    )


def test_warnings_in_all_modes():
    """WARNING in rag_context -> appears in warnings list in all three modes."""
    session, detections = _make_scanning_session_with_detections(2)

    # SCANNING
    frame_scan = render_overlay(session, detections, rag_context=RAG_WITH_WARNINGS)
    assert len(frame_scan.warnings) >= 2
    assert len(frame_scan.cautions) >= 2

    # FOCUSED
    session = select_component(session, detections[0])
    frame_focus = render_overlay(session, detections, rag_context=RAG_WITH_WARNINGS)
    assert len(frame_focus.warnings) >= 2
    assert len(frame_focus.cautions) >= 2

    # PROCEDURE
    session = load_procedure(session, ["Step 1"])
    frame_proc = render_overlay(session, detections, rag_context=RAG_WITH_WARNINGS)
    assert len(frame_proc.warnings) >= 2
    assert len(frame_proc.cautions) >= 2

    print(
        f"\n  Warnings present in all 3 modes: "
        f"SCAN={len(frame_scan.warnings)}, FOCUS={len(frame_focus.warnings)}, PROC={len(frame_proc.warnings)}"
    )


def test_manifest_cap_at_8():
    """9 detections -> hud_manifest has exactly 8 items."""
    session, detections = _make_scanning_session_with_detections(9)

    frame = render_overlay(session, detections)

    assert len(frame.hud_manifest) == 8, f"Expected 8, got {len(frame.hud_manifest)}"
    print(f"\n  Manifest cap: {len(frame.hud_manifest)} items from {len(detections)} detections")


def test_none_tm_reference_no_crash():
    """None tm_reference -> no crash, clean output."""
    det = _make_detection("relay", tm_reference=None)
    session = create_session("tech-none", equipment_context="M1 Abrams")

    # Put detection in manifest manually
    session.component_manifest.append(det)
    session.current_state = SessionState.MANIFEST_READY

    frame = render_overlay(session, [det])

    assert isinstance(frame, OverlayFrame)
    assert len(frame.bounding_boxes) == 1
    assert "Relay" in frame.hud_manifest[0]
    print(f"\n  None tm_reference: no crash, manifest='{frame.hud_manifest[0]}'")
