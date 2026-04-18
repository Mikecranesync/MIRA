"""Tests for the VIM Socket.IO bridge (mira_core.py).

Tests are stubbed — no live server.js connection required. All Socket.IO
emit calls are intercepted and verified without network activity.

Usage:
    cd mira-hud
    uv run --with opencv-python-headless --with numpy --with "python-socketio[asyncio_client]>=5.11" \
      --with pytest --with pytest-timeout pytest vim/tests/test_mira_core.py -v -s
"""

from __future__ import annotations

import time
from unittest.mock import patch

from vim.ar_renderer import AnnotatedBox, OverlayFrame
from vim.classifier import Classification
from vim.config import (
    ClassifierConfig,
    OrchestratorConfig,
    ScannerConfig,
    SessionConfig,
    SessionState,
)
from vim.mira_core import VIMBridge
from vim.orchestrator import VIMOrchestrator
from vim.scene_scanner import BoundingBox
from vim.session import Detection, create_session

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_bridge() -> tuple[VIMBridge, object, object]:
    """Create a VIMBridge with stubbed orchestrator and session."""
    orch = VIMOrchestrator(
        scanner_config=ScannerConfig(),
        classifier_config=ClassifierConfig(),
        session_config=SessionConfig(),
        orchestrator_config=OrchestratorConfig(),
    )
    session = create_session("tech-bridge", equipment_context="CH-46E")
    bridge = VIMBridge("http://localhost:3000", orch, session)
    return bridge, orch, session


def _make_detection(class_name: str = "vfd") -> Detection:
    """Create a Detection for testing."""
    bbox = BoundingBox(x=100, y=100, w=200, h=150, area=30000, aspect_ratio=1.333)
    cls = Classification(
        class_name=class_name,
        confidence=0.85,
        bbox=bbox,
        yolo_class_id=0,
        yolo_class_name=class_name,
    )
    now = time.time()
    return Detection(
        detection_id="det-001",
        classification=cls,
        first_seen=now,
        last_seen=now,
    )


def _make_overlay_frame() -> OverlayFrame:
    """Create a sample OverlayFrame for serialization tests."""
    bbox = BoundingBox(x=100, y=100, w=200, h=150, area=30000, aspect_ratio=1.333)
    box = AnnotatedBox(
        box=bbox,
        label="Vfd",
        confidence=0.85,
        color="#00FFFF",
        selected=True,
    )
    return OverlayFrame(
        mode="SCANNING",
        bounding_boxes=[box],
        hud_manifest=["1. Vfd [85%]"],
        procedure_step=None,
        procedure_progress=None,
        diagram_image=None,
        warnings=["WARNING: High voltage"],
        cautions=[],
        mode_indicator="SCANNING",
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_bridge_instantiates():
    """VIMBridge must instantiate without error."""
    bridge, orch, session = _make_bridge()
    assert bridge is not None
    assert bridge._server_url == "http://localhost:3000"
    assert bridge._session.technician_id == "tech-bridge"
    print("\n  VIMBridge instantiated OK")


def test_serialize_overlay_frame():
    """emit_vision_update must serialize OverlayFrame to dict without error."""
    bridge, _, _ = _make_bridge()
    frame = _make_overlay_frame()

    data = bridge._serialize_overlay(frame)

    assert isinstance(data, dict)
    assert data["mode"] == "SCANNING"
    assert len(data["bounding_boxes"]) == 1
    assert data["bounding_boxes"][0]["box"]["x"] == 100
    assert data["bounding_boxes"][0]["label"] == "Vfd"
    assert data["bounding_boxes"][0]["confidence"] == 0.85
    assert data["hud_manifest"] == ["1. Vfd [85%]"]
    assert data["warnings"] == ["WARNING: High voltage"]
    assert data["procedure_step"] is None
    print(f"\n  Serialized: {list(data.keys())}")


def test_on_tech_query_with_component():
    """on_tech_query with component name in payload must call on_component_selected."""
    bridge, orch, session = _make_bridge()

    # Add a VFD detection to manifest
    det = _make_detection("vfd")
    session.component_manifest.append(det)
    session.current_state = SessionState.MANIFEST_READY

    with patch.object(orch, "on_component_selected") as mock_select:
        bridge.on_tech_query({"query_text": "How do I maintain the vfd unit?"})
        mock_select.assert_called_once()
        call_args = mock_select.call_args
        assert call_args[0][1].classification.class_name == "vfd"
        print("\n  on_tech_query: matched 'vfd', called on_component_selected")


def test_on_tech_query_no_component():
    """on_tech_query with no component name must not crash."""
    bridge, orch, session = _make_bridge()

    with patch.object(orch, "on_component_selected") as mock_select:
        bridge.on_tech_query({"query_text": "What is the weather today?"})
        mock_select.assert_not_called()
        print("\n  on_tech_query: no component match, no crash")


def test_on_session_reset():
    """on_session_reset must transition session to IDLE."""
    bridge, _, session = _make_bridge()
    session.current_state = SessionState.PROCEDURE_ACTIVE

    bridge.on_session_reset({})

    assert session.current_state == SessionState.IDLE
    print("\n  on_session_reset: session is IDLE")
