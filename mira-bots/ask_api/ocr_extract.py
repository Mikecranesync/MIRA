"""Photo OCR — turn a photographed page / label / spec table into text (EVID-4).

PRD: docs/prd/2026-08-25-technician-copilot-prd.md — EVID-4 "Photos become
searchable evidence": an OCR fallback (Tesseract per the design doc; docling is
dead) turns a photographed page into indexed chunks under the same one-pipeline
writer, honestly reporting quality.

Why Tesseract and not the PaddleOCR already in this image: nameplate_detect.py
deliberately loads Paddle's DETECTOR only (432 MiB RSS, 757 MiB inference peak);
adding its recognizer would grow that footprint on an 8 GB VPS whose mira-ask
container is capped at 1536m. Tesseract (Apache-2.0, apt `tesseract-ocr`) reads a
phone photo in a few hundred MB with no model preload, and its per-word
confidence is exactly the quality signal the PRD asks us to report honestly.

Route: POST /ocr/extract
- Feature-flagged: PHOTO_OCR_ENABLED (default OFF). Flag off, pytesseract /
  binary missing, timeout, or busy all return HTTP 200 with ``available: false``
  — the caller keeps the photo viewable and says so. This endpoint only ever
  ADDS a searchable text layer; it never fails an upload.
- Concurrency 1 by construction (module-level slot): one CPU OCR at a time.
- Read-only: no DB, no LLM, no ingestion side effects — text + quality out.
- Optional shared-secret auth via X-Mira-Key (read at request time so tests can
  monkeypatch it; mirrors nameplate_detect.py).

Separation: own APIRouter so tests import it WITHOUT constructing ask_api.app
(which builds the heavy Supervisor engine at import time).
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import os
import threading
import time

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("mira-ask")

router = APIRouter()

# Same containment as nameplate_detect: bound the compressed bytes, the base64
# field, and — separately — the DECODED pixel count (a small JPEG can decode
# to a gigapixel bitmap).
_MAX_IMAGE_BYTES = int(os.getenv("PHOTO_OCR_MAX_BYTES", str(8 * 1024 * 1024)))
_MAX_IMAGE_B64_LEN = (_MAX_IMAGE_BYTES * 4) // 3 + 8
_MAX_IMAGE_PIXELS = int(os.getenv("PHOTO_OCR_MAX_PIXELS", str(32_000_000)))
# Tesseract's sweet spot is ~300 dpi text; a 4000x3000 phone photo of a page is
# far beyond that and only costs time. Downscale the long edge to this before
# reading (header-only check first, then a real resize).
_MAX_LONG_EDGE = int(os.getenv("PHOTO_OCR_MAX_LONG_EDGE", "2200"))

# One OCR at a time. A plain threading semaphore acquired INSIDE the worker
# thread (non-blocking): a request whose asyncio waiter timed out keeps the
# slot until its thread actually finishes, so a second OCR can never stack on
# top of it; later requests bounce with available=false, "busy".
_slot = threading.Semaphore(1)

# Lazy import cache. False-y reason = load failed permanently (missing
# pytesseract or binary) — cached so a broken install degrades to
# available=false without re-probing on every request.
_engine_ready = False
_engine_failed_reason: str | None = None


def _flag_enabled() -> bool:
    return os.getenv("PHOTO_OCR_ENABLED", "0") == "1"


def _load_engine() -> None:
    """Import pytesseract and confirm the binary answers. Cached either way."""
    global _engine_ready, _engine_failed_reason
    if _engine_ready or _engine_failed_reason is not None:
        return
    try:
        import pytesseract

        pytesseract.get_tesseract_version()
        _engine_ready = True
        logger.info("photo-ocr: tesseract ready")
    except Exception as exc:  # noqa: BLE001 — any load failure means "unavailable", not 500
        _engine_failed_reason = f"ocr_load_failed: {type(exc).__name__}: {exc}"
        logger.warning("photo-ocr: %s", _engine_failed_reason)


def assemble_text(data: dict) -> tuple[str, float | None, int]:
    """Rebuild reading-order text from a pytesseract `image_to_data` dict and
    score it. Returns (text, mean_confidence 0-100 or None, word_count).

    Words are grouped into lines by (block, paragraph, line); lines joined by
    newlines, paragraphs by a blank line. Only non-empty words with a real
    confidence (>= 0; tesseract uses -1 for non-word boxes) count toward the
    mean. Pure function, exported for unit tests.
    """
    n = len(data.get("text", []))
    lines: dict[tuple[int, int, int], list[str]] = {}
    order: list[tuple[int, int, int]] = []
    confs: list[float] = []
    for i in range(n):
        word = str(data["text"][i]).strip()
        if not word:
            continue
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        key = (int(data["block_num"][i]), int(data["par_num"][i]), int(data["line_num"][i]))
        if key not in lines:
            lines[key] = []
            order.append(key)
        lines[key].append(word)
        if conf >= 0:
            confs.append(conf)
    out: list[str] = []
    prev_par: tuple[int, int] | None = None
    for key in order:
        par = (key[0], key[1])
        if prev_par is not None and par != prev_par:
            out.append("")
        out.append(" ".join(lines[key]))
        prev_par = par
    text = "\n".join(out).strip()
    word_count = sum(len(v) for v in lines.values())
    mean_conf = round(sum(confs) / len(confs), 1) if confs else None
    return text, mean_conf, word_count


def _prepare_image(raw: bytes):
    """Decode, honor EXIF orientation, grayscale, cap the long edge. Pixel cap
    is checked on the header BEFORE any pixel data is decoded."""
    import io

    from PIL import Image, ImageOps

    try:
        im = Image.open(io.BytesIO(raw))
        w, h = im.size
    except Exception as exc:
        raise ValueError("undecodable_image") from exc
    if w * h > _MAX_IMAGE_PIXELS:
        raise ValueError("image_too_large_decoded")
    im = ImageOps.exif_transpose(im)
    im = im.convert("L")
    long_edge = max(im.size)
    if long_edge > _MAX_LONG_EDGE:
        scale = _MAX_LONG_EDGE / long_edge
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))))
    return im


def _run_ocr(raw: bytes, lang: str) -> dict:
    """The ENTIRE heavy path in one occupancy of the slot, on a worker thread."""
    if not _slot.acquire(blocking=False):
        return {"unavailable": "busy"}
    try:
        _load_engine()
        if _engine_failed_reason is not None:
            return {"unavailable": _engine_failed_reason}
        import pytesseract

        im = _prepare_image(raw)
        data = pytesseract.image_to_data(im, lang=lang, output_type=pytesseract.Output.DICT)
        text, mean_conf, words = assemble_text(data)
        return {"text": text, "mean_confidence": mean_conf, "word_count": words,
                "width": im.width, "height": im.height}
    finally:
        _slot.release()


class OcrRequest(BaseModel):
    """image_base64: the photo bytes exactly as the workspace holds them."""

    image_base64: str = Field(..., min_length=1, max_length=_MAX_IMAGE_B64_LEN)
    # Tesseract language pack(s). Only `eng` ships in the image; anything else
    # is rejected up front rather than surfacing as a tesseract error.
    lang: str = Field(default="eng", pattern=r"^[a-z]{3}(\+[a-z]{3})*$")


def _unavailable(reason: str) -> dict:
    return {
        "available": False,
        "reason": reason,
        "text": "",
        "mean_confidence": None,
        "word_count": 0,
        "engine": "tesseract",
    }


@router.post("/ocr/extract")
async def ocr_extract(req: OcrRequest, x_mira_key: str = Header(default=None)):
    key = os.environ.get("ASK_API_KEY", "")
    if key and x_mira_key != key:
        raise HTTPException(status_code=401, detail="invalid or missing X-Mira-Key")

    if not _flag_enabled():
        return _unavailable("disabled")

    try:
        raw = base64.b64decode(req.image_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="invalid base64")
    if not raw:
        raise HTTPException(status_code=400, detail="empty image")
    if len(raw) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=f"image exceeds {_MAX_IMAGE_BYTES} bytes")

    timeout = float(os.getenv("PHOTO_OCR_TIMEOUT", "45"))
    t0 = time.monotonic()
    try:
        out = await asyncio.wait_for(asyncio.to_thread(_run_ocr, raw, req.lang), timeout=timeout)
    except asyncio.TimeoutError:
        # The thread keeps running and keeps the slot; we just stop waiting.
        return _unavailable("timeout")
    except ValueError as exc:
        if str(exc) == "image_too_large_decoded":
            raise HTTPException(status_code=413, detail="decoded image exceeds pixel limit")
        raise HTTPException(status_code=400, detail="undecodable image")
    except Exception as exc:  # noqa: BLE001 — degrade, never 500: the photo stays viewable
        logger.warning("photo-ocr: inference failed: %s", exc)
        return _unavailable(f"inference_failed: {type(exc).__name__}")

    if "unavailable" in out:
        return _unavailable(out["unavailable"])

    return {
        "available": True,
        "reason": None,
        "engine": "tesseract",
        "lang": req.lang,
        "text": out["text"],
        # Mean of tesseract's per-word confidences (0-100). None when no word
        # was read — the caller must treat that as "no text", not "perfect".
        "mean_confidence": out["mean_confidence"],
        "word_count": out["word_count"],
        "image": {"width": out["width"], "height": out["height"]},
        "ms": int((time.monotonic() - t0) * 1000),
    }
