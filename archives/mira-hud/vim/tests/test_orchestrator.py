"""Tests for the VIM scan loop orchestrator (Layer 4).

Tests frame processing, memory leak detection, RAG query generation,
and async scan loop start/stop.

Usage:
    cd mira-hud
    uv run --with opencv-python-headless --with numpy --with ultralytics --with pytest \
      pytest vim/tests/test_orchestrator.py -v -s --timeout=120
"""

from __future__ import annotations

import asyncio
import time
import tracemalloc
from pathlib import Path

import cv2
import numpy as np
import pytest

from vim.classifier import Classification
from vim.config import (
    CameraSourceType,
    ClassifierConfig,
    OrchestratorConfig,
    ScannerConfig,
    SessionConfig,
)
from vim.orchestrator import ManifestUpdateEvent, ProcedureQueryEvent, VIMOrchestrator
from vim.scene_scanner import BoundingBox
from vim.session import Detection, create_session

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


# ---------------------------------------------------------------------------
# Synthetic test video generation
# ---------------------------------------------------------------------------


def _generate_test_video(path: Path, fps: int = 10, duration_s: int = 5) -> None:
    """Generate a synthetic 1080p test video with alternating rectangle frames."""
    width, height = 1920, 1080
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (width, height))

    total_frames = fps * duration_s
    for i in range(total_frames):
        frame = np.ones((height, width, 3), dtype=np.uint8) * 200

        if i % 2 == 0:
            # Frame A: two rectangles (left and center)
            cv2.rectangle(frame, (200, 150), (500, 450), (50, 50, 50), 3)
            cv2.rectangle(frame, (700, 300), (1000, 600), (60, 60, 60), 3)
        else:
            # Frame B: two rectangles (center and right)
            cv2.rectangle(frame, (700, 300), (1000, 600), (60, 60, 60), 3)
            cv2.rectangle(frame, (1200, 100), (1600, 500), (40, 40, 40), 3)

        # Add frame number text
        cv2.putText(
            frame,
            f"Frame {i}",
            (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 0, 0),
            2,
        )
        writer.write(frame)

    writer.release()


@pytest.fixture(scope="module")
def test_video_path() -> Path:
    """Generate synthetic test video (once per module)."""
    path = FIXTURES_DIR / "test_video.mp4"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        _generate_test_video(path)
    return path


@pytest.fixture(scope="module")
def orchestrator(test_video_path) -> VIMOrchestrator:
    """Create an orchestrator configured for the test video."""
    orch_config = OrchestratorConfig(
        source_type=CameraSourceType.FILE,
        video_file_path=str(test_video_path),
        scan_interval_s=0.1,
    )
    return VIMOrchestrator(
        scanner_config=ScannerConfig(),
        classifier_config=ClassifierConfig(),
        session_config=SessionConfig(),
        orchestrator_config=orch_config,
    )


def _make_detection(
    class_name: str = "vfd",
    tm_reference: str | None = None,
) -> Detection:
    """Create a Detection for query string tests."""
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
        detection_id="test-det-001",
        classification=cls,
        first_seen=now,
        last_seen=now,
        tm_reference=tm_reference,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_process_frame_returns_manifest_event(orchestrator):
    """process_frame on a static test image must return ManifestUpdateEvent."""
    session = create_session("tech-001", equipment_context="CH-46E")
    frame = np.ones((1080, 1920, 3), dtype=np.uint8) * 200
    cv2.rectangle(frame, (300, 200), (600, 500), (50, 50, 50), 3)

    event = orchestrator.process_frame(frame, session)

    assert isinstance(event, ManifestUpdateEvent)
    assert isinstance(event.session_id, str)
    assert isinstance(event.detections, list)
    assert isinstance(event.manifest_size, int)
    assert isinstance(event.timestamp, float)
    assert event.manifest_size >= 0
    print(f"\n  ManifestUpdateEvent: {event.manifest_size} detections")


def test_scan_loop_no_memory_leak(test_video_path):
    """10-second scan loop must not leak >10MB of memory."""
    orch_config = OrchestratorConfig(
        source_type=CameraSourceType.FILE,
        video_file_path=str(test_video_path),
        scan_interval_s=0.1,
    )
    orch = VIMOrchestrator(
        scanner_config=ScannerConfig(),
        classifier_config=ClassifierConfig(),
        session_config=SessionConfig(),
        orchestrator_config=orch_config,
    )
    session = create_session("tech-leak-test")

    tracemalloc.start()
    snapshot_before = tracemalloc.take_snapshot()

    async def run_loop():
        loop_task = asyncio.create_task(orch.start(session))
        await asyncio.sleep(10)
        orch.stop()
        try:
            await asyncio.wait_for(loop_task, timeout=5.0)
        except asyncio.TimeoutError:
            loop_task.cancel()

    asyncio.run(run_loop())

    snapshot_after = tracemalloc.take_snapshot()
    tracemalloc.stop()

    # Compare memory
    stats_before = sum(s.size for s in snapshot_before.statistics("filename"))
    stats_after = sum(s.size for s in snapshot_after.statistics("filename"))
    delta_mb = (stats_after - stats_before) / (1024 * 1024)

    assert delta_mb < 10.0, f"Memory leak: {delta_mb:.1f}MB > 10MB threshold"
    print(f"\n  Memory delta: {delta_mb:.1f}MB (threshold: 10MB)")


def test_query_string_format(orchestrator):
    """on_component_selected must return ProcedureQueryEvent with correct query."""
    session = create_session("tech-query", equipment_context="CH-46E")
    det = _make_detection("vfd", tm_reference="TM 55-1520-240-23")

    event = orchestrator.on_component_selected(session, det)

    assert isinstance(event, ProcedureQueryEvent)
    assert "vfd" in event.query_string
    assert "TM 55-1520-240-23" in event.query_string
    assert "maintenance procedure" in event.query_string
    assert "  " not in event.query_string  # no double spaces
    print(f"\n  Query: '{event.query_string}'")


def test_query_includes_equipment_context(orchestrator):
    """Equipment context 'CH-46E' must appear in query string."""
    session = create_session("tech-ctx", equipment_context="CH-46E")
    det = _make_detection("hydraulic_actuator", tm_reference="NAVAIR 01-230")

    event = orchestrator.on_component_selected(session, det)

    assert "CH-46E" in event.query_string
    assert event.equipment_context == "CH-46E"
    print(f"\n  Query with context: '{event.query_string}'")


def test_query_no_none_in_string(orchestrator):
    """tm_reference=None must not produce 'None' in query string."""
    session = create_session("tech-none", equipment_context="M1 Abrams")
    det = _make_detection("relay", tm_reference=None)

    event = orchestrator.on_component_selected(session, det)

    assert "None" not in event.query_string
    assert "relay" in event.query_string
    assert "M1 Abrams" in event.query_string
    print(f"\n  Query (no None): '{event.query_string}'")


def test_stop_after_start_completes(test_video_path):
    """stop() after start() must complete within 2 seconds."""
    orch_config = OrchestratorConfig(
        source_type=CameraSourceType.FILE,
        video_file_path=str(test_video_path),
        scan_interval_s=0.5,
    )
    orch = VIMOrchestrator(
        scanner_config=ScannerConfig(),
        classifier_config=ClassifierConfig(),
        session_config=SessionConfig(),
        orchestrator_config=orch_config,
    )
    session = create_session("tech-stop")

    async def run_and_stop():
        loop_task = asyncio.create_task(orch.start(session))
        await asyncio.sleep(1.0)

        t_stop = time.perf_counter()
        orch.stop()
        try:
            await asyncio.wait_for(loop_task, timeout=2.0)
        except asyncio.TimeoutError:
            loop_task.cancel()
            pytest.fail("stop() did not complete within 2 seconds")

        elapsed = time.perf_counter() - t_stop
        assert elapsed < 2.0, f"stop() took {elapsed:.1f}s (> 2s)"
        return elapsed

    elapsed = asyncio.run(run_and_stop())
    print(f"\n  stop() completed in {elapsed:.2f}s")
