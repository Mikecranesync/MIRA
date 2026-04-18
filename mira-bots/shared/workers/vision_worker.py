"""Vision Worker — Photo analysis, OCR, and classification."""

import base64
import io
import logging
import os
import re

import httpx
from PIL import Image

from ..inference.router import InferenceRouter as _InferenceRouter

_inference_router = _InferenceRouter()

logger = logging.getLogger("mira-gsd")

PRINT_KEYWORDS = {
    "schematic",
    "diagram",
    "drawing",
    "ladder",
    "p&id",
    "wiring",
    "one-line",
    "rung",
    "contactor",
    "electrical print",
    "control diagram",
    "ladder logic",
    "relay logic",
}

# Keywords that indicate a nameplate / data plate / rating plate photo.
# These appear in the vision model description or OCR text when the photo
# shows an equipment identification label rather than a faceplate with
# indicators or an electrical drawing.
NAMEPLATE_KEYWORDS = {
    "nameplate",
    "data plate",
    "rating plate",
    "specification plate",
    "serial number plate",
    "serial plate",
    "motor nameplate",
    "equipment tag",
    "id plate",
    "identification plate",
    "name plate",
}

# Structured fields that appear on equipment nameplates — if ≥3 are found in OCR,
# the image is a nameplate regardless of how the vision model describes it.
# This catches VFD spec tables described as "AC Drive" by the vision model.
NAMEPLATE_OCR_FIELDS = {
    "hp", "horsepower", "kw",
    "fla", "full load amp", "full-load amp",
    "serial", "serial no", "ser. no",
    "volts", "voltage", "vac", "vdc",
    "hz", "frequency",
    "rpm", "r.p.m",
    "manufacturer", "mfr",
    "model no", "model number", "catalog",
    "enclosure", "nema",
}

# Keywords that indicate a physical component photo, NOT a drawing —
# even if the faceplate has many readable text labels (OCR items > threshold)
EQUIPMENT_FACE_KEYWORDS = {
    "overload",
    "relay",
    "vfd",
    "drive",
    "controller",
    "plc",
    "display",
    "indicator",
    "led",
    "dial",
    "faceplate",
    "nameplate",
    "breaker",
    "contactor",
    "motor starter",
    "disconnect",
    "push to reset",
    "fault",
    "run",
    "allen-bradley",
    "siemens",
    "eaton",
    "schneider",
    "abb",
    "powerflex",
    "micro820",
    "compactlogix",
    "e1 plus",
    "e3 plus",
    "gs10",
    "gs20",
    "gs4",
    "panel meter",
    "hmi",
    "touchscreen",
    "power supply",
    "terminal block",
    "sensor",
    "proximity",
    "photoelectric",
    "encoder",
    "thermocouple",
    "rtd",
}

OCR_CLASSIFICATION_THRESHOLD = 10


class VisionWorker:
    """Handles photo analysis: vision model + OCR + classification."""

    def __init__(self, openwebui_url: str, api_key: str, vision_model: str):
        self.openwebui_url = openwebui_url.rstrip("/")
        self.api_key = api_key
        self.vision_model = vision_model

    async def process(self, photo_b64: str, message: str) -> dict:
        """Analyze a photo. Returns classification and extracted data.

        Returns dict with keys:
            classification: 'ELECTRICAL_PRINT' | 'NAMEPLATE' | 'EQUIPMENT_PHOTO'
            vision_result: str (vision model description)
            ocr_items: list[str] (glm-ocr extracted text items)
            tesseract_text: str (Tesseract backup OCR)
            drawing_type: str | None (only for ELECTRICAL_PRINT)
        """
        import asyncio

        vision_coro = self._call_vision(photo_b64, message)
        ocr_coro = self._call_ocr(photo_b64)
        results = await asyncio.gather(vision_coro, ocr_coro, return_exceptions=True)

        vision_result = results[0] if not isinstance(results[0], Exception) else message
        ocr_items = results[1] if not isinstance(results[1], Exception) else []

        if isinstance(results[0], Exception):
            logger.error("Vision call failed: %s", results[0])
        if isinstance(results[1], Exception):
            logger.warning("glm-ocr call failed: %s", results[1])

        tesseract_text = self._ocr_extract(photo_b64)

        classify_result = self._classify_photo(str(vision_result), ocr_items)
        classification = classify_result["type"]
        classify_confidence = classify_result["confidence"]
        logger.info(
            "Photo classified as %s (confidence=%.2f, %d OCR items)",
            classification,
            classify_confidence,
            len(ocr_items),
        )

        drawing_type = None
        drawing_confidence = 0.0
        if classification == "ELECTRICAL_PRINT":
            dt_result = self._detect_drawing_type(str(vision_result))
            drawing_type = dt_result["type"]
            drawing_confidence = dt_result["confidence"]

        return {
            "classification": classification,
            "classification_confidence": classify_confidence,
            "vision_result": vision_result,
            "ocr_items": ocr_items if isinstance(ocr_items, list) else [],
            "tesseract_text": tesseract_text,
            "drawing_type": drawing_type,
            "drawing_type_confidence": drawing_confidence,
        }

    async def _call_vision(self, photo_b64: str, caption: str) -> str:
        """Send photo to vision model for asset/drawing identification."""
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{photo_b64}",
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "What is in this image? "
                            "If it is a PHYSICAL piece of equipment or component "
                            "(relay, VFD, drive, PLC, breaker, motor starter, overload, "
                            "sensor, panel meter, HMI), return: manufacturer, model, "
                            "and describe the STATE of visible indicators — which LEDs "
                            "are lit (color and label), dial/potentiometer positions, "
                            "DIP switch settings, display readings, and any fault or "
                            "alarm indicators. This is critical for diagnosis. "
                            "If it is an electrical drawing, schematic, or diagram "
                            "(printed on paper or a CAD screen), say 'electrical drawing' "
                            "and the type (ladder logic, one-line, wiring, P&ID, "
                            "panel schedule). "
                            "If the image shows a computer monitor or laptop screen, "
                            "analyze ONLY the technical content on screen — ignore "
                            "application toolbars, menus, window chrome, and any AI "
                            "assistant UI elements visible in the software. "
                            "If text is small or partially visible, describe what you "
                            "can read and note a closer shot may improve extraction. "
                            "Keep it under 50 words. Do NOT invent any text."
                        ),
                    },
                ],
            }
        ]

        # Try Claude router first; fall back to local Open WebUI if not enabled or error
        content, usage = await _inference_router.complete(messages)
        if content:
            _InferenceRouter.log_usage(usage)
            return content

        # Local fallback via Open WebUI
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.openwebui_url}/api/chat/completions",
                headers=headers,
                json={"model": self.vision_model, "messages": messages},
            )
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"]

    async def _call_ocr(self, photo_b64: str) -> list:
        """Call glm-ocr for pure text extraction. Returns list of text items."""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{photo_b64}"},
                    },
                    {
                        "type": "text",
                        "text": (
                            "You are a precision OCR engine. Extract ALL text visible "
                            "in this image exactly as printed. Preserve wire numbers, "
                            "part numbers, terminal labels, fault codes, and all "
                            "alphanumeric content. Output as a plain numbered list — "
                            "no code blocks, no JSON, no markdown formatting. "
                            "Each line: a number, a period, then the extracted text. "
                            "NEVER interpret, explain, or add content not visible. "
                            "If text is unclear write [UNCLEAR]."
                        ),
                    },
                ],
            }
        ]

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.openwebui_url}/api/chat/completions",
                headers=headers,
                json={
                    "model": os.environ.get("GLM_OCR_MODEL", "glm-ocr:latest"),
                    "messages": messages,
                    "options": {"temperature": 0.0},
                },
            )
            resp.raise_for_status()
            data = resp.json()

        raw = data["choices"][0]["message"]["content"]
        items = []
        for line in raw.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            # Skip code fence markers and bare JSON/markdown syntax
            if line.startswith("```") or line in ("{", "}", "[", "]"):
                continue
            # Skip markdown table separator rows (|:---|:---|)
            if re.match(r"^[|:\-\s]+$", line):
                continue
            # Extract content from markdown table rows (| cell | cell |)
            if line.startswith("|") and line.endswith("|"):
                cells = [c.strip() for c in line.split("|") if c.strip()]
                for cell in cells:
                    cell = re.sub(r"[*`]", "", cell).strip()
                    if cell and not cell.startswith("```"):
                        items.append(cell)
                continue
            # Strip markdown bold/italic/code markers from regular lines (not underscore)
            line = re.sub(r"[*`]", "", line)
            # Strip leading numbers, dots, dashes, parens
            cleaned = re.sub(r"^\d+[\.\)\-\s]+", "", line).strip()
            if cleaned and not cleaned.startswith("```"):
                items.append(cleaned)
        return items

    def _ocr_extract(self, photo_b64: str) -> str:
        """Run Tesseract OCR on image to extract text deterministically."""
        try:
            import pytesseract

            image_bytes = base64.b64decode(photo_b64)
            img = Image.open(io.BytesIO(image_bytes))
            text = pytesseract.image_to_string(img, config="--psm 6")
            return text.strip()
        except Exception as e:
            logger.warning("OCR extraction failed: %s", e)
            return ""

    def _classify_photo(self, vision_result: str, ocr_items: list) -> dict:
        """Classify photo as ELECTRICAL_PRINT, NAMEPLATE, or EQUIPMENT_PHOTO with confidence.

        Returns {"type": str, "confidence": float}.

        Equipment faceplates (overload relays, VFDs, PLCs) often have 10+ readable
        labels, so OCR count alone must NOT override the vision model's classification.
        Vision model identification takes priority — OCR count is only a tiebreaker
        when the vision model is ambiguous.

        NAMEPLATE detection fires when the vision model or OCR explicitly uses
        nameplate/data-plate/rating-plate vocabulary, indicating the photo shows
        an identification label rather than a live faceplate or drawing.

        Confidence is based on keyword match density across vision + OCR text.
        """
        vision_lower = vision_result.lower()
        ocr_text_lower = " ".join(ocr_items).lower()
        combined = vision_lower + " " + ocr_text_lower

        equip_matches = sum(1 for kw in EQUIPMENT_FACE_KEYWORDS if kw in combined)
        print_matches = sum(1 for kw in PRINT_KEYWORDS if kw in combined)
        nameplate_matches = sum(1 for kw in NAMEPLATE_KEYWORDS if kw in combined)

        # Nameplate detection: vision model explicitly calls it a nameplate/data plate.
        # Check vision_lower first (high confidence); fall back to OCR (lower confidence).
        if any(kw in vision_lower for kw in NAMEPLATE_KEYWORDS):
            conf = min(1.0, 0.7 + nameplate_matches * 0.05)
            return {"type": "NAMEPLATE", "confidence": round(conf, 2)}
        if any(kw in ocr_text_lower for kw in NAMEPLATE_KEYWORDS):
            conf = min(1.0, 0.5 + nameplate_matches * 0.05)
            return {"type": "NAMEPLATE", "confidence": round(conf, 2)}

        # Structural nameplate detection: ≥3 nameplate fields in OCR → it's a nameplate
        # even if the vision model calls it a "specifications table" or "AC drive".
        # VFD and motor nameplates are often printed labels that vision models describe
        # using the equipment name ("drive", "controller") rather than "nameplate".
        ocr_field_hits = sum(1 for f in NAMEPLATE_OCR_FIELDS if f in ocr_text_lower)
        if ocr_field_hits >= 3:
            conf = min(1.0, 0.55 + ocr_field_hits * 0.04)
            return {"type": "NAMEPLATE", "confidence": round(conf, 2)}

        # Equipment faceplate keywords override everything — these are never drawings
        if any(kw in vision_lower for kw in EQUIPMENT_FACE_KEYWORDS):
            conf = min(1.0, 0.6 + equip_matches * 0.05)
            return {"type": "EQUIPMENT_PHOTO", "confidence": round(conf, 2)}
        if any(kw in ocr_text_lower for kw in EQUIPMENT_FACE_KEYWORDS):
            conf = min(1.0, 0.4 + equip_matches * 0.05)
            return {"type": "EQUIPMENT_PHOTO", "confidence": round(conf, 2)}

        # Vision model says it's a drawing — trust it
        if any(kw in vision_lower for kw in PRINT_KEYWORDS):
            conf = min(1.0, 0.6 + print_matches * 0.08)
            return {"type": "ELECTRICAL_PRINT", "confidence": round(conf, 2)}

        # High OCR count + no equipment keywords = likely a drawing
        if len(ocr_items) >= OCR_CLASSIFICATION_THRESHOLD:
            conf = min(1.0, 0.3 + len(ocr_items) * 0.02)
            return {"type": "ELECTRICAL_PRINT", "confidence": round(conf, 2)}

        # Default: equipment photo with low confidence
        return {"type": "EQUIPMENT_PHOTO", "confidence": 0.3}

    def _detect_drawing_type(self, vision_result: str) -> dict:
        """Detect the type of electrical drawing from vision result.

        Returns {"type": str, "confidence": float}.
        """
        vr = vision_result.lower()

        # Map keyword groups to drawing types with match counting
        _TYPES = [
            (["ladder", "rung"], "ladder logic diagram"),
            (["one-line", "one line", "single line"], "one-line diagram"),
            (["p&id", "piping"], "P&ID"),
            (["wiring", "terminal"], "wiring diagram"),
            (["panel", "schedule"], "panel schedule"),
            (["schematic", "circuit"], "schematic"),
        ]

        best_type = "electrical drawing"
        best_matches = 0
        for keywords, drawing_type in _TYPES:
            matches = sum(1 for kw in keywords if kw in vr)
            if matches > best_matches:
                best_matches = matches
                best_type = drawing_type

        conf = min(1.0, 0.4 + best_matches * 0.25) if best_matches > 0 else 0.2
        return {"type": best_type, "confidence": round(conf, 2)}
