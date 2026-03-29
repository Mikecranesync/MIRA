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
    "schematic", "diagram", "drawing", "ladder", "p&id", "wiring",
    "one-line", "rung", "contactor", "electrical print", "control diagram",
    "ladder logic", "relay logic",
}

# Keywords that indicate a physical component photo, NOT a drawing —
# even if the faceplate has many readable text labels (OCR items > threshold)
EQUIPMENT_FACE_KEYWORDS = {
    "overload", "relay", "vfd", "drive", "controller", "plc", "display",
    "indicator", "led", "dial", "faceplate", "nameplate", "breaker",
    "contactor", "motor starter", "disconnect", "push to reset", "fault",
    "run", "allen-bradley", "siemens", "eaton", "schneider", "abb",
    "powerflex", "micro820", "compactlogix", "e1 plus", "e3 plus",
    "gs10", "gs20", "gs4", "panel meter", "hmi", "touchscreen",
    "power supply", "terminal block", "sensor", "proximity",
    "photoelectric", "encoder", "thermocouple", "rtd",
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
            classification: 'ELECTRICAL_PRINT' | 'EQUIPMENT_PHOTO'
            vision_result: str (vision model description)
            ocr_items: list[str] (glm-ocr extracted text items)
            tesseract_text: str (Tesseract backup OCR)
            drawing_type: str | None (only for ELECTRICAL_PRINT)
        """
        import asyncio

        vision_coro = self._call_vision(photo_b64, message)
        ocr_coro = self._call_ocr(photo_b64)
        results = await asyncio.gather(
            vision_coro, ocr_coro, return_exceptions=True
        )

        vision_result = results[0] if not isinstance(results[0], Exception) else message
        ocr_items = results[1] if not isinstance(results[1], Exception) else []

        if isinstance(results[0], Exception):
            logger.error("Vision call failed: %s", results[0])
        if isinstance(results[1], Exception):
            logger.warning("glm-ocr call failed: %s", results[1])

        tesseract_text = self._ocr_extract(photo_b64)

        classification = self._classify_photo(str(vision_result), ocr_items)
        logger.info(
            "Photo classified as %s (%d OCR items)", classification, len(ocr_items)
        )

        drawing_type = None
        if classification == "ELECTRICAL_PRINT":
            drawing_type = self._detect_drawing_type(str(vision_result))

        return {
            "classification": classification,
            "vision_result": vision_result,
            "ocr_items": ocr_items if isinstance(ocr_items, list) else [],
            "tesseract_text": tesseract_text,
            "drawing_type": drawing_type,
        }

    async def _call_vision(self, photo_b64: str, caption: str) -> str:
        """Send photo to vision model for asset/drawing identification."""
        messages = [{
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
        }]

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

        messages = [{
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
        }]

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
            if re.match(r'^[|:\-\s]+$', line):
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

    def _classify_photo(self, vision_result: str, ocr_items: list) -> str:
        """Classify photo as ELECTRICAL_PRINT or EQUIPMENT_PHOTO.

        Equipment faceplates (overload relays, VFDs, PLCs) often have 10+ readable
        labels, so OCR count alone must NOT override the vision model's classification.
        Vision model identification takes priority — OCR count is only a tiebreaker
        when the vision model is ambiguous.
        """
        vision_lower = vision_result.lower()
        ocr_text_lower = " ".join(ocr_items).lower()

        # Equipment faceplate keywords override everything — these are never drawings
        if any(kw in vision_lower for kw in EQUIPMENT_FACE_KEYWORDS):
            return "EQUIPMENT_PHOTO"
        if any(kw in ocr_text_lower for kw in EQUIPMENT_FACE_KEYWORDS):
            return "EQUIPMENT_PHOTO"

        # Vision model says it's a drawing — trust it
        if any(kw in vision_lower for kw in PRINT_KEYWORDS):
            return "ELECTRICAL_PRINT"

        # High OCR count + no equipment keywords = likely a drawing
        if len(ocr_items) >= OCR_CLASSIFICATION_THRESHOLD:
            return "ELECTRICAL_PRINT"

        return "EQUIPMENT_PHOTO"

    def _detect_drawing_type(self, vision_result: str) -> str:
        """Detect the type of electrical drawing from vision result."""
        vr = vision_result.lower()
        if "ladder" in vr or "rung" in vr:
            return "ladder logic diagram"
        if "one-line" in vr or "one line" in vr or "single line" in vr:
            return "one-line diagram"
        if "p&id" in vr or "piping" in vr:
            return "P&ID"
        if "wiring" in vr or "terminal" in vr:
            return "wiring diagram"
        if "panel" in vr or "schedule" in vr:
            return "panel schedule"
        if "schematic" in vr or "circuit" in vr:
            return "schematic"
        return "electrical drawing"
