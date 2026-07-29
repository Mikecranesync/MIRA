"""Phase-3 hermetic: the full session bench through the REAL album rung
(``bot._try_multi_photo_printsense_reply``) with scripted vision + interpreter
seams, plus the restart-survival probe against the REAL PhotoBatchQueue.

$0, offline — CI-faithful proof that the multi-photo route, refusal-to-combine
gate, evidence accumulation, and durability promise are all exercised."""

from __future__ import annotations

import os
import sys

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.modules.pop("chat_adapter", None)

import bot  # noqa: E402
import printsense_testkit as tk  # noqa: E402
from printsense.benchmarks import session_cases as sc  # noqa: E402


def _script_seams(monkeypatch):
    """Scripted vision + interpreter driven by a per-turn cursor, so the REAL
    rung's control flow (all-print gate -> package interpretation) runs
    unmodified while CI stays offline."""
    cursor = {"session": None, "turn": None, "page_idx": 0}

    def _select(caption: str):
        for s in sc.SESSIONS:
            for t in s["turns"]:
                if t["caption"] == caption:
                    return s, t
        raise AssertionError(f"no scripted turn for caption {caption!r}")

    async def _vision(photo_b64, caption):
        s, t = _select(caption)
        if (cursor["session"], cursor["turn"]) != (s["session_id"], t["turn_id"]):
            cursor.update(session=s["session_id"], turn=t["turn_id"], page_idx=0)
        cls = t["scripted"]["classifications"][cursor["page_idx"]]
        cursor["page_idx"] += 1
        return {"classification": cls, "drawing_type": "wiring diagram", "ocr_items": []}

    async def _interpret(*, photo_b64s, question, package_context=None):
        _s, t = _select(question)
        return t["scripted"]["reply"]

    monkeypatch.setattr(bot.engine.vision, "process", _vision)
    monkeypatch.setattr(bot.engine, "_interpret_print_anthropic_pages", _interpret)


@pytest.mark.asyncio
async def test_full_hermetic_session_bench_passes(monkeypatch):
    _script_seams(monkeypatch)
    env = await tk.run_phase3(bot._try_multi_photo_printsense_reply, mode="hermetic")
    assert env["hard_failures"] == [], env["hard_failures"]
    assert env["sessions_passed"] == env["sessions_total"] == len(sc.SESSIONS) + 1  # + durability
    assert env["turns_passed"] == env["turns_total"]
    assert env["durability"]["survived_restart"] is True
    assert env["durability"]["raw_preserved"] is True
    # the continuation session recommends the missing sheet
    assert "89" in env["recommended_missing_pages"]


@pytest.mark.asyncio
async def test_nonprint_mix_refuses_via_real_gate(monkeypatch):
    _script_seams(monkeypatch)
    s2 = [s for s in sc.SESSIONS if s["session_id"] == "s2_nonprint_refuse"]
    env = await tk.run_phase3(bot._try_multi_photo_printsense_reply, mode="hermetic", sessions=s2)
    graded = env["sessions"][0]["results"][0]
    assert graded["status"] == "pass"  # correct refusal-to-combine


@pytest.mark.asyncio
async def test_durability_probe_uses_real_queue():
    probe = await tk.run_durability_probe()
    assert probe == {
        "survived_restart": True,
        "raw_preserved": True,
        "caption_preserved": True,
    }


@pytest.mark.asyncio
async def test_live_session_subset_is_bounded():
    live = [s for s in sc.SESSIONS if s["session_id"] in tk.PHASE3_LIVE_SESSION_IDS]
    assert 0 < len(live) <= 2
    assert sum(len(s["turns"]) for s in live) <= 3  # max paid package calls per run
