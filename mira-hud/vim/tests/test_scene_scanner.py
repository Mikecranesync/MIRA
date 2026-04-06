"""Tests for the VIM scene scanner (Layer 1 geometric detector).

Generates a synthetic test_panel.jpg with known rectangles and lines,
then verifies detection accuracy, performance, statelesness, and edge cases.

Usage:
    cd mira-hud
    uv run --with opencv-python-headless --with numpy pytest vim/tests/test_scene_scanner.py -v
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np

from vim.config import ScannerConfig
from vim.scene_scanner import BoundingBox, LineSegment, ScanResult, draw_detections, scan_frame

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"


# ---------------------------------------------------------------------------
# Fixture: generate synthetic industrial panel image
# ---------------------------------------------------------------------------


def _create_test_panel(path: Path) -> np.ndarray:
    """Create a synthetic 1920x1080 test panel with known rectangles and lines.

    Draws:
    - 4 filled rectangles of varying sizes (simulating VFDs, relays, junction boxes)
    - 6 line segments (simulating wires, conduit runs)
    - Some noise circles to test false-positive rejection

    Returns the generated image (BGR).
    """
    img = np.ones((1080, 1920, 3), dtype=np.uint8) * 230  # light gray background

    # Rectangle 1: large VFD (dark gray)
    cv2.rectangle(img, (200, 150), (450, 550), (60, 60, 60), 3)

    # Rectangle 2: medium relay panel (dark blue)
    cv2.rectangle(img, (600, 200), (850, 450), (80, 40, 30), 3)

    # Rectangle 3: small terminal block (dark green)
    cv2.rectangle(img, (1000, 300), (1150, 500), (30, 70, 30), 3)

    # Rectangle 4: junction box (brown)
    cv2.rectangle(img, (1300, 100), (1700, 400), (40, 60, 100), 3)

    # Line segments (wires/conduit)
    cv2.line(img, (450, 350), (600, 350), (0, 0, 0), 2)  # horizontal wire
    cv2.line(img, (850, 300), (1000, 300), (0, 0, 0), 2)  # horizontal wire
    cv2.line(img, (325, 550), (325, 750), (50, 50, 50), 2)  # vertical conduit
    cv2.line(img, (1150, 400), (1300, 250), (30, 30, 30), 2)  # diagonal cable
    cv2.line(img, (100, 800), (800, 800), (0, 0, 0), 3)  # long horizontal run
    cv2.line(img, (1500, 400), (1500, 900), (40, 40, 40), 2)  # long vertical run

    # Noise: small circles (should NOT be detected as rectangles)
    cv2.circle(img, (900, 700), 30, (100, 100, 100), 2)
    cv2.circle(img, (1100, 700), 20, (80, 80, 80), 2)

    # Noise: tiny rectangle below min_rect_area threshold
    cv2.rectangle(img, (50, 50), (70, 70), (0, 0, 0), 2)  # 20x20 = 400 px² < 2000

    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), img)
    return img


def get_test_panel() -> np.ndarray:
    """Load or create the test panel fixture."""
    path = FIXTURES_DIR / "test_panel.jpg"
    if path.exists():
        img = cv2.imread(str(path))
        if img is not None:
            return img
    return _create_test_panel(path)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_detects_rectangles():
    """Scanner must detect at least 1 rectangle from the test panel."""
    frame = get_test_panel()
    config = ScannerConfig()
    result = scan_frame(frame, config)

    assert isinstance(result, ScanResult)
    assert len(result.rectangles) >= 1, (
        f"Expected at least 1 rectangle, got {len(result.rectangles)}"
    )
    for rect in result.rectangles:
        assert isinstance(rect, BoundingBox)
        assert rect.area >= config.min_rect_area
        assert rect.area <= config.max_rect_area
        assert rect.aspect_ratio >= config.aspect_ratio_min
        assert rect.aspect_ratio <= config.aspect_ratio_max


def test_detects_lines():
    """Scanner must detect at least 1 line segment from the test panel."""
    frame = get_test_panel()
    config = ScannerConfig()
    result = scan_frame(frame, config)

    assert isinstance(result, ScanResult)
    assert len(result.lines) >= 1, f"Expected at least 1 line, got {len(result.lines)}"
    for line in result.lines:
        assert isinstance(line, LineSegment)
        assert line.length >= config.line_min_length


def test_processing_time_under_50ms():
    """Scanner must process a 1080p frame in under 50ms on CPU."""
    frame = get_test_panel()
    config = ScannerConfig()

    # Warm-up run
    scan_frame(frame, config)

    # Timed run (average of 5)
    times = []
    for _ in range(5):
        t0 = time.perf_counter()
        scan_frame(frame, config)
        elapsed = (time.perf_counter() - t0) * 1000
        times.append(elapsed)

    avg_ms = sum(times) / len(times)
    assert avg_ms < 50, f"Average processing time {avg_ms:.1f}ms exceeds 50ms limit"


def test_output_types():
    """ScanResult must have correct field types."""
    frame = get_test_panel()
    config = ScannerConfig()
    result = scan_frame(frame, config, frame_id=42)

    assert isinstance(result.rectangles, list)
    assert isinstance(result.lines, list)
    assert isinstance(result.frame_timestamp, float)
    assert result.frame_id == 42
    assert isinstance(result.processing_time_ms, float)
    assert result.processing_time_ms > 0


def test_stateless():
    """Calling scan_frame twice on the same frame must return identical detections."""
    frame = get_test_panel()
    config = ScannerConfig()

    r1 = scan_frame(frame, config, frame_id=1)
    r2 = scan_frame(frame, config, frame_id=2)

    assert len(r1.rectangles) == len(r2.rectangles)
    assert len(r1.lines) == len(r2.lines)

    for a, b in zip(r1.rectangles, r2.rectangles):
        assert a.x == b.x and a.y == b.y and a.w == b.w and a.h == b.h

    for a, b in zip(r1.lines, r2.lines):
        assert a.x1 == b.x1 and a.y1 == b.y1 and a.x2 == b.x2 and a.y2 == b.y2


def test_blank_frame_no_crash():
    """A blank white frame must return zero detections without crashing."""
    blank = np.ones((1080, 1920, 3), dtype=np.uint8) * 255
    config = ScannerConfig()
    result = scan_frame(blank, config)

    assert isinstance(result, ScanResult)
    assert len(result.rectangles) == 0
    assert len(result.lines) == 0


def test_annotated_output():
    """Save annotated debug image with detections drawn."""
    frame = get_test_panel()
    config = ScannerConfig()
    result = scan_frame(frame, config)

    annotated = draw_detections(frame, result)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "scan_result.jpg"
    cv2.imwrite(str(output_path), annotated)

    assert output_path.exists(), f"Annotated output not written to {output_path}"
    assert output_path.stat().st_size > 0

    # Print summary for human review
    print("\n=== Scanner Results ===")
    print(f"  Rectangles: {len(result.rectangles)}")
    print(f"  Lines:      {len(result.lines)}")
    print(f"  Time:       {result.processing_time_ms:.1f}ms")
    print(f"  Output:     {output_path}")
    for i, r in enumerate(result.rectangles):
        print(f"    Rect {i}: ({r.x},{r.y}) {r.w}x{r.h} area={r.area} ar={r.aspect_ratio}")
    for i, ln in enumerate(result.lines):
        print(f"    Line {i}: ({ln.x1},{ln.y1})->({ln.x2},{ln.y2}) len={ln.length}")
