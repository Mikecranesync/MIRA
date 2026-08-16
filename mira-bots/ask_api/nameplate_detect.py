"""Text-DETECTION-only nameplate region finder (PR C of the nameplate arc).

Why detection only: the region-crop experiment (mira-hub/benchmarks/nameplate/
region-experiment.ts, PR B) proved the vision recognizer reads an isolated
label crop perfectly (`1.27A` 0/3 -> 3/3, fabricated `RoHS` eliminated) — the
failure was WHERE the model looked, not HOW it read. auto-region.ts then
proved the region can be found automatically: PaddleOCR's text DETECTOR on the
raw photo, union of all detected boxes, no human coordinates (results/
auto-round1-union.json: current 3/3, identity 12/12, hallucinations 0).
Paddle's recognizer is never loaded — the smallest viable footprint (VPS probe
2026-08-16: model load 432 MiB RSS, inference peak 757 MiB, ~2.3 s/image CPU).

Route: POST /nameplate/detect
- Feature-flagged: NAMEPLATE_DETECT_ENABLED (default OFF). Flag off, paddle
  missing, model-load failure, or timeout all return HTTP 200 with
  ``available: false`` — the caller's existing whole-photo recognition path
  continues unchanged. This endpoint can only ever ADD information.
- Concurrency 1 by construction (module-level semaphore): one 4000x3000 CPU
  inference at a time bounds peak RSS to the single-run figure above.
- Read-only: no DB, no LLM, no ingestion side effects — pure geometry out.
- Coordinates are in the DECODED pixel space of the posted bytes (cv2 applies
  no EXIF rotation; sharp without .rotate() matches). The caller crops in that
  same space, so the two stay consistent by construction.
- Optional shared-secret auth via X-Mira-Key (gate read at request time,
  mirrors ask_api/manual_discovery.py so tests can monkeypatch it).

Separation: own APIRouter so tests import it WITHOUT constructing ask_api.app
(which builds the heavy Supervisor engine at import time).
"""

import asyncio
import base64
import binascii
import logging
import os
import time

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("mira-ask")

router = APIRouter()

# Decoded-bytes cap. The reference photo is 2.8 MB; 8 MB covers any phone JPEG
# while keeping a hostile payload from ballooning the decode.
_MAX_IMAGE_BYTES = int(os.getenv("NAMEPLATE_DETECT_MAX_BYTES", str(8 * 1024 * 1024)))

# One inference at a time — this is what makes the measured single-run peak RSS
# (757 MiB) the container's actual worst case rather than a per-request bound.
_inference_lock = asyncio.Semaphore(1)

# Lazy singleton. False = load failed permanently (missing dep, bad model) —
# cached so a broken install degrades to available=false without re-importing
# on every request. None = not attempted yet.
_detector = None
_detector_failed_reason: str | None = None


def _flag_enabled() -> bool:
    return os.getenv("NAMEPLATE_DETECT_ENABLED", "0") == "1"


def _load_detector():
    """Import paddle and build the TextDetection predictor. Sync + heavy
    (~430 MiB RSS, ~3 s warm disk) — called once, inside the semaphore, via
    a worker thread. Any failure is cached; never raises to the route."""
    global _detector, _detector_failed_reason
    if _detector is not None or _detector_failed_reason is not None:
        return
    try:
        from paddleocr import TextDetection

        model_name = os.getenv("NAMEPLATE_DET_MODEL", "PP-OCRv5_mobile_det")
        # MKL-DNN stays off: Paddle 3.x's PIR + oneDNN CPU path throws
        # "ConvertPirAttribute2RuntimeAttribute not support" on this model
        # (hit on the VPS probe, 2026-08-16).
        _detector = TextDetection(model_name=model_name, enable_mkldnn=False)
        logger.info("nameplate-detect: loaded %s", model_name)
    except Exception as exc:  # noqa: BLE001 — any load failure means "unavailable", not 500
        _detector_failed_reason = f"detector_load_failed: {type(exc).__name__}: {exc}"
        logger.warning("nameplate-detect: %s", _detector_failed_reason)


def _predict(raw: bytes):
    """Decode + detect. Runs in a worker thread. Returns (polys, scores, w, h)."""
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("undecodable_image")
    result = _detector.predict(img)[0]
    polys = [[[int(x), int(y)] for x, y in poly] for poly in result["dt_polys"]]
    scores = [float(s) for s in result["dt_scores"]]
    return polys, scores, int(img.shape[1]), int(img.shape[0])


def union_bbox(
    polys: list[list[list[int]]], scores: list[float], min_score: float
) -> dict[str, int] | None:
    """Axis-aligned union of every polygon at/above min_score — the exact
    automated-crop rule auto-region.ts qualified (strategy union_all). Pure
    function, exported for unit tests."""
    pts = [pt for poly, s in zip(polys, scores) if s >= min_score for pt in poly]
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return {
        "left": min(xs),
        "top": min(ys),
        "width": max(xs) - min(xs),
        "height": max(ys) - min(ys),
    }


class DetectRequest(BaseModel):
    """image_base64: the photo bytes exactly as the app holds them (no
    preprocessing — coordinates come back in this image's pixel space)."""

    image_base64: str = Field(..., min_length=1)
    min_score: float = Field(default=0.5, ge=0.0, le=1.0)


def _unavailable(reason: str) -> dict:
    return {"available": False, "reason": reason, "regions": [], "union_bbox": None}


@router.post("/nameplate/detect")
async def nameplate_detect(req: DetectRequest, x_mira_key: str = Header(default=None)):
    # Optional shared-secret gate, read at request time (allows test monkeypatching).
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

    timeout = float(os.getenv("NAMEPLATE_DETECT_TIMEOUT", "30"))
    t0 = time.monotonic()
    async with _inference_lock:
        try:
            await asyncio.wait_for(asyncio.to_thread(_load_detector), timeout=timeout)
            if _detector_failed_reason is not None:
                return _unavailable(_detector_failed_reason)
            polys, scores, width, height = await asyncio.wait_for(
                asyncio.to_thread(_predict, raw), timeout=timeout
            )
        except asyncio.TimeoutError:
            # The worker thread may still be running — the semaphore stays the
            # concurrency bound; we just stop waiting on this request.
            return _unavailable("timeout")
        except ValueError:
            raise HTTPException(status_code=400, detail="undecodable image")
        except Exception as exc:  # noqa: BLE001 — degrade, never 500: caller falls back
            logger.warning("nameplate-detect: inference failed: %s", exc)
            return _unavailable(f"inference_failed: {type(exc).__name__}")

    return {
        "available": True,
        "reason": None,
        "model": os.getenv("NAMEPLATE_DET_MODEL", "PP-OCRv5_mobile_det"),
        "image": {"width": width, "height": height},
        "regions": [
            {"poly": poly, "score": score} for poly, score in zip(polys, scores)
        ],
        "union_bbox": union_bbox(polys, scores, req.min_score),
        "ms": int((time.monotonic() - t0) * 1000),
    }
