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
    r = vw._classify_photo(_CABINET_DESC, ocr_items=["Micro820", "2080-LC20-20QBB"],
                           caption="Explain this print")
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
