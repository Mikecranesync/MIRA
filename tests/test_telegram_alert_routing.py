"""Ops-alert routing must never default to the prod user-facing bot.

Guards the 2026-07-08 fix: heartbeat/probe/report/morning-brief traffic was
landing on @FactoryLM_Diagnose (TELEGRAM_BOT_TOKEN) because the senders defaulted
to the prod token+chat. They now resolve through a dedicated alert channel:
    TELEGRAM_ALERT_BOT_TOKEN → TELEGRAM_BOT_TOKEN_STG → TELEGRAM_BOT_TOKEN
    TELEGRAM_ALERT_CHAT_ID   → TELEGRAM_CHAT_ID       → TELEGRAM_REPORT_CHAT_ID
So when the alert vars are set (as they are in Doppler prd), ops traffic goes to
the staging bot, and the prod bot only falls through if nothing else is set.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_TN = Path(__file__).resolve().parents[1] / "mira-crawler" / "reporting" / "telegram_notify.py"
_spec = importlib.util.spec_from_file_location("telegram_notify", _TN)
tn = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tn)

_VARS = [
    "TELEGRAM_ALERT_BOT_TOKEN", "TELEGRAM_BOT_TOKEN_STG", "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_ALERT_CHAT_ID", "TELEGRAM_CHAT_ID", "TELEGRAM_REPORT_CHAT_ID",
]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for v in _VARS:
        monkeypatch.delenv(v, raising=False)
    yield


def test_token_prefers_alert_bot(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALERT_BOT_TOKEN", "STAGING")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "PROD")
    assert tn.alert_token() == "STAGING"  # never the prod bot when alert is set


def test_token_falls_back_to_stg_then_prod(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN_STG", "STG")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "PROD")
    assert tn.alert_token() == "STG"
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN_STG")
    assert tn.alert_token() == "PROD"  # last-resort only


def test_chat_prefers_alert_chat(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALERT_CHAT_ID", "8445149012")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "PROD_CHAT")
    assert tn.alert_chat_id() == "8445149012"


def test_explicit_arg_wins(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALERT_BOT_TOKEN", "STAGING")
    assert tn.alert_token("EXPLICIT") == "EXPLICIT"


def test_unset_returns_empty(monkeypatch):
    assert tn.alert_token() == ""
    assert tn.alert_chat_id() == ""
