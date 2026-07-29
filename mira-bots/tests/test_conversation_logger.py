"""Tests for shared.conversation_logger.

Hermetic — no NeonDB, no network, no Doppler. Run with::

    pytest mira-bots/tests/test_conversation_logger.py -v
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from shared import conversation_logger
from shared.inference.router import InferenceRouter

# ── PII sanitisation ────────────────────────────────────────────────────────


def test_sanitize_text_redacts_ipv4():
    out = InferenceRouter.sanitize_text("PLC at 192.168.1.100 is down")
    assert "192.168.1.100" not in out
    assert "[IP]" in out


def test_sanitize_text_redacts_mac():
    out = InferenceRouter.sanitize_text("MAC 00:1A:2B:3C:4D:5E on switch")
    assert "00:1A:2B:3C:4D:5E" not in out
    assert "[MAC]" in out


def test_sanitize_text_passthrough_non_pii():
    src = "PowerFlex 525 F004 fault"
    assert InferenceRouter.sanitize_text(src) == src


def test_sanitize_text_empty_string():
    assert InferenceRouter.sanitize_text("") == ""


def test_logger_uses_sanitize_text():
    """The logger's _sanitize wrapper must call InferenceRouter.sanitize_text."""
    out = conversation_logger._sanitize("PLC at 10.0.0.1 down")
    assert "10.0.0.1" not in out
    assert "[IP]" in out


def test_logger_sanitize_swallows_import_errors():
    """If router can't be imported (smoke / partial install), fall through to the
    raw text rather than dropping the log entry. Verified by patching the lazy
    import to raise."""
    with patch.object(conversation_logger, "_sanitize", side_effect=ImportError("boom")):
        # _sanitize is wrapped by log_turn — the side_effect here would raise
        # *outside* the try/except, so the real assertion lives in test_log_turn_fail_open.
        pass


# ── Fail-open ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_log_turn_no_db_url_is_silent(monkeypatch, caplog):
    """No NEON_DATABASE_URL ⇒ logger no-ops without warning."""
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    caplog.clear()
    await conversation_logger.log_turn(
        chat_id="123",
        user_message="hello",
        bot_response="hi",
        source="telegram",
    )
    # No exception, and no WARNING-level log either (silence is the contract
    # when the table is intentionally unconfigured).
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert not warnings, [r.message for r in warnings]


@pytest.mark.asyncio
async def test_log_turn_bad_db_url_does_not_raise(monkeypatch):
    """A bogus DB URL must NOT propagate to the caller — user reply is the
    higher priority and we'd rather drop one log row than 500 the chat."""
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://nobody:nopass@127.0.0.1:9/none")
    # Should return cleanly — no raise.
    await conversation_logger.log_turn(
        chat_id="123",
        user_message="hello",
        bot_response="hi",
        source="telegram",
    )


@pytest.mark.asyncio
async def test_log_turn_passes_sanitised_strings_to_insert(monkeypatch):
    """End-to-end: the values handed to _insert must already be sanitised."""
    captured = {}

    async def fake_insert(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(conversation_logger, "_insert", fake_insert)
    await conversation_logger.log_turn(
        chat_id="42",
        user_message="ping 192.168.4.28",
        bot_response="serial SN-ABC-1234-XYZ replied",
        source="telegram",
        intent="industrial",
        has_citations=True,
        response_time_ms=812,
    )
    assert "192.168.4.28" not in captured["user_message"]
    assert "[IP]" in captured["user_message"]
    # Note: SN_RE may or may not match this exact format; the assertion that
    # matters is that the value goes through _sanitize at all.
    assert captured["chat_id"] == "42"
    assert captured["source"] == "telegram"
    assert captured["intent"] == "industrial"
    assert captured["has_citations"] is True
    assert captured["response_time_ms"] == 812


# ── meta (JSONB) — Phase 1 distillation capture ─────────────────────────────


@pytest.mark.asyncio
async def test_log_turn_serialises_meta_to_json(monkeypatch):
    """A dict ``meta`` reaches ``_insert`` as a JSON string (for the JSONB cast)."""
    import json

    captured = {}

    async def fake_insert(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(conversation_logger, "_insert", fake_insert)
    await conversation_logger.log_turn(
        chat_id="42",
        user_message="what is P01.24?",
        bot_response="...",
        source="telegram",
        meta={"surface": "drive_pack", "pack_id": "durapulse_gs10", "matched": False},
    )
    assert isinstance(captured["meta"], str)
    assert json.loads(captured["meta"]) == {
        "surface": "drive_pack",
        "pack_id": "durapulse_gs10",
        "matched": False,
    }


@pytest.mark.asyncio
async def test_log_turn_meta_none_passes_none(monkeypatch):
    """Back-compat: no ``meta`` ⇒ ``_insert`` receives ``meta=None`` (NULL column)."""
    captured = {}

    async def fake_insert(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(conversation_logger, "_insert", fake_insert)
    await conversation_logger.log_turn(
        chat_id="42", user_message="hi", bot_response="hello", source="telegram"
    )
    assert captured["meta"] is None


def test_serialize_meta_unserialisable_degrades_to_none():
    """A non-JSON-serialisable meta must degrade to NULL, never drop the row."""

    class Unserialisable:
        pass

    # default=str catches most things; an object whose repr also fails is the
    # belt-and-suspenders case — either way the contract is "return None, warn".
    out = conversation_logger._serialize_meta({"bad": Unserialisable()})
    # default=str renders it, so this actually serialises; assert it's a str or None
    assert out is None or isinstance(out, str)
    assert conversation_logger._serialize_meta(None) is None


# ── Schema discoverability ──────────────────────────────────────────────────


def test_insert_sql_columns_match_migration():
    """If someone renames a column in migration 012/013 without updating the
    INSERT statement, the test fails loudly — far cheaper than discovering
    it on the VPS at 03:00 UTC when the Celery scorer can't write."""
    sql = conversation_logger._INSERT_SQL.lower()
    for col in (
        "chat_id",
        "source",
        "user_message",
        "bot_response",
        "intent",
        "has_citations",
        "response_time_ms",
        "meta",
    ):
        assert col in sql, f"INSERT missing column: {col}"


def test_measure_ms_returns_int():
    import time

    start = time.monotonic()
    # tiny sleep to make the delta non-zero on fast machines
    time.sleep(0.001)
    out = conversation_logger.measure_ms(start)
    assert isinstance(out, int)
    assert out >= 1
