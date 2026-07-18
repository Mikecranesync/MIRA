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

# STRONG "this IS a drawing" signals. If the vision model's own description uses
# one of these phrases, the image is an electrical print regardless of which
# equipment it depicts — a "wiring diagram of a VFD drive" is a drawing, not a
# faceplate photo. These are checked BEFORE the equipment-face keywords so that
# "drive"/"vfd"/"relay" in the description of a print no longer forces
# EQUIPMENT_PHOTO. (Fixes the campaign-measured 91% mis-classification of real
# electrical prints — docs/eval/print-translator-campaign/RANKED_REPORT.md.)
STRONG_PRINT_SIGNALS = {
    "wiring diagram",
    "schematic",
    "electrical schematic",
    "electrical drawing",
    "electrical print",
    "ladder logic",
    "ladder diagram",
    "relay logic",
    "one-line diagram",
    "one line diagram",
    "single-line diagram",
    "single line diagram",
    "connection diagram",
    "control diagram",
    "circuit diagram",
    "terminal diagram",
}

# Caption/question vocabulary that signals the photo is a DRAWING, not a
# physical component. Routes a captioned print photo to the grounded schematic
# path even when the vision summary of the drawing's CONTENT (motor, sensor,
# RTD, terminal, relay) trips an EQUIPMENT_FACE keyword — the technician saying
# "this print/schematic/diagram" outranks an incidental component word.
# Regression: docs/eval/visual-technician-corpus/hard_failures/
#   oem_brake_stator.yaml
CAPTION_PRINT_KEYWORDS = {
    "print",
    "prints",
    "schematic",
    "diagram",
    "drawing",
    "wiring",
    "one-line",
    "one line",
    "single line",
    "ladder",
    "p&id",
    "panel schedule",
    "elementary",
    "control print",
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
    "hp",
    "horsepower",
    "kw",
    "fla",
    "full load amp",
    "full-load amp",
    "serial",
    "serial no",
    "ser. no",
    "volts",
    "voltage",
    "vac",
    "vdc",
    "hz",
    "frequency",
    "rpm",
    "r.p.m",
    "manufacturer",
    "mfr",
    "model no",
    "model number",
    "catalog",
    "enclosure",
    "nema",
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

# Compiled word-boundary matchers, cached per keyword. Word-boundary matching
# (not substring) is required so an equipment keyword like "led" does not match
# inside "titled", "run" inside "runway", or "drive" inside "driver" — every one
# of those substring hits mis-classified a real electrical print in the campaign.
_KW_PATTERN_CACHE: dict[str, "re.Pattern[str]"] = {}


def _kw_in(keyword: str, text: str) -> bool:
    """True if ``keyword`` occurs in ``text`` as a whole word/phrase.

    ``(?<!\\w) … (?!\\w)`` anchors both ends to a non-word char (or string
    edge), so ``"led"`` matches ``"led fault"`` but NOT ``"titled"``. Spaces
    and punctuation inside a phrase (``"wiring diagram"``, ``"p&id"``,
    ``"one-line"``) are matched literally via ``re.escape``. ``text`` and the
    keywords are already lower-cased by the caller.
    """
    pattern = _KW_PATTERN_CACHE.get(keyword)
    if pattern is None:
        pattern = re.compile(r"(?<!\w)" + re.escape(keyword) + r"(?!\w)")
        _KW_PATTERN_CACHE[keyword] = pattern
    return pattern.search(text) is not None


_NEGATORS = re.compile(
    r"(?<!\w)(?:not|no|never|isn't|aren't|doesn't|don't|didn't|cannot|can't|won't"
    r"|without|unlikely|rather than|instead of)(?!\w)"
)
# A negation's scope ends at a contrast word: "not a photo but a schematic"
# still affirms "schematic".
_NEGATION_SCOPE_BREAKERS = re.compile(r"(?<!\w)(?:but|however|although|though|yet)(?!\w)")
_SENTENCE_SPLIT = re.compile(r"[.;!?]")


def _kw_affirmed(keyword: str, text: str) -> bool:
    """True if ``keyword`` occurs in ``text`` OUTSIDE a negated clause.

    Prose guard for vision-model descriptions: "does not appear to be an
    electrical drawing" mentions the phrase but DENIES it — that mention must
    not count as a classification signal (it mis-routed a plain gray photo to
    the print path at 0.75 confidence). A mention is negated when a negator
    token precedes it in the same sentence with no contrast word ("but",
    "however", …) between them. OCR label lanes keep plain ``_kw_in`` — OCR
    items are labels, not prose.
    """
    for sentence in _SENTENCE_SPLIT.split(text):
        pattern = _KW_PATTERN_CACHE.get(keyword)
        if pattern is None:
            pattern = re.compile(r"(?<!\w)" + re.escape(keyword) + r"(?!\w)")
            _KW_PATTERN_CACHE[keyword] = pattern
        for m in pattern.finditer(sentence):
            prefix = sentence[: m.start()]
            neg_positions = [n.end() for n in _NEGATORS.finditer(prefix)]
            if not neg_positions:
                return True
            last_neg = neg_positions[-1]
            if _NEGATION_SCOPE_BREAKERS.search(prefix[last_neg:]):
                return True
    return False


OCR_CLASSIFICATION_THRESHOLD = 10


def parse_ocr_reply(raw: str) -> list[str]:
    """Model OCR reply -> clean text items (numbered list / markdown tolerant)."""
    items = []
    for line in raw.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("```") or line in ("{", "}", "[", "]"):
            continue
        if re.match(r"^[|:\-\s]+$", line):
            continue
        if line.startswith("|") and line.endswith("|"):
            cells = [c.strip() for c in line.split("|") if c.strip()]
            for cell in cells:
                cell = re.sub(r"[*`]", "", cell).strip()
                if cell and not cell.startswith("```"):
                    items.append(cell)
            continue
        line = re.sub(r"[*`]", "", line)
        cleaned = re.sub(r"^\d+[\.\)]\s*|^\d+\s+-\s+|^\d+\s+", "", line).strip()
        if cleaned and not cleaned.startswith("```"):
            items.append(cleaned)
    return items


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

        classify_result = self._classify_photo(str(vision_result), ocr_items, message)
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
        """Model-OCR enrichment lane (OFF by default — the deterministic floor
        is Tesseract, see ``process``). When ``OCR_MODEL_LANE=on``, sends the
        numbered-list OCR prompt through the inference router (same cascade
        as ``_call_vision``); free-tier VL models misread dense schematics
        (2026-07-17 UNSEEN benchmark), so this lane supplements the floor —
        it must never replace it."""
        if os.environ.get("OCR_MODEL_LANE", "off").strip().lower() != "on":
            return []

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
        content, _usage = await _inference_router.complete(messages)
        if not content:
            return []
        return parse_ocr_reply(content)

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

    def _classify_photo(self, vision_result: str, ocr_items: list, caption: str = "") -> dict:
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

        # Word-boundary matching (`_kw_in`) — "led" must not match "titled",
        # "drive" must not match "driver". NAMEPLATE_OCR_FIELDS keeps substring
        # matching below (units like "5HP"/"60Hz" sit adjacent to digits).
        # Vision prose goes through `_kw_affirmed` so a DENIED mention ("does
        # not appear to be an electrical drawing") never counts as a signal;
        # OCR text stays on `_kw_in` (labels, not prose).
        equip_matches = sum(
            1
            for kw in EQUIPMENT_FACE_KEYWORDS
            if _kw_affirmed(kw, vision_lower) or _kw_in(kw, ocr_text_lower)
        )
        print_matches = sum(
            1
            for kw in PRINT_KEYWORDS
            if _kw_affirmed(kw, vision_lower) or _kw_in(kw, ocr_text_lower)
        )
        nameplate_matches = sum(
            1
            for kw in NAMEPLATE_KEYWORDS
            if _kw_affirmed(kw, vision_lower) or _kw_in(kw, ocr_text_lower)
        )

        # Nameplate detection: vision model explicitly calls it a nameplate/data plate.
        # Check vision_lower first (high confidence); fall back to OCR (lower confidence).
        if any(_kw_affirmed(kw, vision_lower) for kw in NAMEPLATE_KEYWORDS):
            conf = min(1.0, 0.7 + nameplate_matches * 0.05)
            return {"type": "NAMEPLATE", "confidence": round(conf, 2)}
        if any(_kw_in(kw, ocr_text_lower) for kw in NAMEPLATE_KEYWORDS):
            conf = min(1.0, 0.5 + nameplate_matches * 0.05)
            return {"type": "NAMEPLATE", "confidence": round(conf, 2)}

        # Structural nameplate detection: ≥3 nameplate fields in OCR → it's a nameplate
        # even if the vision model calls it a "specifications table" or "AC drive".
        # VFD and motor nameplates are often printed labels that vision models describe
        # using the equipment name ("drive", "controller") rather than "nameplate".
        # (Substring match on purpose — "5HP"/"480VAC"/"60Hz" abut digits.)
        ocr_field_hits = sum(1 for f in NAMEPLATE_OCR_FIELDS if f in ocr_text_lower)
        if ocr_field_hits >= 3:
            conf = min(1.0, 0.55 + ocr_field_hits * 0.04)
            return {"type": "NAMEPLATE", "confidence": round(conf, 2)}

        # Vision structural detection: "table with specifications" or "specifications for"
        # catches VFD spec labels described by vision models using the equipment name
        # ("AC Drive", "VFD") rather than the word "nameplate". This runs before the
        # EQUIPMENT_FACE check so "drive" in the description doesn't override it.
        _spec_table = (
            "table" in vision_lower
            and any(w in vision_lower for w in ("specification", "rating", "data sheet"))
        ) or "specifications for" in vision_lower
        if _spec_table:
            return {"type": "NAMEPLATE", "confidence": 0.65}

        # STRONG print signal in the vision model's own description → it IS a drawing,
        # regardless of which equipment it depicts. MUST precede the equipment-face
        # keywords: a "wiring diagram of a VFD drive" must not be forced to
        # EQUIPMENT_PHOTO by the word "drive". (The 91% mis-classification fix.)
        if any(_kw_affirmed(sig, vision_lower) for sig in STRONG_PRINT_SIGNALS):
            conf = min(1.0, 0.7 + print_matches * 0.05)
            return {"type": "ELECTRICAL_PRINT", "confidence": round(conf, 2)}

        # Caption override: if the technician's caption/question explicitly calls
        # this a print/schematic/diagram/wiring drawing, trust that over an
        # incidental equipment-component word in the vision summary. A genuine
        # nameplate (handled above) still wins; this only pre-empts the
        # EQUIPMENT_FACE override below so a captioned drawing routes to the
        # grounded schematic path instead of the generic engine.
        caption_lower = (caption or "").lower()
        if any(_kw_in(kw, caption_lower) for kw in CAPTION_PRINT_KEYWORDS):
            return {"type": "ELECTRICAL_PRINT", "confidence": 0.6}

        # Equipment faceplate keywords (only when NO strong print signal above) —
        # a physical faceplate photo, never a drawing.
        if any(_kw_affirmed(kw, vision_lower) for kw in EQUIPMENT_FACE_KEYWORDS):
            conf = min(1.0, 0.6 + equip_matches * 0.05)
            return {"type": "EQUIPMENT_PHOTO", "confidence": round(conf, 2)}
        if any(_kw_in(kw, ocr_text_lower) for kw in EQUIPMENT_FACE_KEYWORDS):
            conf = min(1.0, 0.4 + equip_matches * 0.05)
            return {"type": "EQUIPMENT_PHOTO", "confidence": round(conf, 2)}

        # Weaker print keywords in the description — trust it.
        if any(_kw_affirmed(kw, vision_lower) for kw in PRINT_KEYWORDS):
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
