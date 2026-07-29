"""Tests for the FR-3 image-quality gate (shared.visual.quality_gate).

Pure/deterministic/no-network by construction -- these generate synthetic
fixtures with PIL rather than shipping binary test assets. Per the Phase-1
spec: a synthetic blurry image must score below threshold (ok False); a
sharp, high-contrast one must score at/above it (ok True).
"""

from __future__ import annotations

import io
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

from shared.visual import quality_gate  # noqa: E402
from shared.visual.quality_gate import THRESHOLD, score_image  # noqa: E402


def _png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _sharp_high_contrast_image() -> Image.Image:
    """A large, crisp black/white checkerboard -- plenty of edge energy,
    maximum contrast, well above the resolution floor."""
    rng = random.Random(42)
    w, h = 1600, 1200
    img = Image.new("L", (w, h), color=0)
    draw = ImageDraw.Draw(img)
    cell = 12
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if ((x // cell) + (y // cell)) % 2 == 0:
                draw.rectangle([x, y, x + cell, y + cell], fill=255)
    for _ in range(20):
        y = rng.randint(0, h - 1)
        draw.line([(0, y), (w, y)], fill=rng.choice([0, 255]), width=1)
    return img


def _heavily_blurred_low_contrast_image() -> Image.Image:
    """A full-resolution photo-like image, heavily Gaussian-blurred with a
    flattened gray palette -- isolates "genuinely blurry" from "just small",
    so a passing resolution score alone cannot rescue it (resolution is only
    20% of the combined score by design)."""
    rng = random.Random(7)
    w, h = 1600, 1200
    img = Image.new("L", (w, h), color=128)
    draw = ImageDraw.Draw(img)
    for y in range(0, h, 12):
        shade = 118 + int(14 * math.sin(y / 50.0))
        draw.line([(0, y), (w, y)], fill=shade)
    for _ in range(400):
        x, y = rng.randint(0, w - 1), rng.randint(0, h - 1)
        draw.ellipse([x, y, x + 3, y + 3], fill=128 + rng.randint(-8, 8))
    return img.filter(ImageFilter.GaussianBlur(radius=12))


def _tiny_uniform_image() -> Image.Image:
    """A tiny, flat-gray image -- no edges, no contrast, no resolution."""
    return Image.new("L", (60, 45), color=128)


def test_sharp_high_contrast_image_passes_with_margin():
    result = score_image(_png_bytes(_sharp_high_contrast_image()))
    assert result.ok is True
    assert result.score >= THRESHOLD
    # Not just a hair over the line -- proves the heuristic is actually
    # rewarding sharpness/contrast, not passing by luck.
    assert result.score >= THRESHOLD + 0.3


def test_blurry_full_resolution_image_fails_below_threshold():
    result = score_image(_png_bytes(_heavily_blurred_low_contrast_image()))
    assert result.ok is False
    assert result.score < THRESHOLD
    reasons_text = " ".join(result.reasons).lower()
    assert "sharp" in reasons_text or "contrast" in reasons_text


def test_tiny_flat_image_fails():
    result = score_image(_png_bytes(_tiny_uniform_image()))
    assert result.ok is False
    assert result.score < THRESHOLD


def test_unreadable_bytes_score_zero_and_do_not_raise():
    result = score_image(b"this is not an image file")
    assert result.ok is False
    assert result.score == 0.0
    assert any("unreadable" in r.lower() for r in result.reasons)


def test_score_is_deterministic_for_the_same_bytes():
    data = _png_bytes(_sharp_high_contrast_image())
    first = score_image(data)
    second = score_image(data)
    assert first.score == second.score
    assert first.ok == second.ok
    assert first.reasons == second.reasons


def test_pure_python_fallback_matches_verdicts_without_numpy(monkeypatch):
    """CI's mira-bots test job does not install numpy -- force the fallback
    path and assert the pass/fail verdicts are unchanged (exact score
    equality is not required across the two implementations, only the
    ok/not-ok verdict, since float accumulation order can differ slightly)."""
    monkeypatch.setattr(quality_gate, "_HAS_NUMPY", False)
    monkeypatch.setattr(quality_gate, "_np", None)

    sharp = score_image(_png_bytes(_sharp_high_contrast_image()))
    assert sharp.ok is True

    blurry = score_image(_png_bytes(_heavily_blurred_low_contrast_image()))
    assert blurry.ok is False


def test_quality_score_to_dict_is_json_safe():
    result = score_image(_png_bytes(_sharp_high_contrast_image()))
    payload = result.to_dict()
    assert payload["ok"] is True
    assert isinstance(payload["score"], float)
    assert isinstance(payload["reasons"], list)
