"""Vision Worker — Photo analysis, OCR, and classification."""

import base64
import logging
import os
import re

import httpx

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

# IEC/DIN designation-grammar tokens (schematic tags) — deterministic LAYOUT
# evidence that a page is a drawing. Real prints label entities with short
# designators (-M1, -B1, -X1, -W5497, -20/A10, 15.7, PT100); physical equipment
# photos carry brand/catalog text (Micro820, 2080-LC20-20QBB) that matches none
# of these. Anchored full-token patterns — an OCR item must BE a tag, not merely
# contain one — so long catalog strings can never false-positive.
_SCHEMATIC_TAG_PATTERNS = [
    re.compile(r"^[+-][A-Z]{1,3}\d{1,4}$", re.IGNORECASE),  # -M1, -B2, +S1
    re.compile(r"^-?[A-Z]{0,3}\d{1,3}/[A-Z]{1,3}\d{1,4}$", re.IGNORECASE),  # -20/A10
    re.compile(r"^-?W\d{2,5}$", re.IGNORECASE),  # -W5497
    re.compile(r"^\d{1,3}\.\d{1,2}$"),  # 15.7 (sheet.column)
    re.compile(r"^[A-Z]{1,3}\d{1,4}$", re.IGNORECASE),  # PT100, M1 (unprefixed)
]
_PREFIXED_TAG = re.compile(r"^[+-]|/")


def _ocr_schematic_tag_hits(ocr_items: list) -> tuple[int, int]:
    """(total tag-grammar hits, prefixed hits) across OCR items.

    ``prefixed`` (leading -/+ or a sheet/device slash) is the high-precision
    subset — bare ``PT100``-style tokens also appear on nameplates, so the
    caller requires at least one prefixed tag before trusting the count.
    """
    hits = prefixed = 0
    for item in ocr_items or []:
        tok = str(item).strip()
        if any(p.match(tok) for p in _SCHEMATIC_TAG_PATTERNS):
            hits += 1
            if _PREFIXED_TAG.search(tok[:4]):
                prefixed += 1
    return hits, prefixed


# Minimum distinct tag-grammar hits (with >=1 prefixed) to call a page a print
# on layout evidence alone.
SCHEMATIC_TAG_THRESHOLD = 3

# Overwhelming OCR density, on its own, is STRONG layout evidence a page is a
# printed sheet/table rather than a physical device face — deliberately much
# higher than OCR_CLASSIFICATION_THRESHOLD (10, a WEAK tiebreaker only reached
# when nothing else matched; see the "OCR count alone must NOT override the
# vision model's classification" note in _classify_photo). Bench regression
# (2026-07-18 Tower OP re-benchmark, c11/c12): two real LED/diagnostic-table
# print pages carried 156 and 184 OCR items yet classified EQUIPMENT_PHOTO,
# because their dense reference tables are described using the SAME
# vocabulary as EQUIPMENT_FACE_KEYWORDS ("led", "plc", "indicator", "fault")
# and their module references (e.g. "X9.4") don't match the IEC schematic-tag
# grammar above. No genuine single-device faceplate/nameplate photo carries
# anywhere near this many distinct OCR items, so this threshold is safe to
# treat as STRONG evidence — outranking EQUIPMENT_FACE_KEYWORDS the same way
# STRONG_PRINT_SIGNALS and the schematic-tag grammar already do.
DENSE_TABLE_OCR_THRESHOLD = 50

# Guards the NAMEPLATE_OCR_FIELDS unit-vocabulary branch (>=3 hits, above) at
# dense-table volume — bench regression 2026-07-19, c10: a ~170-item PLC
# LED-reference table carried "24 V"/"10 Hz"/"(25 Hz)"/"voltage" as native
# table content, hitting >=3 NAMEPLATE_OCR_FIELDS and returning NAMEPLATE
# before the DENSE_TABLE_OCR_THRESHOLD check above ever ran. At
# len(ocr_items) >= DENSE_TABLE_OCR_THRESHOLD, the unit-field branch requires
# EITHER plate vocabulary proper (NAMEPLATE_KEYWORDS — checked earlier,
# unconditional on density) OR a hit density at/above this ratio. Derived
# from the two real data points: a genuine VFD spec plate is ~3+ hits in ~a
# dozen OCR items (~0.25+); the c10 table is ~4 hits in ~170 items (~0.02).
# 0.15 sits with margin below a real plate and well above the table case.
# Below the dense threshold this guard does not apply — unit-field NAMEPLATE
# detection is unchanged.
NAMEPLATE_FIELD_DENSITY_THRESHOLD = 0.15


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
        # Numbering alternatives, in order: dot/paren ("1." / "2)"), dash-bullet (needs whitespace after the dash, e.g. "3 - x"), then bare "N ".
        # A glued dash ("3 -K17") isn't dash-bullet (no space after "-"), so it falls to bare "N " and the IEC tag "-K17" survives.
        cleaned = re.sub(r"^\d+[\.\)]\s*|^\d+\s+-\s+|^\d+\s+", "", line).strip()
        if cleaned and not cleaned.startswith("```"):
            items.append(cleaned)
    return items


def _tesseract_tokens_impl(image_bytes: bytes) -> list[dict]:
    """Deterministic word boxes via the shared printsense adapter.

    Raises printsense.xref_extractor.OcrUnavailable when the binary or
    pytesseract is absent (local Windows dev) — callers degrade honestly.
    """
    from printsense.xref_extractor import ocr_tokens

    return ocr_tokens(image_bytes)


def _printsense_line_items(tokens: list) -> list:
    """line_items via printsense when shipped; [] otherwise for lean images."""
    try:
        from printsense.xref_extractor import line_items
    except ImportError:
        return []
    return line_items(tokens)


def _tesseract_version_impl() -> str:
    import pytesseract

    return str(pytesseract.get_tesseract_version())


def _model_lane_on() -> bool:
    """OCR_MODEL_LANE=on gate, shared by ocr_lane_report() and _call_ocr() —
    off by default; the deterministic floor is Tesseract."""
    return os.environ.get("OCR_MODEL_LANE", "off").strip().lower() == "on"


def ocr_lane_report() -> dict:
    """One-shot health report for every OCR lane. Logged at bot boot and
    rendered by /printsense_test ocr — the mechanism that makes a dead
    floor loud instead of a per-turn WARNING nobody reads (the 2026-07
    glm-ocr lane died silently for weeks)."""
    expected = (os.environ.get("OCR_EXPECT_TESSERACT", "0").strip() or "0") == "1"
    model_lane = "on" if _model_lane_on() else "off"
    try:
        version: str | None = _tesseract_version_impl()
        available = True
    except Exception:  # noqa: BLE001 — absence is a report state, not an error
        version = None
        available = False
    if available:
        verdict = "ok"
    elif expected:
        verdict = "DEAD"
    else:
        verdict = "DEGRADED"
    return {
        "tesseract": {"available": available, "version": version},
        "model_lane": model_lane,
        "expected_floor": expected,
        "verdict": verdict,
    }


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
            ocr_items: list[str] (Tesseract floor + model-lane supplement, deduped)
            ocr_tokens: list[dict] (Tesseract word boxes: {text, bbox, line}; [] when unavailable)
            ocr_source: str ('tesseract' | 'tesseract+model' | 'model' | 'none')
            tesseract_text: str (newline-joined Tesseract line strings from the same pass)
            drawing_type: str | None (only for ELECTRICAL_PRINT)
        """
        import asyncio

        vision_coro = self._call_vision(photo_b64, message)
        ocr_coro = self._call_ocr(photo_b64)

        def _floor() -> list[dict]:
            try:
                from printsense.xref_extractor import OcrUnavailable

                return _tesseract_tokens_impl(base64.b64decode(photo_b64))
            except ImportError as exc:
                # printsense not shipped in this image (slack/mira-pipeline) —
                # the floor is telegram-image-only until image parity lands.
                logger.warning("printsense not shipped in this image — OCR floor off: %s", exc)
                return []
            except OcrUnavailable as exc:
                logger.warning("tesseract floor unavailable: %s", exc)
                return []
            except Exception as exc:  # noqa: BLE001 — floor failure must not eat the turn
                logger.warning("tesseract floor error: %s", exc)
                return []

        floor_coro = asyncio.to_thread(_floor)
        results = await asyncio.gather(vision_coro, ocr_coro, floor_coro, return_exceptions=True)

        vision_result = results[0] if not isinstance(results[0], Exception) else message
        model_items = results[1] if not isinstance(results[1], Exception) else []
        ocr_tokens_ = results[2] if not isinstance(results[2], Exception) else []

        if isinstance(results[0], Exception):
            logger.error("Vision call failed: %s", results[0])
        if isinstance(results[1], Exception):
            logger.warning("model-OCR lane failed: %s", results[1])
        if isinstance(results[2], Exception):
            logger.warning("tesseract floor task failed: %s", results[2])

        floor_items = _printsense_line_items(ocr_tokens_)
        ocr_items = list(floor_items)
        for item in model_items if isinstance(model_items, list) else []:
            if item not in ocr_items:
                ocr_items.append(item)

        if floor_items and len(ocr_items) > len(floor_items):
            ocr_source = "tesseract+model"
        elif floor_items:
            ocr_source = "tesseract"
        elif ocr_items:
            ocr_source = "model"
        else:
            ocr_source = "none"

        tesseract_text = "\n".join(floor_items) if floor_items else ""

        classify_result = self._classify_photo(str(vision_result), ocr_items, message)
        classification = classify_result["type"]
        classify_confidence = classify_result["confidence"]
        logger.info(
            "Photo classified as %s (confidence=%.2f, %d OCR items, ocr_source=%s)",
            classification,
            classify_confidence,
            len(ocr_items),
            ocr_source,
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
            "ocr_items": ocr_items,
            "ocr_tokens": ocr_tokens_,
            "ocr_source": ocr_source,
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
        if not _model_lane_on():
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
        #
        # Density-gated at dense-table volume (see NAMEPLATE_FIELD_DENSITY_THRESHOLD
        # docstring, c10 regression): a handful of unit-field hits scattered across
        # 50+ OCR items is table content, not a plate, unless plate vocabulary
        # proper is also present. Below the dense threshold this branch is
        # unchanged from before.
        ocr_field_hits = sum(1 for f in NAMEPLATE_OCR_FIELDS if f in ocr_text_lower)
        if ocr_field_hits >= 3:
            is_dense = len(ocr_items) >= DENSE_TABLE_OCR_THRESHOLD
            field_density = (ocr_field_hits / len(ocr_items)) if ocr_items else 0.0
            if (
                not is_dense
                or nameplate_matches > 0
                or field_density >= NAMEPLATE_FIELD_DENSITY_THRESHOLD
            ):
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

        # OCR schematic-tag grammar (LAYOUT evidence — operator directive
        # 2026-07-15: visual -> OCR/layout -> caption). A page whose OCR items
        # are IEC designators (-M1, -B1, -X1, PT100 …) is a drawing even when
        # the vision model describes only its CONTENTS ("a stator winding with
        # an RTD…" — the 2026-07-12 MACK/InTraSys misroute). This replaces the
        # old caption pre-empt: the rescue no longer needs a caption at all,
        # and a caption alone can never produce it.
        tag_hits, tag_prefixed = _ocr_schematic_tag_hits(ocr_items)
        if tag_hits >= SCHEMATIC_TAG_THRESHOLD and tag_prefixed >= 1:
            conf = min(1.0, 0.6 + tag_hits * 0.04)
            return {"type": "ELECTRICAL_PRINT", "confidence": round(conf, 2)}

        # Overwhelming OCR density (LAYOUT evidence, same tier as the schematic-
        # tag grammar above — bench regression 2026-07-18, c11/c12: LED/
        # diagnostic-table print pages at 156-184 OCR items). A page densely
        # covered in 50+ distinct OCR items is a printed sheet/table, never a
        # single device's faceplate — even when the vision description and the
        # OCR text both carry EQUIPMENT_FACE_KEYWORDS vocabulary ("led", "plc",
        # "indicator", "fault" are exactly what a LED-reference table's own
        # content says). Deliberately checked BEFORE EQUIPMENT_FACE_KEYWORDS,
        # unlike the weak OCR_CLASSIFICATION_THRESHOLD tiebreaker further below
        # which stays a last resort for genuinely ambiguous, lower-density cases.
        if len(ocr_items) >= DENSE_TABLE_OCR_THRESHOLD:
            conf = min(1.0, 0.6 + len(ocr_items) * 0.001)
            return {"type": "ELECTRICAL_PRINT", "confidence": round(conf, 2)}

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

        # Caption as a TIE-BREAKER only (operator directive 2026-07-15: visual
        # evidence -> OCR/layout evidence -> caption). Reached only when nothing
        # visual or OCR-based matched above — a technician calling an otherwise
        # unidentifiable page "my print" may break the tie toward the schematic
        # path, but a caption can never override visual/OCR evidence in either
        # direction (a cabinet photo captioned "explain this print" stays
        # EQUIPMENT_PHOTO via the vision keywords above).
        caption_lower = (caption or "").lower()
        if any(_kw_in(kw, caption_lower) for kw in CAPTION_PRINT_KEYWORDS):
            return {"type": "ELECTRICAL_PRINT", "confidence": 0.6}

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
