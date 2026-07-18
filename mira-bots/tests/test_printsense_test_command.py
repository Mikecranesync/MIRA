"""/printsense_test phase1 — admin gating, shared-logic reuse, fail-closed.

Mirrors the fixture pattern of test_printsense_commercial_telegram.py. Hermetic:
no network, no OCR, no paid SDK — the command runs the committed synthetic
corpus through the real capability bench and the frozen grader-gate corpus.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

pytest.importorskip("pydantic")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "telegram"))
import printsense_commercial as pc  # noqa: E402

from printsense.benchmarks import capability_bench as cb  # noqa: E402


def _update(chat_id=999, text="/printsense_test phase1"):
    u = MagicMock()
    u.effective_chat.id = chat_id
    u.message.text = text
    u.message.reply_text = AsyncMock()
    return u


def _ctx(args=("phase1",)):
    c = MagicMock()
    c.args = list(args)
    c.bot.send_document = AsyncMock()
    return c


@pytest.fixture(autouse=True)
def _admin(monkeypatch):
    monkeypatch.setattr(pc, "_ADMIN_IDS", {"999"})


async def test_non_admin_refused():
    u, c = _update(chat_id=123), _ctx()
    await pc.printsense_test_command(u, c)
    u.message.reply_text.assert_awaited_once_with("Not authorized.")
    c.bot.send_document.assert_not_called()


async def test_empty_admin_set_refuses_everyone(monkeypatch):
    """Env unset => empty set => fail closed for every chat id."""
    monkeypatch.setattr(pc, "_ADMIN_IDS", set())
    u, c = _update(chat_id=999), _ctx()
    await pc.printsense_test_command(u, c)
    u.message.reply_text.assert_awaited_once_with("Not authorized.")
    c.bot.send_document.assert_not_called()


async def test_unknown_phase_usage():
    u, c = _update(), _ctx(args=("phase9",))
    await pc.printsense_test_command(u, c)
    assert "Usage" in u.message.reply_text.await_args[0][0]
    c.bot.send_document.assert_not_called()


async def test_admin_runs_shared_bench_and_gets_artifacts(monkeypatch):
    """The command must call the SHARED capability bench (not a parallel
    implementation) and attach both artifacts to the invoking admin chat."""
    sentinel_env = cb.run_corpus(enforce_freeze=False)
    called = {}

    def spy_run_corpus():
        called["ran"] = True
        return sentinel_env

    monkeypatch.setattr(cb, "run_corpus", spy_run_corpus)
    u, c = _update(), _ctx()
    await pc.printsense_test_command(u, c)

    assert called.get("ran") is True, "command did not call the shared bench"
    summary = u.message.reply_text.await_args[0][0]
    assert "PrintSense phase1" in summary
    assert "scu2" in summary and "atv340" in summary  # frozen gate reported
    assert c.bot.send_document.await_count == 2
    names = {call.kwargs["filename"] for call in c.bot.send_document.await_args_list}
    assert names == {"printsense_phase1.json", "printsense_phase1.md"}
    for call in c.bot.send_document.await_args_list:
        assert call.kwargs["chat_id"] == 999  # never another chat


async def test_artifact_audit_failure_blocks_send(monkeypatch):
    monkeypatch.setattr(cb, "audit_artifact", lambda text: ["absolute_unix_path"])
    u, c = _update(), _ctx()
    await pc.printsense_test_command(u, c)
    assert "self-audit" in u.message.reply_text.await_args[0][0]
    c.bot.send_document.assert_not_called()


async def test_internal_error_fails_closed(monkeypatch):
    def boom():
        raise RuntimeError("kaboom with /data/secret/path")

    monkeypatch.setattr(cb, "run_corpus", boom)
    u, c = _update(), _ctx()
    await pc.printsense_test_command(u, c)
    msg = u.message.reply_text.await_args[0][0]
    assert msg == "PrintSense test failed: RuntimeError"  # class name only
    assert "/data" not in msg
    c.bot.send_document.assert_not_called()


async def test_ocr_phase_awaits_run_ocr_report_live(monkeypatch):
    """When args=['ocr'], the command must await printsense_testkit.run_ocr_report_live
    and not invoke any of the phase1/2/3/4/unseen paths."""
    import sys

    # Mock run_ocr_report_live before importing printsense_testkit
    class FakePrintsenseTestkit:
        run_ocr_report_live = AsyncMock()
        run_phase2_live = AsyncMock()
        run_phase3_live = AsyncMock()
        run_phase4_live = AsyncMock()
        run_unseen_lane_live = AsyncMock()

    fake_testkit = FakePrintsenseTestkit()
    sys.modules["printsense_testkit"] = fake_testkit

    # Also mock cb.run_corpus to ensure phase1 path isn't taken
    monkeypatch.setattr(cb, "run_corpus", AsyncMock())

    u, c = _update(), _ctx(args=("ocr",))
    await pc.printsense_test_command(u, c)

    # Assert ocr path was taken
    fake_testkit.run_ocr_report_live.assert_awaited_once_with(u, c)

    # Assert other paths were NOT called
    fake_testkit.run_phase2_live.assert_not_called()
    fake_testkit.run_phase3_live.assert_not_called()
    fake_testkit.run_phase4_live.assert_not_called()
    fake_testkit.run_unseen_lane_live.assert_not_called()
    cb.run_corpus.assert_not_called()

    # Cleanup
    del sys.modules["printsense_testkit"]
