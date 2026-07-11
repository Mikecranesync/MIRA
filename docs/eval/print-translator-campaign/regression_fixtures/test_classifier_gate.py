"""Regression fixtures — Print Translator campaign, classifier gate defect.

Deterministic, NO real inference. Feeds `VisionWorker._classify_photo` the
REAL vision-description strings captured during the bounded print-translator
campaign run (2026-07-10, `doppler run --project factorylm --config dev --
python tools/print_translator_eval/run.py --id <N> ...`) against real
official-OEM electrical prints. The exact strings below are copied verbatim
from `docs/eval/print-translator-campaign/results/<id>.json` `vision.vision_result`
— none are invented.

Every case here is a genuine mis-classification: the vision model correctly
described the image as an electrical drawing / wiring diagram, but
`_classify_photo` routed it to EQUIPMENT_PHOTO or NAMEPLATE instead of
ELECTRICAL_PRINT, so the real Print Translator handler
(`bot._try_print_translator_reply`) never reached `router.complete` and the
technician got nothing (or the generic equipment-photo/nameplate path).

Root cause (two independent defects in `mira-bots/shared/workers/vision_worker.py`):

1. `EQUIPMENT_FACE_KEYWORDS` / `NAMEPLATE_KEYWORDS` are checked with plain
   substring (`kw in combined`), not word-boundary matching — common English
   words that happen to CONTAIN a keyword false-positive: "titled" contains
   "led", "displays" contains "display", "illustrating" contains "rating",
   "tables" contains "table".
2. Even when the match IS a real whole word ("relay", "PLC", "HMI", "drive"),
   `_classify_photo` checks EQUIPMENT_FACE_KEYWORDS / NAMEPLATE structural
   fields BEFORE checking PRINT_KEYWORDS — so a real print description that
   *names the equipment it depicts* ("wiring diagram for a DI Safety Relay",
   "wiring diagram for 3-phase starters ... start-stop push button station")
   loses to the equipment-keyword branch even though "wiring diagram" is
   stated explicitly in the same sentence.

Fix (not implemented here — this file only documents/reproduces the defect):
word-boundary matching (`re.search(rf"\\b{re.escape(kw)}\\b", combined)`) AND
print-keyword precedence when a strong print signal ("wiring diagram",
"schematic", "ladder diagram", "control diagram", etc.) is present in the
vision description.

Each xfail below is the CURRENT (wrong) behavior — when the fix lands, these
tests should start failing (XPASS), at which point flip them to plain
assertions of the correct ELECTRICAL_PRINT classification.
"""

from __future__ import annotations

import os
import sys

import pytest

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
_MIRA_BOTS = os.path.join(_REPO_ROOT, "mira-bots")
if _MIRA_BOTS not in sys.path:
    sys.path.insert(0, _MIRA_BOTS)

from shared.workers.vision_worker import VisionWorker  # noqa: E402


@pytest.fixture()
def worker() -> VisionWorker:
    """No network — `__init__` only stores config strings."""
    return VisionWorker(openwebui_url="http://unused", api_key="unused", vision_model="unused")


class TestSubstringNotWordBoundary:
    """`kw in combined` matches inside unrelated English words."""

    @pytest.mark.xfail(
        reason="campaign-found gate defect — 'titled' contains 'led' (EQUIPMENT_FACE_KEYWORDS "
        "substring, not word-boundary); real GS20 VFD wiring diagram mis-classified as "
        "EQUIPMENT_PHOTO. Fix = word-boundary + print-precedence.",
        strict=True,
    )
    def test_gs20_full_io_wiring_diagram_titled_led_substring(self, worker: VisionWorker):
        """Campaign entry #17 (AutomationDirect GS20 User Manual Ch. 2, page 37).

        Real captured vision_result — see
        `docs/eval/print-translator-campaign/results/17.json`.
        """
        vision_result = (
            "The image shows an electrical drawing, specifically a full I/O wiring "
            'diagram for a control circuit. The diagram is titled "Control Circuit '
            'Wiring Diagrams (Continued) Full I/O Wiring Diagram" and includes various '
            "symbols and labels indicating different components and connections."
        )
        result = worker._classify_photo(vision_result, ocr_items=[])
        # Current (wrong) behavior: substring "led" inside "titled" trips
        # EQUIPMENT_FACE_KEYWORDS before the explicit "wiring diagram" ever gets checked.
        assert result["type"] == "ELECTRICAL_PRINT"

    @pytest.mark.xfail(
        reason="campaign-found gate defect — 'displays' contains 'display' (EQUIPMENT_FACE_"
        "KEYWORDS substring, not word-boundary); real Rockwell Bulletin 509 wiring diagram "
        "mis-classified as EQUIPMENT_PHOTO. Fix = word-boundary + print-precedence.",
        strict=True,
    )
    def test_rockwell_509_displays_display_substring(self, worker: VisionWorker):
        """Campaign entry #5 (Rockwell Automation Bulletin 509, GI-WD005, page 12).

        Real captured vision_result — see
        `docs/eval/print-translator-campaign/results/05.json`.
        """
        vision_result = (
            "The image displays an electrical drawing, specifically a wiring diagram "
            "for 3-phase starters, Bulletin 509. The diagram illustrates the standard "
            "wiring configuration with a start-stop push button station for Bulletin "
            "509 Sizes 7 and 8."
        )
        result = worker._classify_photo(vision_result, ocr_items=[])
        assert result["type"] == "ELECTRICAL_PRINT"

    @pytest.mark.xfail(
        reason="campaign-found gate defect — compound substring hit: 'illustrating' contains "
        "'rating' and 'tables' contains 'table', tripping the NAMEPLATE '_spec_table' "
        "structural detector on a real reversing/braking application note that explicitly "
        "says 'wiring diagrams'. Fix = word-boundary + print-precedence.",
        strict=True,
    )
    def test_an_gs_022_illustrating_rating_and_tables_table_substrings(self, worker: VisionWorker):
        """Campaign entry #21 (AutomationDirect AN-GS-022 Reversing & Braking, page 1).

        Real captured vision_result — see
        `docs/eval/print-translator-campaign/results/21.json`. This is a DIFFERENT
        failure mode from the other two cases here: it is misrouted to NAMEPLATE
        (via the `_spec_table` structural check), not EQUIPMENT_PHOTO, proving the
        substring-matching defect is not confined to `EQUIPMENT_FACE_KEYWORDS`.
        """
        vision_result = (
            'The image shows an "Application Note" document from Automation Direct, '
            "detailing common wiring scenarios for start/stop and forward/reverse "
            "control. It includes text descriptions and diagrams for various "
            "configurations, such as 2-wire and 3-wire start/stop circuits, with "
            "tables and flowcharts illustrating the connections and settings."
        )
        result = worker._classify_photo(vision_result, ocr_items=[])
        assert result["type"] == "ELECTRICAL_PRINT"


class TestEquipmentKeywordPrecedenceOverExplicitPrintSignal:
    """A whole-word equipment-name match beats an explicit 'wiring diagram' statement.

    These are NOT substring artifacts — "relay", "PLC", and "HMI" are real
    whole words in the vision description. The defect is ordering: `_classify_photo`
    checks EQUIPMENT_FACE_KEYWORDS before PRINT_KEYWORDS, so a print that legitimately
    names the equipment it depicts (which almost every real electrical print does)
    loses even when "wiring diagram" is stated in the same sentence.
    """

    @pytest.mark.xfail(
        reason="campaign-found gate defect — whole-word 'relay' (from 'Protection by Thermal "
        "O/L Relay') matches EQUIPMENT_FACE_KEYWORDS and is checked before PRINT_KEYWORDS, "
        "even though the same sentence explicitly says 'wiring diagram'. Real ABB star-delta "
        "starter schematic mis-classified as EQUIPMENT_PHOTO. Fix = print-precedence when a "
        "strong print signal is present.",
        strict=True,
    )
    def test_abb_star_delta_relay_keyword_precedence(self, worker: VisionWorker):
        """Campaign entry #3 (ABB STAR DELTA Open-Type Starter Technical Data, page 4).

        Real captured vision_result — see
        `docs/eval/print-translator-campaign/results/03.json`.
        """
        vision_result = (
            "The image shows an electrical drawing, specifically a wiring diagram for "
            "YKA..-30, YDA..-30 Star-Delta Starters Open Type Version Protection by "
            "Thermal O/L Relay. The diagram includes power circuits, local control, "
            "and remote control sections with various symbols and labels."
        )
        result = worker._classify_photo(vision_result, ocr_items=[])
        assert result["type"] == "ELECTRICAL_PRINT"

    @pytest.mark.xfail(
        reason="campaign-found gate defect — whole-word 'relay' (from 'DI Safety Relay') "
        "matches EQUIPMENT_FACE_KEYWORDS before PRINT_KEYWORDS. Real Rockwell Guardmaster "
        "440R safety-relay wiring example mis-classified as EQUIPMENT_PHOTO. Fix = "
        "print-precedence when a strong print signal is present.",
        strict=True,
    )
    def test_guardmaster_440r_relay_keyword_precedence(self, worker: VisionWorker):
        """Campaign entry #9 (Rockwell Guardmaster 440R-UM013, page 41).

        Real captured vision_result — see
        `docs/eval/print-translator-campaign/results/09.json`.
        """
        vision_result = (
            "The image shows an electrical drawing, specifically a wiring diagram for "
            "a DI Safety Relay (Cat. No. 440R-D22R2). The diagram illustrates two "
            "devices with mechanical contacts and monitored manual reset, as well as "
            "a safety mat and device with OSSD outputs."
        )
        result = worker._classify_photo(vision_result, ocr_items=[])
        assert result["type"] == "ELECTRICAL_PRINT"
