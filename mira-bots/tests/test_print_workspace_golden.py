"""THE golden persistent-Q&A acceptance conversation (Package C).

Drives the REAL bot rungs — ``bot._try_print_translator_reply`` for the photo
turn, ``bot._try_print_workspace_followup`` for every text turn — over the
synthetic K17 seal-in fixture (``printsense.benchmarks.persistent_qa_fixture``)
through the spec's five-turn conversation:

  1. photo + "What would energize K17?"           → grounded in coil evidence
  2. "How does its seal-in work?"                 → pronoun "its" → K17; cites 13/14
  3. "Why would it drop out?"                     → pronoun "it" → K17
  4. "I have 24V before F12 but nothing after."   → DOCUMENTED technician observation
  5. "What should I check next on this circuit?"  → print evidence + the measurement

plus, in a separate test, the progressive-enrichment close-up: a re-read of the
K17 region supersedes the wide shot's overlapping evidence, bumps the
print-model revision, and the conversation continues against the updated
revision without a restart.

Hermetic and keyless (the Package A/B idiom): InMemory visual store
(``NEON_DATABASE_URL`` removed), tmp sqlite mapping db, vision + cascade +
theory reply mocked deterministic, ``log_turn``/``send_push`` mocked. The
mocked model strings are bounded, fixture-grounded, and graded per turn by the
rung's own ``print_autoeval.evaluate_print_turn`` hook (severity must never be
P0). No network, no paid provider, zero live inference.
"""

from __future__ import annotations

import asyncio
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

import bot  # noqa: E402
from printsense.benchmarks import persistent_qa_fixture as fx  # noqa: E402
from shared import print_autoeval, print_workspace  # noqa: E402
from shared.visual.evidence_state import EvidenceState  # noqa: E402
from shared.visual.store import InMemoryVisualStore  # noqa: E402

# --------------------------------------------------------------------------- #
# the golden conversation (questions + bounded deterministic model strings)
# --------------------------------------------------------------------------- #

Q1 = "What would energize K17?"
Q2 = "How does its seal-in work?"
Q3 = "Why would it drop out?"
Q4 = "I have 24V before F12 but nothing after."
Q5 = "What should I check next on this circuit?"

# Turn-1 theory reply (the mocked engine._grounded_print_reply string —
# fixture-grounded, no state assertion, carries a safety marker).
THEORY_REPLY_1 = (
    "K17 pulls in when 24VDC reaches its coil terminals A1/A2: supply through "
    "fuse -F12, then the -S1 start pushbutton, then the coil. The 13/14 "
    "auxiliary contact seals in around -S1 so the coil circuit stays complete. "
    "Verify with a meter — a print cannot show live state."
)
# Turn-2/3/5 model explanations (the mocked router.complete strings — grounded
# ONLY in the evidence packet the rung builds from the persisted ledger).
MODEL_REPLY_2 = (
    "When the K17 coil pulls in, its 13/14 auxiliary contact closes and "
    "bridges the -S1 start pushbutton, so the coil circuit stays complete "
    "after Start is released. Verify with a meter — the print cannot show "
    "live state."
)
MODEL_REPLY_3 = (
    "The drawing shows three interruption points for the K17 coil circuit: "
    "the -F12 fuse, the -S1 start path, and the 13/14 seal-in contact. Any of "
    "them opening would drop the coil out. Verify each with a meter before "
    "relying on a suspected cause."
)
MODEL_REPLY_5 = (
    "You report 24V before -F12 and nothing after it, so the drawing points at "
    "-F12 itself as the break. De-energize and lock out, verify zero energy, "
    "then check -F12 for continuity; if it proves good, move to the -S1 start "
    "path and the 13/14 seal-in contact."
)
CLOSEUP_CAPTION = "what does this close-up of K17 show?"
CLOSEUP_THEORY_REPLY = (
    "This close-up shows the -K17 contact block detail: coil terminals A1/A2, "
    "the 13/14 seal-in contact, and the 21/22 auxiliary pair. Verify terminal "
    "assignments against the panel before working on it."
)

# --------------------------------------------------------------------------- #
# fixtures + helpers (the Package A/B hermetic idiom)
# --------------------------------------------------------------------------- #

_PNG_CACHE: dict[str, bytes] = {}


def _png(name: str, base: dict) -> bytes:
    if name not in _PNG_CACHE:
        _PNG_CACHE[name] = fx.page_png(base)
    return _PNG_CACHE[name]


class _NullTyping:
    def __init__(self, *a, **k): ...

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


def _update():
    u = MagicMock()
    u.effective_chat.id = 999
    u.effective_user.id = 999
    u.message.reply_text = AsyncMock()
    return u


def _delivered(update) -> str:
    """Everything the turn sent to the technician (chunk-joined)."""
    return "\n".join(c.args[0] for c in update.message.reply_text.await_args_list)


async def _drain_tasks() -> None:
    for _ in range(6):
        await asyncio.sleep(0)


def _store() -> InMemoryVisualStore:
    store = print_workspace._get_service().store
    assert isinstance(store, InMemoryVisualStore), "tests must run on the InMemory store"
    return store


@pytest.fixture
def wired(monkeypatch, tmp_path):
    """Hermetic workspace env with every external seam mocked deterministic."""
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira.db"))
    monkeypatch.setenv("MIRA_PRINT_CAS_DIR", str(tmp_path / "cas"))
    print_workspace._reset_for_tests()

    log_turn = AsyncMock()
    monkeypatch.setattr(bot, "log_turn", log_turn)
    monkeypatch.setattr(bot, "send_push", AsyncMock())
    monkeypatch.setattr(print_autoeval, "ALERT_LIMITER", print_autoeval.AlertRateLimiter())
    monkeypatch.setattr(bot.engine.router, "last_model_for", lambda _sid: None)
    from printsense import interpret as _interp

    monkeypatch.setattr(_interp, "pop_last_usage", lambda: None)
    monkeypatch.setattr(bot, "typing_action", _NullTyping)
    monkeypatch.setattr(bot, "_print_interpreter_configured", lambda: False)

    # The ONE vision call of the conversation (turn 1). Counted.
    vision = AsyncMock(return_value=fx.vision_data(fx.BASE))
    monkeypatch.setattr(bot.engine.vision, "process", vision)
    # The photo turn's grounded reply (cascade seam) — mocked deterministic.
    theory = AsyncMock(return_value=THEORY_REPLY_1)
    monkeypatch.setattr(bot.engine, "_grounded_print_reply", theory)
    # The follow-up rungs' bounded model-explanation seam. Default: cascade
    # produces nothing; each turn that may use it scripts its reply.
    router = AsyncMock(return_value=("", {}))
    monkeypatch.setattr(bot.engine.router, "complete", router)

    yield {
        "log_turn": log_turn,
        "vision": vision,
        "theory": theory,
        "router": router,
        "monkeypatch": monkeypatch,
    }
    print_workspace._reset_for_tests()


async def _photo_turn(caption: str, base_name: str = "base", base: dict | None = None):
    update = _update()
    raw = _png(base_name, base or fx.BASE)
    claimed = await bot._try_print_translator_reply(raw, raw, caption, update, MagicMock())
    await _drain_tasks()
    return claimed, update


async def _text_turn(text: str):
    update = _update()
    claimed = await bot._try_print_workspace_followup(text, update, MagicMock())
    await _drain_tasks()
    return claimed, update


def _autoeval_of(wired, turn_index: int) -> dict:
    """The rung-recorded autoeval verdict of the Nth delivered turn (0-based).

    Every delivered turn flows through ``print_autoeval.evaluate_print_turn``
    via the bot's autoeval hook and lands one ``log_turn`` call whose meta
    carries the verdict — the per-turn P0 gate this suite asserts on.
    """
    calls = wired["log_turn"].await_args_list
    assert len(calls) > turn_index, f"expected a log_turn call for turn {turn_index + 1}"
    kw = calls[turn_index].kwargs
    assert kw["meta"]["surface"] == "print_translator"
    return kw


# --------------------------------------------------------------------------- #
# THE golden five-turn conversation
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_golden_five_turn_conversation(wired):
    # ── Turn 1: photo + "What would energize K17?" ─────────────────────────
    claimed, update = await _photo_turn(Q1)
    assert claimed is True
    reply1 = _delivered(update)
    # grounded in coil evidence: the coil terminals and the feed path
    assert "A1" in reply1 and "A2" in reply1
    assert "K17" in reply1
    assert wired["vision"].await_count == 1  # the print was analyzed ONCE
    assert wired["theory"].await_count == 1

    ws = print_workspace.get_workspace("999")
    assert ws is not None, "the photo turn must establish the workspace mapping"
    session_id, tenant = ws.session_id, ws.tenant_id
    store = _store()

    obs = await store.load_observations(session_id, tenant)
    ocr = [o for o in obs if o.extractor == "ocr"]
    assert {o.raw_value for o in ocr} == {t["text"] for t in fx.BASE["tokens"]}
    assert all(o.evidence_state is EvidenceState.VISIBLE for o in ocr)
    assert all(o.metadata.get("bbox") for o in ocr)  # evidence regions stored
    # caption continuity: the named tag became the conversation focus
    assert ws.last_entity == "-K17"
    session = await store.get_session(session_id, tenant)
    revision_1 = session.current_revision
    assert revision_1

    kw1 = _autoeval_of(wired, 0)
    assert kw1["meta"]["autoeval"]["branch"] == "theory"
    assert kw1["meta"]["autoeval"]["severity"] != "P0"

    # ── Turn 2: "How does its seal-in work?" — pronoun "its" → K17 ─────────
    wired["router"].return_value = (MODEL_REPLY_2, {"provider": "groq", "model": "test-model"})
    claimed, update = await _text_turn(Q2)
    assert claimed is True
    reply2 = _delivered(update)
    assert "13" in reply2 and "14" in reply2  # cites the seal-in pair
    # focus resolved to K17: its ledger claim leads the evidence block
    assert "[Shown on the drawing] -K17" in reply2
    # the model saw the bounded evidence packet from the LEDGER, not the image
    assert wired["router"].await_count == 1
    messages = wired["router"].await_args.args[0]
    assert "ONLY from the evidence lines" in messages[0]["content"]
    packet2 = messages[1]["content"]
    assert f"Question: {Q2}" in packet2
    assert "contact pair 13-14 = NO by convention" in packet2
    assert wired["vision"].await_count == 1  # NOT re-analyzed for the question
    kw2 = _autoeval_of(wired, 1)
    assert kw2["meta"]["autoeval"]["branch"] == "workspace_followup"
    assert kw2["meta"]["autoeval"]["severity"] != "P0"
    assert print_workspace.get_workspace("999").last_entity == "-K17"

    # ── Turn 3: "Why would it drop out?" — pronoun again → K17 ─────────────
    wired["router"].return_value = (MODEL_REPLY_3, {"provider": "groq", "model": "test-model"})
    claimed, update = await _text_turn(Q3)
    assert claimed is True
    reply3 = _delivered(update)
    assert "drop the coil out" in reply3
    assert "[Shown on the drawing] -K17" in reply3  # resolved the prior entity
    assert "Safety:" in reply3  # diagnostic guidance carries a safety note
    assert wired["router"].await_count == 2
    assert wired["vision"].await_count == 1
    kw3 = _autoeval_of(wired, 2)
    assert kw3["meta"]["autoeval"]["severity"] != "P0"

    # ── Turn 4: the technician measurement — DOCUMENTED, zero LLM ──────────
    claimed, update = await _text_turn(Q4)
    assert claimed is True
    reply4 = _delivered(update)
    assert "You report" in reply4
    assert "-F12 is shown on the stored drawing." in reply4
    assert wired["router"].await_count == 2  # ZERO LLM on the intake path

    obs = await store.load_observations(session_id, tenant)
    tech = [o for o in obs if o.extractor == "technician"]
    assert len(tech) == 1
    # distinct from drawing facts: DOCUMENTED technician row, never VISIBLE/OCR
    assert tech[0].evidence_state is EvidenceState.DOCUMENTED
    assert tech[0].raw_value == Q4
    measurement = tech[0].metadata["measurement"]
    assert measurement["value"] == 24.0
    assert measurement["location_before"] == "F12"
    assert measurement["negated"] is True
    kw4 = _autoeval_of(wired, 3)
    assert kw4["meta"]["autoeval"]["severity"] != "P0"

    # ── Turn 5: the next-check — print evidence + the measurement, together ─
    wired["router"].return_value = (MODEL_REPLY_5, {"provider": "groq", "model": "test-model"})
    claimed, update = await _text_turn(Q5)
    assert claimed is True
    reply5 = _delivered(update)
    assert wired["router"].await_count == 3
    packet5 = wired["router"].await_args.args[0][1]["content"]
    # BOTH evidence kinds reached the answer: the print-derived deterministic
    # line AND the turn-4 technician measurement, in one bounded packet.
    assert "contact pair 13-14 = NO by convention" in packet5
    assert f"technician reported: {Q4}" in packet5
    # ... and both render as trust-labeled claims in the delivered answer.
    assert "[Shown on the drawing]" in reply5
    assert "[Reported by technician]" in reply5
    assert "F12" in reply5
    kw5 = _autoeval_of(wired, 4)
    assert kw5["meta"]["autoeval"]["branch"] == "workspace_followup"
    assert kw5["meta"]["autoeval"]["severity"] != "P0"

    # ── conversation-state proofs across the whole exchange ────────────────
    assert wired["vision"].await_count == 1  # one photo analysis for 5 turns
    assert wired["theory"].await_count == 1
    final_ws = print_workspace.get_workspace("999")
    assert final_ws is not None
    assert final_ws.session_id == session_id  # the mapping survived every turn
    session = await store.get_session(session_id, tenant)
    assert session.current_revision == revision_1  # text turns never re-model
    recorded = [q["text"] for q in store._questions.values()]
    for question in (Q1, Q2, Q3, Q4, Q5):
        assert question in recorded, f"turn not recorded against the workspace: {question}"


@pytest.mark.asyncio
async def test_bare_next_check_question_falls_through_by_design(wired):
    """The spec's bare "What should I check next?" carries no workspace signal
    (no measurement, no resolvable entity, not print-shaped), so the preserved
    Package B claim gate correctly declines it — such a turn could equally
    target a drive pack or wiring context. The golden conversation therefore
    anchors the turn with "on this circuit" (deviation documented in
    docs/plans/2026-07-18-printsense-persistent-qa.md)."""
    await _photo_turn(Q1)
    claimed, update = await _text_turn("What should I check next?")
    assert claimed is False
    update.message.reply_text.assert_not_awaited()


# --------------------------------------------------------------------------- #
# Turn 6: the progressive-enrichment close-up (supersede + revision bump)
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_close_up_supersedes_and_conversation_continues(wired):
    # Wide shot first (same turn 1 as the golden conversation).
    claimed, _u = await _photo_turn(Q1)
    assert claimed is True
    ws = print_workspace.get_workspace("999")
    session_id, tenant = ws.session_id, ws.tenant_id
    store = _store()
    revision_1 = (await store.get_session(session_id, tenant)).current_revision
    wide_k17 = [
        o
        for o in await store.load_observations(session_id, tenant)
        if o.extractor == "ocr" and o.raw_value == "-K17"
    ]
    assert len(wide_k17) == 1

    # The close-up re-read of the K17 region (adds the 21/22 aux pair).
    wired["vision"].return_value = fx.vision_data(fx.CLOSE_UP_BASE)
    wired["theory"].return_value = CLOSEUP_THEORY_REPLY
    claimed, update = await _photo_turn(CLOSEUP_CAPTION, base_name="closeup", base=fx.CLOSE_UP_BASE)
    assert claimed is True
    reply = _delivered(update)
    # the technician was told the print model advanced
    assert "Close-up absorbed: 5 observations updated" in reply
    assert "revision bumped" in reply

    # Revision bumped; overlap evidence superseded; new region evidence active.
    session = await store.get_session(session_id, tenant)
    revision_2 = session.current_revision
    assert revision_2 and revision_2 != revision_1

    everything = await store.load_observations(session_id, tenant, active_only=False)
    superseded = [o for o in everything if o.evidence_state is EvidenceState.SUPERSEDED]
    overlap = {t["text"] for t in fx.CLOSE_UP_BASE["tokens"]} & {
        t["text"] for t in fx.BASE["tokens"]
    }
    assert {o.raw_value for o in superseded} == overlap  # -K17, A1, A2, 13, 14
    assert all(o.superseded_by for o in superseded)

    active = await store.load_observations(session_id, tenant, active_only=True)
    active_ids = {o.observation_id for o in active}
    assert not ({o.observation_id for o in superseded} & active_ids)
    active_values = {o.raw_value for o in active if o.extractor == "ocr"}
    assert {"21", "22"} <= active_values  # the close-up-only pair joined
    assert "-X2:4" in active_values  # un-re-read wide evidence survives
    # the ACTIVE -K17 row is the close-up's re-read (its bbox), not the stale one
    active_k17 = [o for o in active if o.extractor == "ocr" and o.raw_value == "-K17"]
    assert len(active_k17) == 1
    assert active_k17[0].observation_id != wide_k17[0].observation_id
    assert active_k17[0].metadata["bbox"] == fx.CLOSE_UP_BASE["tokens"][0]["bbox"]
    assert wide_k17[0].observation_id in {o.observation_id for o in superseded}

    # The conversation CONTINUES against the updated revision — no restart.
    claimed, update = await _text_turn("what feeds K17?")
    assert claimed is True
    followup = _delivered(update)
    assert "[Shown on the drawing]" in followup
    assert "-K17" in followup
    assert "[Superseded]" not in followup  # stale evidence never renders active
    assert f"revision {revision_2[:8]}" in followup  # the superseded-note stamp
    assert "replaced by your close-up" in followup
    assert wired["router"].await_count == 0  # ledger-grounded, zero LLM
    assert wired["vision"].await_count == 2  # one per photo, none per question
    assert print_workspace.get_workspace("999").session_id == session_id
    for i in range(3):
        kw = _autoeval_of(wired, i)
        assert kw["meta"]["autoeval"]["severity"] != "P0"


# --------------------------------------------------------------------------- #
# fixture sanity (deterministic, redistributable)
# --------------------------------------------------------------------------- #


def test_fixture_is_deterministic_and_synthetic():
    assert fx.BASE["truth_status"] == "synthetic"
    assert fx.CLOSE_UP_BASE["truth_status"] == "synthetic"
    vd = fx.vision_data(fx.BASE)
    assert vd["classification"] == "ELECTRICAL_PRINT"
    assert vd["ocr_items"] == [t["text"] for t in fx.BASE["tokens"]]
    assert all(t["bbox"] for t in vd["ocr_tokens"])
    assert fx.vision_data(fx.BASE) == vd  # pure
    assert fx.page_png(fx.BASE) == fx.page_png(fx.BASE)  # deterministic render
    # the close-up overlaps the wide shot exactly on the K17-region tokens
    overlap = {t["text"] for t in fx.CLOSE_UP_BASE["tokens"]} & {
        t["text"] for t in fx.BASE["tokens"]
    }
    assert overlap == {"-K17", "A1", "A2", "13", "14"}
