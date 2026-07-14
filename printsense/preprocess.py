"""Deterministic print-image preprocessing for the PrintSense interpreter.

Two pre-Claude steps the D->A roadmap (``printsense/PATH_TO_A.md`` Phase 0)
identified as the biggest accuracy unlocks on a real field photo:

1. **Resolution budget** -- Claude Opus 4.8 reads images up to **2576 px** on the
   long edge (~4784 vision tokens). The Telegram bot otherwise crushes every
   photo to ``MAX_VISION_PX=1024`` for the *local* qwen2.5vl encoder, so the D
   grade was scored on a 1024 px image and Claude's high-res perception was
   never used. ``PRINT_VISION_MAX_PX`` (default 2576) gives the print path its
   own budget; beyond 2576 the API downsamples anyway, so that is the ceiling.
2. **Auto-rotate** -- a workbench photo is often 90 deg off, and every tag/wire
   on the SCU2 sheet-20 case was legible only upright. EXIF orientation is normal
   when the rotation is baked into pixels, so this uses **content-based**
   Tesseract OSD, not EXIF.

Both are Pillow/Tesseract only -- no Anthropic. Everything is **defensive**: a
decode failure, a missing Pillow, or a missing Tesseract binary returns the
bytes unchanged rather than eating the turn (the interpreter still runs, just on
the un-preprocessed image). Pillow and pytesseract are lazy-imported so this
module imports on a box without them -- e.g. the Windows dev box, where
Tesseract is not installed (it IS in the bot container).
"""

from __future__ import annotations

import io
import logging
import os

logger = logging.getLogger("printsense.preprocess")

# Opus 4.8 high-res vision budget: 2576 px on the long edge AND <= 4784 vision
# tokens, where tokens = ceil(w/28) * ceil(h/28) (28x28-px patches). BOTH limits
# bind (Anthropic vision-coordinates doc): a square sheet at 2576px costs 8464
# tokens and is silently downscaled server-side — so the client must honor the
# token budget too, or portrait/square prints lose resolution with no log line.
MAX_PX = int(os.getenv("PRINT_VISION_MAX_PX", "2576"))
MAX_IMG_TOKENS = int(os.getenv("PRINT_VISION_MAX_IMG_TOKENS", "4784"))
_PATCH = 28
# Minimum Tesseract OSD orientation confidence to trust an auto-rotate.
OSD_MIN_CONF = float(os.getenv("PRINT_VISION_OSD_MIN_CONF", "1.0"))
# JPEG quality for the re-encode -- q>=95, never Pillow's lossy default of 75.
JPEG_QUALITY = int(os.getenv("PRINT_VISION_JPEG_QUALITY", "95"))
# OSD runs on a downscaled probe for speed; the rotation is applied to full-res.
_OSD_PROBE_PX = 1000


def prepare_print_image(data: bytes, media_type: str) -> tuple[bytes, str]:
    """Auto-upright + resize one print image to the Claude vision budget.

    Returns ``(bytes, media_type)`` -- possibly the same object unchanged. PDFs
    and any non-image media type pass through untouched (rotate/resize are raster
    ops). Any failure (bad bytes, no Pillow) returns the input unchanged.
    """
    if not media_type.startswith("image/"):
        return data, media_type
    try:
        from PIL import Image  # noqa: PLC0415 -- lazy; box may lack Pillow
    except ImportError:
        logger.warning("PRINT_PREPROCESS_SKIP reason=pillow_missing")
        return data, media_type
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # noqa: BLE001 -- bad bytes -> use the original
        logger.warning("PRINT_PREPROCESS_SKIP reason=decode_failed err=%s", exc)
        return data, media_type

    img = _exif_upright(img)
    img = _auto_upright(img)
    img = _resize_to_budget(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return buf.getvalue(), "image/jpeg"


def _exif_upright(img):
    """Apply the EXIF Orientation tag (free upright for phone photos; no Tesseract).

    Runs BEFORE the content-based OSD pass: a phone photo usually carries the
    rotation as EXIF metadata, which this fixes without any binary; OSD then only
    has to handle rotation baked into the pixels. Defensive like everything here.
    """
    try:
        from PIL import ImageOps  # noqa: PLC0415

        return ImageOps.exif_transpose(img)
    except Exception as exc:  # noqa: BLE001 -- corrupt EXIF must not eat the turn
        logger.warning("PRINT_EXIF_UPRIGHT_SKIP err=%s", exc)
        return img


def _fits(w: int, h: int, max_edge: int, max_tokens: int) -> bool:
    if max(w, h) > max_edge:
        return False
    return -(-w // _PATCH) * -(-h // _PATCH) <= max_tokens


def resized_size(
    w: int, h: int, max_edge: int | None = None, max_tokens: int | None = None
) -> tuple[int, int]:
    """Largest aspect-preserving size honoring BOTH high-res-tier constraints.

    Mirrors Anthropic's server resize rule (vision-coordinates doc): every side
    <= ``max_edge`` AND ceil(w/28)*ceil(h/28) <= ``max_tokens``. Never upscales.
    Binary-search on the long edge, then nudge down past ceil() wobble.
    """
    max_edge = MAX_PX if max_edge is None else max_edge
    max_tokens = MAX_IMG_TOKENS if max_tokens is None else max_tokens
    if _fits(w, h, max_edge, max_tokens):
        return w, h
    long0 = max(w, h)
    lo, hi = 1, min(long0, max_edge)  # candidate long-edge lengths
    while lo < hi:
        mid = (lo + hi + 1) // 2
        s = mid / long0
        if _fits(max(1, round(w * s)), max(1, round(h * s)), max_edge, max_tokens):
            lo = mid
        else:
            hi = mid - 1
    s = lo / long0
    rw, rh = max(1, round(w * s)), max(1, round(h * s))
    while not _fits(rw, rh, max_edge, max_tokens) and max(rw, rh) > 1:  # ceil wobble
        rw, rh = max(1, rw - 1), max(1, rh - 1)
    return rw, rh


def _resize_to_budget(img):
    """Downscale to :func:`resized_size` (never upscale)."""
    from PIL import Image  # noqa: PLC0415

    w, h = img.size
    tw, th = resized_size(w, h)
    if (tw, th) == (w, h):
        return img
    return img.resize((tw, th), Image.LANCZOS)


def _resize_long_edge(img, max_px: int):
    """Downscale so the long edge is at most ``max_px`` (never upscale).

    Retained for callers that budget by edge only (e.g. tile crops sized well
    under the token cap); the full-page path uses :func:`_resize_to_budget`.
    """
    from PIL import Image  # noqa: PLC0415

    w, h = img.size
    if max(w, h) <= max_px:
        return img
    scale = max_px / max(w, h)
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def _auto_upright(img):
    """Rotate ``img`` to upright via Tesseract OSD, or return it unchanged.

    OSD runs on a downscaled probe for speed; the detected rotation is applied to
    the full-res image. Gated on ``orientation_conf`` -- a low-confidence read is
    left alone rather than risk rotating a correctly-oriented sheet. Tesseract
    reports the clockwise angle the page is rotated; PIL ``rotate`` is CCW, so we
    negate (bench-verified on the sheet-20 case: a 90-CW photo needed a CCW
    correction to come upright).
    """
    try:
        import pytesseract  # noqa: PLC0415 -- lazy; dev box lacks the binary
    except ImportError:
        return img
    try:
        from PIL import Image  # noqa: PLC0415

        w, h = img.size
        probe = img
        if max(w, h) > _OSD_PROBE_PX:
            s = _OSD_PROBE_PX / max(w, h)
            probe = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
        osd = pytesseract.image_to_osd(probe, output_type=pytesseract.Output.DICT)
    except Exception as exc:  # noqa: BLE001 -- no binary / too-few-chars -> no rotate
        logger.warning("PRINT_AUTOROTATE_SKIP reason=osd_failed err=%s", exc)
        return img

    rotate = int(osd.get("rotate", 0)) % 360
    conf = float(osd.get("orientation_conf", 0.0))
    if rotate == 0 or conf < OSD_MIN_CONF:
        logger.info("PRINT_AUTOROTATE_NONE rotate=%s conf=%.1f", rotate, conf)
        return img
    logger.info("PRINT_AUTOROTATE rotate=%s conf=%.1f", rotate, conf)
    return img.rotate(-rotate, expand=True)
