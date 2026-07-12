"""Image-quality gate (FR-3, ADR-0027 Phase 1) — pure, deterministic, no LLM.

Scores an image 0.0..1.0 from three cheap, deterministic heuristics so an
unreadable photo is rejected (and a specific "send a clearer photo" reason
given) BEFORE it ever reaches a vision/LLM call:

  - sharpness  — variance of the Laplacian (edge energy) of the grayscale
                 image. Blur collapses high-frequency edge content, so a
                 blurry photo has low Laplacian variance.
  - contrast   — RMS contrast (population stddev of grayscale luma). A
                 washed-out / poorly-lit photo has low pixel variance.
  - resolution — longest-side pixel count, linearly scaled between a floor
                 (unusable) and a ceiling (plenty for OCR) — a large but
                 blurry photo must NOT pass on resolution alone (resolution
                 is capped at 20% of the combined score; see calibration
                 note below).

Deterministic: same bytes -> same score, no randomness, no network, no I/O
beyond decoding the bytes already provided. numpy is an OPTIONAL accelerator
(vectorized variance) — if unavailable, a pure-Python fallback computes the
identical two-pass variance so behavior does not depend on numpy being
installed (CI's mira-bots test job does not install numpy).

Calibration (docs/... none yet; numbers below empirically chosen against
synthetic PIL fixtures during Phase 1 build): a full-resolution image that is
heavily Gaussian-blurred with flattened contrast scores ~0.24 (well under the
default 0.35 threshold) even though its resolution term is maxed out; a
sharp, high-contrast image scores ~1.0. See
``mira-bots/tests/test_visual_quality_gate.py`` for the fixtures.
"""

from __future__ import annotations

import io
import logging
import math

from PIL import Image, ImageFilter

from .models import QualityScore

logger = logging.getLogger("mira-gsd.visual_quality_gate")

try:  # numpy is an optional accelerator only — never a hard dependency here.
    import numpy as _np

    _HAS_NUMPY = True
except Exception:  # pragma: no cover - exercised only when numpy is absent
    _np = None
    _HAS_NUMPY = False

# ``ok = score >= THRESHOLD`` (module constant per spec).
THRESHOLD = 0.35

# Discrete Laplacian (edge-detection) kernel — classic 4-neighbor form.
_LAPLACIAN_KERNEL = ImageFilter.Kernel((3, 3), [0, 1, 0, 1, -4, 1, 0, 1, 0], scale=1)

# Reference values that map a raw heuristic to a 0..1 sub-score. Empirically
# chosen (see module docstring); a value at/above the reference saturates at
# 1.0 rather than growing unbounded.
_SHARPNESS_REFERENCE = 800.0
_CONTRAST_REFERENCE = 70.0
_MIN_LONG_SIDE = 480  # px; at/below this, resolution contributes 0
_FULL_LONG_SIDE = 1200  # px; at/above this, resolution contributes its full weight

_WEIGHT_SHARPNESS = 0.55
_WEIGHT_CONTRAST = 0.25
_WEIGHT_RESOLUTION = 0.20

_SHARPNESS_OK_FLOOR = 0.3
_CONTRAST_OK_FLOOR = 0.3
_RESOLUTION_OK_FLOOR = 0.3


def _variance_of_laplacian(gray: Image.Image) -> float:
    """Edge-energy variance — low for blurry images, high for sharp ones.

    PIL's ``ImageFilter.Kernel`` does not compute a convolved value for the
    outermost 1px border — those pixels are copied through unchanged instead.
    For a perfectly flat/blank image that border-vs-interior discontinuity is
    the ONLY nonzero signal in the filtered image, and it is a fixed pixel
    COUNT (the perimeter) rather than a fraction of the image — so on a small
    photo it can dominate the variance and make a genuinely blank/blurry
    image look artificially "sharp" (confirmed empirically: a uniform 60x45
    image scored higher raw variance than a healthy mid-size photo before
    this crop was added). Crop that 1px border before measuring variance so
    only real convolution output is scored, on both the numpy and
    pure-Python paths.
    """
    edges = gray.filter(_LAPLACIAN_KERNEL)
    if edges.width > 2 and edges.height > 2:
        edges = edges.crop((1, 1, edges.width - 1, edges.height - 1))
    if _HAS_NUMPY:
        arr = _np.asarray(edges, dtype=_np.float64)
        return float(arr.var())
    return _pure_python_variance(edges.getdata())


def _rms_contrast(gray: Image.Image) -> float:
    """Population stddev of grayscale luma — low for washed-out images."""
    if _HAS_NUMPY:
        arr = _np.asarray(gray, dtype=_np.float64)
        return float(arr.std())
    return math.sqrt(_pure_python_variance(gray.getdata()))


def _pure_python_variance(pixels) -> float:
    """Two-pass population variance with no numpy — deterministic, O(n)."""
    data = list(pixels)
    n = len(data)
    if n == 0:
        return 0.0
    mean = sum(data) / n
    return sum((p - mean) ** 2 for p in data) / n


def _resolution_score(width: int, height: int) -> float:
    long_side = max(width, height)
    if long_side <= _MIN_LONG_SIDE:
        return 0.0
    if long_side >= _FULL_LONG_SIDE:
        return 1.0
    return (long_side - _MIN_LONG_SIDE) / (_FULL_LONG_SIDE - _MIN_LONG_SIDE)


def score_image(image_bytes: bytes) -> QualityScore:
    """Score raw image bytes 0.0..1.0. Never raises — an unreadable/corrupt
    file scores 0.0 with an explanatory reason rather than propagating.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()
        gray = img.convert("L")
    except Exception as exc:  # noqa: BLE001 - any decode failure is "unreadable"
        logger.warning("quality_gate: unreadable image (%s)", exc)
        return QualityScore(score=0.0, ok=False, reasons=["unreadable image file"])

    width, height = gray.width, gray.height
    sharpness = _variance_of_laplacian(gray)
    contrast = _rms_contrast(gray)

    sharpness_score = min(1.0, sharpness / _SHARPNESS_REFERENCE)
    contrast_score = min(1.0, contrast / _CONTRAST_REFERENCE)
    resolution_score = _resolution_score(width, height)

    combined = (
        _WEIGHT_SHARPNESS * sharpness_score
        + _WEIGHT_CONTRAST * contrast_score
        + _WEIGHT_RESOLUTION * resolution_score
    )
    combined = max(0.0, min(1.0, combined))

    reasons: list[str] = []
    if sharpness_score < _SHARPNESS_OK_FLOOR:
        reasons.append("low sharpness — likely blurry")
    if contrast_score < _CONTRAST_OK_FLOOR:
        reasons.append("low contrast — likely washed out or poorly lit")
    if resolution_score < _RESOLUTION_OK_FLOOR:
        reasons.append(f"low resolution — longest side is {max(width, height)}px")

    ok = combined >= THRESHOLD
    if ok and not reasons:
        reasons.append("acceptable sharpness, contrast, and resolution")

    return QualityScore(score=round(combined, 4), ok=ok, reasons=reasons)
