"""Phase-2 single-photo harness — hermetic tests (no network, no paid SDK).

Drives the REAL production rung (`bot._try_print_translator_reply`) through the
Phase-2 harness with the same monkeypatch seams the existing print-translator
tests use (engine.vision.process + engine.router.complete). Proves: the
harness exercises the real path; good scripted answers pass; an invented tag,
a wrong contact verdict, and an unsupported state claim each hard-fail; the
non-print case falls through; both admin surfaces fail closed.
"""

from __future__ import annotations

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
sys.modules.pop("chat_adapter", None)

import pytest  # noqa: E402

pytest.importorskip("pydantic")
pytest.importorskip("PIL")

import bot  # noqa: E402
import printsense_commercial as pc  # noqa: E402
import printsense_testkit as tk  # noqa: E402

from printsense.benchmarks import single_photo_cases as spc  # noqa: E402


def _script_providers(monkeypatch, interpreter_off=True):
    """Vision + router scripted from a case cursor: several cases share the
    same question string (deliberately — same caption, different page), so the
    scripts read the CURRENT case from a mutable box the test advances. The
    production rung itself is untouched."""
    box = {"case": spc.CASES[0]}

    async def vision(photo_b64, message):
        s = box["case"]["scripted"]
        return {
            "classification": s["classification"],
            "classification_confidence": 0.9,
            "vision_result": "a schematic drawing",
            "ocr_items": s["ocr_items"],
            "tesseract_text": "",
            "drawing_type": "control circuit",
            "drawing_type_confidence": 0.8,
        }

    async def complete(messages, **kwargs):
        return box["case"]["scripted"]["reply"], {
            "provider": "scripted",
            "model": "canned",
        }

    monkeypatch.setattr(bot.engine.vision, "process", vision)
    monkeypatch.setattr(bot.engine.router, "complete", complete)
    if interpreter_off:
        monkeypatch.setattr(bot, "_print_interpreter_configured", lambda: False)
    monkeypatch.setattr(bot, "typing_action", _null_typing)
    return box


async def _run_all_cases(box, cases=None):
    """Drive the harness one case at a time (advancing the script cursor) and
    fold the per-case results into one envelope."""
    from printsense.benchmarks import single_photo_grader as spg

    results = []
    for case in cases or spc.CASES:
        box["case"] = case
        env = await tk.run_phase2(
            bot._try_print_translator_reply, _ctx(), 999, mode="hermetic", cases=[case]
        )
        results.extend(env["results"])
    return spg.build_envelope(results, mode="hermetic")


class _NullTyping:
    def __init__(self, *a, **k): ...

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


_null_typing = _NullTyping


def _ctx():
    c = MagicMock()
    c.bot.send_document = AsyncMock()
    return c


def _update(chat_id=999):
    u = MagicMock()
    u.effective_chat.id = chat_id
    u.effective_user.id = chat_id
    u.message.reply_text = AsyncMock()
    u.message.caption = ""
    return u


async def test_harness_runs_real_rung_all_cases_pass(monkeypatch):
    box = _script_providers(monkeypatch)
    env = await _run_all_cases(box)
    assert env["cases_total"] == len(spc.CASES)
    assert env["cases_failed"] == 0, env["hard_failures"]
    assert not env["hard_failures"]
    # the non-print case proved the ladder honesty (fell through as expected)
    nonprint = next(r for r in env["results"] if r["case_id"] == "q_nonprint_falls_through")
    assert nonprint["status"] == "pass"
    assert env["latency_max_s"] is not None
    assert env["estimated_cost_usd"] == 0.0


async def test_invented_tag_hard_fails(monkeypatch):
    box = _script_providers(monkeypatch)

    async def liar(messages, **kwargs):
        return ("The main contactor -77/K55 feeds this circuit.", {"provider": "scripted"})

    monkeypatch.setattr(bot.engine.router, "complete", liar)
    box["case"] = next(c for c in spc.CASES if c["case_id"] == "q_circuit_function")
    env = await tk.run_phase2(
        bot._try_print_translator_reply, _ctx(), 999, mode="hermetic", cases=[box["case"]]
    )
    assert any(h["class"] == "prose_tag_invention" for h in env["hard_failures"])


def _fastpath_off(monkeypatch):
    """UNSEEN-1 answers closed-form classes deterministically BEFORE the
    cascade; these grader-detection tests script a BAD cascade reply, so the
    fast-path is switched off to keep exercising the grader on the model path
    (the fast-path's own behavior is covered in
    test_printsense_deterministic_fastpath.py)."""
    import printsense.deterministic_qa as dq

    monkeypatch.setattr(dq, "try_deterministic_answer", lambda *a, **k: None)


async def test_wrong_contact_verdict_hard_fails(monkeypatch):
    box = _script_providers(monkeypatch)
    _fastpath_off(monkeypatch)

    async def wrong(messages, **kwargs):
        return ("No — 13/14 is a normally closed contact.", {"provider": "scripted"})

    monkeypatch.setattr(bot.engine.router, "complete", wrong)
    box["case"] = next(c for c in spc.CASES if c["case_id"] == "q_contact_convention")
    env = await tk.run_phase2(
        bot._try_print_translator_reply, _ctx(), 999, mode="hermetic", cases=[box["case"]]
    )
    assert any(h["class"] == "wrong_contact_verdict" for h in env["hard_failures"])


async def test_unsupported_state_claim_hard_fails(monkeypatch):
    box = _script_providers(monkeypatch)
    _fastpath_off(monkeypatch)

    async def stateful(messages, **kwargs):
        return (
            "The coil circuit is fine — the contactor is currently "
            "energized, and -93/K02 is pulled in.",
            {"provider": "scripted"},
        )

    monkeypatch.setattr(bot.engine.router, "complete", stateful)
    box["case"] = next(c for c in spc.CASES if c["case_id"] == "q_not_energize")
    env = await tk.run_phase2(
        bot._try_print_translator_reply, _ctx(), 999, mode="hermetic", cases=[box["case"]]
    )
    assert any(h["class"] == "unsupported_state_claim" for h in env["hard_failures"])


async def test_confident_answer_on_unreadable_hard_fails(monkeypatch):
    box = _script_providers(monkeypatch)

    async def overconfident(messages, **kwargs):
        return ("This is a standard motor starter around -90/K09.", {"provider": "scripted"})

    monkeypatch.setattr(bot.engine.router, "complete", overconfident)
    box["case"] = next(c for c in spc.CASES if c["case_id"] == "q_unreadable_refusal")
    env = await tk.run_phase2(
        bot._try_print_translator_reply, _ctx(), 999, mode="hermetic", cases=[box["case"]]
    )
    classes = {h["class"] for h in env["hard_failures"]}
    assert {"missing_refusal_honesty", "refusal_violated"} & classes


async def test_grade_caption_admin_gate(monkeypatch):
    monkeypatch.setattr(pc, "_ADMIN_IDS", {"999"})
    _script_providers(monkeypatch)
    # non-admin: refused, turn claimed (no leak into customer flows)
    u, c = _update(chat_id=123), _ctx()
    claimed = await tk.try_printsense_grade_reply(b"x", b"x", "/printsense_grade test?", u, c)
    assert claimed is True
    u.message.reply_text.assert_awaited_once_with("Not authorized.")
    c.bot.send_document.assert_not_called()
    # empty admin set: everyone refused
    monkeypatch.setattr(pc, "_ADMIN_IDS", set())
    u2 = _update(chat_id=999)
    assert await tk.try_printsense_grade_reply(b"x", b"x", "/printsense_grade test?", u2, _ctx())
    u2.message.reply_text.assert_awaited_once_with("Not authorized.")


async def test_grade_caption_admin_gets_answer_and_report(monkeypatch):
    monkeypatch.setattr(pc, "_ADMIN_IDS", {"999"})
    box = _script_providers(monkeypatch)
    box["case"] = spc.CASES[0]
    u, c = _update(chat_id=999), _ctx()
    png = spc.render_case_png(spc.CASES[0])
    claimed = await tk.try_printsense_grade_reply(
        png, png, "/printsense_grade What does this circuit do?", u, c
    )
    assert claimed is True
    # technician-facing answer went to the real chat (tee forwards)
    texts = [call.args[0] for call in u.message.reply_text.await_args_list]
    assert any("contactor control circuit" in t for t in texts)
    # and the diagnostic report was attached
    c.bot.send_document.assert_awaited_once()
    assert c.bot.send_document.await_args.kwargs["filename"] == "printsense_grade.md"
    assert c.bot.send_document.await_args.kwargs["chat_id"] == 999


async def test_grade_caption_ordinary_photo_falls_through():
    u, c = _update(), _ctx()
    assert await tk.try_printsense_grade_reply(b"x", b"x", "a normal caption", u, c) is False
    u.message.reply_text.assert_not_called()


async def test_phase2_command_routes_and_delivers(monkeypatch):
    monkeypatch.setattr(pc, "_ADMIN_IDS", {"999"})
    _script_providers(monkeypatch)
    u, c = _update(chat_id=999), _ctx()
    ctx = c
    ctx.args = ["phase2"]
    await pc.printsense_test_command(u, ctx)
    summary = u.message.reply_text.await_args[0][0]
    assert "PrintSense phase2" in summary
    assert ctx.bot.send_document.await_count == 2
    names = {call.kwargs["filename"] for call in ctx.bot.send_document.await_args_list}
    assert names == {"printsense_phase2.json", "printsense_phase2.md"}


async def test_expectations_frozen():
    from printsense.benchmarks import single_photo_grader as spg

    assert spg.expectations_frozen_ok(), (
        "single-photo expectations edited without refreezing single_photo_cases.sha256"
    )
