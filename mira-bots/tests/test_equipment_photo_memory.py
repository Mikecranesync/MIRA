"""Equipment-photo memory — persistence + the REAL ``bot._try_equipment_photo_followup``
driven over a seeded workspace. Hermetic and keyless: InMemory visual store
(``NEON_DATABASE_URL`` removed), tmp sqlite mapping db, zero LLM anywhere on
the rung (the whole point). Mirrors ``test_print_workspace_followup.py``.

Covers: model-free equipment ingest (PrecomputedNameplate — no second vision
call), per-field observations, identity-preserving no-fields ingest, the
claim gate (safety / small-talk / no-workspace fall-throughs), deterministic
field answers with trust labels, honest refusal for a missing field, the
generic "what did that photo show" recall, re-ingest convergence (latest
wins), the golden multi-turn conversation, and fail-open on store failure.
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
from shared import print_workspace  # noqa: E402
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


_FIELDS = {
    "manufacturer": "TECO",
    "model": "AEHH8N",
    "serial": "SN-4471",
    "voltage": "460V",
    "fla": "6.2",
    "hp": "5",
    "raw_text": "TECO AEHH8N 5HP 460V 6.2A SN-4471",
}


def _vision(classification: str = "EQUIPMENT_PHOTO") -> dict:
    return {
        "classification": classification,
        "classification_confidence": 0.9,
        "vision_result": "a TECO 3-phase induction motor, 5 HP, mounted on a base",
        "ocr_items": ["TECO", "AEHH8N", "5HP", "460V"],
        "ocr_tokens": [],
    }


def _update():
    u = MagicMock()
    u.effective_chat.id = 777
    u.effective_user.id = 777
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
    """Hermetic workspace env (the print-workspace test idiom)."""
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira.db"))
    monkeypatch.setenv("MIRA_PRINT_CAS_DIR", str(tmp_path / "cas"))
    print_workspace._reset_for_tests()
    # The rung is zero-LLM by contract — any cascade call is a failure.
    router = AsyncMock(side_effect=AssertionError("equipment rung must never call the cascade"))
    monkeypatch.setattr(bot.engine.router, "complete", router)
    # Tenant guard: tests seed tenant "t-eq" directly, so the current-turn
    # resolver must agree (the real bot uses the same resolver on both the
    # persist and read sides — see test_tenant_mismatch_falls_through).
    monkeypatch.setattr(bot, "_print_workspace_tenant", lambda _u: "t-eq")
    yield {"router": router, "monkeypatch": monkeypatch}
    print_workspace._reset_for_tests()


async def _seed(
    chat_id: str = "777",
    tenant: str = "t-eq",
    fields: dict | None = _FIELDS,
    classification: str = "EQUIPMENT_PHOTO",
    caption: str = "Analyze this equipment photo",
):
    outcome = await print_workspace.persist_print_turn(
        chat_id,
        tenant,
        _good_image_bytes(),
        _vision(classification),
        caption,
        "SEED ANSWER",
        nameplate_fields=fields,
    )
    assert outcome is not None and outcome.session_id
    return outcome


async def _run(text: str):
    update = _update()
    claimed = await bot._try_equipment_photo_followup(text, update, MagicMock())
    await _drain_tasks()
    return claimed, update


def _reply_text(update) -> str:
    assert update.message.reply_text.await_count >= 1
    return "\n".join(c.args[0] for c in update.message.reply_text.await_args_list)


# --------------------------------------------------------------------------- #
# persistence (model-free equipment ingest)
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_equipment_ingest_writes_per_field_observations(wired):
    outcome = await _seed()
    obs = await _store().load_observations(outcome.session_id, "t-eq")
    by_field = {
        (o.metadata or {}).get("field"): o.raw_value
        for o in obs
        if o.extractor == "nameplate_worker"
    }
    assert by_field["manufacturer"] == "TECO"
    assert by_field["model"] == "AEHH8N"
    assert by_field["serial"] == "SN-4471"
    # raw_text is recorded separately, never folded into a field value
    assert by_field["raw_text"] == "TECO AEHH8N 5HP 460V 6.2A SN-4471"
    # field observations are VISIBLE (read off the photo)
    states = {
        o.evidence_state
        for o in obs
        if o.extractor == "nameplate_worker" and (o.metadata or {}).get("field") == "model"
    }
    assert states == {EvidenceState.VISIBLE}
    # the resolver ran (unsupported family → honest non-resolution, still recorded)
    assert any(o.extractor == "equipment_resolver" for o in obs)


@pytest.mark.asyncio
async def test_no_fields_ingest_preserves_prior_identity(wired):
    """A fields-less persist (vision-only turn) takes the spine's 'unreadable'
    path: one NEEDS_CONTEXT nameplate_worker observation, NO equipment_resolver
    row — a blurry follow-up photo never erases established identity."""
    first = await _seed()
    resolver_before = [
        o
        for o in await _store().load_observations(first.session_id, "t-eq")
        if o.extractor == "equipment_resolver"
    ]
    await _seed(fields=None)
    obs = await _store().load_observations(first.session_id, "t-eq")
    resolver_after = [o for o in obs if o.extractor == "equipment_resolver"]
    assert len(resolver_after) == len(resolver_before)  # unchanged — not erased
    assert any(
        o.extractor == "nameplate_worker" and o.evidence_state is EvidenceState.NEEDS_CONTEXT
        for o in obs
    )


@pytest.mark.asyncio
async def test_reingest_converges_latest_wins(wired):
    """Re-sending the same photo doesn't corrupt answers — the field readers
    take the latest value per field (full sha-keyed dedupe is a documented
    follow-up; the spine has no evidence-read API yet)."""
    outcome = await _seed()
    await _seed(fields={**_FIELDS, "serial": "SN-9999"})
    obs = await _store().load_observations(outcome.session_id, "t-eq")
    fields = print_workspace.latest_equipment_fields(obs)
    assert fields["serial"] == "SN-9999"  # latest reading wins
    assert fields["model"] == "AEHH8N"


# --------------------------------------------------------------------------- #
# claim gate
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_safety_text_is_never_claimed(wired):
    await _seed()
    claimed, update = await _run("there is visible smoke — what model is this?")
    assert claimed is False  # the STOP gate owns hazard turns
    update.message.reply_text.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text",
    [
        "yes",
        "thanks",
        "the motor keeps tripping on overload",
        "how do I reset the fault?",
    ],
)
async def test_non_photo_turns_fall_through(wired, text):
    await _seed()
    claimed, update = await _run(text)
    assert claimed is False
    update.message.reply_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_without_a_workspace_everything_falls_through(wired):
    claimed, update = await _run("what was the model number?")
    assert claimed is False
    update.message.reply_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_print_only_workspace_field_question_falls_through(wired):
    """A workspace holding only print evidence (no equipment rows) does not
    claim nameplate-field questions — they belong to the engine."""
    await print_workspace.persist_print_turn(
        "777",
        "t-eq",
        _good_image_bytes(),
        {
            "classification": "ELECTRICAL_PRINT",
            "drawing_type": "control circuit",
            "ocr_items": ["-K17"],
            "ocr_tokens": [],
        },
        "explain this print",
        "SEED",
    )
    claimed, update = await _run("what was the model number?")
    assert claimed is False
    update.message.reply_text.assert_not_awaited()


# --------------------------------------------------------------------------- #
# deterministic field answers (zero LLM)
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_model_number_answered_from_the_photo(wired):
    await _seed()
    claimed, update = await _run("what was the model number?")
    assert claimed is True
    rendered = _reply_text(update)
    assert "Model: AEHH8N" in rendered
    assert "nameplate photo" in rendered
    assert "[Shown on the nameplate]" in rendered  # honest per-surface trust label
    wired["router"].assert_not_awaited()


@pytest.mark.asyncio
async def test_manufacturer_and_amps_answered(wired):
    await _seed()
    claimed, update = await _run("who makes it?")
    assert claimed is True
    assert "Manufacturer: TECO" in _reply_text(update)

    claimed2, update2 = await _run("how many amps is it rated for?")
    assert claimed2 is True
    assert "Full-load amps: 6.2" in _reply_text(update2)


@pytest.mark.asyncio
async def test_missing_field_gets_an_honest_refusal(wired):
    fields = {k: v for k, v in _FIELDS.items() if k != "serial"}
    await _seed(fields=fields)
    claimed, update = await _run("what's the serial number?")
    assert claimed is True
    rendered = _reply_text(update)
    assert "doesn't show a legible serial number" in rendered
    assert "closer" in rendered  # actionable ask, not a dead end


@pytest.mark.asyncio
async def test_generic_photo_recall_summarizes_the_evidence(wired):
    await _seed()
    claimed, update = await _run("what did that photo show?")
    assert claimed is True
    rendered = _reply_text(update)
    assert "Nameplate fields I read:" in rendered
    assert "Model: AEHH8N" in rendered
    assert "Manufacturer: TECO" in rendered
    wired["router"].assert_not_awaited()


@pytest.mark.asyncio
async def test_turns_are_recorded_against_the_workspace(wired):
    outcome = await _seed()
    claimed, _u = await _run("what was the model number?")
    assert claimed is True
    questions = [q["text"] for q in _store()._questions.values()]
    assert "what was the model number?" in questions
    assert outcome.session_id in {q["session_id"] for q in _store()._questions.values()}


# --------------------------------------------------------------------------- #
# golden conversation — photo → 4 distinct follow-ups on the REAL rungs
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_golden_equipment_photo_conversation(wired):
    """The operator ask, end to end: send one equipment photo, then keep
    asking about it. Every answer comes from the persisted ledger, zero LLM,
    and a safety turn still falls through to the STOP gate."""
    await _seed(caption="what is this motor?")

    for question, expected in [
        ("what was the model number?", "Model: AEHH8N"),
        ("who makes it?", "Manufacturer: TECO"),
        ("how many volts does the nameplate say?", "Voltage: 460V"),
        ("what did that photo show?", "Nameplate fields I read:"),
    ]:
        claimed, update = await _run(question)
        assert claimed is True, question
        assert expected in _reply_text(update), question

    # Safety turn: never claimed, even mid-conversation.
    claimed, update = await _run("I smell burning and see smoke from that motor")
    assert claimed is False
    update.message.reply_text.assert_not_awaited()

    wired["router"].assert_not_awaited()  # the entire conversation cost zero tokens


# --------------------------------------------------------------------------- #
# tenant guard + rung precedence (adversarial-review findings)
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_tenant_mismatch_falls_through(wired):
    """Defense-in-depth: if this turn resolves to a DIFFERENT tenant than the
    stored workspace (tenant mapping drifted), the rung must not answer."""
    await _seed()
    wired["monkeypatch"].setattr(bot, "_print_workspace_tenant", lambda _u: "other-tenant")
    claimed, update = await _run("what was the model number?")
    assert claimed is False
    update.message.reply_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_mixed_workspace_rung_precedence(wired):
    """One chat, BOTH print and equipment evidence in the same workspace:
    a print question is claimed by the print rung, a nameplate-field question
    by the equipment rung — never both, never crossed."""
    await _seed()  # equipment evidence
    await print_workspace.persist_print_turn(
        "777",
        "t-eq",
        _good_image_bytes(),
        {
            "classification": "ELECTRICAL_PRINT",
            "drawing_type": "control circuit",
            "ocr_items": ["-K17"],
            "ocr_tokens": [{"text": "-K17", "bbox": [10, 10, 60, 40]}],
        },
        "explain this print",
        "PRINT SEED",
    )

    # Field question → equipment rung claims; print rung declines first.
    u1 = _update()
    print_claimed = await bot._try_print_workspace_followup("what was the model number?", u1, MagicMock())
    assert print_claimed is False
    claimed, update = await _run("what was the model number?")
    assert claimed is True
    assert "Model: AEHH8N" in _reply_text(update)

    # Print-tag question → print rung claims (equipment rung never sees it
    # in handle_message; prove it also would not claim on its own).
    u2 = _update()
    print_claimed2 = await bot._try_print_workspace_followup("what feeds K17?", u2, MagicMock())
    assert print_claimed2 is True
    eq_claimed = await bot._try_equipment_photo_followup("what feeds K17?", _update(), MagicMock())
    assert eq_claimed is False


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
    claimed, update = await _run("what was the model number?")
    assert claimed is False
    update.message.reply_text.assert_not_awaited()
