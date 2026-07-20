"""Regression tests for the classification-fallback floor (ROUND 4 defect #2).

When the vision model gives the classifier **no usable signal** — the call
failed, or it returned empty content — `VisionWorker._classify_photo` used to
still emit a *confident-ish* ``EQUIPMENT_PHOTO`` (0.30–0.45), scraped from OCR
keyword fragments or the low-confidence default. That silently promoted a
fallback to a model-qualified answer and misrouted table sheets to the
equipment-photo diagnosis path (Tower OP ROUND 4, the naive 0/12).

The fix threads a ``vision_ok`` flag into the classifier. When the vision
signal is absent:

  * STRONG, vision-independent LAYOUT/OCR evidence still wins (dense-table and
    IEC schematic-tag grammar → ``ELECTRICAL_PRINT``; OCR-structural nameplate
    fields → ``NAMEPLATE``) — those never depended on vision prose;
  * everything past that (equipment-face OCR keywords, the weak OCR-count
    tiebreaker, the caption tiebreaker, the low-confidence default) is
    short-circuited to an explicit ``UNKNOWN`` + ``decline_reason``, instead of
    a fabricated ``EQUIPMENT_PHOTO``.

The ``vision_ok=True`` path (the normal case) is byte-for-byte unchanged — the
last test in this file pins that.

All fixtures are synthetic; no proprietary print text appears.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest
from shared.workers.vision_worker import DENSE_TABLE_OCR_THRESHOLD, VisionWorker


@pytest.fixture
def vw() -> VisionWorker:
    # _classify_photo uses only its args + module-level keyword sets; ctor args
    # are never exercised (no network at construction).
    return VisionWorker("http://localhost", "test-key", "test-model")


# --------------------------------------------------------------------------- #
# The defect: no vision signal + weak fallback evidence → UNKNOWN, not a
# confident EQUIPMENT_PHOTO.
# --------------------------------------------------------------------------- #


def test_provider_failure_with_equipment_ocr_scrap_declines(vw):
    """provider-failure case: vision failed (vision_ok=False), a handful of OCR
    items carry ONE equipment-face keyword. Old behaviour: EQUIPMENT_PHOTO ~0.45.
    New behaviour: UNKNOWN + decline_reason — we do not manufacture a class."""
    r = vw._classify_photo(
        "",  # process() passes empty vision text when the call failed
        ocr_items=["PLC", "MODULE", "TABLE", "PAGE 3"],  # < dense threshold, 1 equip kw
        caption="",
        vision_ok=False,
    )
    assert r["type"] == "UNKNOWN", r
    assert r.get("decline_reason"), r


def test_empty_vision_no_ocr_declines(vw):
    """malformed/empty response case: vision returned empty content and there is
    no OCR either → UNKNOWN at 0.0, never the low-confidence EQUIPMENT_PHOTO 0.3."""
    r = vw._classify_photo("", ocr_items=[], caption="", vision_ok=False)
    assert r["type"] == "UNKNOWN", r
    assert r["confidence"] == 0.0
    assert r.get("decline_reason")


def test_caption_cannot_rescue_a_dead_vision_call(vw):
    """A print-ish caption must NOT drag a signalless photo into ELECTRICAL_PRINT
    when vision failed — a caption alone is the weakest evidence and cannot
    stand in for a dead vision call. Decline instead."""
    r = vw._classify_photo(
        "", ocr_items=["A", "B"], caption="explain this print", vision_ok=False
    )
    assert r["type"] == "UNKNOWN", r


# --------------------------------------------------------------------------- #
# Strong, vision-independent LAYOUT evidence still wins even with vision down.
# --------------------------------------------------------------------------- #


def test_dense_table_survives_vision_failure(vw):
    """table-sheet case: a page with dense OCR (>= DENSE_TABLE_OCR_THRESHOLD) is
    a printed sheet on LAYOUT evidence alone — it must still classify as
    ELECTRICAL_PRINT even when the vision call died. Declining a clearly-dense
    table would be the *opposite* over-correction."""
    items = [f"row {i} value {i * 7}" for i in range(DENSE_TABLE_OCR_THRESHOLD + 5)]
    r = vw._classify_photo("", ocr_items=items, caption="", vision_ok=False)
    assert r["type"] == "ELECTRICAL_PRINT", r


def test_schematic_tag_grammar_survives_vision_failure(vw):
    """IEC designator tags in OCR are a drawing on layout evidence alone —
    unaffected by a dead vision call."""
    r = vw._classify_photo(
        "",
        ocr_items=["-M1", "-B1", "-B2", "PT100", "-X1"],
        caption="",
        vision_ok=False,
    )
    assert r["type"] == "ELECTRICAL_PRINT", r


# --------------------------------------------------------------------------- #
# Non-regression: the vision_ok=True (normal) path is unchanged.
# --------------------------------------------------------------------------- #


def test_vision_ok_default_path_unchanged(vw):
    """With a real (uninformative) vision result and vision_ok defaulting True,
    the historical low-confidence EQUIPMENT_PHOTO 0.3 default is preserved — the
    fix only fires when vision is genuinely absent."""
    r = vw._classify_photo("a white page with faint markings", ocr_items=[], caption="")
    assert r["type"] == "EQUIPMENT_PHOTO"
    assert r["confidence"] == 0.3
