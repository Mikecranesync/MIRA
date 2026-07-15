"""The photo→OCR-code→drive-pack bridge, exercised through Supervisor.process().

A technician sends a PHOTO of a drive keypad showing a fault code (no caption).
When MIRA already knows WHICH drive it is (resolved from the identified asset,
never from the code) and the OCR shows a fault code that drive documents, the
engine answers from the pack — cited, deterministic, read-only — instead of
generic RAG. Any miss (no pack, no code, or code not documented) falls through
to the existing RAG auto-diagnose unchanged.

Drives the OUTER ``Supervisor.process()``/``process_full()`` with a fake vision
worker (the ``test_engine_drive_pack_fastpath`` mocking recipe) so the real
engine branch runs — no network, no LLM. The pure extraction/lookup guardrails
(bare-numeral rejection, PowerFlex word-lead safety) live in
``test_drive_pack_photo_fault_bridge.py``; this file proves the wiring.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, "mira-bots")

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")

from shared.engine import Supervisor  # noqa: E402

_PHOTO_B64 = "dGVzdA=="  # base64("test") — content is ignored by the fake vision worker


class _FakeVision:
    """Deterministic stand-in for VisionWorker.process()."""

    def __init__(self, payload: dict):
        self._payload = payload

    async def process(self, photo_b64: str, message: str) -> dict:
        assert isinstance(photo_b64, str) and photo_b64
        return dict(self._payload)


def _equipment_photo(ocr_items: list[str], vision_result: str) -> dict:
    return {
        "classification": "EQUIPMENT_PHOTO",
        "classification_confidence": 0.7,
        "confidence": "high",
        "vision_result": vision_result,
        "ocr_items": ocr_items,
        "tesseract_text": " ".join(ocr_items),
        "drawing_type": None,
        "drawing_type_confidence": 0.0,
    }


@pytest.fixture
def supervisor(tmp_path):
    db_path = str(tmp_path / "photo_fault_bridge.db")
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
    sup.router = MagicMock()
    sup.router.complete = AsyncMock(return_value=("answer body", {}))
    sup.rag = MagicMock()
    sup.rag.process = AsyncMock(
        return_value={"reply": "RAG_FALLBACK_ANSWER — generic diagnosis path"}
    )
    return sup


def _route(intent: str = "continue_current"):
    return AsyncMock(return_value={"intent": intent, "confidence": 0.9, "reasoning": "test"})


@pytest.mark.asyncio
async def test_powerflex_keypad_photo_answered_from_pack(supervisor):
    """A PowerFlex keypad photo showing 'F005' (a real pack code) is answered
    from the pack: the OverVoltage meaning, the read code echoed back for a
    human sanity-check, inline citations, and the trusted drive_pack dispatch."""
    supervisor.vision = _FakeVision(
        _equipment_photo(
            ocr_items=["PowerFlex 525", "F005", "FAULT"],
            vision_result="PowerFlex 525 drive showing a fault on the display.",
        )
    )
    with patch("shared.engine.route_intent", new=_route()):
        result = await supervisor.process_full("chat-pf-f005", "", photo_b64=_PHOTO_B64)

    reply = result["reply"]
    assert result["dispatch_kind"] == "drive_pack"
    assert "OverVoltage" in reply
    assert "I read fault code 5 off the photo" in reply
    assert "PowerFlex 525" in reply
    assert "[Source:" in reply
    # never generic RAG
    assert "RAG_FALLBACK_ANSWER" not in reply
    supervisor.rag.process.assert_not_called()


@pytest.mark.asyncio
async def test_gs10_keypad_photo_mnemonic_answered_from_pack(supervisor):
    """The GS10 (mnemonic) side of the bridge: a keypad photo reading 'CE10'
    is answered from the durapulse_gs10 pack — proves the hook is vendor
    agnostic, not PowerFlex-only."""
    supervisor.vision = _FakeVision(
        _equipment_photo(
            ocr_items=["AutomationDirect GS10", "CE10", "FAULT"],
            vision_result="AutomationDirect GS10 drive showing a fault on the keypad.",
        )
    )
    with patch("shared.engine.route_intent", new=_route()):
        result = await supervisor.process_full("chat-gs10-ce10", "", photo_b64=_PHOTO_B64)

    reply = result["reply"]
    assert result["dispatch_kind"] == "drive_pack"
    assert "CE10" in reply
    assert "timeout" in reply.lower() or "time-out" in reply.lower()
    assert "I read fault code CE10 off the photo" in reply
    assert "[Source:" in reply


@pytest.mark.asyncio
async def test_safety_keyword_in_photo_wins_over_pack(supervisor):
    """Safety precedence: a photo whose OCR shows BOTH a real fault code AND a
    safety hazard ('arc flash') must NOT be short-circuited into a cited pack
    answer — the fast-path yields so the safety path is never masked. Mirrors
    the text fast-path's test_safety_still_wins_over_pack."""
    supervisor.vision = _FakeVision(
        _equipment_photo(
            ocr_items=["PowerFlex 525", "F005", "arc flash", "FAULT"],
            vision_result="PowerFlex 525 drive with visible arc flash damage.",
        )
    )
    with patch("shared.engine.route_intent", new=_route()):
        result = await supervisor.process_full("chat-pf-arcflash", "", photo_b64=_PHOTO_B64)

    # the pack fast-path must NOT have fired
    assert result.get("dispatch_kind") != "drive_pack"
    assert "OverVoltage" not in result["reply"]
    assert "I read fault code" not in result["reply"]


@pytest.mark.asyncio
async def test_running_drive_photo_no_code_falls_through_to_rag(supervisor):
    """A faulted-but-no-readable-code faceplate (bare '5 A', '45.0 Hz' — no
    fault-context number) must NOT be answered from the pack. The pack resolves
    from the asset, but extraction yields nothing, so the turn falls through to
    the existing generic RAG auto-diagnose — no confident wrong cited hit."""
    supervisor.vision = _FakeVision(
        _equipment_photo(
            ocr_items=["PowerFlex 525", "Output 45.0 Hz", "5 A", "FAULT relay"],
            vision_result="PowerFlex 525 drive in a control panel.",
        )
    )
    with patch("shared.engine.route_intent", new=_route()):
        result = await supervisor.process_full("chat-pf-nocode", "", photo_b64=_PHOTO_B64)

    assert result.get("dispatch_kind") != "drive_pack"
    assert "OverVoltage" not in result["reply"]
    assert "[Source:" not in result["reply"]
    # the generic auto-diagnose (RAG) path handled it instead
    supervisor.rag.process.assert_called_once()
