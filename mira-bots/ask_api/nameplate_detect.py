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
# base64 expands ~4/3; bound the FIELD so a hostile body can't make FastAPI
# hold a giant string before we ever decode it.
_MAX_IMAGE_B64_LEN = (_MAX_IMAGE_BYTES * 4) // 3 + 8

# Compressed-size limits do not bound DECODED size (a 100 KB JPEG can decode to
# a gigapixel bitmap). Cap total pixels BEFORE cv2 allocates: 4000x3000 (the
# qualified phone-photo shape) is 12 MP; 32 MP allows any current phone sensor
# while keeping worst-case BGR allocation under ~100 MB.
_MAX_IMAGE_PIXELS = int(os.getenv("NAMEPLATE_DETECT_MAX_PIXELS", str(32_000_000)))

# One inference at a time — this is what makes the measured single-run peak RSS
# (757 MiB) the container's actual worst case rather than a per-request bound.
#
# NOT a plain semaphore-around-await: `asyncio.wait_for(to_thread(...))` cannot
# cancel a running thread, so a timeout would release the lock while the worker
# is STILL RUNNING and the next request could stack a second 757 MiB inference
# on top of it. Instead the busy slot is the worker's own Future — a request
# that times out stops WAITING but the slot stays occupied until the thread
# actually finishes; later requests bounce with available=false, "busy".
_busy_future: asyncio.Future | None = None
_busy_guard = asyncio.Lock()


async def _run_exclusive(fn, *args, timeout: float):
    """Run fn in a worker thread as THE single occupant of the inference slot.

    Returns (ok, value). ok=False values: "busy" (slot occupied by a previous
    request — possibly one whose waiter already timed out), "timeout" (this
    request stopped waiting; the slot stays occupied until the thread ends).
    """
    global _busy_future
    async with _busy_guard:
        if _busy_future is not None and not _busy_future.done():
            return False, "busy"
        _busy_future = asyncio.ensure_future(asyncio.to_thread(fn, *args))
        fut = _busy_future
        # If our waiter times out and the run later fails, SOMEONE must retrieve
        # the exception or asyncio logs it as never-retrieved at GC time.
        fut.add_done_callback(
            lambda f: f.cancelled() or f.exception() is None or logger.warning(
                "nameplate-detect: abandoned run failed: %s", f.exception()
            )
        )
    try:
        return True, await asyncio.wait_for(asyncio.shield(fut), timeout=timeout)
    except asyncio.TimeoutError:
        # The thread keeps running and keeps the slot; it will complete and
        # release naturally. We just stop waiting on it.
        return False, "timeout"

# Lazy singleton. False = load failed permanently (missing dep, bad model) —
# cached so a broken install degrades to available=false without re-importing
# on every request. None = not attempted yet.
_detector = None
_detector_failed_reason: str | None = None

# Doc-orientation classifier (PP-LCNet_x1_0_doc_ori, ~7 MB) — loaded lazily on
# the first crop request. The hub-path qualification proved orientation is
# load-bearing for the crop: the identical union crop read sideways scored
# 1.27A 2/3 / catalog 0/3, uprighted 3/3 / 3/3. A classifier failure degrades
# to the unrotated crop, never to a failed request.
_orienter = None
_orienter_failed = False


# Whitelist of accepted PaddleOCR detection models (defense-in-depth, groq
# review 2026-08-16): the model name reaches PaddleOCR's model resolver, so an
# arbitrary env value could point the loader at an unexpected model/path.
# Constrain it to the qualified detectors; anything else falls back to the
# default with a warning rather than loading a caller-named artifact.
_ALLOWED_DET_MODELS = frozenset(
    {"PP-OCRv5_mobile_det", "PP-OCRv5_server_det", "PP-OCRv4_mobile_det", "PP-OCRv4_server_det"}
)
_DEFAULT_DET_MODEL = "PP-OCRv5_mobile_det"


def _det_model_name() -> str:
    name = os.getenv("NAMEPLATE_DET_MODEL", _DEFAULT_DET_MODEL)
    if name not in _ALLOWED_DET_MODELS:
        logger.warning(
            "nameplate-detect: NAMEPLATE_DET_MODEL=%r not in allowlist — using %s", name, _DEFAULT_DET_MODEL
        )
        return _DEFAULT_DET_MODEL
    return name


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

        model_name = _det_model_name()
        # MKL-DNN stays off: Paddle 3.x's PIR + oneDNN CPU path throws
        # "ConvertPirAttribute2RuntimeAttribute not support" on this model
        # (hit on the VPS probe, 2026-08-16).
        _detector = TextDetection(model_name=model_name, enable_mkldnn=False)
        logger.info("nameplate-detect: loaded %s", model_name)
    except Exception as exc:  # noqa: BLE001 — any load failure means "unavailable", not 500
        _detector_failed_reason = f"detector_load_failed: {type(exc).__name__}: {exc}"
        logger.warning("nameplate-detect: %s", _detector_failed_reason)


def _check_decoded_size(raw: bytes) -> None:
    """Reject images whose DECODED size exceeds the pixel cap, reading only the
    header (PIL's lazy open — no pixel data is decoded). A compressed-size cap
    alone is not containment: a small JPEG can decode to a gigapixel bitmap."""
    import io

    from PIL import Image

    try:
        with Image.open(io.BytesIO(raw)) as im:
            w, h = im.size
    except Exception as exc:
        raise ValueError("undecodable_image") from exc
    if w * h > _MAX_IMAGE_PIXELS:
        raise ValueError("image_too_large_decoded")


def _predict(raw: bytes):
    """Decode + detect. Runs in a worker thread. Returns (polys, scores, w, h).
    Callers must have passed _check_decoded_size first."""
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("undecodable_image")
    result = _detector.predict(img)[0]
    polys = [[[int(x), int(y)] for x, y in poly] for poly in result["dt_polys"]]
    scores = [float(s) for s in result["dt_scores"]]
    return polys, scores, int(img.shape[1]), int(img.shape[0])


def _upright(crop):
    """Best-effort uprighting of a crop. Classify orientation; if not "0",
    rotate the classified amount back and RE-CLASSIFY — the rotation is kept
    only when the result verifies as upright, so a misclassification can never
    make the crop worse than sideways. Returns (image, applied_degrees).

    Label mapping calibrated live on the real Oriental Motor crop (2026-08-16):
    sideways crop → label "90"; cv2.ROTATE_90_COUNTERCLOCKWISE → re-classifies
    "0" at 0.908. Label N means "rotated N° clockwise"; correction is N° CCW.
    """
    global _orienter, _orienter_failed
    import cv2

    if _orienter_failed:
        return crop, 0
    try:
        if _orienter is None:
            from paddleocr import DocImgOrientationClassification

            _orienter = DocImgOrientationClassification(
                model_name="PP-LCNet_x1_0_doc_ori", enable_mkldnn=False
            )
        label = str(_orienter.predict(crop)[0]["label_names"][0])
        rotations = {
            "90": cv2.ROTATE_90_COUNTERCLOCKWISE,
            "180": cv2.ROTATE_180,
            "270": cv2.ROTATE_90_CLOCKWISE,
        }
        if label not in rotations:
            return crop, 0
        rotated = cv2.rotate(crop, rotations[label])
        verify = str(_orienter.predict(rotated)[0]["label_names"][0])
        if verify != "0":
            return crop, 0
        return rotated, int(label)
    except Exception as exc:  # noqa: BLE001 — orientation is an enhancement, never a failure
        _orienter_failed = True
        logger.warning("nameplate-detect: orientation classifier failed: %s", exc)
        return crop, 0


def _crop_jpeg(raw: bytes, bbox: dict[str, int], pad: int) -> tuple[bytes, dict[str, int], int]:
    """Crop `bbox` (expanded by `pad`, clamped to the frame) out of the decoded
    image at NATIVE resolution, upright it, and re-encode as JPEG q95. Runs in
    a worker thread. The crop is taken from the original bytes — never from a
    resized intermediate — so no detail is lost between detection and
    recognition. Returns (jpeg_bytes, bbox_in_original_space, rotation_deg)."""
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("undecodable_image")
    h, w = img.shape[:2]
    x1 = max(0, bbox["left"] - pad)
    y1 = max(0, bbox["top"] - pad)
    x2 = min(w, bbox["left"] + bbox["width"] + pad)
    y2 = min(h, bbox["top"] + bbox["height"] + pad)
    if x2 - x1 <= 0 or y2 - y1 <= 0:
        raise ValueError("empty_crop")
    crop, rotation_deg = _upright(img[y1:y2, x1:x2])
    ok, encoded = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not ok:
        raise ValueError("encode_failed")
    return encoded.tobytes(), {"left": x1, "top": y1, "width": x2 - x1, "height": y2 - y1}, rotation_deg


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

    image_base64: str = Field(..., min_length=1, max_length=_MAX_IMAGE_B64_LEN)
    min_score: float = Field(default=0.5, ge=0.0, le=1.0)
    # When true, the response carries the union-of-all-boxes crop as JPEG —
    # the exact automated-crop rule qualified in auto-round1-union.json. The
    # caller (mira-hub) cannot crop pixels itself: sharp is not a declared
    # hub dependency and nothing under src/lib may import it, while cv2 is
    # already resident here for detection.
    return_crop: bool = Field(default=False)
    crop_pad: int = Field(default=40, ge=0, le=400)


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

    def _detect_and_crop(raw_bytes: bytes, min_score: float, want_crop: bool, pad: int) -> dict:
        """The ENTIRE heavy path in one worker-thread occupancy of the busy
        slot: size check (header only) -> detector load -> predict -> crop.
        One occupancy per request means a timed-out predecessor can never
        overlap this run — the slot is still theirs until their thread ends."""
        _load_detector()
        if _detector_failed_reason is not None:
            return {"unavailable": _detector_failed_reason}
        _check_decoded_size(raw_bytes)
        polys, scores, width, height = _predict(raw_bytes)
        bbox = union_bbox(polys, scores, min_score)
        crop_b64: str | None = None
        crop_bbox: dict[str, int] | None = None
        crop_rotation_deg = 0
        if want_crop and bbox is not None:
            try:
                crop_bytes, crop_bbox, crop_rotation_deg = _crop_jpeg(raw_bytes, bbox, pad)
                crop_b64 = base64.b64encode(crop_bytes).decode()
            except Exception as exc:  # noqa: BLE001 — a failed crop must not void the detections
                logger.warning("nameplate-detect: crop failed: %s", exc)
                crop_bbox = None
                crop_rotation_deg = 0
        return {
            "polys": polys,
            "scores": scores,
            "width": width,
            "height": height,
            "bbox": bbox,
            "crop_b64": crop_b64,
            "crop_bbox": crop_bbox,
            "crop_rotation_deg": crop_rotation_deg,
        }

    try:
        ok, out = await _run_exclusive(
            _detect_and_crop, raw, req.min_score, req.return_crop, req.crop_pad, timeout=timeout
        )
        if not ok:
            # "busy" = the single inference slot is occupied (possibly by a
            # request whose waiter already timed out — the thread is still
            # running and still owns the memory). "timeout" = we stopped
            # waiting on our own run. Both degrade; the caller falls back.
            return _unavailable(out)
        if "unavailable" in out:
            return _unavailable(out["unavailable"])
    except ValueError as exc:
        if str(exc) == "image_too_large_decoded":
            raise HTTPException(status_code=413, detail="decoded image exceeds pixel limit")
        raise HTTPException(status_code=400, detail="undecodable image")
    except Exception as exc:  # noqa: BLE001 — degrade, never 500: caller falls back
        logger.warning("nameplate-detect: inference failed: %s", exc)
        return _unavailable(f"inference_failed: {type(exc).__name__}")

    polys, scores = out["polys"], out["scores"]
    width, height = out["width"], out["height"]
    bbox = out["bbox"]
    crop_b64 = out["crop_b64"]
    crop_bbox = out["crop_bbox"]
    crop_rotation_deg = out["crop_rotation_deg"]

    return {
        "available": True,
        "reason": None,
        "model": _det_model_name(),
        "image": {"width": width, "height": height},
        "regions": [
            {"poly": poly, "score": score} for poly, score in zip(polys, scores)
        ],
        "union_bbox": bbox,
        "crop_base64": crop_b64,
        "crop_bbox": crop_bbox,
        # Degrees the crop was rotated counterclockwise-corrected to upright
        # (0 = returned as it lies in the original). Provenance: original
        # pixels = decode(original)[crop_bbox] rotated by this amount.
        "crop_rotation_deg": crop_rotation_deg,
        "ms": int((time.monotonic() - t0) * 1000),
    }
