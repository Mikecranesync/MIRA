"""A technician's PDF is never dropped (2026-08-16 prod defect).

Mike sent the real Danfoss MG20N622 manual. ``HUB_INGEST_TOKEN`` was empty in
prod, so the document handler replied with the raw internal string
"Hub intake is not configured." and discarded the file — then later told him it
could not read manuals.

These tests pin the fix:
- the Hub door being shut is logged with the **missing env var name** for ops;
- the bytes are **retained** on the bot's own volume (``shared.document_spool``);
- the technician gets a sentence about what happened, never the internal string;
- when the door IS configured the submit path is unchanged.

No network, no inference — the Telegram file download and the Hub POST are both
mocked, and the spool writes into ``tmp_path``.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

# Minimal env for shared imports (mirrors test_telegram_nameplate_ask.py).
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.modules.pop("chat_adapter", None)  # isolate from other bot adapters

import pytest  # noqa: E402

import bot  # noqa: E402
from shared import document_spool  # noqa: E402

_PDF = b"%PDF-1.7\nMG20N622 Danfoss VLT AQUA Drive FC-202 operating guide\n%%EOF"

# The string the technician must never see again.
_OLD_INTERNAL = "Hub intake is not configured."


@pytest.fixture
def spool_env(tmp_path, monkeypatch):
    """Point the spool dir + ledger at tmp_path."""
    monkeypatch.setenv(document_spool.SPOOL_DIR_ENV, str(tmp_path / "documents"))
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira_test.db"))
    return tmp_path


def _mock_doc_update_context(filename: str = "MG20N622.pdf", mime: str = "application/pdf"):
    update = MagicMock()
    update.effective_chat.id = 12345
    update.effective_user.id = 777
    update.message.document.file_name = filename
    update.message.document.mime_type = mime
    update.message.document.file_size = len(_PDF)
    update.message.document.file_id = "file-123"
    update.message.caption = ""
    update.message.reply_text = AsyncMock()

    tg_file = MagicMock()
    tg_file.download_as_bytearray = AsyncMock(return_value=bytearray(_PDF))
    context = MagicMock()
    context.bot.get_file = AsyncMock(return_value=tg_file)
    return update, context


class _CapturedTasks:
    """Collect the coroutine the handler backgrounds so tests can await it."""

    def __init__(self):
        self.coros = []

    def __call__(self, coro):
        self.coros.append(coro)
        return MagicMock()

    async def run(self):
        for coro in self.coros:
            await coro
        self.coros.clear()


def _replies(update) -> list[str]:
    return [c.args[0] for c in update.message.reply_text.call_args_list if c.args]


def _hub_unconfigured(monkeypatch):
    monkeypatch.setattr(bot, "HUB_URL", "")
    monkeypatch.setattr(bot, "HUB_IMPORT_URL", "")
    monkeypatch.setattr(bot, "HUB_INGEST_TOKEN", "")
    from shared import contextualization_intake as ci

    monkeypatch.setattr(ci, "HUB_URL", "")
    monkeypatch.setattr(ci, "HUB_IMPORT_URL", "")
    monkeypatch.setattr(ci, "HUB_INGEST_TOKEN", "")


def _hub_configured(monkeypatch):
    monkeypatch.setattr(bot, "HUB_URL", "https://hub.example.com")
    monkeypatch.setattr(bot, "HUB_IMPORT_URL", "")
    monkeypatch.setattr(bot, "HUB_INGEST_TOKEN", "svc-token")


async def _run_handler(update, context):
    tasks = _CapturedTasks()
    with patch.object(bot.asyncio, "create_task", tasks):
        await bot.document_handler(update, context)
    await tasks.run()


# --- the spool primitive ------------------------------------------------------


def test_spool_document_retains_bytes_and_ledgers_them(spool_env):
    doc = document_spool.spool_document(
        raw_bytes=_PDF,
        filename="MG20N622.pdf",
        tenant_id="tenant-1",
        uploader="777",
        reason="hub_unconfigured",
    )

    assert doc is not None
    with open(doc.path, "rb") as fh:
        assert fh.read() == _PDF  # the bytes themselves, byte-for-byte
    assert doc.filename == "MG20N622.pdf"
    assert doc.size == len(_PDF)

    db = sqlite3.connect(os.environ["MIRA_DB_PATH"])
    try:
        row = db.execute(
            "SELECT filename, status, reason, tenant_id, size FROM pending_document_intake "
            "WHERE doc_id = ?",
            (doc.doc_id,),
        ).fetchone()
    finally:
        db.close()
    assert row == ("MG20N622.pdf", document_spool.STATUS_PENDING, "hub_unconfigured",
                   "tenant-1", len(_PDF))


def test_spool_document_is_idempotent_by_content(spool_env):
    first = document_spool.spool_document(raw_bytes=_PDF, filename="MG20N622.pdf")
    second = document_spool.spool_document(raw_bytes=_PDF, filename="MG20N622.pdf")

    assert first is not None and second is not None
    assert first.path == second.path
    assert len(list((spool_env / "documents").iterdir())) == 1


def test_spool_document_rejects_path_traversal(spool_env):
    doc = document_spool.spool_document(
        raw_bytes=_PDF, filename="../../etc/passwd.pdf"
    )
    assert doc is not None
    assert doc.filename == "passwd.pdf"
    assert Path(doc.path).parent == (spool_env / "documents")


def test_spool_document_returns_none_when_it_cannot_retain(tmp_path, monkeypatch):
    """A save that did not happen must report None, never a fake success."""
    blocker = tmp_path / "not-a-dir"
    blocker.write_bytes(b"x")
    monkeypatch.setenv(document_spool.SPOOL_DIR_ENV, str(blocker / "documents"))
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira_test.db"))

    assert document_spool.spool_document(raw_bytes=_PDF, filename="MG20N622.pdf") is None


# --- the handler: Hub door shut ----------------------------------------------


@pytest.mark.asyncio
async def test_unconfigured_hub_retains_bytes_and_says_so(spool_env, monkeypatch, caplog):
    _hub_unconfigured(monkeypatch)
    update, context = _mock_doc_update_context()

    with caplog.at_level("WARNING"):
        await _run_handler(update, context)

    # 1. The bytes survived.
    spooled = list((spool_env / "documents").iterdir())
    assert len(spooled) == 1
    assert spooled[0].read_bytes() == _PDF

    # 2. The technician was told the truth, not the internal string.
    replies = _replies(update)
    assert replies, "handler replied nothing"
    assert not any(_OLD_INTERNAL in r for r in replies)
    final = replies[-1]
    assert "MG20N622.pdf" in final
    assert "Saved" in final
    assert "send it again" in final  # explicitly tells him he need not re-send

    # 3. Ops can see the config gap, by name.
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    assert any("HUB_INGEST_TOKEN" in m for m in warnings), warnings


@pytest.mark.asyncio
async def test_unconfigured_hub_never_posts(spool_env, monkeypatch):
    _hub_unconfigured(monkeypatch)
    submit = AsyncMock(return_value=True)
    monkeypatch.setattr(bot, "_submit_doc_to_hub", submit)
    update, context = _mock_doc_update_context()

    await _run_handler(update, context)

    submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_retention_failure_is_admitted_not_papered_over(spool_env, monkeypatch):
    _hub_unconfigured(monkeypatch)
    monkeypatch.setattr(document_spool, "spool_document", lambda **kw: None)
    update, context = _mock_doc_update_context()

    await _run_handler(update, context)

    final = _replies(update)[-1]
    assert "nothing was saved" in final
    assert "Saved MG20N622.pdf" not in final


@pytest.mark.asyncio
async def test_hub_configured_but_submit_fails_still_retains(spool_env, monkeypatch):
    """A rejected POST is the same defect class — the bytes still must not drop."""
    _hub_configured(monkeypatch)
    monkeypatch.setattr(bot, "_submit_doc_to_hub", AsyncMock(return_value=False))
    update, context = _mock_doc_update_context()

    await _run_handler(update, context)

    spooled = list((spool_env / "documents").iterdir())
    assert len(spooled) == 1
    assert spooled[0].read_bytes() == _PDF
    assert "Saved MG20N622.pdf" in _replies(update)[-1]


# --- the handler: Hub door open (unchanged behaviour) -------------------------


@pytest.mark.asyncio
async def test_configured_hub_submits_and_reports_unchanged(spool_env, monkeypatch):
    _hub_configured(monkeypatch)
    submit = AsyncMock(return_value=True)
    monkeypatch.setattr(bot, "_submit_doc_to_hub", submit)
    update, context = _mock_doc_update_context()

    await _run_handler(update, context)

    submit.assert_awaited_once()
    assert submit.await_args.args[0] == _PDF
    assert submit.await_args.args[1] == "MG20N622.pdf"

    replies = _replies(update)
    assert replies[0] == "Submitting MG20N622.pdf to the Hub..."
    assert "Submitted *MG20N622.pdf* to the Hub for review." in replies[-1]
    assert "proposed source once contextualized" in replies[-1]

    # Nothing spooled — the Hub has it.
    assert not (spool_env / "documents").exists()


# --- the handler: pre-checks speak to a technician ----------------------------


@pytest.mark.asyncio
async def test_non_pdf_message_is_technician_facing(spool_env, monkeypatch):
    _hub_configured(monkeypatch)
    update, context = _mock_doc_update_context(filename="notes.docx", mime="application/msword")

    await _run_handler(update, context)

    reply = _replies(update)[-1]
    assert "notes.docx" in reply
    assert "PDF" in reply and "send it again" in reply
    assert "application/msword" not in reply  # no raw MIME jargon


@pytest.mark.asyncio
async def test_oversize_message_is_technician_facing(spool_env, monkeypatch):
    _hub_configured(monkeypatch)
    update, context = _mock_doc_update_context()
    update.message.document.file_size = 25 * 1024 * 1024

    await _run_handler(update, context)

    reply = _replies(update)[-1]
    assert "25MB" in reply and "20MB" in reply
    assert "split the file" in reply


@pytest.mark.asyncio
async def test_download_failure_is_honest(spool_env, monkeypatch):
    _hub_configured(monkeypatch)
    update, context = _mock_doc_update_context()
    context.bot.get_file = AsyncMock(side_effect=RuntimeError("telegram down"))

    await _run_handler(update, context)

    reply = _replies(update)[-1]
    assert "couldn't download" in reply
    assert "telegram down" not in reply  # no raw exception text
    assert "Please send it again" in reply


# --- ops signal ---------------------------------------------------------------


def test_missing_vars_names_the_empty_token(monkeypatch):
    _hub_unconfigured(monkeypatch)
    assert "HUB_INGEST_TOKEN" in bot._hub_intake_missing_vars()

    monkeypatch.setattr(bot, "HUB_URL", "https://hub.example.com")
    assert bot._hub_intake_missing_vars() == ["HUB_INGEST_TOKEN"]

    monkeypatch.setattr(bot, "HUB_INGEST_TOKEN", "svc-token")
    assert bot._hub_intake_missing_vars() == []


def test_no_internal_string_left_in_the_handler():
    """The literal that reached a technician in prod is gone from the module."""
    import inspect

    assert _OLD_INTERNAL not in inspect.getsource(bot.document_handler)
