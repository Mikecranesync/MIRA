"""Regression tests for the Print Translator classifier gate fix.

The real-world Print Translator campaign
(`docs/eval/print-translator-campaign/RANKED_REPORT.md`) measured that
`VisionWorker._classify_photo` mis-classified 10/11 real official-OEM electrical
prints to `EQUIPMENT_PHOTO`/`NAMEPLATE` — the vision model correctly described
each as a drawing, but two deterministic defects blocked it:

  1. equipment-face keywords were checked BEFORE print keywords, so a
     "wiring diagram of a VFD drive" matched "drive" and became EQUIPMENT_PHOTO;
  2. substring matching fired "led" inside "titled".

The fix adds `STRONG_PRINT_SIGNALS` (checked before the equipment-face keywords)
and word-boundary matching (`_kw_in`). These tests pin the fixed behaviour
against the exact real vision-model strings captured in the campaign, and guard
against over-correcting genuine equipment/nameplate photos.
"""

from __future__ import annotations

import pytest

from shared.workers.vision_worker import VisionWorker, _kw_in


@pytest.fixture
def vw() -> VisionWorker:
    # _classify_photo uses only its args + module-level keyword sets; the ctor
    # args are never exercised here (no network at construction).
    return VisionWorker("http://localhost", "test-key", "test-model")


# --- The real campaign strings (verbatim from results/*.json) now classify right ---

# GS20 p.30 — result 17-family: names the equipment ("drive", "gs20") AND is a drawing.
_GS20_MAIN = (
    "The image shows an electrical drawing, specifically a wiring diagram for the "
    "main circuit and control circuit wiring terminals of a DURAPULSE GS20 & GS20X drive."
)
# GS20 p.37 — the "led" inside "titled" substring false-positive case.
_GS20_IO = (
    "The image shows an electrical drawing, specifically a full I/O wiring diagram for a "
    'control circuit. The diagram is titled "Control Circuit Wiring Diagrams (Continued) '
    'Full I/O Wiring Diagram" and includes various symbols and labels.'
)
# ABB ACS355 — the one that already passed; must stay a print.
_ACS355 = (
    "The image shows an electrical drawing, specifically a connection diagram for "
    "connecting power cables. The diagram illustrates the connections between various "
    "components, including input and output sections."
)


@pytest.mark.parametrize(
    "vision_result",
    [_GS20_MAIN, _GS20_IO, _ACS355],
    ids=["gs20-main-wiring", "gs20-io-titled", "abb-acs355-connection"],
)
def test_real_prints_now_classify_as_electrical_print(vw, vision_result):
    """The campaign's mis-classified real prints now reach ELECTRICAL_PRINT."""
    result = vw._classify_photo(vision_result, ocr_items=[])
    assert result["type"] == "ELECTRICAL_PRINT", result


def test_strong_print_signal_beats_equipment_keyword(vw):
    """A drawing that names a VFD/drive is a print, not an EQUIPMENT_PHOTO."""
    r = vw._classify_photo("wiring diagram of a vfd drive and motor starter", [])
    assert r["type"] == "ELECTRICAL_PRINT"


def test_ladder_logic_print(vw):
    r = vw._classify_photo("ladder logic diagram with rungs, contactor coils and relays", [])
    assert r["type"] == "ELECTRICAL_PRINT"


# --- Word-boundary matching ---


def test_led_does_not_match_titled():
    assert _kw_in("led", "the diagram is titled full i/o") is False
    assert _kw_in("led", "a red led indicator is on") is True


def test_drive_does_not_match_driver():
    assert _kw_in("drive", "the gate driver circuit") is False
    assert _kw_in("drive", "the vfd drive output") is True


def test_run_does_not_match_runway():
    assert _kw_in("run", "conveyor runway limit") is False
    assert _kw_in("run", "run and stop pushbuttons") is True


def test_phrase_and_punctuation_keywords():
    assert _kw_in("wiring diagram", "a full i/o wiring diagram here") is True
    assert _kw_in("one-line diagram", "see the one-line diagram") is True


# --- Guard against over-correction: genuine equipment/nameplate photos ---


def test_genuine_faceplate_stays_equipment_photo(vw):
    """A real VFD faceplate photo (no drawing signal) is still EQUIPMENT_PHOTO."""
    r = vw._classify_photo(
        "a photo of an allen-bradley powerflex 525 vfd drive faceplate with an "
        "led display showing a fault code",
        ["FAULT", "F004", "STOP", "RUN"],
    )
    assert r["type"] == "EQUIPMENT_PHOTO"


def test_nameplate_stays_nameplate(vw):
    r = vw._classify_photo("a motor nameplate / rating plate", ["HP", "FLA", "RPM", "VOLTS"])
    assert r["type"] == "NAMEPLATE"


def test_nameplate_by_ocr_fields_still_fires(vw):
    """≥3 nameplate OCR fields (digit-adjacent units) still classify as NAMEPLATE
    (substring match preserved for this path)."""
    r = vw._classify_photo(
        "an ac drive label",
        ["5HP", "480VAC", "60Hz", "1750RPM"],
    )
    assert r["type"] == "NAMEPLATE"


# --- Negated mentions in vision prose must NOT count as signals (#2753 live
# --- finding: "does not appear to be ... electrical drawing" classified as a
# --- print at 0.75 and made the print path claim a plain gray photo) ---


def test_negated_print_mention_does_not_classify_as_print(vw):
    """The exact live-run description that mis-routed the non-print image."""
    r = vw._classify_photo(
        "the image shows a dark gray circle on a gradient gray background. "
        "there are no visible indicators, labels, or text. it does not appear "
        "to be a physical piece of equipment, electrical drawing, or computer "
        "screen. the image is too ambiguous to provide further information.",
        [],
        "What does this circuit do?",
    )
    assert r["type"] != "ELECTRICAL_PRINT"


def test_affirmed_print_mention_still_classifies_as_print(vw):
    r = vw._classify_photo("this is a wiring diagram of a motor starter circuit.", [])
    assert r["type"] == "ELECTRICAL_PRINT"


def test_negation_scope_ends_at_contrast_word(vw):
    """'not a photo BUT a ladder diagram' affirms the diagram."""
    r = vw._classify_photo("this is not a photo of equipment but a ladder diagram.", [])
    assert r["type"] == "ELECTRICAL_PRINT"


def test_negated_nameplate_mention_does_not_classify_as_nameplate(vw):
    """Same guard on the nameplate prose lane."""
    r = vw._classify_photo("this is not a nameplate or rating plate, just a wall.", [])
    assert r["type"] != "NAMEPLATE"
