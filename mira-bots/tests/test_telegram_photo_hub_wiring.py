"""HubV3 Phase 6 — Telegram bot wiring → Hub intake (replaces mira-ingest).

Confirms the photo and document handlers build the §2 telegram-route envelope
and submit it to the Hub import endpoint (not mira-ingest), carrying raw bytes
and the resolved tenant. Imports the real ``bot`` module so the wiring is
exercised, not a stand-in.
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
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_hubv3_wiring_test.db")

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


async def test_submit_photo_to_hub_builds_telegram_envelope(monkeypatch):
    seen: dict = {}

    async def _fake_submit(envelope, **kwargs):
        seen["envelope"] = envelope
        seen["kwargs"] = kwargs
        return True

    monkeypatch.setattr(bot, "submit_intake_to_hub", _fake_submit)
    monkeypatch.setattr(bot, "HUB_IMPORT_URL", "https://hub.example.com")

    def _capture_resolve(cid):
        seen["resolve_arg"] = cid
        return "tenant-x"

    monkeypatch.setattr(bot.chat_tenant, "resolve", _capture_resolve)

    raw = b"\xff\xd8\xff conveyor photo bytes"
    # user_id != chat_id so a wrong resolve key is caught.
    await bot._submit_photo_to_hub(
        raw, "conveyor-1 nameplate", _fake_update(user_id=789, chat_id=-100200)
    )

    env = seen["envelope"]
    assert env["ingest_route"] == "telegram"
    assert env["review_status"] == "proposed"
    assert env["asset_hints"]["name"] == "conveyor-1"
    assert env["source_metadata"]["uploader"] == "789"
    assert env["source_metadata"]["mime"] == "image/jpeg"
    assert seen["kwargs"]["raw_bytes"] == raw
    assert seen["kwargs"]["tenant_id"] == "tenant-x"
    # Tenant resolves by uploader user id, NOT the (group) chat id.
    assert seen["resolve_arg"] == "789"


async def test_submit_doc_to_hub_builds_telegram_envelope(monkeypatch):
    seen: dict = {}

    async def _fake_submit(envelope, **kwargs):
        seen["envelope"] = envelope
        seen["kwargs"] = kwargs
        return True

    monkeypatch.setattr(bot, "submit_intake_to_hub", _fake_submit)
    monkeypatch.setattr(bot, "HUB_IMPORT_URL", "https://hub.example.com")
    monkeypatch.setattr(bot.chat_tenant, "resolve", lambda cid: "tenant-y")

    pdf = b"%PDF-1.7 fake manual"
    await bot._submit_doc_to_hub(pdf, "gs10manual.pdf", "drive manual", _fake_update())

    env = seen["envelope"]
    assert env["ingest_route"] == "telegram"
    assert env["review_status"] == "proposed"
    assert env["source_metadata"]["filename"] == "gs10manual.pdf"
    assert env["source_metadata"]["mime"] == "application/pdf"
    assert seen["kwargs"]["raw_bytes"] == pdf
    assert seen["kwargs"]["filename"] == "gs10manual.pdf"
    assert seen["kwargs"]["tenant_id"] == "tenant-y"


async def test_submit_photo_to_hub_noop_when_unconfigured(monkeypatch):
    called = {"n": 0}

    async def _fake_submit(*a, **k):
        called["n"] += 1
        return True

    monkeypatch.setattr(bot, "submit_intake_to_hub", _fake_submit)
    monkeypatch.setattr(bot, "HUB_IMPORT_URL", "")  # not configured

    await bot._submit_photo_to_hub(b"x", "cap", _fake_update())
    assert called["n"] == 0  # no submit attempted when Hub URL absent
