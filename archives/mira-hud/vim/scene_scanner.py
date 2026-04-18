"""CPU-only geometric scene scanner (Layer 1).

Detects rectangular components (VFDs, relays, transformers, terminal blocks,
junction boxes, circuit breakers) and line segments (wires, conduit, hydraulic
hoses, pneumatic lines, cable harnesses) in a single camera frame.

No GPU. No torch/ultralytics. No frame history. Completely stateless.

Pipeline:
    1. Grayscale → Gaussian blur → Canny edge detection
    2. findContours → approxPolyDP (4-corner filter) → size/aspect ratio filters
    3. HoughLinesP for line segments

Usage:
    from vim.scene_scanner import scan_frame
    from vim.config import ScannerConfig

    result = scan_frame(bgr_frame, ScannerConfig())
    for rect in result.rectangles:
        print(f"Rect at ({rect.x}, {rect.y}) {rect.w}x{rect.h}")
    for line in result.lines:
        print(f"Line ({line.x1},{line.y1}) → ({line.x2},{line.y2})")
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import cv2
import numpy as np

from .config import ScannerConfig

# ---------------------------------------------------------------------------
# Output dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BoundingBox:
    """Axis-aligned bounding box for a detected rectangular component."""

    x: int
    y: int
    w: int
    h: int
    area: int
    aspect_ratio: float
    contour_points: tuple[tuple[int, int], ...] = field(default=(), repr=False)


@dataclass(frozen=True)
class LineSegment:
    """A detected line segment (wire, conduit, hose)."""

    x1: int
    y1: int
    x2: int
    y2: int
    length: float


@dataclass(frozen=True)
class ScanResult:
    """Complete scan output for a single frame."""

    rectangles: list[BoundingBox]
    lines: list[LineSegment]
    frame_timestamp: float
    frame_id: int
    processing_time_ms: float = 0.0


# ---------------------------------------------------------------------------
# Core scanner
# ---------------------------------------------------------------------------


def scan_frame(
    frame: np.ndarray,
    config: ScannerConfig,
    frame_id: int = 0,
) -> ScanResult:
    """Scan a single BGR frame for rectangular components and line segments.

    Args:
        frame: OpenCV BGR image (numpy array, HxWx3 uint8).
        config: Scanner parameters from vim.config.ScannerConfig.
        frame_id: Optional frame sequence number.

    Returns:
        ScanResult with detected rectangles and lines.
    """
    t_start = time.perf_counter()
    timestamp = time.time()

    # Preprocessing: grayscale → blur → Canny
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (config.blur_kernel, config.blur_kernel), 0)
    edges = cv2.Canny(blurred, config.canny_low, config.canny_high)

    # Rectangle detection
    rectangles = _detect_rectangles(edges, config)

    # Line detection
    lines = _detect_lines(edges, config)

    elapsed_ms = (time.perf_counter() - t_start) * 1000.0

    return ScanResult(
        rectangles=rectangles,
        lines=lines,
        frame_timestamp=timestamp,
        frame_id=frame_id,
        processing_time_ms=elapsed_ms,
    )


# ---------------------------------------------------------------------------
# Rectangle detection
# ---------------------------------------------------------------------------


def _detect_rectangles(edges: np.ndarray, config: ScannerConfig) -> list[BoundingBox]:
    """Find rectangular contours in edge image.

    Pipeline: findContours → approxPolyDP (4 corners) → size/aspect filters.
    """
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    results: list[BoundingBox] = []
    seen_rects: set[tuple[int, int, int, int]] = set()

    for contour in contours:
        # Approximate polygon
        perimeter = cv2.arcLength(contour, closed=True)
        if perimeter < 1:
            continue
        approx = cv2.approxPolyDP(contour, config.approx_epsilon * perimeter, closed=True)

        # 4-6 corners — thick borders sometimes produce 5-6 vertices
        if len(approx) < 4 or len(approx) > 6:
            continue

        # Must be convex
        if not cv2.isContourConvex(approx):
            continue

        # Bounding box
        x, y, w, h = cv2.boundingRect(approx)
        area = w * h

        # Size filters
        if area < config.min_rect_area or area > config.max_rect_area:
            continue

        # Aspect ratio filter
        aspect = w / h if h > 0 else 0.0
        if aspect < config.aspect_ratio_min or aspect > config.aspect_ratio_max:
            continue

        # Dedup: skip if a very similar bounding rect was already found
        # (thick borders create inner+outer contours for the same shape)
        key = (x // 10, y // 10, w // 10, h // 10)
        if key in seen_rects:
            continue
        seen_rects.add(key)

        # Store corner points as tuple of tuples (hashable for frozen dataclass)
        corners = tuple(tuple(pt[0]) for pt in approx.tolist())

        results.append(
            BoundingBox(
                x=x,
                y=y,
                w=w,
                h=h,
                area=area,
                aspect_ratio=round(aspect, 3),
                contour_points=corners,
            )
        )

    # Sort by area descending (largest components first)
    results.sort(key=lambda r: r.area, reverse=True)
    return results


# ---------------------------------------------------------------------------
# Line detection
# ---------------------------------------------------------------------------


def _detect_lines(edges: np.ndarray, config: ScannerConfig) -> list[LineSegment]:
    """Detect line segments using HoughLinesP."""
    raw_lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=config.hough_threshold,
        minLineLength=config.line_min_length,
        maxLineGap=config.line_max_gap,
    )

    if raw_lines is None:
        return []

    results: list[LineSegment] = []
    for line in raw_lines:
        x1, y1, x2, y2 = line[0]
        length = float(np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2))
        results.append(
            LineSegment(x1=int(x1), y1=int(y1), x2=int(x2), y2=int(y2), length=round(length, 1))
        )

    # Sort by length descending (longest segments first)
    results.sort(key=lambda s: s.length, reverse=True)
    return results


# ---------------------------------------------------------------------------
# Debug visualization
# ---------------------------------------------------------------------------


def draw_detections(
    frame: np.ndarray,
    result: ScanResult,
    rect_color: tuple[int, int, int] = (0, 255, 0),
    line_color: tuple[int, int, int] = (255, 255, 0),
    rect_thickness: int = 2,
    line_thickness: int = 2,
) -> np.ndarray:
    """Draw detected rectangles and lines on a copy of the frame.

    Rectangles: green bounding boxes with area label.
    Lines: cyan segments with length label.

    Returns annotated copy (does not modify input).
    """
    annotated = frame.copy()

    for rect in result.rectangles:
        cv2.rectangle(
            annotated,
            (rect.x, rect.y),
            (rect.x + rect.w, rect.y + rect.h),
            rect_color,
            rect_thickness,
        )
        label = f"{rect.w}x{rect.h} a={rect.area}"
        cv2.putText(
            annotated,
            label,
            (rect.x, rect.y - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            rect_color,
            1,
        )

    for line in result.lines:
        cv2.line(
            annotated,
            (line.x1, line.y1),
            (line.x2, line.y2),
            line_color,
            line_thickness,
        )
        mid_x = (line.x1 + line.x2) // 2
        mid_y = (line.y1 + line.y2) // 2
        cv2.putText(
            annotated,
            f"L={line.length}",
            (mid_x, mid_y - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.35,
            line_color,
            1,
        )

    return annotated
