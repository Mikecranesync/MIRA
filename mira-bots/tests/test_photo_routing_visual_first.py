"""Visual-first photo routing — image content decides, captions are tie-breakers only.

Operator directive (2026-07-15, live phone-test finding): a technician sent the
Bulletin 509 starter print with the caption "Analyze this equipment photo" and got
the thin OCR-label preview instead of the PrintSense interpretation, because
(a) that caption is also the bot's DEFAULT for captionless photos and the engine
treated it as "no question asked", and (b) the classifier let captions pre-empt
visual equipment evidence.

Core rule pinned here:
  visual evidence -> OCR/layout evidence -> caption as a TIE-BREAKER only.

Layer 1: ``VisionWorker._classify_photo`` — captions never override visual/OCR
evidence in either direction; they only break ties when nothing visual matched.
Layer 2: ``Supervisor`` ELECTRICAL_PRINT branch — a classified print ALWAYS gets
the grounded PrintSense reply, with or without a caption, whatever the caption says.

Hermetic: no network, no images — classifier tests are pure; engine tests mock
the vision worker and the grounded-reply method.
"""

from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, "mira-bots")

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared.photo_handler import DEFAULT_PHOTO_CAPTION
from shared.workers.vision_worker import VisionWorker

# --------------------------------------------------------------------------- #
# Layer 1 — classifier: caption is a tie-breaker, never an override
# --------------------------------------------------------------------------- #

# kit-04-like: vision clearly describes a drawing (STRONG signal present).
_STARTER_PRINT_DESC = (
    "The image shows a page of wiring diagrams for Bulletin 509 3-phase starters, "
    "a standard wiring diagram with start-stop push button station."
)
# kit-06-like: vision clearly describes real equipment in a cabinet (no drawing signal).
_CABINET_DESC = (
    "A photo of an Allen-Bradley Micro820 PLC controller mounted on a DIN rail "
    "inside a cabinet with terminal blocks and blue field wires."
)
# household: nothing electrical at all.
_MUG_DESC = "A ceramic coffee mug sitting on a wooden kitchen table."
# genuinely ambiguous: no print/equipment/nameplate vocabulary anywhere.
_AMBIGUOUS_DESC = "A white page with faint markings, hard to identify."


@pytest.fixture
def vw() -> VisionWorker:
    return VisionWorker("http://localhost", "test-key", "test-model")


@pytest.mark.parametrize(
    "caption",
    [
        "",
        None,
        "what is this?",
        "tell me what this means",
        "Analyze this equipment photo",  # the misleading caption from the live test
        "eqipment foto plz",  # vague + misspelled
    ],
    ids=["no-caption", "none", "what-is-this", "tell-me", "equipment-caption", "misspelled"],
)
def test_visible_print_routes_to_print_regardless_of_caption(vw, caption):
    r = vw._classify_photo(_STARTER_PRINT_DESC, ocr_items=[], caption=caption or "")
    assert r["type"] == "ELECTRICAL_PRINT", r


def test_equipment_photo_not_hijacked_by_print_caption(vw):
    """kit-06 with 'Explain this print': visual equipment evidence must win."""
    r = vw._classify_photo(
        _CABINET_DESC, ocr_items=["Micro820", "2080-LC20-20QBB"], caption="Explain this print"
    )
    assert r["type"] == "EQUIPMENT_PHOTO", r


def test_household_image_never_a_print(vw):
    r = vw._classify_photo(_MUG_DESC, ocr_items=[], caption="")
    assert r["type"] == "EQUIPMENT_PHOTO"
    assert r["confidence"] <= 0.4  # the low-confidence default, not a keyword hit


def test_caption_still_breaks_genuine_ties(vw):
    """When neither vision nor OCR carries any evidence, the caption may decide."""
    r = vw._classify_photo(_AMBIGUOUS_DESC, ocr_items=[], caption="this is a print of my machine")
    assert r["type"] == "ELECTRICAL_PRINT"
    # tie-break confidence stays modest — it is caption-only evidence
    assert r["confidence"] <= 0.6


def test_ocr_layout_outranks_caption(vw):
    """Dense OCR (layout evidence) classifies as a print WITHOUT any caption help —
    and an equipment-ish caption must not drag it back."""
    items = [f"X{i}.{i}" for i in range(12)]  # >= OCR_CLASSIFICATION_THRESHOLD
    r = vw._classify_photo(_AMBIGUOUS_DESC, ocr_items=items, caption="equipment photo")
    assert r["type"] == "ELECTRICAL_PRINT"


def test_schematic_tag_grammar_is_layout_evidence(vw):
    """IEC designation tags in OCR = a drawing, even when the vision model
    describes only drawn components and the caption is misleading."""
    r = vw._classify_photo(
        "A stator motor winding with a temperature sensor (RTD) and terminals.",
        ocr_items=["-M1", "-B1", "-B2", "PT100", "-X1"],
        caption="Analyze this equipment photo",
    )
    assert r["type"] == "ELECTRICAL_PRINT"


def test_catalog_text_does_not_trip_tag_grammar(vw):
    """kit-06's OCR (brand + catalog number) must not read as schematic tags."""
    from shared.workers.vision_worker import _ocr_schematic_tag_hits

    hits, prefixed = _ocr_schematic_tag_hits(["Micro820", "2080-LC20-20QBB", "Allen-Bradley"])
    assert hits == 0 and prefixed == 0


def test_unprefixed_tokens_alone_are_not_enough(vw):
    """PT100-style bare tokens also appear on nameplates — without at least one
    prefixed designator the tag grammar must not fire."""
    r = vw._classify_photo(
        "an ac motor label",
        ocr_items=["PT100", "M1", "B2"],  # 3 hits, 0 prefixed
        caption="",
    )
    assert r["type"] != "ELECTRICAL_PRINT" or r["confidence"] < 0.6


# --------------------------------------------------------------------------- #
# c11/c12-class regression (2026-07-18 Tower OP bench re-benchmark): two real
# LED/diagnostic-table print pages classified EQUIPMENT_PHOTO despite 184 and
# 156 real OCR items available. The source photos are PROPRIETARY (Heege PLC
# LED-code reference sheets) and are never checked in — the fixtures below are
# 100% FICTIONAL, following the same "9x-series" synthetic-tag convention used
# for committed print fixtures elsewhere in this repo (see
# printsense/benchmarks/golden_corpus.py's K9xx/Q9xx/S9xx/X9xx tags,
# truth_status="synthetic"). No real Heege wording appears below.
#
# Failure mechanism (why NEITHER existing print-layout signal saves this
# class): the vision model describes the page's CONTENTS — "a PLC module's
# LED status-indicator reference table" — which is exactly the vocabulary in
# EQUIPMENT_FACE_KEYWORDS ("led", "plc", "indicator", "fault"), and that check
# fires (on both the vision text AND the OCR text, since the OCR items also
# say "LED") BEFORE the weak OCR_CLASSIFICATION_THRESHOLD tiebreaker (position
# 10 in _classify_photo) ever runs. The module references use a dotted
# "X9.N" form, not a -/+ prefixed IEC designator, so PR #2713's schematic-tag
# grammar (_ocr_schematic_tag_hits) doesn't fire either — confirmed by
# test_catalog_text_does_not_trip_tag_grammar-style reasoning, see
# test_led_table_ocr_does_not_trip_tag_grammar below.
# --------------------------------------------------------------------------- #

_LED_DIAGNOSTIC_TABLE_DESC = (
    "A printed reference page for a PLC expansion module, showing a table of "
    "LED status indicators with their color states and a fault or diagnostic "
    "meaning listed for each position."
)

_LED_MEANINGS = (
    "Error: runtime fault detected",
    "Warning: input out of range",
    "OK: normal operation",
    "Error: communication timeout",
    "Warning: battery low",
    "OK: standby",
)


def _synthetic_led_table_ocr_items(n: int) -> list[str]:
    """``n`` fictional OCR items mirroring the real bench cases' density —
    cycles fictional 9x-series module refs ("X9.4"), LED-position descriptors
    ("LED 5 (IG)"), and generic fictional fault/status meanings. Every token
    is synthetic; none of it is real Heege text, and none of it matches the
    IEC designator grammar (dotted form, no leading -/+ or sheet/device
    slash)."""
    items: list[str] = []
    for i in range(n):
        bucket = i % 3
        if bucket == 0:
            items.append(f"X9.{i % 24 + 1}")
        elif bucket == 1:
            items.append(f"LED {i % 24 + 1} ({'IG' if i % 2 else 'R'})")
        else:
            items.append(_LED_MEANINGS[i % len(_LED_MEANINGS)])
    return items


def test_led_table_ocr_does_not_trip_tag_grammar():
    """Sanity pin for the failure mechanism: the dotted 9x-series module refs
    must NOT read as IEC schematic tags — otherwise this fixture would pass
    for the wrong reason (PR #2713's existing rescue, not the density fix)."""
    from shared.workers.vision_worker import _ocr_schematic_tag_hits

    hits, prefixed = _ocr_schematic_tag_hits(_synthetic_led_table_ocr_items(184))
    assert hits == 0 and prefixed == 0


@pytest.mark.parametrize(
    "ocr_count,caption",
    [(184, ""), (156, "Analyze this equipment photo")],
    ids=["c11-184-items-no-caption", "c12-156-items-equipment-caption"],
)
def test_dense_led_diagnostic_table_routes_to_print_not_equipment(vw, ocr_count, caption):
    """Pins the c11/c12 Tower OP bench regression dead: a diagnostic/LED-table
    page with overwhelming OCR density must classify ELECTRICAL_PRINT even
    though both the vision description and the OCR text itself carry heavy
    EQUIPMENT_FACE_KEYWORDS vocabulary (led/plc/indicator/fault) — the exact
    class PR #2713 exists to fix, that its shipped signals (STRONG_PRINT_
    SIGNALS, schematic-tag grammar) don't yet cover."""
    items = _synthetic_led_table_ocr_items(ocr_count)
    r = vw._classify_photo(_LED_DIAGNOSTIC_TABLE_DESC, ocr_items=items, caption=caption)
    assert r["type"] == "ELECTRICAL_PRINT", r


@pytest.mark.parametrize(
    "ocr_count,expect_type",
    [(49, "EQUIPMENT_PHOTO"), (50, "ELECTRICAL_PRINT")],
    ids=["49-items-below-threshold", "50-items-at-threshold"],
)
def test_dense_table_ocr_threshold_boundary(vw, ocr_count, expect_type):
    """Pins the DENSE_TABLE_OCR_THRESHOLD boundary: 49 items stays equipment,
    50 items classifies as print. The threshold discriminates overwhelming OCR
    density (indicator of a reference/diagnostic page) from moderate faceplate
    labels."""
    from shared.workers.vision_worker import DENSE_TABLE_OCR_THRESHOLD

    items = _synthetic_led_table_ocr_items(ocr_count)
    r = vw._classify_photo(_LED_DIAGNOSTIC_TABLE_DESC, ocr_items=items, caption="")
    assert r["type"] == expect_type, f"expected {expect_type}, got {r['type']}"
    # Sanity check: constant is 50
    assert DENSE_TABLE_OCR_THRESHOLD == 50


def test_moderate_equipment_photo_ocr_count_stays_equipment_photo(vw):
    """Guards against an overcorrection: a real equipment photo with a
    faceplate's worth of readable labels (well below the dense-table
    threshold) must still classify EQUIPMENT_PHOTO — the fix is a density
    signal for OVERWHELMING counts, not a general OCR-count override of
    vision equipment evidence."""
    items = _synthetic_led_table_ocr_items(20)
    r = vw._classify_photo(_LED_DIAGNOSTIC_TABLE_DESC, ocr_items=items, caption="")
    assert r["type"] == "EQUIPMENT_PHOTO", r


# --------------------------------------------------------------------------- #
# c10-class regression (2026-07-19 Tower OP bench re-benchmark): a PLC LED-
# reference table page (~170 OCR items) carried a handful of voltage/frequency
# call-outs ("24 V", "10 Hz", "voltage") as NATIVE TABLE CONTENT, not a
# nameplate — yet the NAMEPLATE_OCR_FIELDS unit-vocabulary branch (>=3 hits)
# ran BEFORE the DENSE_TABLE_OCR_THRESHOLD check and claimed it NAMEPLATE at
# 0.67 confidence, so the dense-table rescue above never ran. Fixed with a
# ratio-aware guard (NAMEPLATE_FIELD_DENSITY_THRESHOLD): at dense-table volume
# the unit-field branch only claims the photo if plate vocabulary proper is
# ALSO present, or the hit density is itself plate-like (~0.15+). All
# fixtures below are 100% FICTIONAL, per the c11/c12 convention above — no
# real print text.
# --------------------------------------------------------------------------- #


def _salted_led_table_items(n: int, salt: tuple) -> list:
    """``n`` fictional LED-table OCR items (`_synthetic_led_table_ocr_items`)
    with the first ``len(salt)`` entries replaced by unit-vocabulary strings —
    mirrors the c10 case: native table content that happens to carry a few
    voltage/frequency call-outs alongside the fictional LED/module refs."""
    items = _synthetic_led_table_ocr_items(n)
    for i, value in enumerate(salt):
        items[i] = value
    return items


# 4 items -> 3 distinct NAMEPLATE_OCR_FIELDS hits ("hz", "vac", "voltage"),
# the same shape as the real c10 page's ~4 hits in ~170 items.
_C10_UNIT_VOCAB_SALT = ("24 V", "10 Hz", "480 VAC", "voltage")


def test_dense_led_table_salted_with_unit_vocabulary_routes_to_print(vw):
    """c10-class regression: a dense LED/diagnostic table whose native
    content happens to include a few voltage/frequency call-outs must still
    classify ELECTRICAL_PRINT via the DENSE_TABLE_OCR_THRESHOLD signal — the
    low hit DENSITY (3 hits in 170 items, ~0.018) must not let the
    NAMEPLATE_OCR_FIELDS branch claim it ahead of the density check."""
    items = _salted_led_table_items(170, _C10_UNIT_VOCAB_SALT)
    r = vw._classify_photo(_LED_DIAGNOSTIC_TABLE_DESC, ocr_items=items, caption="")
    assert r["type"] == "ELECTRICAL_PRINT", r


def test_true_nameplate_unit_fields_below_dense_threshold_still_nameplate(vw):
    """Below DENSE_TABLE_OCR_THRESHOLD the unit-field branch is UNCHANGED: a
    genuine VFD/motor nameplate with a dozen readable fields and >=3 unit
    hits still classifies NAMEPLATE, whatever the vision model calls it."""
    items = [
        "ABC Drives Inc",
        "Model AC100",
        "HP 5",
        "Volts 480",
        "Hz 60",
        "Amps 12",
        "Enclosure NEMA 4",
        "Serial No 12345",
        "RPM 1750",
        "Frequency 60",
        "Catalog No X100",
        "Made in USA",
    ]
    r = vw._classify_photo(
        "a metal identification tag mounted on the drive housing",
        ocr_items=items,
        caption="",
    )
    assert r["type"] == "NAMEPLATE", r


def test_dense_true_nameplate_with_plate_vocabulary_still_nameplate(vw):
    """Adversarial case (protection preserved): a dense (>=50 item) page whose
    OCR carries plate vocabulary proper ("Rating Plate") must still classify
    NAMEPLATE — the density guard only narrows the unit-field branch; it must
    never override an explicit nameplate/rating-plate/data-plate mention."""
    items = _synthetic_led_table_ocr_items(60)
    items[0] = "Rating Plate"
    r = vw._classify_photo(_LED_DIAGNOSTIC_TABLE_DESC, ocr_items=items, caption="")
    assert r["type"] == "NAMEPLATE", r


# --------------------------------------------------------------------------- #
# Layer 2 — engine: a classified print ALWAYS gets the grounded reply
# --------------------------------------------------------------------------- #


@pytest.fixture
def supervisor(tmp_path):
    from shared.engine import Supervisor

    db_path = str(tmp_path / "test.db")
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        with patch("shared.engine.VisionWorker"):
            with patch("shared.engine.NameplateWorker"):
                with patch("shared.engine.RAGWorker"):
                    with patch("shared.engine.PrintWorker"):
                        with patch("shared.engine.PLCWorker"):
                            with patch("shared.engine.NemotronClient"):
                                with patch("shared.engine.InferenceRouter"):
                                    sup = Supervisor(
                                        db_path=db_path,
                                        openwebui_url="http://localhost:3000",
                                        api_key="test-key",
                                        collection_id="test-collection",
                                    )
    return sup


def _print_vision_data() -> dict:
    return {
        "classification": "ELECTRICAL_PRINT",
        "vision_result": _STARTER_PRINT_DESC,
        "ocr_items": ["Bulletin 509", "3 Phase Starters", "L1", "L2", "L3"],
        "tesseract_text": "",
        "drawing_type": "wiring diagram",
        "confidence": "high",
    }


def _wire_photo_mocks(sup) -> AsyncMock:
    sup.vision.process = AsyncMock(return_value=_print_vision_data())
    grounded = AsyncMock(return_value="GROUNDED-PRINT-INTERPRETATION")
    sup._grounded_print_reply = grounded
    sup._extract_schematic = AsyncMock(return_value=None)
    sup._save_session_photo = MagicMock(return_value="")
    return grounded


@pytest.mark.parametrize(
    "caption,expect_question",
    [
        (None, None),
        ("", None),
        (DEFAULT_PHOTO_CAPTION, None),  # the literal default caption == no question
        ("Tell me what this means", "Tell me what this means"),
        ("Analyze this equipment photo", None),
    ],
    ids=["none", "empty", "default-caption", "real-question", "equipment-caption"],
)
async def test_classified_print_always_gets_grounded_reply(supervisor, caption, expect_question):
    grounded = _wire_photo_mocks(supervisor)

    result = await supervisor.process_full("chat-1", caption, photo_b64="Zm9vYmFy")

    assert grounded.await_count == 1, "grounded print reply must run for every classified print"
    assert "GROUNDED-PRINT-INTERPRETATION" in result["reply"]
    # the question forwarded to the interpreter: real captions pass through,
    # empty/default captions become None (interpret the whole sheet)
    _, kwargs_or_args = grounded.await_args
    passed_question = (
        kwargs_or_args.get("question")
        if "question" in kwargs_or_args
        else grounded.await_args.args[1]
    )
    assert passed_question == expect_question


@pytest.mark.asyncio
async def test_print_upload_persists_print_state_before_slow_interpretation_timeout(
    supervisor, monkeypatch
):
    """A slow paid print lane must not lose the classified print session.

    The live Slack failure was: image upload classified ELECTRICAL_PRINT, the
    expensive interpretation timed out, then the follow-up started from IDLE.
    Persisting the print state before the slow call keeps the next turn routed
    to the print path.
    """
    import shared.engine as engine_mod

    chat_id = "slack:C123:thread-timeout"
    supervisor.vision.process = AsyncMock(return_value=_print_vision_data())
    supervisor._extract_schematic = AsyncMock(return_value=None)
    supervisor._save_session_photo = MagicMock(return_value="")

    async def _slow_print_reply(*_args, **_kwargs):
        await asyncio.sleep(1)
        return "late print answer"

    supervisor._grounded_print_reply = AsyncMock(side_effect=_slow_print_reply)
    monkeypatch.setattr(engine_mod, "_PROCESS_TIMEOUT", 0.01)

    reply = await supervisor.process(
        chat_id,
        "Explain this print to me",
        photo_b64="Zm9vYmFy",
        platform="slack",
    )

    assert reply == engine_mod.TIMEOUT_WARNING
    loaded = supervisor._load_state(chat_id)
    assert loaded["state"] == "ELECTRICAL_PRINT"
    assert loaded["context"]["drawing_type"] == "wiring diagram"
    assert loaded["context"]["photo_turn"] == 1


@pytest.mark.asyncio
async def test_print_followup_reuses_saved_photo_for_grounded_visual_reply(supervisor):
    """Text follow-ups in a print session should stay visual, not OCR-only."""
    chat_id = "slack:C123:thread-followup"
    supervisor._save_state(
        chat_id,
        {
            "state": "ELECTRICAL_PRINT",
            "asset_identified": _STARTER_PRINT_DESC[:120],
            "context": {
                "photo_turn": 1,
                "ocr_items": [],
                "ocr_text": "",
                "drawing_type": "wiring diagram",
                "history": [],
            },
            "exchange_count": 1,
            "fault_category": None,
            "final_state": None,
        },
    )
    supervisor._load_session_photo = MagicMock(return_value="saved-print-photo")
    grounded = AsyncMock(return_value="M1 is powered through contactor K2.1.")
    supervisor._grounded_print_reply = grounded
    supervisor.print_.process = AsyncMock(side_effect=AssertionError("OCR-only worker was used"))

    with (
        patch(
            "shared.engine.route_intent",
            new=AsyncMock(
                return_value={
                    "intent": "continue_current",
                    "confidence": 0.95,
                    "reasoning": "question is about the current print",
                }
            ),
        ),
        patch("shared.engine.classify_intent", return_value="industrial"),
    ):
        result = await supervisor.process_full(chat_id, "which contactor powers M1")

    assert "M1 is powered through contactor K2.1" in result["reply"]
    grounded.assert_awaited_once()
    assert grounded.await_args.args[0] == "saved-print-photo"
    assert grounded.await_args.args[1] == "which contactor powers M1"
    assert grounded.await_args.args[2]["drawing_type"] == "wiring diagram"
    assert supervisor.print_.process.await_count == 0
