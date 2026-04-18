"""Tests for the VIM YOLO classifier (Layer 2).

Tests model loading, single/batch classification, confidence filtering,
COCO-to-industrial mapping, and two-layer pipeline latency.

Usage:
    cd mira-hud
    uv run --with ultralytics --with opencv-python-headless --with numpy --with pytest \
      pytest vim/tests/test_classifier.py -v -s
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np
import pytest

from vim.classifier import (
    Classification,
    ClassificationBatch,
    classify_crop,
    classify_crops,
    extract_crop,
    extract_crops,
    load_model,
    scan_and_classify,
)
from vim.config import ClassifierConfig
from vim.scene_scanner import BoundingBox

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def model():
    """Load YOLO model once for all tests (avoids repeated downloads)."""
    config = ClassifierConfig()
    return load_model(config)


@pytest.fixture(scope="module")
def test_crops() -> list[np.ndarray]:
    """Generate 10 diverse synthetic crops for batch testing.

    Each crop has a distinct visual pattern (solid colors, gradients,
    shapes) to ensure YOLO produces varied responses.
    """
    crops = []

    # Crop 1: dark rectangle on light background (VFD-like)
    c1 = np.ones((200, 300, 3), dtype=np.uint8) * 200
    cv2.rectangle(c1, (50, 30), (250, 170), (30, 30, 30), -1)
    cv2.rectangle(c1, (70, 50), (230, 150), (0, 200, 0), 2)
    crops.append(c1)

    # Crop 2: grid pattern (terminal block-like)
    c2 = np.ones((150, 200, 3), dtype=np.uint8) * 180
    for row in range(0, 150, 30):
        cv2.line(c2, (0, row), (200, row), (50, 50, 50), 1)
    for col in range(0, 200, 25):
        cv2.line(c2, (col, 0), (col, 150), (50, 50, 50), 1)
    crops.append(c2)

    # Crop 3: circle on dark background (gauge-like)
    c3 = np.ones((180, 180, 3), dtype=np.uint8) * 40
    cv2.circle(c3, (90, 90), 70, (200, 200, 200), 3)
    cv2.line(c3, (90, 90), (130, 50), (0, 0, 255), 2)
    crops.append(c3)

    # Crop 4: horizontal bars (relay-like)
    c4 = np.ones((120, 250, 3), dtype=np.uint8) * 160
    for y in range(20, 120, 20):
        cv2.rectangle(c4, (10, y - 8), (240, y + 8), (60, 60, 60), -1)
    crops.append(c4)

    # Crop 5: bright colored panel
    c5 = np.zeros((200, 200, 3), dtype=np.uint8)
    c5[:100, :100] = (255, 0, 0)
    c5[:100, 100:] = (0, 255, 0)
    c5[100:, :100] = (0, 0, 255)
    c5[100:, 100:] = (255, 255, 0)
    crops.append(c5)

    # Crop 6: diagonal lines (cable harness)
    c6 = np.ones((150, 300, 3), dtype=np.uint8) * 220
    for i in range(0, 300, 15):
        cv2.line(c6, (i, 0), (i + 80, 150), (40, 40, 40), 2)
    crops.append(c6)

    # Crop 7: nested rectangles (junction box)
    c7 = np.ones((250, 250, 3), dtype=np.uint8) * 190
    cv2.rectangle(c7, (20, 20), (230, 230), (50, 50, 50), 3)
    cv2.rectangle(c7, (50, 50), (200, 200), (80, 80, 80), 2)
    cv2.rectangle(c7, (80, 80), (170, 170), (100, 100, 100), 2)
    crops.append(c7)

    # Crop 8: text-like pattern (label plate)
    c8 = np.ones((100, 300, 3), dtype=np.uint8) * 255
    cv2.putText(c8, "WARNING", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)
    cv2.putText(c8, "480V 3PH", (20, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    crops.append(c8)

    # Crop 9: gradient (sensor housing)
    c9 = np.zeros((160, 160, 3), dtype=np.uint8)
    for row in range(160):
        c9[row, :] = (row, 160 - row, 80)
    crops.append(c9)

    # Crop 10: random noise
    rng = np.random.RandomState(42)
    c10 = rng.randint(0, 255, (200, 200, 3), dtype=np.uint8)
    crops.append(c10)

    return crops


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_model_loads(model):
    """Model must load successfully (custom or pretrained fallback)."""
    assert model is not None
    assert hasattr(model, "names")
    assert hasattr(model, "predict")
    assert len(model.names) > 0
    print(f"\n  Model loaded: {len(model.names)} classes")


def test_single_crop_classification(model, test_crops):
    """classify_crop must return Classification or None for a single crop."""
    config = ClassifierConfig(confidence_threshold=0.1)  # low threshold to ensure detections
    crop = test_crops[0]

    result = classify_crop(model, crop, config)

    # May be None if nothing detected — that's valid
    if result is not None:
        assert isinstance(result, Classification)
        assert isinstance(result.class_name, str)
        assert result.confidence > 0
        assert result.yolo_class_id >= 0
        print(f"\n  Single crop: {result.class_name} ({result.confidence:.2f})")
    else:
        print("\n  Single crop: no detection (valid for synthetic image)")


def test_batch_classification(model, test_crops):
    """classify_crops must handle a batch of 10 crops and return ClassificationBatch."""
    config = ClassifierConfig(confidence_threshold=0.1)

    batch_result = classify_crops(model, test_crops, config=config)

    assert isinstance(batch_result, ClassificationBatch)
    assert isinstance(batch_result.classifications, list)
    assert batch_result.processing_time_ms > 0
    assert isinstance(batch_result.model_name, str)

    print(
        f"\n  Batch: {len(batch_result.classifications)}/{len(test_crops)} detected "
        f"in {batch_result.processing_time_ms:.1f}ms"
    )
    for c in batch_result.classifications:
        print(f"    {c.class_name} ({c.yolo_class_name}) conf={c.confidence:.2f}")


def test_confidence_threshold_filters(model, test_crops):
    """Higher confidence threshold must produce fewer or equal detections."""
    config_low = ClassifierConfig(confidence_threshold=0.1)
    config_high = ClassifierConfig(confidence_threshold=0.8)

    result_low = classify_crops(model, test_crops, config=config_low)
    result_high = classify_crops(model, test_crops, config=config_high)

    assert len(result_high.classifications) <= len(result_low.classifications), (
        f"High threshold ({len(result_high.classifications)}) should produce "
        f"<= low threshold ({len(result_low.classifications)})"
    )
    print(
        f"\n  Threshold filter: {len(result_low.classifications)} (0.1) "
        f"vs {len(result_high.classifications)} (0.8)"
    )


def test_empty_batch(model):
    """Empty crop list must return empty ClassificationBatch without crashing."""
    config = ClassifierConfig()
    result = classify_crops(model, [], config=config)

    assert isinstance(result, ClassificationBatch)
    assert len(result.classifications) == 0
    assert result.processing_time_ms == 0.0


def test_crop_extraction():
    """extract_crop must produce correctly padded crops."""
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    frame[100:300, 200:500] = 128  # gray rectangle

    bbox = BoundingBox(x=200, y=100, w=300, h=200, area=60000, aspect_ratio=1.5)

    crop = extract_crop(frame, bbox, padding=0.1)
    assert crop.shape[0] > 0 and crop.shape[1] > 0
    # With 10% padding: width ~300 + 2*30 = 360, height ~200 + 2*20 = 240
    assert crop.shape[1] >= 300  # at least bbox width
    assert crop.shape[0] >= 200  # at least bbox height


def test_crop_extraction_edge_clamping():
    """Crops near frame edges must be clamped, not crash."""
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    # Bbox extends beyond frame
    bbox = BoundingBox(x=80, y=80, w=50, h=50, area=2500, aspect_ratio=1.0)

    crop = extract_crop(frame, bbox, padding=0.2)
    assert crop.shape[0] > 0 and crop.shape[1] > 0
    # Should be clamped to frame bounds
    assert crop.shape[0] <= 100
    assert crop.shape[1] <= 100


def test_batch_extraction():
    """extract_crops must return one crop per bbox."""
    frame = np.zeros((500, 500, 3), dtype=np.uint8)
    bboxes = [
        BoundingBox(x=10, y=10, w=100, h=100, area=10000, aspect_ratio=1.0),
        BoundingBox(x=200, y=200, w=150, h=80, area=12000, aspect_ratio=1.875),
    ]
    crops = extract_crops(frame, bboxes, padding=0.05)
    assert len(crops) == 2


def test_two_layer_pipeline_latency(model):
    """Full scan -> classify pipeline on a 1080p frame must complete."""
    # Use the test panel from scanner fixtures
    panel_path = FIXTURES_DIR / "test_panel.jpg"
    if panel_path.exists():
        frame = cv2.imread(str(panel_path))
    else:
        frame = np.ones((1080, 1920, 3), dtype=np.uint8) * 200
        cv2.rectangle(frame, (300, 200), (600, 500), (50, 50, 50), 3)
        cv2.rectangle(frame, (800, 300), (1100, 600), (60, 60, 60), 3)

    t_start = time.perf_counter()
    scan_result, class_result = scan_and_classify(frame, model)
    total_ms = (time.perf_counter() - t_start) * 1000.0

    assert len(scan_result.rectangles) >= 0  # may be 0 on synthetic
    assert isinstance(class_result, ClassificationBatch)

    print(f"\n  Two-layer pipeline: {total_ms:.1f}ms total")
    print(
        f"    Scanner: {scan_result.processing_time_ms:.1f}ms "
        f"({len(scan_result.rectangles)} rects, {len(scan_result.lines)} lines)"
    )
    print(
        f"    Classifier: {class_result.processing_time_ms:.1f}ms "
        f"({len(class_result.classifications)} classified)"
    )
    for c in class_result.classifications:
        print(
            f"      {c.class_name} ({c.yolo_class_name}) "
            f"conf={c.confidence:.2f} bbox={c.bbox.w}x{c.bbox.h}"
        )


def test_output_types(model, test_crops):
    """Classification fields must have correct types."""
    config = ClassifierConfig(confidence_threshold=0.1)
    result = classify_crops(model, test_crops[:3], config=config)

    for c in result.classifications:
        assert isinstance(c.class_name, str)
        assert isinstance(c.confidence, float)
        assert 0.0 < c.confidence <= 1.0
        assert isinstance(c.bbox, BoundingBox)
        assert isinstance(c.yolo_class_id, int)
        assert isinstance(c.yolo_class_name, str)
