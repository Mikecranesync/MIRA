"""Telegram bot wiring → the Hub's citable folder-upload door (#2540).

Confirms the photo and document handlers POST the raw file to the Hub folder
door (``submit_file_to_hub_folder``), carrying the raw bytes and the tenant
resolved by the *uploader* id (not the group chat id), and that both submit
paths no-op when the Hub intake env is unset. Imports the real ``bot`` module so
the wiring is exercised, not a stand-in.
"""

from __future__ import annotations

import os
import sys
import types

# Dummy env so bot.py imports cleanly (mirrors test_image_downscale.py).
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_hub_wiring_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.modules.pop("chat_adapter", None)

import bot  # noqa: E402


def _fake_update(user_id=789, chat_id=42):
    return types.SimpleNamespace(
        effective_user=types.SimpleNamespace(id=user_id),
        effective_chat=types.SimpleNamespace(id=chat_id),
        message=types.SimpleNamespace(
            date=types.SimpleNamespace(isoformat=lambda: "2026-06-20T12:00:00+00:00")
        ),
    )


def _configure(monkeypatch):
    """Point the bot at a fake Hub so `_hub_intake_configured()` is True."""
    monkeypatch.setattr(bot, "HUB_URL", "https://hub.example.com")
    monkeypatch.setattr(bot, "HUB_BASE_PATH", "/hub")
    monkeypatch.setattr(bot, "HUB_INGEST_TOKEN", "svc-token")


async def test_submit_photo_to_hub_posts_folder_upload(monkeypatch):
    seen: dict = {}

    async def _fake_submit(**kwargs):
        seen["kwargs"] = kwargs
        return True

    _configure(monkeypatch)
    monkeypatch.setattr(bot, "submit_file_to_hub_folder", _fake_submit)

    def _capture_resolve(cid):
        seen["resolve_arg"] = cid
        return "tenant-x"

    monkeypatch.setattr(bot.chat_tenant, "resolve", _capture_resolve)

    raw = b"\xff\xd8\xff conveyor photo bytes"
    # user_id != chat_id so a wrong resolve key is caught.
    await bot._submit_photo_to_hub(
        raw, "conveyor-1 nameplate", _fake_update(user_id=789, chat_id=-100200)
    )

    kw = seen["kwargs"]
    assert kw["raw_bytes"] == raw
    assert kw["mime"] == "image/jpeg"
    assert kw["filename"] == "photo.jpg"
    assert kw["tenant_id"] == "tenant-x"
    assert kw["token"] == "svc-token"
    # Tenant resolves by uploader user id, NOT the (group) chat id.
    assert seen["resolve_arg"] == "789"


async def test_submit_doc_to_hub_posts_folder_upload(monkeypatch):
    seen: dict = {}

    async def _fake_submit(**kwargs):
        seen["kwargs"] = kwargs
        return True

    _configure(monkeypatch)
    monkeypatch.setattr(bot, "submit_file_to_hub_folder", _fake_submit)
    monkeypatch.setattr(bot.chat_tenant, "resolve", lambda cid: "tenant-y")

    pdf = b"%PDF-1.7 fake manual"
    ok = await bot._submit_doc_to_hub(pdf, "gs10manual.pdf", "drive manual", _fake_update())

    assert ok is True
    kw = seen["kwargs"]
    assert kw["raw_bytes"] == pdf
    assert kw["filename"] == "gs10manual.pdf"
    assert kw["mime"] == "application/pdf"
    assert kw["tenant_id"] == "tenant-y"


async def test_submit_photo_to_hub_noop_when_unconfigured(monkeypatch):
    called = {"n": 0}

    async def _fake_submit(**k):
        called["n"] += 1
        return True

    monkeypatch.setattr(bot, "submit_file_to_hub_folder", _fake_submit)
    # Not configured — no base URL, no token.
    monkeypatch.setattr(bot, "HUB_URL", "")
    monkeypatch.setattr(bot, "HUB_IMPORT_URL", "")
    monkeypatch.setattr(bot, "HUB_INGEST_TOKEN", "")

    await bot._submit_photo_to_hub(b"x", "cap", _fake_update())
    assert called["n"] == 0  # no submit attempted when Hub intake unconfigured
