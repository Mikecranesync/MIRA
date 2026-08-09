"""CON-004 (#3158) — the UNS confirmation demand must not repeat verbatim.

Campaign c8 `t8_41_002_confused`, live on staging:

    tech: How do you know it's a PF525, actually maybe it's a PF40?
    MIRA: Before I diagnose, confirm the equipment: **Rockwell Automation, PF40**
          (confidence 70%). Reply 'yes' to confirm, or tell me the correct
          manufacturer and model.
    tech: How do you know it's a Rockwell Automation PF40 now, earlier we were
          talking about a PF525?
    MIRA: <the identical prompt, word for word>

The technician did not ANSWER the confirmation — they challenged it. Replaying
the demand reads as a machine looping, and no repeat guard can see it: CTX-004
and CTX-004b both live in `_call_with_correction`, and this lane never passes
through it. Surfaced by the offline lab's `contained_repeat` detector, which
scored it ratio 1.000.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, "mira-bots")

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")

from shared.engine import Supervisor  # noqa: E402

FIRST_ASK = "Before I diagnose, confirm the equipment"


@pytest.fixture
def sv(tmp_path):
    db_path = str(tmp_path / "unsconfirm.db")
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        with (
            patch("shared.engine.VisionWorker"),
            patch("shared.engine.NameplateWorker"),
            patch("shared.engine.RAGWorker"),
            patch("shared.engine.PrintWorker"),
            patch("shared.engine.PLCWorker"),
            patch("shared.engine.NemotronClient"),
            patch("shared.engine.InferenceRouter"),
        ):
            return Supervisor(
                db_path=db_path,
                openwebui_url="http://localhost:3000",
                api_key="test-key",
                collection_id="test-collection",
            )


class _Uns:
    def __init__(self, manufacturer, model, confidence=0.7):
        self.manufacturer = manufacturer
        self.model = model
        self.confidence = confidence


async def _ask(sv, chat, state, uns, message="what's wrong with it?"):
    # resolve_demo_namespace is imported INSIDE the handler, so patch it at its
    # source module. Forcing it to raise takes the generic manufacturer/model
    # branch — the one the live c8 conversation used.
    with patch("shared.demo_namespace.resolve_demo_namespace", side_effect=Exception("no demo")):
        return await sv._handle_uns_confirmation_request(chat, message, state, uns, "trace")


@pytest.mark.asyncio
async def test_second_ask_for_the_same_candidate_does_not_repeat_verbatim(sv):
    chat = "reask"
    state = {"state": "IDLE", "context": {}, "exchange_count": 1}
    uns = _Uns("Rockwell Automation", "PF40")

    first = await _ask(sv, chat, state, uns)
    first_text = first.get("reply") if isinstance(first, dict) else str(first)

    state = sv._load_state(chat)
    second = await _ask(sv, chat, state, uns, "How do you know it's a PF40 now?")
    second_text = second.get("reply") if isinstance(second, dict) else str(second)

    assert FIRST_ASK in first_text, "the first ask is unchanged"
    assert second_text != first_text, "the confirmation demand repeated verbatim"
    assert "Rockwell Automation, PF40" in second_text, "the candidate is still named"


@pytest.mark.asyncio
async def test_the_reask_gives_provenance_and_an_explicit_choice(sv):
    """A technician who questions the guess is owed where it came from — not
    the same demand again."""
    chat = "reask-content"
    state = {"state": "IDLE", "context": {}, "exchange_count": 1}
    uns = _Uns("Rockwell Automation", "PF40")
    await _ask(sv, chat, state, uns)
    state = sv._load_state(chat)
    second = await _ask(sv, chat, state, uns, "how do you know?")
    text = second.get("reply") if isinstance(second, dict) else str(second)

    lowered = text.lower()
    assert "from what you told me" in lowered, "the re-ask must state provenance"
    assert "haven't verified" in lowered or "not verified" in lowered, (
        "the re-ask must admit the guess is unverified"
    )
    assert "2." in text, "the re-ask must offer an explicit choice"


@pytest.mark.asyncio
async def test_a_different_candidate_gets_the_normal_first_ask(sv):
    """Negative control: the variation is for a REPEATED candidate. When the
    resolver lands on something new, that is a fresh question, not a loop."""
    chat = "new-candidate"
    state = {"state": "IDLE", "context": {}, "exchange_count": 1}
    await _ask(sv, chat, state, _Uns("Rockwell Automation", "PF525"))
    state = sv._load_state(chat)
    second = await _ask(sv, chat, state, _Uns("AutomationDirect", "GS10"))
    text = second.get("reply") if isinstance(second, dict) else str(second)
    assert FIRST_ASK in text, "a new candidate is a new question, not a re-ask"
