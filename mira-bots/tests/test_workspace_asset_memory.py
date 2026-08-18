"""Persistent machine context — turn 2 knows which machine it is on.

The defect this pins: one nameplate photo is persisted perfectly
(``EQUIPMENT_WORKSPACE_PERSISTED … fields=9``) and the very next turn answers
as if nothing had ever been identified — no asset lead, and a request for a
field already on file.

Two layers, both hermetic and zero-LLM (any cascade call is a test failure):

* ``shared.asset_memory`` — the pure text transform (lead + never re-ask).
* the REAL bot rungs over a seeded workspace — the deterministic recall
  fast-path answering a model/catalog question on turn 2, and the generic
  engine reply path being rewritten before delivery.
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
from shared import asset_memory, print_workspace  # noqa: E402
from shared.visual.store import InMemoryVisualStore  # noqa: E402

# --------------------------------------------------------------------------- #
# the machine this chat is working on
# --------------------------------------------------------------------------- #

_PLATE = {
    "manufacturer": "Danfoss",
    "model": "FC-202",
    "catalog": "131B0028",
    "serial": "DF-77120",
    "voltage": "400V",
    "fla": "32A",
    "kw": "15",
    "frequency": "50Hz",
    "raw_text": "Danfoss VLT FC-202 131B0028 15kW 400V 32A",
}


# --------------------------------------------------------------------------- #
# layer 1 — the pure transform
# --------------------------------------------------------------------------- #


def test_lead_names_maker_model_and_size():
    assert asset_memory.format_asset_lead(_PLATE) == "Danfoss FC-202 · 15 kW"


def test_lead_falls_back_to_the_catalog_code_when_there_is_no_model():
    fields = {"manufacturer": "Danfoss", "catalog": "131B0028"}
    assert asset_memory.format_asset_lead(fields) == "Danfoss 131B0028"


def test_lead_keeps_a_unit_the_plate_already_carried():
    assert asset_memory.format_asset_lead({"model": "GS10", "hp": "5 HP"}) == "GS10 · 5 HP"


def test_no_identifying_field_means_no_lead():
    assert asset_memory.format_asset_lead({"voltage": "400V"}) is None
    assert asset_memory.format_asset_lead({}) is None
    assert asset_memory.format_asset_lead(None) is None


@pytest.mark.parametrize(
    "ask",
    [
        "What's the model number on the drive?",
        "Can you tell me the model number?",
        "Please provide the full-load amps from the nameplate.",
        "I'll need the manufacturer before I can go further.",
        "Send me the catalog number.",
    ],
)
def test_a_field_already_on_file_is_never_asked_for_again(ask):
    reply = f"Start with the obvious checks. {ask} Then measure the DC bus."
    out = asset_memory.apply_asset_memory(reply, _PLATE)
    assert ask not in out
    assert "Start with the obvious checks." in out
    assert "Then measure the DC bus." in out
    assert asset_memory.ANSWERED_PREFIX in out  # it answered instead of asking


def test_the_dropped_request_is_answered_from_the_plate():
    reply = "Check the drive. What's the model number? Then report back."
    out = asset_memory.apply_asset_memory(reply, _PLATE)
    assert "Model: FC-202" in out
    assert "model number?" not in out


def test_a_request_for_an_unknown_field_survives():
    """MIRA still asks for what it genuinely does not have."""
    plate = {k: v for k, v in _PLATE.items() if k != "serial"}
    reply = "Check the drive carefully now. What's the serial number on the label?"
    out = asset_memory.apply_asset_memory(reply, plate)
    assert "What's the serial number on the label?" in out


def test_a_statement_about_a_known_field_is_not_a_request():
    reply = (
        "The model FC-202 trips on DC-bus overvoltage when the ramp is too short. "
        "Extend the deceleration time and retest the run."
    )
    out = asset_memory.apply_asset_memory(reply, _PLATE)
    assert out == reply  # already names the machine, asks for nothing


def test_a_reply_that_only_asks_becomes_the_answer():
    out = asset_memory.apply_asset_memory("What's the model number?", _PLATE)
    assert out == f"{asset_memory.ANSWERED_PREFIX}Model: FC-202."


def test_short_acks_are_left_alone():
    assert asset_memory.apply_asset_memory("Got it.", _PLATE) == "Got it."


def test_no_workspace_fields_means_a_byte_identical_reply():
    reply = "What's the model number on the drive? I need it to look up the fault."
    assert asset_memory.apply_asset_memory(reply, {}) == reply
    assert asset_memory.apply_asset_memory(reply, None) == reply
    assert asset_memory.apply_asset_memory(reply, {"raw_text": "junk"}) == reply


def test_substantive_answers_lead_with_the_machine():
    reply = "Overvoltage trips usually come from decelerating a high-inertia load too fast."
    out = asset_memory.apply_asset_memory(reply, _PLATE)
    assert out.startswith("Danfoss FC-202 · 15 kW — ")
    assert reply in out


# --------------------------------------------------------------------------- #
# layer 2 — the real bot, over a seeded workspace
# --------------------------------------------------------------------------- #

_IMAGE_CACHE: dict[str, bytes] = {}


def _image_bytes() -> bytes:
    """A checkerboard — flat images fail the ingest sharpness gate."""
    cached = _IMAGE_CACHE.get("plate")
    if cached is None:
        img = Image.new("L", (320, 240))
        px = img.load()
        for y in range(240):
            for x in range(320):
                px[x, y] = 255 if ((x // 8) + (y // 8)) % 2 == 0 else 0
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        cached = _IMAGE_CACHE["plate"] = buf.getvalue()
    return cached


def _update():
    u = MagicMock()
    u.effective_chat.id = 909
    u.effective_user.id = 909
    u.message.reply_text = AsyncMock()
    u.to_dict.return_value = {"message": {"chat": {"id": 909}}}
    return u


@pytest.fixture
def wired(monkeypatch, tmp_path):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira.db"))
    monkeypatch.setenv("MIRA_PRINT_CAS_DIR", str(tmp_path / "cas"))
    print_workspace._reset_for_tests()
    router = AsyncMock(side_effect=AssertionError("asset memory must never call the cascade"))
    monkeypatch.setattr(bot.engine.router, "complete", router)
    monkeypatch.setattr(bot, "_print_workspace_tenant", lambda _u: "t-asset")
    yield {"router": router, "monkeypatch": monkeypatch}
    print_workspace._reset_for_tests()


async def _seed_nameplate_turn(fields: dict | None = None) -> None:
    """Turn 1: the technician sends the nameplate photo."""
    outcome = await print_workspace.persist_print_turn(
        "909",
        "t-asset",
        _image_bytes(),
        {
            "classification": "NAMEPLATE",
            "classification_confidence": 0.95,
            "vision_result": "a Danfoss VLT drive nameplate",
            "ocr_items": ["Danfoss", "FC-202"],
            "ocr_tokens": [],
        },
        "what is this?",
        "SEED ANSWER",
        nameplate_fields=_PLATE if fields is None else fields,
    )
    assert outcome is not None and outcome.session_id
    store = print_workspace._get_service().store
    assert isinstance(store, InMemoryVisualStore)


async def _drain() -> None:
    for _ in range(4):
        await asyncio.sleep(0)


def _reply_text(update) -> str:
    assert update.message.reply_text.await_count >= 1
    return "\n".join(c.args[0] for c in update.message.reply_text.await_args_list)


@pytest.mark.asyncio
async def test_turn_two_answers_the_model_question_from_the_workspace(wired):
    """The headline: photo on turn 1, question on turn 2, zero inference."""
    await _seed_nameplate_turn()
    update = _update()
    claimed = await bot._try_equipment_photo_followup(
        "what's the model number?", update, MagicMock()
    )
    await _drain()
    assert claimed is True
    assert "Model: FC-202" in _reply_text(update)
    wired["router"].assert_not_awaited()


@pytest.mark.asyncio
async def test_turn_two_answers_the_catalog_question_from_the_workspace(wired):
    await _seed_nameplate_turn()
    update = _update()
    claimed = await bot._try_equipment_photo_followup(
        "what's the catalog number?", update, MagicMock()
    )
    await _drain()
    assert claimed is True
    assert "131B0028" in _reply_text(update)
    wired["router"].assert_not_awaited()


@pytest.mark.asyncio
async def test_asking_what_machine_were_on_is_answered_from_memory(wired):
    """'What are we working on?' is a memory read, not a re-derivation."""
    await _seed_nameplate_turn()
    for question in (
        "what machine are we on?",
        "what are we working on?",
        "remind me what this is",
    ):
        update = _update()
        claimed = await bot._try_equipment_photo_followup(question, update, MagicMock())
        await _drain()
        assert claimed is True, question
        assert "Danfoss FC-202 · 15 kW" in _reply_text(update), question
    wired["router"].assert_not_awaited()


@pytest.mark.asyncio
async def test_a_fault_question_still_reaches_the_engine(wired):
    """The identity rung stays narrow — troubleshooting is not memory recall."""
    await _seed_nameplate_turn()
    update = _update()
    claimed = await bot._try_equipment_photo_followup(
        "what is this fault code A17 telling me?", update, MagicMock()
    )
    assert claimed is False
    update.message.reply_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_live_workspace_fields_are_readable_for_the_reply_path(wired):
    await _seed_nameplate_turn()
    fields = await bot._live_workspace_fields(_update())
    assert fields["model"] == "FC-202"
    assert fields["kw"] == "15"
    assert "raw_text" not in fields


@pytest.mark.asyncio
async def test_tenant_drift_hides_the_remembered_plate(wired):
    await _seed_nameplate_turn()
    wired["monkeypatch"].setattr(bot, "_print_workspace_tenant", lambda _u: "someone-else")
    assert await bot._live_workspace_fields(_update()) == {}


@pytest.mark.asyncio
async def test_no_workspace_leaves_the_engine_reply_untouched(wired):
    reply = "What's the model number on the drive?"
    assert await bot._lead_with_remembered_asset("it keeps tripping", reply, _update()) == reply


@pytest.mark.asyncio
async def test_engine_reply_leads_with_the_asset_and_stops_re_asking(wired):
    await _seed_nameplate_turn()
    reply = (
        "Overvoltage faults on a VFD usually mean the deceleration ramp is too aggressive. "
        "What's the model number on the drive? Extend the ramp and retest."
    )
    out = await bot._lead_with_remembered_asset("it trips on overvoltage", reply, _update())
    assert out.startswith("Danfoss FC-202 · 15 kW — ")
    assert "What's the model number on the drive?" not in out
    assert "Model: FC-202" in out
    wired["router"].assert_not_awaited()


@pytest.mark.asyncio
async def test_a_safety_turn_is_never_dressed_up(wired):
    await _seed_nameplate_turn()
    reply = "STOP — describe the hazard. De-energize the equipment first."
    out = await bot._lead_with_remembered_asset(
        "there is an arc flash and smoke coming off the drive", reply, _update()
    )
    assert out == reply


@pytest.mark.asyncio
async def test_a_greeting_is_not_about_the_machine(wired):
    """A greeting/help turn keeps its own voice — no nameplate header."""
    await _seed_nameplate_turn()
    reply = "Hi — I'm MIRA, your maintenance assistant. Send me a photo or ask a question."
    assert await bot._lead_with_remembered_asset("hello", reply, _update()) == reply
    assert await bot._lead_with_remembered_asset("what can you do?", reply, _update()) == reply


@pytest.mark.asyncio
async def test_a_broken_store_never_costs_the_technician_the_answer(wired):
    await _seed_nameplate_turn()
    store = print_workspace._get_service().store

    async def _boom(*_a, **_kw):
        raise RuntimeError("store broke")

    wired["monkeypatch"].setattr(store, "load_observations", _boom)
    reply = "Check the deceleration ramp on that drive and retest the run."
    assert await bot._lead_with_remembered_asset("it trips", reply, _update()) == reply


@pytest.mark.asyncio
async def test_handle_message_delivers_the_rewritten_reply(wired):
    """Proof the transform is actually wired into the delivered turn."""
    await _seed_nameplate_turn()
    update = _update()
    update.message.text = "it keeps tripping on overvoltage during deceleration"

    normalized = MagicMock()
    response = MagicMock()
    response.text = (
        "Overvoltage during decel points at a too-short ramp on a high-inertia load. "
        "What's the model number on the drive?"
    )
    response.citations = []
    response.intent = "industrial"

    mp = wired["monkeypatch"]
    mp.setattr(bot.adapter, "normalize_incoming", AsyncMock(return_value=normalized))
    mp.setattr(bot.dispatcher, "dispatch", AsyncMock(return_value=response))
    rendered = AsyncMock()
    mp.setattr(bot.adapter, "render_outgoing", rendered)
    mp.setattr(bot, "log_turn", AsyncMock())
    mp.setattr(bot, "_maybe_send_voice", AsyncMock())

    await bot.handle_message(update, MagicMock())

    rendered.assert_awaited_once()
    delivered = rendered.await_args.args[0].text
    assert delivered.startswith("Danfoss FC-202 · 15 kW — ")
    assert "What's the model number on the drive?" not in delivered
    assert "Model: FC-202" in delivered
    wired["router"].assert_not_awaited()
