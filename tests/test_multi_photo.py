"""Tests for multi-photo burst processing (process_multi_photo + _combine_photo_analyses).

SKIPPED MODULE: `Supervisor.process_multi_photo` does not exist in
mira-bots/shared/engine.py. These tests describe an intended future API
(burst-processing of multiple photos in a single message) that is out of
scope for the locked 90-day plan (docs/plans/2026-04-19-mira-90-day-mvp.md).
Un-skip the file once `process_multi_photo` ships.
"""

from __future__ import annotations

import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.skip(
    reason="process_multi_photo is unimplemented; out of scope for 2026-04-19 90-day plan. "
    "Un-skip when the multi-photo burst API ships."
)

# ---------------------------------------------------------------------------
# Fixtures — canned vision worker outputs
# ---------------------------------------------------------------------------

NAMEPLATE = {
    "classification": "NAMEPLATE",
    "classification_confidence": 0.95,
    "vision_result": "Carrier AquaEdge 19DV, Serial: ABC123, 460V/3PH",
    "ocr_items": ["Carrier", "AquaEdge", "19DV", "ABC123", "460V"],
    "tesseract_text": "Carrier AquaEdge 19DV",
    "drawing_type": None,
    "drawing_type_confidence": 0.0,
}

BEARING_DAMAGE = {
    "classification": "EQUIPMENT_PHOTO",
    "classification_confidence": 0.85,
    "vision_result": "Visible wear on bearing seal area with heat discoloration",
    "ocr_items": [],
    "tesseract_text": "",
    "drawing_type": None,
    "drawing_type_confidence": 0.0,
}

FAULT_DISPLAY = {
    "classification": "EQUIPMENT_PHOTO",
    "classification_confidence": 0.90,
    "vision_result": "VFD control panel showing fault code E04 compressor overload",
    "ocr_items": ["E04", "FAULT", "OVERLOAD"],
    "tesseract_text": "E04 FAULT",
    "drawing_type": None,
    "drawing_type_confidence": 0.0,
}

WIRING_DIAGRAM = {
    "classification": "ELECTRICAL_PRINT",
    "classification_confidence": 0.92,
    "vision_result": "3-phase motor starter wiring diagram with overload relay",
    "ocr_items": ["L1", "L2", "L3", "M1", "OL"],
    "tesseract_text": "L1 L2 L3",
    "drawing_type": "ladder logic diagram",
    "drawing_type_confidence": 0.88,
}

MOTOR_PHOTO = {
    "classification": "EQUIPMENT_PHOTO",
    "classification_confidence": 0.80,
    "vision_result": "Electric motor with visible shaft coupling",
    "ocr_items": [],
    "tesseract_text": "",
    "drawing_type": None,
    "drawing_type_confidence": 0.0,
}


def _b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def _make_engine() -> object:
    """Construct a Supervisor with all heavy deps mocked out."""
    with patch("shared.engine.Supervisor.__init__", return_value=None):
        from shared.engine import Supervisor

        eng = Supervisor.__new__(Supervisor)

    eng.db_path = ":memory:"
    eng._rec = {}
    eng.vision = MagicMock()
    eng.router = MagicMock()
    eng.rag = MagicMock()
    eng.rag.tenant_id = ""
    eng._save_session_photo = MagicMock()
    eng._log_interaction = MagicMock()
    eng._record_session_turn = AsyncMock()
    return eng


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_two_photos_same_asset_combined():
    """Nameplate + damage photo → combined analysis references both, mentions model."""
    eng = _make_engine()
    eng.vision.process = AsyncMock(side_effect=[NAMEPLATE, BEARING_DAMAGE])
    combined = (
        "📸 Processed 2 photos:\n\n"
        "1️⃣ Nameplate — Carrier AquaEdge 19DV, Serial ABC123, 460V/3PH\n"
        "2️⃣ Equipment photo — Bearing seal wear with heat discoloration\n\n"
        "I identified this as a Carrier AquaEdge 19DV from the nameplate. "
        "The bearing seal wear in photo 2 is a known failure mode on this model — "
        "check the service bulletin for bearing replacement intervals.\n\n"
        "Want me to look up the bearing inspection procedure?"
    )
    eng.router.complete = AsyncMock(return_value=(combined, {}))

    result = await eng.process_multi_photo(
        chat_id="test-001",
        message="what's wrong?",
        photos_b64=[_b64("img1"), _b64("img2")],
        platform="telegram",
    )

    assert "Processed 2 photos" in result
    assert eng.vision.process.call_count == 2
    # Last photo saved for follow-up context
    eng._save_session_photo.assert_called_once_with("test-001", _b64("img2"))
    eng._log_interaction.assert_called_once()


@pytest.mark.asyncio
async def test_nameplate_damage_reply_connects_model_to_issue():
    """Reply from LLM must mention the identified model AND the damage."""
    eng = _make_engine()
    eng.vision.process = AsyncMock(side_effect=[NAMEPLATE, BEARING_DAMAGE])
    reply_text = (
        "📸 Processed 2 photos:\n\n"
        "1. Nameplate: Carrier AquaEdge 19DV (460V/3PH)\n"
        "2. Equipment: Bearing seal wear\n\n"
        "Carrier AquaEdge 19DV bearing seals can fail from thermal cycling — "
        "the discoloration supports this. Want the inspection checklist?"
    )
    eng.router.complete = AsyncMock(return_value=(reply_text, {}))

    result = await eng.process_multi_photo(
        chat_id="test-002",
        message="",
        photos_b64=[_b64("nameplate"), _b64("damage")],
    )

    # Must reference the model and the issue
    assert "Carrier" in result or "AquaEdge" in result or "Nameplate" in result
    assert "bearing" in result.lower() or "wear" in result.lower() or "photo 2" in result.lower()


@pytest.mark.asyncio
async def test_three_unrelated_photos_asks_which_first():
    """Three unrelated photos → lists each and asks 'which first?'"""
    eng = _make_engine()
    eng.vision.process = AsyncMock(side_effect=[NAMEPLATE, BEARING_DAMAGE, FAULT_DISPLAY])
    reply_text = (
        "📸 Processed 3 photos:\n\n"
        "1. Nameplate — Carrier AquaEdge 19DV\n"
        "2. Equipment — Worn conveyor chain\n"
        "3. VFD display — Error code E04\n\n"
        "These appear to show different assets or issues. "
        "Which would you like to troubleshoot first?"
    )
    eng.router.complete = AsyncMock(return_value=(reply_text, {}))

    result = await eng.process_multi_photo(
        chat_id="test-003",
        message="",
        photos_b64=[_b64("img1"), _b64("img2"), _b64("img3")],
    )

    assert "Processed 3 photos" in result
    assert eng.vision.process.call_count == 3
    # Last photo persisted
    eng._save_session_photo.assert_called_once_with("test-003", _b64("img3"))


@pytest.mark.asyncio
async def test_single_photo_via_multi_path_works():
    """process_multi_photo with 1 photo completes without crash (edge case)."""
    eng = _make_engine()
    eng.vision.process = AsyncMock(return_value=NAMEPLATE)
    eng.router.complete = AsyncMock(
        return_value=(
            "📸 Processed 1 photos:\n\n1. Nameplate: Carrier 19DV\n\nWhat issue are you seeing?",
            {},
        )
    )

    result = await eng.process_multi_photo(
        chat_id="test-004",
        message="what is this?",
        photos_b64=[_b64("single")],
    )

    assert result
    eng.vision.process.assert_called_once()
    eng._save_session_photo.assert_called_once()


@pytest.mark.asyncio
async def test_five_photos_all_processed_sequentially():
    """Five-photo burst — VisionWorker called 5 times, returns combined reply."""
    eng = _make_engine()
    eng.vision.process = AsyncMock(return_value=MOTOR_PHOTO)
    reply_text = (
        "📸 Processed 5 photos:\n\n"
        "1-5. Equipment photos — motors and couplings\n\n"
        "Which specific piece would you like to start with?"
    )
    eng.router.complete = AsyncMock(return_value=(reply_text, {}))

    result = await eng.process_multi_photo(
        chat_id="test-005",
        message="inspection round",
        photos_b64=[_b64(f"img{i}") for i in range(5)],
    )

    assert "Processed 5 photos" in result
    assert eng.vision.process.call_count == 5


@pytest.mark.asyncio
async def test_llm_failure_falls_back_to_plain_list():
    """LLM combination returning empty string → plain numbered fallback, no crash."""
    eng = _make_engine()
    eng.vision.process = AsyncMock(side_effect=[NAMEPLATE, FAULT_DISPLAY])
    eng.router.complete = AsyncMock(return_value=("", {}))  # simulate empty/failed LLM

    result = await eng.process_multi_photo(
        chat_id="test-006",
        message="",
        photos_b64=[_b64("img1"), _b64("img2")],
    )

    # Fallback should list both photos
    assert "📸 Processed 2 photos" in result
    assert "1." in result
    assert "2." in result


@pytest.mark.asyncio
async def test_vision_worker_failure_continues_with_placeholder():
    """If VisionWorker fails on one photo, processing continues with a placeholder."""
    eng = _make_engine()
    eng.vision.process = AsyncMock(side_effect=[NAMEPLATE, Exception("Ollama timeout")])
    reply_text = "📸 Processed 2 photos:\n\n1. Nameplate: Carrier 19DV\n2. unclear\n\nWhich would you like to troubleshoot?"
    eng.router.complete = AsyncMock(return_value=(reply_text, {}))

    # Should not raise, even with one failed vision call
    result = await eng.process_multi_photo(
        chat_id="test-007",
        message="",
        photos_b64=[_b64("img1"), _b64("img2")],
    )

    assert result  # returns something
    assert eng.vision.process.call_count == 2  # still attempted both
