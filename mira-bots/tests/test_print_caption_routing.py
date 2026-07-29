"""Regression: a captioned electrical-print photo must route to the grounded
schematic path, not the generic engine.

Captured from a real prod-bot failure (2026-07-12): a ride-OEM LSM
final-brake stator wiring sheet, captioned "What types of devices are listed in
this print?", was answered with a fabricated ladder-logic device list.

`_classify_photo` already routes a print to ELECTRICAL_PRINT when the vision
model NAMES the drawing type (STRONG_PRINT_SIGNALS — "wiring diagram", etc.).
The residual gap these tests cover: when the vision model describes only the
drawing's CONTENTS (a motor winding, an RTD, a sensor, terminals — all
EQUIPMENT_FACE keywords) and does NOT name the drawing type, the photo would
misclassify EQUIPMENT_PHOTO and fall through to the generic engine. The
technician's own caption ("...in this print?") is the signal that closes it.

Ground truth + pass/fail:
docs/eval/visual-technician-corpus/hard_failures/oem_brake_stator.yaml
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.workers.vision_worker import VisionWorker  # noqa: E402


def _worker() -> VisionWorker:
    # _classify_photo is pure string logic — no network, no model.
    return VisionWorker(openwebui_url="http://x", api_key="", vision_model="x")


# A vision summary that names the drawing's CONTENTS (equipment components) but
# NOT the drawing type — so it does NOT trip STRONG_PRINT_SIGNALS or
# PRINT_KEYWORDS and, absent a caption, falls through to the EQUIPMENT_FACE
# override. This is the residual misroute the caption fix closes.
_COMPONENTS_ONLY = (
    "A 3-phase stator motor winding with a temperature sensor (RTD), "
    "thermal switches and terminal blocks."
)
_OCR = ["-M1", "-B1", "-B2", "PT100", "KLIX", "-X1"]


def test_caption_says_print_routes_to_electrical_print():
    """The MACK/InTraSys sheet still routes to ELECTRICAL_PRINT — now on its OCR
    designation-grammar tags (-M1/-B1/-B2/-X1: LAYOUT evidence), per the
    2026-07-15 operator directive (visual -> OCR/layout -> caption tie-break).
    The caption is no longer load-bearing."""
    w = _worker()
    result = w._classify_photo(
        _COMPONENTS_ONLY,
        ocr_items=_OCR,
        caption="What types of devices are listed in this print?",
    )
    assert result["type"] == "ELECTRICAL_PRINT"


def test_same_photo_without_print_caption_is_still_a_print():
    """UPDATED 2026-07-15 (operator directive): the identical sheet with a
    neutral — or even misleading — caption is STILL a print. The old test
    asserted EQUIPMENT_PHOTO here, encoding the caption dependence the live
    phone test proved harmful (the Bulletin 509 print captioned 'Analyze this
    equipment photo' got the thin preview). The OCR tag grammar now carries
    the classification regardless of caption; the ground truth
    (hard_failures/mack_intrasys_brake_stator.yaml) says this IS a print."""
    w = _worker()
    for cap in ("Analyze this equipment photo", "", "what is this?"):
        result = w._classify_photo(_COMPONENTS_ONLY, ocr_items=_OCR, caption=cap)
        assert result["type"] == "ELECTRICAL_PRINT", cap


def test_schematic_caption_variants_route_to_print():
    """With the sheet's real OCR tags present, every caption variant routes to
    the print path. UPDATED 2026-07-15: the old version used ocr_items=[] so
    the CAPTION alone forced the flip — exactly what the operator directive
    forbids (captions are tie-breakers, never overrides). With equipment words
    in the vision summary and NO tags, a print-ish caption must NOT override
    the visual evidence (second loop)."""
    w = _worker()
    for cap in (
        "explain this schematic",
        "what is on this wiring diagram",
        "read this drawing for me",
        "trace this one-line",
    ):
        result = w._classify_photo(_COMPONENTS_ONLY, ocr_items=_OCR, caption=cap)
        assert result["type"] == "ELECTRICAL_PRINT", cap
    # Caption may NOT override visual equipment evidence when no layout
    # evidence backs it up (kit-06 class: real equipment, print-ish caption).
    for cap in ("explain this schematic", "read this print"):
        result = w._classify_photo(_COMPONENTS_ONLY, ocr_items=[], caption=cap)
        assert result["type"] == "EQUIPMENT_PHOTO", cap


def test_genuine_nameplate_with_print_caption_stays_nameplate():
    """Over-fire guard: a real nameplate (>=3 spec fields in OCR, 'data plate' in
    the summary) stays a NAMEPLATE even when the caption says 'print'."""
    w = _worker()
    result = w._classify_photo(
        "A motor data plate.",
        ocr_items=["HP 15", "VOLTS 480", "FLA 21", "RPM 1750", "HZ 60"],
        caption="print the specs on this",
    )
    assert result["type"] == "NAMEPLATE"
