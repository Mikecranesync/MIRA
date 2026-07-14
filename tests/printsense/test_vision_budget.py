"""Vision-budget guard tests (roadmap Round-2 fix F1/F2, research-verified).

Anthropic's high-res tier (Opus 4.8 lineage) accepts an image only up to BOTH
limits: long edge <= 2576 px AND ceil(w/28)*ceil(h/28) <= 4784 vision tokens
(28x28-px patches; platform vision-coordinates doc). The old preprocess resize
honored only the edge cap, so portrait/square sheets were silently downscaled
SERVER-side past what we sent — resolution lost with no log line. ``resized_size``
must honor both constraints client-side.

F2: phone photos carry EXIF Orientation; ``ImageOps.exif_transpose`` uprights
them for free — no Tesseract binary needed (the content-based OSD stays as the
second layer for rotation baked into pixels).
"""

import io
import math
import sys

import pytest

pytest.importorskip("PIL")

from printsense import preprocess as pp  # noqa: E402


def _tokens(w: int, h: int) -> int:
    return math.ceil(w / 28) * math.ceil(h / 28)


# ---- resized_size: the exact two-constraint rule -----------------------------


def test_resized_size_small_image_unchanged():
    assert pp.resized_size(800, 600) == (800, 600)


def test_resized_size_landscape_edge_bound():
    # 4000x1000 -> edge cap dominates: 2576x644 is only ~2116 tokens.
    w, h = pp.resized_size(4000, 1000)
    assert max(w, h) <= pp.MAX_PX
    assert _tokens(w, h) <= pp.MAX_IMG_TOKENS
    assert max(w, h) == pp.MAX_PX  # edge-bound case keeps the full edge budget


def test_resized_size_square_is_token_bound_not_edge_bound():
    # THE BUG THIS FIXES: a 4000x4000 sheet at 2576px costs ceil(2576/28)^2 = 8464
    # tokens > 4784 -> the server silently downscales. Client must stop at the
    # token budget (69*28 = 1932 per side).
    w, h = pp.resized_size(4000, 4000)
    assert _tokens(w, h) <= pp.MAX_IMG_TOKENS
    assert max(w, h) < pp.MAX_PX  # strictly tighter than the edge cap
    assert w == h  # aspect preserved


def test_resized_size_portrait_token_bound():
    # 3:4 print photo: naive 1932x2576 costs 69*92 = 6348 tokens > 4784.
    w, h = pp.resized_size(3000, 4000)
    assert _tokens(w, h) <= pp.MAX_IMG_TOKENS
    assert max(w, h) <= pp.MAX_PX
    # aspect preserved within rounding
    assert abs((w / h) - (3000 / 4000)) < 0.02
    # and it should USE most of the budget, not undershoot wildly
    assert _tokens(w, h) > int(pp.MAX_IMG_TOKENS * 0.8)


def test_resized_size_never_upscales():
    w, h = pp.resized_size(500, 700)
    assert (w, h) == (500, 700)


def test_prepare_uses_token_budget(monkeypatch):
    # End-to-end through prepare_print_image: a big square PNG must come out
    # within BOTH constraints (rotate disabled to isolate the resize).
    monkeypatch.setattr(pp, "_auto_upright", lambda img: img)
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (3200, 3200), (255, 255, 255)).save(buf, format="PNG")
    out, media = pp.prepare_print_image(buf.getvalue(), "image/png")

    got = Image.open(io.BytesIO(out))
    assert media == "image/jpeg"
    assert _tokens(*got.size) <= pp.MAX_IMG_TOKENS
    assert max(got.size) <= pp.MAX_PX


# ---- EXIF upright (free, no Tesseract) ---------------------------------------


def test_exif_orientation_uprighted_without_tesseract(monkeypatch):
    # Orientation=6 means the camera stored the image rotated 90deg CW; viewers
    # (and exif_transpose) rotate it back. Must work with pytesseract ABSENT.
    monkeypatch.setitem(sys.modules, "pytesseract", None)
    from PIL import Image

    src = Image.new("RGB", (40, 20), (0, 0, 0))  # landscape pixels
    exif = Image.Exif()
    exif[274] = 6  # Orientation tag
    buf = io.BytesIO()
    src.save(buf, format="JPEG", exif=exif)

    out, _media = pp.prepare_print_image(buf.getvalue(), "image/jpeg")

    got = Image.open(io.BytesIO(out))
    assert got.size == (20, 40)  # transposed upright: portrait now


def test_no_exif_is_untouched(monkeypatch):
    monkeypatch.setitem(sys.modules, "pytesseract", None)
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (40, 20), (0, 0, 0)).save(buf, format="JPEG")

    out, _media = pp.prepare_print_image(buf.getvalue(), "image/jpeg")

    assert Image.open(io.BytesIO(out)).size == (40, 20)
