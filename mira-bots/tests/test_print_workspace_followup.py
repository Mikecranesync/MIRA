"""Workspace follow-up rung (Package B) — the REAL ``bot._try_print_workspace_followup``
driven over a seeded print workspace. Hermetic and keyless: InMemory visual
store (``NEON_DATABASE_URL`` removed), tmp sqlite mapping db, the inference
cascade mocked (default: all-providers-fail), ``log_turn``/``send_push``
mocked per the autoeval-hook idiom. No network, no paid provider.

Covers: the claim gate (safety/small-talk/wiring fall-throughs), technician-
measurement intake (zero LLM), deterministic-before-LLM ordering, the ledger
answer path, the evidence-packet model explanation, the honest refusal, the
zero-OCR fall-through, the superseded enrichment note, the alias Derived
note, autoeval v2 wiring (``branch="workspace_followup"``, never P0 on a
delivered render), and ``last_entity`` continuity.
"""

from __future__ import annotations

import asyncio
import io
import os
import sys
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))

import pytest  # noqa: E402

pytest.importorskip("pydantic")
pytest.importorskip("PIL")

from PIL import Image  # noqa: E402

import bot  # noqa: E402
from shared import print_autoeval, print_workspace  # noqa: E402
from shared.visual.evidence_state import EvidenceState  # noqa: E402
from shared.visual.store import InMemoryVisualStore  # noqa: E402

# --------------------------------------------------------------------------- #
# fixtures + helpers
# --------------------------------------------------------------------------- #

_IMAGE_CACHE: dict[str, bytes] = {}


def _good_image_bytes() -> bytes:
    cached = _IMAGE_CACHE.get("good")
    if cached is not None:
        return cached
    img = Image.new("L", (320, 240))
    px = img.load()
    for y in range(240):
        for x in range(320):
            px[x, y] = 255 if ((x // 8) + (y // 8)) % 2 == 0 else 0
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    _IMAGE_CACHE["good"] = buf.getvalue()
    return _IMAGE_CACHE["good"]


_TOKENS = [
    {"text": "-K17", "bbox": [430, 120, 520, 145]},
    {"text": "13  14", "bbox": [200, 300, 260, 320]},
    {"text": "-F12", "bbox": [100, 80, 150, 100]},
]


def _vision(tokens=None, ocr_items=None) -> dict:
    return {
        "classification": "ELECTRICAL_PRINT",
        "classification_confidence": 0.9,
        "drawing_type": "control circuit",
        "ocr_items": list(ocr_items or []),
        "ocr_tokens": list(_TOKENS if tokens is None else tokens),
    }


def _update():
    u = MagicMock()
    u.effective_chat.id = 999
    u.effective_user.id = 999
    u.message.reply_text = AsyncMock()
    return u


async def _drain_tasks() -> None:
    for _ in range(4):
        await asyncio.sleep(0)


def _store() -> InMemoryVisualStore:
    store = print_workspace._get_service().store
    assert isinstance(store, InMemoryVisualStore), "tests must run on the InMemory store"
    return store


@pytest.fixture
def wired(monkeypatch, tmp_path):
    """Hermetic workspace env + every external seam mocked (autoeval-hook idiom)."""
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira.db"))
    monkeypatch.setenv("MIRA_PRINT_CAS_DIR", str(tmp_path / "cas"))
    print_workspace._reset_for_tests()

    log_turn = AsyncMock()
    push = AsyncMock()
    monkeypatch.setattr(bot, "log_turn", log_turn)
    monkeypatch.setattr(bot, "send_push", push)
    monkeypatch.setattr(print_autoeval, "ALERT_LIMITER", print_autoeval.AlertRateLimiter())
    monkeypatch.setattr(bot.engine.router, "last_model_for", lambda _sid: None)
    from printsense import interpret as _interp

    monkeypatch.setattr(_interp, "pop_last_usage", lambda: None)
    # Keyless determinism: the cascade "fails" unless a test scripts a reply.
    router = AsyncMock(return_value=("", {}))
    monkeypatch.setattr(bot.engine.router, "complete", router)

    yield {"log_turn": log_turn, "push": push, "router": router, "monkeypatch": monkeypatch}
    print_workspace._reset_for_tests()


async def _seed(chat_id: str = "999", tenant: str = "t-ws", tokens=None, ocr_items=None):
    outcome = await print_workspace.persist_print_turn(
        chat_id,
        tenant,
        _good_image_bytes(),
        _vision(tokens=tokens, ocr_items=ocr_items),
        "explain this print",
        "SEED ANSWER",
    )
    assert outcome is not None and outcome.session_id
    return outcome


async def _run(text: str):
    update = _update()
    claimed = await bot._try_print_workspace_followup(text, update, MagicMock())
    await _drain_tasks()
    return claimed, update


def _autoeval_kwargs(wired) -> dict:
    assert wired["log_turn"].await_count >= 1
    kw = wired["log_turn"].await_args.kwargs
    assert kw["meta"]["surface"] == "print_translator"
    return kw


# --------------------------------------------------------------------------- #
# claim gate
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_safety_text_is_never_claimed(wired):
    await _seed()
    claimed, update = await _run("there is visible smoke from the panel")
    assert claimed is False  # the STOP gate owns hazard turns
    update.message.reply_text.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["yes", "thanks", "where does wire 412 land?"])
async def test_smalltalk_and_wiring_text_fall_through(wired, text):
    """FSM confirmations and wiring questions the workspace cannot answer
    stay with their own rungs — the chain produces nothing and falls through."""
    await _seed()
    claimed, update = await _run(text)
    assert claimed is False
    update.message.reply_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_without_a_workspace_everything_falls_through(wired):
    claimed, update = await _run("what feeds K17?")
    assert claimed is False
    update.message.reply_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_zero_ocr_workspace_falls_through_honestly(wired):
    """An illegible workspace (zero OCR) resolves no focus, so a tag question
    is not claimed — it falls through to the next rung/engine by design."""
    await _seed(tokens=[], ocr_items=[])
    claimed, update = await _run("trace what feeds K17 on this print")
    assert claimed is False
    update.message.reply_text.assert_not_awaited()


# --------------------------------------------------------------------------- #
# (a) technician measurement intake — zero LLM
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_measurement_recorded_and_acked_without_llm(wired):
    outcome = await _seed()
    claimed, update = await _run("I have 24V before F12 but nothing after")
    assert claimed is True
    wired["router"].assert_not_awaited()  # ZERO LLM on the intake path
    update.message.reply_text.assert_awaited()

    obs = await _store().load_observations(outcome.session_id, "t-ws")
    tech = [o for o in obs if o.extractor == "technician"]
    assert len(tech) == 1
    assert tech[0].evidence_state is EvidenceState.DOCUMENTED
    assert tech[0].raw_value == "I have 24V before F12 but nothing after"
    measurement = tech[0].metadata["measurement"]
    assert measurement["value"] == 24.0
    assert measurement["negated"] is True
    assert measurement["location_before"] == "F12"

    kw = _autoeval_kwargs(wired)
    assert kw["meta"]["autoeval"]["branch"] == "workspace_followup"
    assert kw["meta"]["autoeval"]["severity"] != "P0"
    assert kw["has_citations"] is True
    rendered = kw["bot_response"]
    assert "you report" in rendered.lower()
    assert "-F12 is shown on the stored drawing." in rendered
    # measurement focus becomes the workspace's last_entity
    assert print_workspace.get_workspace("999").last_entity == "-F12"


# --------------------------------------------------------------------------- #
# (b) deterministic-before-LLM
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_deterministic_answer_beats_the_model(wired):
    await _seed()
    claimed, update = await _run("is the 13/14 contact on K17 normally open or closed?")
    assert claimed is True
    wired["router"].assert_not_awaited()  # spend law: deterministic first
    kw = _autoeval_kwargs(wired)
    assert kw["meta"]["autoeval"]["branch"] == "workspace_followup"
    assert kw["meta"]["autoeval"]["severity"] != "P0"
    assert kw["has_citations"] is True
    rendered = kw["bot_response"]
    assert "NORMALLY OPEN" in rendered
    assert "[Shown on the drawing]" in rendered  # EvidenceAnswer trust labels
    assert print_workspace.get_workspace("999").last_entity == "-K17"


# --------------------------------------------------------------------------- #
# (c) ledger answers
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_ledger_answer_for_a_known_tag(wired):
    outcome = await _seed()
    claimed, _update_obj = await _run("what feeds K17?")
    assert claimed is True
    wired["router"].assert_not_awaited()
    kw = _autoeval_kwargs(wired)
    rendered = kw["bot_response"]
    assert "[Shown on the drawing]" in rendered
    assert "-K17" in rendered
    assert kw["has_citations"] is True
    assert kw["meta"]["autoeval"]["severity"] != "P0"
    assert print_workspace.get_workspace("999").last_entity == "-K17"
    # (c) records the Q&A turn inside service.ask
    questions = [q["text"] for q in _store()._questions.values()]
    assert "what feeds K17?" in questions
    assert outcome.session_id in {q["session_id"] for q in _store()._questions.values()}


@pytest.mark.asyncio
async def test_alias_question_renders_the_derived_note(wired):
    await _seed()
    claimed, _update_obj = await _run("what does K17.1 do here?")
    assert claimed is True
    rendered = _autoeval_kwargs(wired)["bot_response"]
    assert "[Derived (not verified)] answering for -K17" in rendered
    assert "K17.1 is its contact/child designation" in rendered


# --------------------------------------------------------------------------- #
# (d) evidence-packet model explanation
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_model_explanation_grounded_in_the_evidence_packet(wired):
    outcome = await _seed()
    print_workspace.set_workspace("999", outcome.session_id, "t-ws", last_entity="-K17")
    obs_id = await print_workspace.append_technician_observation(
        outcome.session_id,
        "t-ws",
        "I have 24V before F12 but nothing after",
        {"value": 24.0, "unit": "V", "negated": True},
    )
    assert obs_id
    wired["router"].return_value = (
        "The reported 24V loss after F12 would open the coil circuit. Verify with a meter.",
        {"provider": "groq", "model": "test-model"},
    )

    claimed, _update_obj = await _run("why would it drop out?")
    assert claimed is True
    wired["router"].assert_awaited_once()
    messages = wired["router"].await_args.args[0]
    assert "ONLY from the evidence lines" in messages[0]["content"]
    user_content = messages[1]["content"]
    assert "technician reported: I have 24V before F12 but nothing after" in user_content
    assert "class letter K" in user_content  # decoded designation evidence line
    assert wired["router"].await_args.kwargs["max_tokens"] == 700

    kw = _autoeval_kwargs(wired)
    assert kw["meta"]["autoeval"]["branch"] == "workspace_followup"
    assert kw["meta"]["autoeval"]["severity"] != "P0"
    rendered = kw["bot_response"]
    assert "The reported 24V loss after F12" in rendered
    assert "[Reported by technician]" in rendered


@pytest.mark.asyncio
async def test_refusal_when_the_workspace_has_nothing_for_a_targeted_question(wired):
    """Focus resolved but every chain link misses (cascade down) → honest
    refusal naming the tag, answer_source none, zero claims."""
    outcome = await _seed()
    print_workspace.set_workspace("999", outcome.session_id, "t-ws", last_entity="-K17")
    claimed, _update_obj = await _run("why would it drop out?")
    assert claimed is True  # router returned ("", {}) — the fixture default
    kw = _autoeval_kwargs(wired)
    rendered = kw["bot_response"]
    assert "no legible evidence" in rendered
    assert "-K17" in rendered
    assert "closer photo" in rendered
    assert kw["has_citations"] is False  # a refusal carries no claims
    assert kw["meta"]["autoeval"]["severity"] != "P0"


# --------------------------------------------------------------------------- #
# superseded enrichment note
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_close_up_supersede_note_is_appended(wired):
    await _seed()
    closeup = await print_workspace.persist_print_turn(
        "999",
        "t-ws",
        _good_image_bytes(),
        _vision(tokens=[{"text": "-K17", "bbox": [10, 10, 60, 40]}]),
        "closer look at K17",
        "CLOSEUP ANSWER",
    )
    assert closeup is not None and closeup.superseded_ids

    claimed, _update_obj = await _run("what feeds K17?")
    assert claimed is True
    rendered = _autoeval_kwargs(wired)["bot_response"]
    assert "(earlier readings of -K17 were replaced by your close-up — revision " in rendered


# --------------------------------------------------------------------------- #
# fail-open
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_store_failure_never_raises_into_the_turn(wired):
    await _seed()
    store = _store()

    async def _boom(*args, **kwargs):
        raise RuntimeError("store broke")

    wired["monkeypatch"].setattr(store, "load_observations", _boom)
    claimed, update = await _run("what feeds K17?")
    assert claimed is False
    update.message.reply_text.assert_not_awaited()
